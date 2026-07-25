import "server-only";
import { prisma } from "./db";
import { normalizeLanguage } from "./languages";
import { normalizePhotoSides } from "./offer-photo-config";

// Server-side domain logic for the per-collection Contact address book (ADR-0008,
// #107). A Contact is everyone the collector deals with — sellers, buyers, exchange
// partners, auction houses, platforms. Roles are independent, combinable boolean
// flags (a contact can be several at once), mirroring the `Item` disposition flags
// (ADR-0007 §4). `createContact` may be called with no roles set: create-on-type
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

/** Raised when a delete is blocked because the contact is still referenced by one or
 * more purchases (as supplier or platform). The `Purchase` FKs are `onDelete: Restrict`
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
  platform: boolean;
  other: boolean;
}

export interface ContactData extends ContactRoles {
  id: string;
  collectionId: string;
  name: string;
  notes: string | null;
  email: string | null;
  phone: string | null;
  /** The platform's fixed transaction currency (#196), or null when unset. Only meaningful for
   * contacts carrying the `platform` role. */
  platformCurrency: string | null;
  /** Free-text title template for this platform's listings (#210), or null (falls back to the
   * built-in default). Only meaningful for the `platform` role. */
  titleTemplate: string | null;
  /** Templates for the platform's longer listing texts — the public description (#266) and the
   * seller-only private note (#267) — or null, which means the field is simply not generated (there
   * is no built-in default). Only meaningful for the `platform` role. */
  descriptionTemplate: string | null;
  privateNoteTemplate: string | null;
  /** ISO 639-1 language the platform's generated listing text is written in (#293), or null when
   * unset. Only meaningful for the `platform` role; drives which entity translations the title
   * tokens resolve. */
  titleLanguage: string | null;
  /** The platform's hard photo limits (#308), each null when the platform states none. Read live by
   * the renderer (#310) rather than seeded onto offers. Only meaningful for the `platform` role. */
  maxPhotos: number | null;
  maxPhotoEdge: number | null;
  maxPhotoFileSizeMib: number | null;
  /** Photo defaults seeded onto every offer created on this platform (#308): which scan sides to
   * include, the per-tile label template (#312), and which collage template (#307) supplies the
   * render numbers. Changing them never touches an offer already prepared. */
  photoSides: string;
  tileLabelTemplate: string | null;
  defaultCollageTemplateId: string | null;
  createdAt: Date;
}

const CONTACT_SELECT = {
  id: true,
  collectionId: true,
  name: true,
  notes: true,
  email: true,
  phone: true,
  buyer: true,
  seller: true,
  exchangePartner: true,
  auctionHouse: true,
  platform: true,
  other: true,
  platformCurrency: true,
  titleTemplate: true,
  descriptionTemplate: true,
  privateNoteTemplate: true,
  titleLanguage: true,
  maxPhotos: true,
  maxPhotoEdge: true,
  maxPhotoFileSizeMib: true,
  photoSides: true,
  tileLabelTemplate: true,
  defaultCollageTemplateId: true,
  createdAt: true,
} as const;

export interface ContactCreateInput {
  name: string;
  notes?: string | null;
  email?: string | null;
  phone?: string | null;
  buyer?: boolean;
  seller?: boolean;
  exchangePartner?: boolean;
  auctionHouse?: boolean;
  platform?: boolean;
  other?: boolean;
  /** The platform's fixed currency (#196), or null. Set/edited on the platform's contact form. */
  platformCurrency?: string | null;
  /** The platform's title template (#210), or null. Set/edited on the platform's contact form. */
  titleTemplate?: string | null;
  /** The platform's description (#266) / private-note (#267) templates, or null (generate none).
   * Set/edited on the platform's contact form. */
  descriptionTemplate?: string | null;
  privateNoteTemplate?: string | null;
  /** The platform's listing language (#293), or null. Set/edited on the platform's contact form. */
  titleLanguage?: string | null;
  /** The platform's photo limits (#308) — null each means "no limit stated". */
  maxPhotos?: number | null;
  maxPhotoEdge?: number | null;
  maxPhotoFileSizeMib?: number | null;
  /** The photo defaults new offers on this platform are seeded from (#308). `photoSides` is
   * normalised; an unknown value falls back to the default side. */
  photoSides?: string | null;
  tileLabelTemplate?: string | null;
  /** The collage template (#307) new offers copy their render numbers from, or null for none. A
   * template id from another collection is rejected. */
  defaultCollageTemplateId?: string | null;
}

/** A contact row for the management UI: the full contact plus how many purchases
 * reference it (as supplier or platform). A non-zero `referenceCount` means delete is
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
      _count: { select: { purchases: true, platformPurchases: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map(({ _count, ...contact }) => ({
    ...contact,
    referenceCount: _count.purchases + _count.platformPurchases,
  }));
}

/** Case-insensitive name search, capped at 20 rows, for the acquisition-source
 * autocomplete (#103b). An empty query returns the first 20 contacts by name. An optional
 * `role` narrows to contacts carrying that role flag (e.g. `platform` for the purchase
 * platform picker, #120), so people don't show up where only platforms belong. */
export async function searchContacts(
  ownerId: string,
  collectionId: string,
  query: string,
  role?: keyof ContactRoles
): Promise<ContactData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.contact.findMany({
    where: {
      collectionId,
      name: { contains: query, mode: "insensitive" },
      ...(role ? { [role]: true } : {}),
    },
    select: CONTACT_SELECT,
    orderBy: { name: "asc" },
    take: 20,
  });
}

/** Resolve a purchase contact field (supplier / platform) to a contact id, creating the
 * contact on the fly when the user typed a new name without picking a suggestion (#120).
 *
 * Resolution order:
 *  1. An explicit `id` is honoured only if it belongs to `collectionId` (guards against a
 *     tampered/cross-collection id); otherwise it is ignored and we fall through to name.
 *  2. A `name` is matched case-insensitively against existing contacts and reused, so the
 *     same supplier is never duplicated.
 *  3. Failing both, a new contact is created carrying `role` (a supplier gets `seller`, a
 *     platform gets `platform`). Returns `null` when neither id nor name is given.
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

/** The photo columns (#308) as Prisma writes them, with the collage-template reference verified to
 * belong to the same collection — a tampered id from another collection is simply dropped. */
async function photoData(
  collectionId: string,
  data: ContactCreateInput
): Promise<{
  maxPhotos: number | null;
  maxPhotoEdge: number | null;
  maxPhotoFileSizeMib: number | null;
  photoSides: string;
  tileLabelTemplate: string | null;
  defaultCollageTemplateId: string | null;
}> {
  const templateId = data.defaultCollageTemplateId?.trim() || null;
  const template = templateId
    ? await prisma.collageTemplate.findFirst({
        where: { id: templateId, collectionId },
        select: { id: true },
      })
    : null;
  return {
    maxPhotos: data.maxPhotos ?? null,
    maxPhotoEdge: data.maxPhotoEdge ?? null,
    maxPhotoFileSizeMib: data.maxPhotoFileSizeMib ?? null,
    photoSides: normalizePhotoSides(data.photoSides),
    tileLabelTemplate: data.tileLabelTemplate ?? null,
    defaultCollageTemplateId: template?.id ?? null,
  };
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
  const photos = await photoData(collectionId, data);
  try {
    return await prisma.contact.create({
      data: {
        collectionId,
        name,
        ...photos,
        notes: data.notes ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        buyer: data.buyer ?? false,
        seller: data.seller ?? false,
        exchangePartner: data.exchangePartner ?? false,
        auctionHouse: data.auctionHouse ?? false,
        platform: data.platform ?? false,
        other: data.other ?? false,
        platformCurrency: data.platformCurrency ?? null,
        titleTemplate: data.titleTemplate ?? null,
        descriptionTemplate: data.descriptionTemplate ?? null,
        privateNoteTemplate: data.privateNoteTemplate ?? null,
        titleLanguage: normalizeLanguage(data.titleLanguage),
      },
      select: CONTACT_SELECT,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ContactNameTakenError(name);
    throw err;
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
  const photos = await photoData(collectionId, data);
  try {
    return await prisma.contact.update({
      where: { id: contactId },
      data: {
        name,
        ...photos,
        notes: data.notes ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        buyer: data.buyer ?? false,
        seller: data.seller ?? false,
        exchangePartner: data.exchangePartner ?? false,
        auctionHouse: data.auctionHouse ?? false,
        platform: data.platform ?? false,
        other: data.other ?? false,
        platformCurrency: data.platformCurrency ?? null,
        titleTemplate: data.titleTemplate ?? null,
        descriptionTemplate: data.descriptionTemplate ?? null,
        privateNoteTemplate: data.privateNoteTemplate ?? null,
        titleLanguage: normalizeLanguage(data.titleLanguage),
      },
      select: CONTACT_SELECT,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ContactNameTakenError(name);
    throw err;
  }
}

/**
 * The languages a collection actually needs **translations** for (#293): the distinct listing
 * languages across its platforms, minus the collection's own `defaultLanguage` — text in that
 * language already lives in the entity's default column, so a translation row would duplicate it.
 * This *is* the collection's translation language set (there is no separate language configuration,
 * #265): entity forms offer a per-language input for exactly these codes, and an empty result
 * means no translation UI at all.
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
  const [collection, rows] = await Promise.all([
    prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { defaultLanguage: true },
    }),
    prisma.contact.findMany({
      where: { collectionId, platform: true, titleLanguage: { not: null } },
      select: { titleLanguage: true },
      distinct: ["titleLanguage"],
    }),
  ]);
  const defaultLanguage = normalizeLanguage(collection.defaultLanguage);
  const codes = new Set<string>();
  for (const r of rows) {
    const code = normalizeLanguage(r.titleLanguage);
    if (code && code !== defaultLanguage) codes.add(code);
  }
  return {
    titleLanguages: Array.from(codes).sort(),
    defaultLanguage: defaultLanguage ?? collection.defaultLanguage,
  };
}

/** Delete a contact. Blocked with {@link ContactInUseError} when any purchase still
 * references it as supplier or platform (`onDelete: Restrict`, ADR-0008/0009) — the
 * caller must detach it from those purchases first. */
export async function deleteContact(
  ownerId: string,
  contactId: string
): Promise<void> {
  await assertContactOwner(ownerId, contactId);
  const referenceCount = await prisma.purchase.count({
    where: { OR: [{ contactId }, { platformId: contactId }] },
  });
  if (referenceCount > 0) throw new ContactInUseError(referenceCount);
  await prisma.contact.delete({ where: { id: contactId } });
}

/** Prisma unique-constraint violation (P2002) narrowing without importing the
 * Prisma error class into this server-only module's public surface. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
