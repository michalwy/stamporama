import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma, type DbTransaction } from "./db";
import { normalizeLanguage } from "./languages";
import { normalizeFacebookProfileUrl } from "./facebook-profile-rules";
import { FACEBOOK_PROFILES_SELECT } from "./facebook-sales";
import { normalizeMarketCode } from "./market-anchoring";
import { mergedContactDetails } from "./contact-merge-rules";
import { conversationAttachmentRefs, deleteConversationAttachmentBytes } from "./conversation-attachments";

// Server-side domain logic for the per-collection Contact address book (ADR-0008,
// #107). A Contact is a person or firm the collector deals with — sellers, buyers, exchange
// partners, auction houses. A marketplace is not one: it is a `Platform` (#1955; ADR-0071,
// `platforms.ts`). Roles are independent, combinable boolean flags (a contact can be several at
// once), mirroring the `Item` disposition flags (ADR-0007 §4). `createContact` may be called with no roles set: create-on-type
// from the acquisition-source autocomplete (#103b) produces a role-less contact and
// the roles are filled in separately. `name` is unique per collection.
//
// All access is collection-owner-scoped; checks live here, server-side.

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve a contact to its collection and verify the caller owns it. Returns the
 * `collectionId` so callers can re-check the name-unique constraint scope. */
async function assertContactOwner(
  ownerId: string,
  contactId: string
): Promise<{ collectionId: string }> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!contact || contact.collection.ownerId !== ownerId) {
    throw new Error("Contact not found or access denied.");
  }
  return { collectionId: contact.collectionId };
}

/** Raised when a create would collide with an existing contact name in the same
 * collection (the `(collectionId, name)` unique index). Lets callers surface a
 * friendly message and lets create-on-type fall back to the existing row. */
export class ContactNameTakenError extends Error {
  constructor(name: string) {
    super(`A contact named "${name}" already exists in this collection.`);
    this.name = "ContactNameTakenError";
  }
}

/** Raised when a field's value is refused by its own rule — a Facebook profile link (#1545), or one
 * another contact already holds (#2042) — so the form can say which and why rather than failing
 * generically. */
export class ContactFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactFieldError";
  }
}

/** The profile links as stored: each normalised, so a buyer's lookup is an equality (#1545), blanks
 * dropped and repeats folded into one, in the order typed (#2042). Undefined stays undefined — an
 * update that never showed the field leaves the profiles alone. */
function profileUrlsData(raw: readonly string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const urls: string[] = [];
  for (const typed of raw) {
    const result = normalizeFacebookProfileUrl(typed);
    if (!result.ok) throw new ContactFieldError(result.message);
    if (result.value && !urls.includes(result.value)) urls.push(result.value);
  }
  return urls;
}

/**
 * Give a contact exactly these Facebook profiles (#2042): the ones no longer listed go, the new ones
 * are added, the ones kept keep their row (and so their place in the order). A profile is one
 * person's, so one another contact of the collection already holds is refused, naming that contact —
 * the unique index would refuse it anyway, but only as a bare violation.
 */
async function writeFacebookProfiles(
  tx: DbTransaction,
  collectionId: string,
  contactId: string,
  urls: string[]
): Promise<void> {
  const taken = await tx.contactFacebookProfile.findFirst({
    where: { collectionId, url: { in: urls }, contactId: { not: contactId } },
    select: { url: true, contact: { select: { name: true } } },
  });
  if (taken) {
    throw new ContactFieldError(`The Facebook profile ${taken.url} is already on the contact ${taken.contact.name}.`);
  }
  await tx.contactFacebookProfile.deleteMany({ where: { contactId, url: { notIn: urls } } });
  await tx.contactFacebookProfile.createMany({
    data: urls.map((url) => ({ collectionId, contactId, url })),
    skipDuplicates: true,
  });
}

/** A market as written (#1634): blank is none, anything else must be a two-letter country code.
 * `undefined` passes through, so an update that does not mention it leaves it alone. */
function marketData(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === "") return null;
  const code = normalizeMarketCode(raw);
  if (!code) throw new ContactFieldError("A market is a two-letter country code, such as DE.");
  return code;
}

/** Raised when a delete is blocked because the contact is still referenced by one or
 * more purchases as their supplier. The `Purchase` FK is `onDelete: Restrict`
 * (ADR-0008/0009), so the contact must be detached from those purchases first. */
export class ContactInUseError extends Error {
  constructor(public readonly referenceCount: number) {
    super(
      `This contact is used by ${referenceCount} purchase${referenceCount === 1 ? "" : "s"} and cannot be deleted. Detach it from those purchases first.`
    );
    this.name = "ContactInUseError";
  }
}

/** The combinable role flags. All default to false; any combination is valid,
 * including none at all. */
export interface ContactRoles {
  buyer: boolean;
  seller: boolean;
  exchangePartner: boolean;
  auctionHouse: boolean;
  other: boolean;
}

export interface ContactData extends ContactRoles {
  id: string;
  collectionId: string;
  name: string;
  notes: string | null;
  /** The legal name, where it differs from the name the contact is filed under (#463) — a
   * marketplace buyer is filed under their login, and the parcel carries the name on the order.
   * Null on nearly every contact. */
  fullName: string | null;
  email: string | null;
  phone: string | null;
  /** The person's Facebook profile links, normalised (#1545), in the order they were added — what a
   * Facebook buyer is recognised by, any of them (#2042). Empty on nearly every contact. */
  facebookProfileUrls: string[];
  /** The country this contact sells in (#1634; ADR-0064), ISO 3166-1 alpha-2 — where its auction
   * results count. Null is *not known*: the platform's market then answers, and failing that the
   * collection's home market. */
  market: string | null;
  /** Seller defaults for auction sales (#350, ADR-0021): the currency and fees this seller normally
   * trades on. **Seeded** onto an `AuctionSale` at creation and editable there, so changing them
   * here never re-prices a sale already tracked or settled. Only meaningful for the `seller` /
   * `auctionHouse` roles; the amounts are 2-dp strings, like every other money field crossing this
   * boundary. */
  defaultCurrency: string | null;
  defaultShippingCost: string | null;
  buyerPremiumPercent: string | null;
  buyerPremiumFixed: string | null;
  createdAt: Date;
}

const CONTACT_SELECT = {
  id: true,
  collectionId: true,
  name: true,
  notes: true,
  fullName: true,
  email: true,
  phone: true,
  facebookProfiles: FACEBOOK_PROFILES_SELECT,
  market: true,
  buyer: true,
  seller: true,
  exchangePartner: true,
  auctionHouse: true,
  other: true,
  defaultCurrency: true,
  defaultShippingCost: true,
  buyerPremiumPercent: true,
  buyerPremiumFixed: true,
  createdAt: true,
} as const;

/** A contact row as Prisma returns it under {@link CONTACT_SELECT} — identical to
 * {@link ContactData} except that the seller defaults are still `Decimal`s and the profiles are
 * still rows. */
type ContactRow = Omit<
  ContactData,
  | "defaultShippingCost"
  | "buyerPremiumPercent"
  | "buyerPremiumFixed"
  | "facebookProfileUrls"
> & {
  defaultShippingCost: Decimal | null;
  buyerPremiumPercent: Decimal | null;
  buyerPremiumFixed: Decimal | null;
  facebookProfiles: { url: string }[];
};

/** Money leaves this module as a 2-dp string, the convention the rest of the domain layer follows
 * (`offers.ts`, `valuation.ts`) — a `Decimal` does not survive the server/client boundary. */
function toContactData({ facebookProfiles, ...row }: ContactRow): ContactData {
  return {
    ...row,
    facebookProfileUrls: facebookProfiles.map((profile) => profile.url),
    defaultShippingCost: row.defaultShippingCost?.toFixed(2) ?? null,
    buyerPremiumPercent: row.buyerPremiumPercent?.toFixed(2) ?? null,
    buyerPremiumFixed: row.buyerPremiumFixed?.toFixed(2) ?? null,
  };
}

/** The seller-default columns as Prisma writes them. Blank normalises to null (not recorded);
 * an unparseable amount is dropped rather than stored as zero, since zero shipping is a claim. */
function amount(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return Number.isFinite(Number(value)) ? value : null;
}

function sellerDefaults(data: ContactCreateInput): {
  defaultCurrency: string | null;
  defaultShippingCost: string | null;
  buyerPremiumPercent: string | null;
  buyerPremiumFixed: string | null;
} {
  return {
    defaultCurrency: data.defaultCurrency?.trim() || null,
    defaultShippingCost: amount(data.defaultShippingCost),
    buyerPremiumPercent: amount(data.buyerPremiumPercent),
    buyerPremiumFixed: amount(data.buyerPremiumFixed),
  };
}

export interface ContactCreateInput {
  name: string;
  notes?: string | null;
  /** The legal name beside the filed-under name (#463); blank clears it. */
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** The Facebook profile links (#1545, several since #2042), as typed — each normalised on write,
   * refused when it is not one or another contact holds it; blanks are dropped. The list replaces the
   * contact's profiles; omitted on an update leaves them as they are. */
  facebookProfileUrls?: readonly string[];
  /** The market (#1634), as typed — normalised on write, refused when it is not a two-letter code.
   * Omitted on an update leaves it as it is. */
  market?: string | null;
  buyer?: boolean;
  seller?: boolean;
  exchangePartner?: boolean;
  auctionHouse?: boolean;
  other?: boolean;
  /** The seller's defaults for auction sales (#350) — currency and fees, each null when the seller
   * states none. Only meaningful for the `seller` / `auctionHouse` roles; amounts arrive as
   * decimal strings from the form. */
  defaultCurrency?: string | null;
  defaultShippingCost?: string | null;
  buyerPremiumPercent?: string | null;
  buyerPremiumFixed?: string | null;
}

/** A contact row for the management UI: the full contact plus how many purchases
 * reference it as their supplier. A non-zero `referenceCount` means delete is
 * blocked (see {@link deleteContact}). */
export interface ContactListItem extends ContactData {
  referenceCount: number;
}

/** Full contact list for a collection, name-ordered, each carrying its purchase
 * reference count for the management UI's delete guard. */
export async function listContacts(
  ownerId: string,
  collectionId: string
): Promise<ContactListItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.contact.findMany({
    where: { collectionId },
    select: {
      ...CONTACT_SELECT,
      _count: { select: { purchases: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map(({ _count, ...contact }) => ({
    ...toContactData(contact),
    referenceCount: _count.purchases,
  }));
}

/** One contact as its list row carries it, for the contact's own page (#1708) — whose *Edit* opens
 * the list's dialog, so it reads the same shape. Null when not found or not the caller's. */
export async function getContactListItem(
  ownerId: string,
  contactId: string
): Promise<ContactListItem | null> {
  const row = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      ...CONTACT_SELECT,
      collection: { select: { ownerId: true } },
      _count: { select: { purchases: true } },
    },
  });
  if (!row) return null;
  const { _count, collection, ...contact } = row;
  if (collection.ownerId !== ownerId) return null;
  return {
    ...toContactData(contact),
    referenceCount: _count.purchases,
  };
}

/** Case-insensitive search over the name **and the full name** (#463), capped at 20 rows, for the
 * acquisition-source autocomplete (#103b). Both, because a marketplace buyer is filed under their
 * login and looked for by the name you remember — typing "Bronisław" has to find `bronek_1980`, or
 * the full name is a field that only ever gets written. An empty query returns the first 20 contacts
 * by name. An optional `role` narrows to contacts carrying that role flag (e.g. `seller` for the
 * purchase supplier picker, #120). A platform is not a contact: its pickers search
 * `searchPlatforms` (#1955). */
export async function searchContacts(
  ownerId: string,
  collectionId: string,
  query: string,
  role?: keyof ContactRoles
): Promise<ContactData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.contact.findMany({
    where: {
      collectionId,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { fullName: { contains: query, mode: "insensitive" } },
      ],
      ...(role ? { [role]: true } : {}),
    },
    select: CONTACT_SELECT,
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows.map(toContactData);
}

/** Resolve a party field (a supplier, an auction house) to a contact id, creating the
 * contact on the fly when the user typed a new name without picking a suggestion (#120). A
 * platform field resolves through `resolvePlatform` instead (#1955).
 *
 * Resolution order:
 *  1. An explicit `id` is honoured only if it belongs to `collectionId` (guards against a
 *     tampered/cross-collection id); otherwise it is ignored and we fall through to name.
 *  2. A `name` is matched case-insensitively against existing contacts and reused, so the
 *     same supplier is never duplicated.
 *  3. Failing both, a new contact is created carrying `role` (a supplier gets `seller`).
 *     Returns `null` when neither id nor name is given.
 *
 * The caller must already have asserted ownership of `collectionId`. */
export async function resolvePurchaseContact(
  collectionId: string,
  input: { id?: string | null; name?: string | null; role: keyof ContactRoles }
): Promise<string | null> {
  const id = input.id?.trim();
  if (id) {
    const existing = await prisma.contact.findFirst({
      where: { id, collectionId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const name = input.name?.trim();
  if (!name) return null;

  const byName = await prisma.contact.findFirst({
    where: { collectionId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (byName) return byName.id;

  try {
    const created = await prisma.contact.create({
      data: { collectionId, name, [input.role]: true },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Lost a race (or an exact-case duplicate slipped past the insensitive match): re-read.
    if (isUniqueViolation(err)) {
      const again = await prisma.contact.findFirst({
        where: { collectionId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (again) return again.id;
    }
    throw err;
  }
}

/** Create a contact. `name` is required; roles are optional and independent, so a
 * contact may be created with no roles at all (create-on-type, #103b). Throws
 * {@link ContactNameTakenError} when the name already exists in the collection. */
export async function createContact(
  ownerId: string,
  collectionId: string,
  data: ContactCreateInput
): Promise<ContactData> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = data.name.trim();
  if (!name) throw new Error("Contact name is required.");
  const profileUrls = profileUrlsData(data.facebookProfileUrls) ?? [];
  const market = marketData(data.market) ?? null;
  try {
    return toContactData(await prisma.$transaction(async (tx) => {
      const { id } = await tx.contact.create({
        data: {
          collectionId,
          name,
          ...sellerDefaults(data),
          notes: data.notes ?? null,
          fullName: data.fullName ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          market,
          buyer: data.buyer ?? false,
          seller: data.seller ?? false,
          exchangePartner: data.exchangePartner ?? false,
          auctionHouse: data.auctionHouse ?? false,
          other: data.other ?? false,
        },
        select: { id: true },
      });
      await writeFacebookProfiles(tx, collectionId, id, profileUrls);
      return tx.contact.findUniqueOrThrow({ where: { id }, select: CONTACT_SELECT });
    }));
  } catch (err) {
    throw uniqueViolationError(err, name);
  }
}

/** Fields settable on update. `name` is required (it can be renamed but not cleared);
 * every other field is fully replaced, so the caller sends the complete role set. */
export type ContactUpdateInput = ContactCreateInput;

/** Update a contact's details and roles. Throws {@link ContactNameTakenError} when the
 * new name collides with another contact in the same collection. */
export async function updateContact(
  ownerId: string,
  contactId: string,
  data: ContactUpdateInput
): Promise<ContactData> {
  const { collectionId } = await assertContactOwner(ownerId, contactId);
  const name = data.name.trim();
  if (!name) throw new Error("Contact name is required.");
  const profileUrls = profileUrlsData(data.facebookProfileUrls);
  const market = marketData(data.market);
  try {
    return toContactData(await prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id: contactId },
        data: {
          name,
          ...sellerDefaults(data),
          notes: data.notes ?? null,
          fullName: data.fullName ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          market,
          buyer: data.buyer ?? false,
          seller: data.seller ?? false,
          exchangePartner: data.exchangePartner ?? false,
          auctionHouse: data.auctionHouse ?? false,
          other: data.other ?? false,
        },
        select: { id: true },
      });
      if (profileUrls) await writeFacebookProfiles(tx, collectionId, contactId, profileUrls);
      return tx.contact.findUniqueOrThrow({ where: { id: contactId }, select: CONTACT_SELECT });
    }));
  } catch (err) {
    throw uniqueViolationError(err, name);
  }
}

/**
 * The languages a collection actually needs **translations** for (#293, widened by #777): the
 * distinct languages it puts to use — its platforms' listing languages (`Platform.titleLanguage`)
 * and its albums' printed languages (`Album.language`, #767) — minus the collection's own
 * `defaultLanguage`, since text in that language already lives in the entity's default column and a
 * translation row would duplicate it.
 * This *is* the collection's translation language set (there is no separate language configuration,
 * #265): entity forms offer a per-language input for exactly these codes, and an empty result
 * means no translation UI at all. It stays **derived from use** in both directions — an album in a
 * language nothing is sold in makes that language typeable everywhere, and deleting the last album
 * in it takes the input away again.
 */
export async function getCollectionTitleLanguages(
  ownerId: string,
  collectionId: string
): Promise<string[]> {
  return (await getCollectionTranslationContext(ownerId, collectionId)).titleLanguages;
}

/** What an entity form needs to render its per-language inputs (#293–#296): the languages to offer,
 * and the language its plain fields are labelled with. */
export interface CollectionTranslationContext {
  /** See {@link getCollectionTitleLanguages}. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The collection's `defaultLanguage` — the language its entity columns are written in. */
  defaultLanguage: string;
}

/**
 * {@link getCollectionTitleLanguages} plus the default language, in one round trip. Server-rendered
 * screens (Settings, Areas) get both from their page loader; the issue and stamp dialogs (#295,
 * #296) are opened from six different client call sites, so they fetch this instead of having it
 * drilled through every one of them.
 */
export async function getCollectionTranslationContext(
  ownerId: string,
  collectionId: string
): Promise<CollectionTranslationContext> {
  await assertCollectionOwner(ownerId, collectionId);
  const [collection, platformRows, albumRows] = await Promise.all([
    prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { defaultLanguage: true },
    }),
    prisma.platform.findMany({
      where: { collectionId, titleLanguage: { not: null } },
      select: { titleLanguage: true },
      distinct: ["titleLanguage"],
    }),
    // Albums are the second kind of use (#777, #767). `Album.language` is NOT NULL — an album is a
    // printed artefact and the language is a fact about it, not a pointer that could go missing —
    // so unlike `titleLanguage` there is no null to filter out and no null branch below.
    prisma.album.findMany({
      where: { collectionId },
      select: { language: true },
      distinct: ["language"],
    }),
  ]);
  const defaultLanguage = normalizeLanguage(collection.defaultLanguage);
  const codes = new Set<string>();
  for (const value of [
    ...platformRows.map((r) => r.titleLanguage),
    ...albumRows.map((r) => r.language),
  ]) {
    const code = normalizeLanguage(value);
    if (code && code !== defaultLanguage) codes.add(code);
  }
  return {
    titleLanguages: Array.from(codes).sort(),
    defaultLanguage: defaultLanguage ?? collection.defaultLanguage,
  };
}

/** Delete a contact. Blocked with {@link ContactInUseError} when any purchase still
 * references it as its supplier (`onDelete: Restrict`, ADR-0008/0009) — the
 * caller must detach it from those purchases first. Its conversation log (#2149) goes with it, and
 * the files attached to its entries (#2150) — the cascade drops their rows, so the bytes are read
 * first and deleted once the contact is gone. */
export async function deleteContact(
  ownerId: string,
  contactId: string
): Promise<void> {
  await assertContactOwner(ownerId, contactId);
  const referenceCount = await prisma.purchase.count({
    where: { contactId },
  });
  if (referenceCount > 0) throw new ContactInUseError(referenceCount);
  const attachments = await conversationAttachmentRefs({ entry: { contactId } });
  await prisma.contact.delete({ where: { id: contactId } });
  await deleteConversationAttachmentBytes(attachments);
}

// ── Merge (#2043) ────────────────────────────────────────────────────────────────────────────────
//
// The same person sometimes ends up as two contacts — a buyer bidding from two Facebook accounts, a
// contact made twice by mistake. Merging moves everything that names the other contact to the one
// that remains, gives it the details it lacked (`contact-merge-rules.ts`), and deletes the other.

/** A contact as the merge dialog shows it: its details, and how many records name it — what moves
 * when it is the one merged away. */
export interface ContactMergeCandidate extends ContactData {
  purchaseCount: number;
  saleCount: number;
  tradeCount: number;
  /** Auction sales tracked with it as the seller or house (ADR-0021). */
  auctionSaleCount: number;
  /** Realised prices recorded from it as the auction house (#1633). */
  priceObservationCount: number;
  /** Entries of the conversation log with it (#2149). */
  conversationEntryCount: number;
}

const MERGE_COUNT_SELECT = {
  _count: {
    select: {
      purchases: true,
      salesBuyer: true,
      trades: true,
      auctionSalesSeller: true,
      priceObservationsHouse: true,
      conversationEntries: true,
    },
  },
} as const;

/** Raised when two contacts cannot be merged — one is missing, or they are the same contact. */
export class ContactMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactMergeError";
  }
}

/** The two contacts the merge dialog compares, with what each would bring along. */
export async function getContactMergePair(
  ownerId: string,
  contactId: string,
  otherContactId: string
): Promise<{ contact: ContactMergeCandidate; other: ContactMergeCandidate }> {
  const { collectionId } = await assertContactOwner(ownerId, contactId);
  if (contactId === otherContactId) throw new ContactMergeError("A contact cannot be merged with itself.");
  const rows = await prisma.contact.findMany({
    where: { collectionId, id: { in: [contactId, otherContactId] } },
    select: { ...CONTACT_SELECT, ...MERGE_COUNT_SELECT },
  });
  const toCandidate = (id: string): ContactMergeCandidate => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new ContactMergeError("That contact is not in this collection any more.");
    const { _count, ...contact } = row;
    return {
      ...toContactData(contact),
      purchaseCount: _count.purchases,
      saleCount: _count.salesBuyer,
      tradeCount: _count.trades,
      auctionSaleCount: _count.auctionSalesSeller,
      priceObservationCount: _count.priceObservationsHouse,
      conversationEntryCount: _count.conversationEntries,
    };
  };
  return { contact: toCandidate(contactId), other: toCandidate(otherContactId) };
}

/**
 * Merge `otherContactId` into `remainingContactId` (#2043): every purchase, sale, trade, auction sale,
 * price observation and conversation entry naming the other moves to the remaining contact, and so
 * do its Facebook profiles; the remaining one keeps its name and details, takes the ones it lacks, the union of the
 * roles and the other's notes under its own (`mergedContactDetails`), and the other is deleted. One
 * transaction, so a merge that fails half-way leaves both as they were.
 */
export async function mergeContacts(
  ownerId: string,
  input: { remainingContactId: string; otherContactId: string }
): Promise<void> {
  const { remainingContactId: remainingId, otherContactId: otherId } = input;
  const { collectionId } = await assertContactOwner(ownerId, remainingId);
  if (remainingId === otherId) throw new ContactMergeError("A contact cannot be merged with itself.");

  await prisma.$transaction(async (tx) => {
    const rows = await tx.contact.findMany({
      where: { collectionId, id: { in: [remainingId, otherId] } },
      select: { ...CONTACT_SELECT, defaultAuctionPlatformId: true },
    });
    const remainingRow = rows.find((r) => r.id === remainingId);
    const otherRow = rows.find((r) => r.id === otherId);
    if (!remainingRow || !otherRow) {
      throw new ContactMergeError("That contact is not in this collection any more.");
    }
    const merged = mergedContactDetails(toContactData(remainingRow), toContactData(otherRow));

    await tx.purchase.updateMany({ where: { contactId: otherId }, data: { contactId: remainingId } });
    await tx.sale.updateMany({ where: { buyerId: otherId }, data: { buyerId: remainingId } });
    await tx.trade.updateMany({ where: { partnerId: otherId }, data: { partnerId: remainingId } });
    await tx.auctionSale.updateMany({ where: { sellerId: otherId }, data: { sellerId: remainingId } });
    await tx.priceObservation.updateMany({
      where: { auctionHouseId: otherId },
      data: { auctionHouseId: remainingId },
    });
    // The conversation log moves whole, with the sales its entries name (#2149).
    await tx.conversationEntry.updateMany({ where: { contactId: otherId }, data: { contactId: remainingId } });
    // A profile is unique per collection, so the other's can never collide with the remaining's.
    await tx.contactFacebookProfile.updateMany({
      where: { contactId: otherId },
      data: { contactId: remainingId },
    });

    await tx.contact.update({
      where: { id: remainingId },
      data: {
        notes: merged.notes,
        fullName: merged.fullName,
        email: merged.email,
        phone: merged.phone,
        market: merged.market,
        buyer: merged.buyer,
        seller: merged.seller,
        exchangePartner: merged.exchangePartner,
        auctionHouse: merged.auctionHouse,
        other: merged.other,
        defaultCurrency: merged.defaultCurrency,
        defaultShippingCost: merged.defaultShippingCost,
        buyerPremiumPercent: merged.buyerPremiumPercent,
        buyerPremiumFixed: merged.buyerPremiumFixed,
        // A remembered value, not a detail on the form — still the other's memory is better than none.
        defaultAuctionPlatformId: remainingRow.defaultAuctionPlatformId ?? otherRow.defaultAuctionPlatformId,
      },
      select: { id: true },
    });
    // Nothing names the other any more; were something to have appeared since, the `Restrict` keys
    // refuse the delete and the whole merge with it.
    await tx.contact.delete({ where: { id: otherId } });
  });
}

/** Prisma unique-constraint violation (P2002) narrowing without importing the
 * Prisma error class into this server-only module's public surface. */
/** What a create or an update of a contact throws for a unique violation: the name's own error, or —
 * when the index hit was a profile's, a second contact having taken the link between the check and
 * the write — the profile's. Anything else is thrown as it came. */
function uniqueViolationError(err: unknown, name: string): unknown {
  if (!isUniqueViolation(err)) return err;
  const target = JSON.stringify((err as { meta?: unknown }).meta ?? "");
  if (target.includes("url")) {
    return new ContactFieldError("That Facebook profile is already on another contact.");
  }
  return new ContactNameTakenError(name);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
