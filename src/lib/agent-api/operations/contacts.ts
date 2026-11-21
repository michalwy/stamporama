import "server-only";
import { prisma } from "../../db";
import {
  ContactFieldError,
  ContactMergeError,
  ContactNameTakenError,
  ContactNotEmptyError,
  createContact,
  deleteEmptyContact,
  getContactListItem,
  getContactMergePair,
  mergeContacts,
  updateContact,
  type ContactCreateInput,
  type ContactData,
  type ContactMergeCandidate,
} from "../../contacts";
import { mergedContactDetails } from "../../contact-merge-rules";
import { COMMON_CURRENCIES } from "../../currencies";
import { normalizeDecimalInput } from "../../decimal-input";
import { normalizeFacebookProfileUrl } from "../../facebook-profile-rules";
import { normalizeMarketCode } from "../../market-anchoring";
import type { Prisma } from "@/generated/prisma/client";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import { closeContacts, MAX_SELLER_SUGGESTIONS, resolveSeller } from "../purchase-reads";
import {
  AGENT_CONTACT_ROLES,
  CLEARABLE_CONTACT_FIELDS,
  CONTACT_FIELDS,
  CONTACT_ROLE_FLAGS,
  agentFieldChanges,
  contactChangeNote,
  contactChanges,
  contactDetails,
  contactFieldChanges,
  contactHoldingsParts,
  contactMergeMoves,
  contactMergeMovesSentence,
  contactMergeNote,
  contactNotEmptyMessage,
  contactRecord,
  contactRow,
  parseContactRole,
  refuseSellerOnlyFields,
  roleFlags,
  sellsToCollector,
  type AgentContactDetails,
  type AgentContactFieldChange,
  type ContactFieldChanges,
  type ContactMergeMoves,
  type ContactLogFacts,
  type ContactRoleFlags,
  type AgentContact,
  type AgentContactRow,
  type ContactHistoryFacts,
} from "../contact-reads";
import { writeAssistantEntries } from "./conversation-log";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Contacts (#2610) — the people the collection deals with, read in full: who a contact is, how to reach
// them, their defaults, their Facebook profiles, and what the collector has done with them.
//
// **The reads are the contact page's own.** The contact comes from `contacts.ts`'
// `getContactListItem`, the read behind the contact's page and its *Edit* dialog, so what the agent is
// told is what the collector sees. **Email, phone and notes are read here and nowhere else**: the
// collector opened them to the Assistant on 2026-11-21, for this read; a seller, a buyer and a
// proposal's contact stay two fields wherever else they appear (`purchase-reads.ts`, `sale-reads.ts`,
// `proposal-reads.ts`), and `find_contacts`' row is no wider.
//
// **What was done with the contact is the record's numbers**, each list newest first and narrowed as
// the contact's page narrows it: a purchase is one it supplied — never a trade's incoming half, which is
// its trade's — and an opening balance has no supplier at all. The list operations narrowed to the
// contact (`list_purchases`, `list_sales`, `list_trades`, `list_proposals`,
// `list_conversation_entries`) read each one.
//
// **A contact is named as the other operations name one**: its id, or what it is filed under or its
// full name exactly; an unknown name is refused with the close ones, pointing at `find_contacts`
// rather than at an operation that would create somebody.
//
// **Writes (#2611): a contact made and edited with every detail its dialog takes**, through the dialog's
// own `createContact` and `updateContact`, so each is refused where the dialog would be, with the same
// reason. An edit changes **only the fields named** — unlike the dialog, which saves them all — so an
// agent cannot wipe a field it was not told about; `clear` empties one. **Every write leaves a note in
// the contact's conversation log**, the Assistant's, naming what changed and from what, so the contact's
// page shows it and a wrong one can be put back (the collector's choice on 2026-11-21 over a log of its
// own). `create_seller` and `find_or_create_buyer` stay as they were: the narrow creates a purchase and
// a sale reach for.

// ── find_contacts ────────────────────────────────────────────────────────────

export async function findContacts(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentContactRow>> {
  const search = optionalString(params, "search");
  const roleValue = optionalString(params, "role");
  const marketValue = optionalString(params, "market");
  const profileValue = optionalString(params, "facebook_profile");

  const and: Prisma.ContactWhereInput[] = [];
  for (const word of (search ?? "").split(/\s+/).filter((w) => w.length > 0)) {
    and.push({
      OR: [
        { name: { contains: word, mode: "insensitive" } },
        { fullName: { contains: word, mode: "insensitive" } },
      ],
    });
  }
  if (roleValue !== null) {
    and.push({ [CONTACT_ROLE_FLAGS[parseContactRole(roleValue, "role")]]: true });
  }
  if (marketValue !== null) {
    const code = normalizeMarketCode(marketValue);
    if (!code) {
      throw invalidRequest(`"market" is a two-letter country code, such as DE or PL; "${marketValue}" is not one.`);
    }
    and.push({ market: code });
  }
  if (profileValue !== null) {
    const profile = normalizeFacebookProfileUrl(profileValue);
    if (!profile.ok || profile.value === null) {
      throw invalidRequest(
        `${profile.ok ? "That is not a profile link." : profile.message} Send a Facebook profile link as "facebook_profile", such as https://www.facebook.com/jan.kowalski.`
      );
    }
    and.push({ facebookProfiles: { some: { url: profile.value } } });
  }

  const where: Prisma.ContactWhereInput = {
    collectionId: context.collectionId,
    collection: { ownerId: context.ownerId },
    AND: and,
  };
  const window = parseListWindow(params);
  const [rows, total, header] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: {
        id: true,
        name: true,
        fullName: true,
        market: true,
        buyer: true,
        seller: true,
        exchangePartner: true,
        auctionHouse: true,
        other: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: window.offset,
      take: window.limit,
    }),
    // The match count and never `items.length` (#706).
    prisma.contact.count({ where }),
    loadCollectionHeader(context),
  ]);
  return listResponse(
    rows.map((row) => contactRow(row, collectionPath(header, `/contacts/${encodeURIComponent(row.id)}`))),
    total,
    window
  );
}

export const findContactsOperation: Operation = {
  name: "find_contacts",
  method: "GET",
  path: "/contacts",
  description:
    "Find the collection's contacts — the people and firms it buys from, sells to, trades with and bids at — by part of the name or full name, a role, a market, or a Facebook profile link, in any combination. This is how a contact is found before `get_contact` reads it in full.",
  writes: false,
  parameters: [
    {
      name: "search",
      in: "query",
      type: "string",
      required: false,
      description:
        "Words that must each appear in what the contact is filed under or in their full name, ignoring case — `jan`, `kowalski`, `bronek`.",
    },
    {
      name: "role",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only contacts playing this role: `seller` (sells to the collector), `buyer` (buys from the collector), `exchange_partner` (trades stamps), `auction_house`, or `other`. A contact may play several.",
      values: AGENT_CONTACT_ROLES,
    },
    {
      name: "market",
      in: "query",
      type: "string",
      required: false,
      description: "Only contacts in this market, a two-letter country code such as DE or PL.",
    },
    {
      name: "facebook_profile",
      in: "query",
      type: "string",
      required: false,
      description: "Only the contact holding this Facebook profile link — at most one, since a profile belongs to one contact.",
    },
  ],
  result: {
    kind: "list",
    description:
      "The contacts, by name: `id`, `name` (what the contact is filed under — a marketplace login where they have one), `fullName` (their name beside a login, else null), `roles`, `market` (null where not known) and `path`, the contact's page in the app.",
  },
  handler: async (context, params) => findContacts(context, params),
};

// ── get_contact ──────────────────────────────────────────────────────────────

async function resolveContact(context: OperationContext, value: string, parameter = "contact"): Promise<string> {
  const candidates = await prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
  return resolveSeller(value, candidates, parameter, null);
}

/** What the collector has done with the contact — the contact page's narrowing, as numbers. */
async function loadContactHistory(collectionId: string, contactId: string): Promise<ContactHistoryFacts> {
  const [purchases, sales, trades, proposals, auctionSales, conversationEntries] = await Promise.all([
    prisma.purchase.findMany({
      where: { collectionId, contactId, kind: "purchase", tradeId: null },
      orderBy: [{ purchasedAt: "desc" }, { purchaseNo: "desc" }],
      select: { purchaseNo: true },
    }),
    prisma.sale.findMany({
      where: { collectionId, buyerId: contactId },
      orderBy: [{ soldAt: "desc" }, { saleNo: "desc" }],
      select: { saleNo: true },
    }),
    prisma.trade.findMany({
      where: { collectionId, partnerId: contactId },
      orderBy: [{ createdAt: "desc" }, { tradeNo: "desc" }],
      select: { tradeNo: true },
    }),
    prisma.proposal.findMany({
      where: { collectionId, contactId },
      orderBy: [{ createdAt: "desc" }, { proposalNo: "desc" }],
      select: { proposalNo: true },
    }),
    prisma.auctionSale.findMany({
      where: { collectionId, sellerId: contactId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true },
    }),
    prisma.conversationEntry.count({ where: { collectionId, contactId } }),
  ]);
  return {
    purchases: purchases.map((row) => row.purchaseNo),
    sales: sales.map((row) => row.saleNo),
    trades: trades.map((row) => row.tradeNo),
    proposals: proposals.map((row) => row.proposalNo),
    auctionSales,
    conversationEntries,
  };
}

export async function readContact(context: OperationContext, params: ParsedParams): Promise<AgentContact> {
  return readContactById(context, await resolveContact(context, requiredString(params, "contact")));
}

async function readContactById(context: OperationContext, contactId: string): Promise<AgentContact> {
  const [contact, remembered, history, header] = await Promise.all([
    getContactListItem(context.ownerId, contactId),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { defaultAuctionPlatform: { select: { name: true } } },
    }),
    loadContactHistory(context.collectionId, contactId),
    loadCollectionHeader(context),
  ]);
  if (!contact || contact.collectionId !== context.collectionId) {
    throw notFound(`No contact with id "${contactId}" is in this token's collection. Use \`find_contacts\` to find the right one.`);
  }
  return contactRecord(contact, {
    auctionPlatform: remembered?.defaultAuctionPlatform?.name ?? null,
    history,
    path: collectionPath(header, `/contacts/${encodeURIComponent(contactId)}`),
  });
}

export const getContactOperation: Operation = {
  name: "get_contact",
  method: "GET",
  path: "/contacts/{contact}",
  description:
    "One contact in full, as the contact's page and edit dialog show it: name, full name, email, phone, notes, roles, market and language; the defaults an auction sale or a sale to them starts from; their Facebook profiles; and the numbers of every purchase, sale, trade and proposal made with them, the auction sales tracked with them, and how many conversation entries are logged.",
  writes: false,
  parameters: [
    {
      name: "contact",
      in: "path",
      type: "string",
      required: true,
      description:
        "The contact's id from `find_contacts`, or what they are filed under or their full name, exactly; a name that matches nobody is refused with the contacts close to it.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The contact. `name` is what they are filed under (a marketplace login where they have one) and `fullName` their name beside it; `email`, `phone`, `notes`, `market` and `language` (an ISO 639-1 code — the language every material for them opens in) are null where not recorded. `roles` lists the ones they play. `facebookProfiles` are their profile links. The auction defaults, seeded onto an auction sale tracked with them: `defaultCurrency`, `defaultShippingCost`, `buyerPremiumPercent`, `buyerPremiumFixed`, and `auctionPlatform`, the platform they were last tracked on. Their own free-extras terms, each null for none and combined with the platform's on a sale to them: `freeExtrasMinimumOrder` and `freeExtrasMaximumBudget` in the collection's base currency, `freeExtrasBudgetPercent` of the order. What was done with them, newest first: `purchases` (purchase numbers — orders they supplied; a trade's incoming half is under its trade), `sales`, `trades` and `proposals` (their numbers), `auctionSales` (`id`, `name`, `status` — they have no number) and `conversationEntries`, a count. `list_purchases` with `seller`, `list_sales` with `buyer`, `list_trades` with `partner`, `list_proposals` with `contact` and `list_conversation_entries` with `buyer` read each in turn. `path` is the contact's page in the app.",
  },
  handler: async (context, params) => readContact(context, params),
};

// ── create_contact / update_contact (#2611) ──────────────────────────────────

/** What each one-value field means, for the model reading the operation. */
const FIELD_DESCRIPTIONS: Record<string, string> = {
  full_name:
    "Their name, kept beside what they are filed under when that is a marketplace login — the name on the parcel.",
  email: "Their e-mail address.",
  phone: "Their phone number.",
  notes: "Free notes about them, as the collector keeps them.",
  market:
    "The country a seller or an auction house sells in, a two-letter code such as DE — where their results count. Only for a seller or an auction house.",
  language:
    "The language they read, an ISO 639-1 code such as de or pl (de-AT reads as de) — every material for them, a proposal or a message, opens in it.",
  default_currency:
    "The currency a seller or an auction house trades in — seeded onto an auction sale tracked with them. Only for a seller or an auction house.",
  default_shipping_cost:
    "The postage a seller or an auction house usually charges, in their default currency, as 5.00 — seeded onto an auction sale tracked with them. Only for a seller or an auction house.",
  buyer_premium_percent:
    "An auction house's buyer's premium as a percentage of the hammer price, as 20. Only for a seller or an auction house.",
  buyer_premium_fixed:
    "A fixed buyer's premium per lot, in their default currency. Only for a seller or an auction house.",
  free_extras_minimum_order:
    "Their own free-extras terms: the order value, in the collection's base currency, from which a sale to them carries free extras.",
  free_extras_budget_percent:
    "Their own free-extras terms: the free extras' budget as a percentage of the order, above 0 and at most 100.",
  free_extras_maximum_budget:
    "Their own free-extras terms: the most the free extras may be worth, in the collection's base currency.",
};

const FIELD_PARAMETERS: readonly ParameterSpec[] = CONTACT_FIELDS.map((field) => ({
  name: field.param,
  in: "body",
  type: "string",
  required: false,
  description: FIELD_DESCRIPTIONS[field.param],
  ...(field.param === "default_currency" ? { values: COMMON_CURRENCIES } : {}),
}));

const ROLES_DESCRIPTION =
  "The roles they play, any combination or none: `seller` (sells to the collector), `buyer` (buys from the collector), `exchange_partner` (trades stamps), `auction_house`, `other`.";

/** A domain refusal — a name taken, a profile on another contact, a figure out of range — as one the
 *  agent can act on, in the dialog's own words. */
async function refusingContactGuards<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ContactFieldError || error instanceof ContactNameTakenError) {
      throw invalidRequest(`${error.message} Nothing was written.`);
    }
    throw error;
  }
}

function fieldChanges(params: ParsedParams, clear: ReadonlySet<string>): ContactFieldChanges {
  return contactFieldChanges((param) => optionalString(params, param), clear, normalizeDecimalInput);
}

function parsedRoles(params: ParsedParams): ContactRoleFlags | null {
  if (params.roles === undefined) return null;
  return roleFlags(stringList(params, "roles").map((role) => parseContactRole(role, "roles")));
}

function logFacts(contact: ContactData): ContactLogFacts {
  return contact;
}

/** Leave the note on the contact's conversation log, when the write changed anything. */
async function noteContactWrite(
  context: OperationContext,
  contactId: string,
  before: ContactLogFacts | null
): Promise<void> {
  const after = await getContactListItem(context.ownerId, contactId);
  if (!after) return;
  const note = contactChangeNote(contactChanges(before, logFacts(after)), before === null);
  if (!note) return;
  await writeAssistantEntries(context, contactId, [
    { occurredAt: new Date(), channel: "other", direction: "note", summary: note.summary, quote: note.quote, url: null, saleId: null },
  ]);
}

async function loadContactCandidates(context: OperationContext) {
  return prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
}

export async function addContact(context: OperationContext, params: ParsedParams): Promise<AgentContact> {
  const name = requiredString(params, "name");
  const differentPerson = optionalBoolean(params, "different_person") ?? false;
  const changes = fieldChanges(params, new Set());
  const roles = parsedRoles(params) ?? roleFlags([]);
  refuseSellerOnlyFields(changes, roles, `"${name}"`);

  // Today's guard (#1390): somebody already known is used, never duplicated, and a name close to
  // somebody known is confirmed to be another person before anybody is created.
  const candidates = await loadContactCandidates(context);
  const same = candidates.find((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (same) {
    throw invalidRequest(
      `A contact is already filed under "${same.name}" (${same.id}). If that is this person, change them with \`update_contact\`; if it is somebody else, file this one under another name. Nobody was created.`,
      [same.id]
    );
  }
  if (!differentPerson) {
    const close = closeContacts([name, ...(changes.fullName ? [changes.fullName] : [])], candidates);
    if (close.length > 0) {
      const shown = close.slice(0, MAX_SELLER_SUGGESTIONS);
      throw invalidRequest(
        `"${name}" is close to ${close.length === 1 ? "a contact" : `${close.length} contacts`} already in this collection: ${shown
          .map((candidate) => `${candidate.name} (${candidate.id})`)
          .join(", ")}. If one of them is this person, change them with \`update_contact\` instead. If none is, call again with "different_person": true. Nobody was created.`,
        shown.map((candidate) => candidate.id)
      );
    }
  }

  const input: ContactCreateInput = {
    name,
    ...changes,
    ...roles,
    facebookProfileUrls: stringList(params, "facebook_profiles"),
  };
  const created = await refusingContactGuards(() => createContact(context.ownerId, context.collectionId, input));
  await noteContactWrite(context, created.id, null);
  return readContactById(context, created.id);
}

export const createContactOperation: Operation = {
  name: "create_contact",
  method: "POST",
  path: "/contacts",
  description:
    "Add a person or firm to the collection's contacts with any of the details their edit dialog takes: name, full name, email, phone, notes, roles, market, language, the auction defaults, the free-extras terms and Facebook profiles. Find them with `find_contacts` first: an existing contact is never duplicated — the same name is refused with its id — and a name close to one already there is refused with the candidates until you state it is a different person. A Facebook profile already on another contact is refused with that contact's name. The creation is noted in the contact's conversation log as the Assistant's.",
  writes: true,
  parameters: [
    {
      name: "name",
      in: "body",
      type: "string",
      required: true,
      description:
        "What the contact is filed under — for a marketplace buyer or seller their login, with their name as `full_name`; otherwise their name.",
    },
    ...FIELD_PARAMETERS,
    { name: "roles", in: "body", type: "string[]", required: false, description: ROLES_DESCRIPTION, values: AGENT_CONTACT_ROLES },
    {
      name: "facebook_profiles",
      in: "body",
      type: "string[]",
      required: false,
      description: "Their Facebook profile links, such as https://www.facebook.com/jan.kowalski.",
    },
    {
      name: "different_person",
      in: "body",
      type: "boolean",
      required: false,
      description:
        "Send true only when a first attempt was refused for being close to an existing contact and that contact is **not** this person. Never send it on a first attempt.",
    },
  ],
  result: {
    kind: "object",
    description: "The new contact, as `get_contact` reads it.",
  },
  handler: async (context, params) => addContact(context, params),
};

/** A profile link as sent, normalised as the dialog stores it, or a refusal naming the parameter. */
function profileLink(value: string, parameter: string): string {
  const profile = normalizeFacebookProfileUrl(value);
  if (!profile.ok || profile.value === null) {
    throw invalidRequest(
      `${profile.ok ? `"${value}" is not a profile link.` : profile.message} Send Facebook profile links in "${parameter}", such as https://www.facebook.com/jan.kowalski. Nothing was written.`
    );
  }
  return profile.value;
}

export async function editContact(context: OperationContext, params: ParsedParams): Promise<AgentContact> {
  const contactId = await resolveContact(context, requiredString(params, "contact"));
  const current = await getContactListItem(context.ownerId, contactId);
  if (!current || current.collectionId !== context.collectionId) {
    throw notFound(`No contact with id "${contactId}" is in this token's collection. Use \`find_contacts\` to find the right one.`);
  }
  const clear = new Set(stringList(params, "clear"));
  const changes = fieldChanges(params, clear);
  const rename = optionalString(params, "name");
  const roles = parsedRoles(params);
  const adding = stringList(params, "add_facebook_profiles").map((value) => profileLink(value, "add_facebook_profiles"));
  const removing = stringList(params, "remove_facebook_profiles").map((value) => profileLink(value, "remove_facebook_profiles"));

  if (rename === null && roles === null && Object.keys(changes).length === 0 && adding.length === 0 && removing.length === 0) {
    throw invalidRequest(
      "Nothing to change was sent. Send the fields to change, `clear` to empty some, `roles`, or a Facebook profile to add or remove; the rest are left as they are."
    );
  }

  const flags: ContactRoleFlags = roles ?? current;
  refuseSellerOnlyFields(changes, flags, `"${current.name}"`);
  // The dialog's rule: a contact that stops selling to the collector keeps no market and no auction
  // defaults — they are cleared when the roles sent make it neither a seller nor an auction house.
  if (roles !== null && !sellsToCollector(roles)) {
    for (const field of CONTACT_FIELDS) if (field.sellerOnly) changes[field.key] = null;
  }

  const stray = removing.filter((url) => !current.facebookProfileUrls.includes(url));
  if (stray.length > 0) {
    throw invalidRequest(
      `${stray.join(", ")} ${stray.length === 1 ? "is" : "are"} not among ${current.name}'s Facebook profiles${current.facebookProfileUrls.length > 0 ? ` (${current.facebookProfileUrls.join(", ")})` : ", who has none"}. Nothing was written.`,
      current.facebookProfileUrls
    );
  }
  const profiles =
    adding.length > 0 || removing.length > 0
      ? [...current.facebookProfileUrls.filter((url) => !removing.includes(url)), ...adding.filter((url) => !removing.includes(url))]
      : undefined;

  // The dialog saves every field, so the ones not named are sent as they stand.
  const kept = Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, current[field.key]])) as ContactFieldChanges;
  const input: ContactCreateInput = {
    name: rename ?? current.name,
    ...kept,
    ...changes,
    buyer: flags.buyer,
    seller: flags.seller,
    exchangePartner: flags.exchangePartner,
    auctionHouse: flags.auctionHouse,
    other: flags.other,
    ...(profiles !== undefined ? { facebookProfileUrls: profiles } : {}),
  };
  await refusingContactGuards(() => updateContact(context.ownerId, contactId, input));
  await noteContactWrite(context, contactId, logFacts(current));
  return readContactById(context, contactId);
}

export const updateContactOperation: Operation = {
  name: "update_contact",
  method: "PATCH",
  path: "/contacts/{contact}",
  description:
    "Change a contact's details: any of the fields their edit dialog takes, their roles, and their Facebook profiles. **Only what is sent changes** — every field not named is left as it is; `clear` empties a field. A change is refused wherever the dialog would refuse it, with the same reason: a name another contact is filed under, a Facebook profile already on another contact (named), a market or a language that is not a code. The change is noted in the contact's conversation log as the Assistant's, with each field's old and new value.",
  writes: true,
  parameters: [
    {
      name: "contact",
      in: "path",
      type: "string",
      required: true,
      description:
        "The contact's id from `find_contacts`, or what they are filed under or their full name, exactly; a name that matches nobody is refused with the contacts close to it.",
    },
    {
      name: "name",
      in: "body",
      type: "string",
      required: false,
      description: "A new name to file them under. It cannot be cleared.",
    },
    ...FIELD_PARAMETERS,
    {
      name: "roles",
      in: "body",
      type: "string[]",
      required: false,
      description: `${ROLES_DESCRIPTION} The list replaces their roles; send all they keep. A contact left neither a seller nor an auction house loses their market and auction defaults, as in the dialog.`,
      values: AGENT_CONTACT_ROLES,
    },
    {
      name: "add_facebook_profiles",
      in: "body",
      type: "string[]",
      required: false,
      description: "Facebook profile links to add to the ones they have. One already on another contact is refused with that contact's name.",
    },
    {
      name: "remove_facebook_profiles",
      in: "body",
      type: "string[]",
      required: false,
      description: "Facebook profile links to take off them — each must be one of theirs.",
    },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Fields to empty. A field named here is not sent as well.",
      values: CLEARABLE_CONTACT_FIELDS,
    },
  ],
  result: {
    kind: "object",
    description: "The contact as it now stands, as `get_contact` reads it.",
  },
  handler: async (context, params) => editContact(context, params),
};

// ── preview_contact_merge / merge_contacts / delete_contact (#2612) ──────────
//
// **A merge is the app's own `mergeContacts`**, *Merge with…*: everything filed under the other contact
// moves to the one that remains, which keeps its name and details and takes the ones it lacks
// (`contact-merge-rules.ts`), and the other is deleted. It cannot be undone, as in the app; the
// remaining contact's conversation log gets the Assistant's note naming the contact merged away, what
// moved and every field it took. The preview is the dialog's: the merged contact and the counts.
//
// **A delete takes only an empty contact** — nothing filed under it at all, conversation entries and
// proposals included, which the app's delete would take along. A contact with history is refused
// with what it holds and pointed at the merge, so no purchase, sale or proposal is lost with it.

const MERGE_CONTACT_PARAMETER: ParameterSpec = {
  name: "contact",
  in: "path",
  type: "string",
  required: true,
  description:
    "The contact that **remains** — it keeps its name and details. Its id from `find_contacts`, or what they are filed under or their full name, exactly.",
};

function mergeOtherParameter(location: "query" | "body"): ParameterSpec {
  return {
    name: "other",
    in: location,
    type: "string",
    required: true,
    description:
      "The contact merged **away** — everything filed under it moves to `contact`, and it is deleted. Its id from `find_contacts`, or what they are filed under or their full name, exactly.",
  };
}

interface MergePair {
  readonly remaining: ContactMergeCandidate;
  readonly other: ContactMergeCandidate;
}

async function resolveMergePair(context: OperationContext, params: ParsedParams): Promise<MergePair> {
  const remainingId = await resolveContact(context, requiredString(params, "contact"));
  const otherId = await resolveContact(context, requiredString(params, "other"), "other");
  if (remainingId === otherId) {
    throw invalidRequest(`"contact" and "other" name the same contact (${remainingId}). A contact cannot be merged with itself.`);
  }
  try {
    const pair = await getContactMergePair(context.ownerId, remainingId, otherId);
    return { remaining: pair.contact, other: pair.other };
  } catch (error) {
    if (error instanceof ContactMergeError) throw invalidRequest(`${error.message} Nothing was merged.`);
    throw error;
  }
}

function contactRef(contact: ContactData): { id: string; name: string } {
  return { id: contact.id, name: contact.name };
}

export interface AgentContactMergePreview {
  readonly remaining: { readonly id: string; readonly name: string };
  readonly other: { readonly id: string; readonly name: string };
  readonly merged: AgentContactDetails;
  readonly changes: readonly AgentContactFieldChange[];
  readonly moves: ContactMergeMoves;
  readonly summary: string;
}

export async function previewContactMerge(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentContactMergePreview> {
  const { remaining, other } = await resolveMergePair(context, params);
  const merged = mergedContactDetails(remaining, other);
  const moves = contactMergeMoves(other);
  const moved = contactMergeMovesSentence(moves);
  return {
    remaining: contactRef(remaining),
    other: contactRef(other),
    merged: contactDetails(merged),
    changes: agentFieldChanges(contactChanges(logFacts(remaining), merged)),
    moves,
    summary: `${other.name} merges into ${remaining.name}: ${moved === "nothing" ? "nothing moves" : `${moved} move`} to ${remaining.name}, and ${other.name} is deleted. This cannot be undone.`,
  };
}

const MERGE_RULE =
  "The contact that remains keeps its name and the details it has, takes each detail it lacks from the other, plays the roles of both, and keeps the other's notes under its own; the auction defaults and the free-extras terms are each taken as one set, from the other only when it has none of its own. Every purchase, sale, trade, proposal, auction sale, price observation, conversation entry and Facebook profile of the other moves to it, and the other is deleted.";

export const previewContactMergeOperation: Operation = {
  name: "preview_contact_merge",
  method: "GET",
  path: "/contacts/{contact}/merge",
  description: `Say what \`merge_contacts\` would do, writing nothing — what the app's *Merge with…* dialog shows: the contact as it will be once merged, the details it gains, and how many records move. ${MERGE_RULE} Call it first and tell the collector before merging.`,
  writes: false,
  parameters: [MERGE_CONTACT_PARAMETER, mergeOtherParameter("query")],
  result: {
    kind: "object",
    description:
      "`remaining` and `other` (`id`, `name`). `merged`: the remaining contact's details once merged — the fields `get_contact` states, without the record. `changes`: each detail it gains or changes, `field` with `before` and `after`. `moves`: how many `purchases`, `sales`, `trades`, `proposals`, `auctionSales`, `priceObservations`, `conversationEntries` and `facebookProfiles` move from the other. `summary` says it in a sentence.",
  },
  handler: async (context, params) => previewContactMerge(context, params),
};

export async function mergeContactsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ contact: AgentContact; mergedAway: { id: string; name: string }; moved: ContactMergeMoves }> {
  const { remaining, other } = await resolveMergePair(context, params);
  const moves = contactMergeMoves(other);
  try {
    await mergeContacts(context.ownerId, { remainingContactId: remaining.id, otherContactId: other.id });
  } catch (error) {
    if (error instanceof ContactMergeError) throw invalidRequest(`${error.message} Nothing was merged.`);
    throw error;
  }
  // The note is the second transaction, as every contact write's is (#2611).
  const after = await getContactListItem(context.ownerId, remaining.id);
  if (after) {
    const note = contactMergeNote(contactRef(other), moves, contactChanges(logFacts(remaining), logFacts(after)));
    await writeAssistantEntries(context, remaining.id, [
      { occurredAt: new Date(), channel: "other", direction: "note", summary: note.summary, quote: note.quote, url: null, saleId: null },
    ]);
  }
  return {
    contact: await readContactById(context, remaining.id),
    mergedAway: contactRef(other),
    moved: moves,
  };
}

export const mergeContactsOperation: Operation = {
  name: "merge_contacts",
  method: "POST",
  path: "/contacts/{contact}/merge",
  description: `Merge two contacts that are the same person or firm — a buyer bidding from a second Facebook account, a contact made twice — exactly as the app's *Merge with…* does. ${MERGE_RULE} **It cannot be undone.** Run \`preview_contact_merge\` with the same two contacts first. The merge is noted in the remaining contact's conversation log as the Assistant's, naming the contact merged away, what moved and each detail taken.`,
  writes: true,
  parameters: [MERGE_CONTACT_PARAMETER, mergeOtherParameter("body")],
  result: {
    kind: "object",
    description:
      "`contact`: the remaining contact as `get_contact` now reads it. `mergedAway`: the deleted contact's `id` and `name`. `moved`: the counts `preview_contact_merge` states as `moves`.",
  },
  handler: async (context, params) => mergeContactsFromParams(context, params),
};

/** Everything filed under the contact, each record by what it is called by, newest first. */
async function loadContactHoldings(collectionId: string, contactId: string) {
  const [purchases, history, priceObservations] = await Promise.all([
    // Every purchase naming it, a trade's incoming half included — each one keeps it from being deleted.
    prisma.purchase.findMany({
      where: { collectionId, contactId },
      orderBy: [{ purchasedAt: "desc" }, { purchaseNo: "desc" }],
      select: { purchaseNo: true },
    }),
    loadContactHistory(collectionId, contactId),
    prisma.priceObservation.count({ where: { collectionId, auctionHouseId: contactId } }),
  ]);
  return {
    purchases: purchases.map((row) => row.purchaseNo),
    sales: history.sales,
    trades: history.trades,
    proposals: history.proposals,
    auctionSales: history.auctionSales,
    priceObservations,
    conversationEntries: history.conversationEntries,
  };
}

export async function deleteContactFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ deleted: { id: string; name: string; fullName: string | null; facebookProfiles: string[] } }> {
  const contactId = await resolveContact(context, requiredString(params, "contact"));
  const contact = await getContactListItem(context.ownerId, contactId);
  if (!contact || contact.collectionId !== context.collectionId) {
    throw notFound(`No contact with id "${contactId}" is in this token's collection. Use \`find_contacts\` to find the right one.`);
  }
  const parts = contactHoldingsParts(await loadContactHoldings(context.collectionId, contactId));
  if (parts.length > 0) throw invalidRequest(contactNotEmptyMessage(contact.name, parts));
  try {
    await deleteEmptyContact(context.ownerId, contactId);
  } catch (error) {
    // A record filed between the check above and the write: refused there, inside the transaction.
    if (error instanceof ContactNotEmptyError) {
      throw invalidRequest(`${contact.name} gained a record while being deleted, and is not deleted. Read them with \`get_contact\`. Nothing was deleted.`);
    }
    throw error;
  }
  return {
    deleted: { id: contact.id, name: contact.name, fullName: contact.fullName, facebookProfiles: [...contact.facebookProfileUrls] },
  };
}

export const deleteContactOperation: Operation = {
  name: "delete_contact",
  method: "DELETE",
  path: "/contacts/{contact}",
  description:
    "Delete a contact made by mistake — **only one with nothing filed under it**: no purchase, sale, trade, proposal, auction sale, price observation or conversation entry. Its Facebook profiles go with it. A contact with any of those is refused with what it holds, by number: a contact with history is merged with `merge_contacts`, never deleted, so nothing filed under it is lost.",
  writes: true,
  parameters: [
    {
      name: "contact",
      in: "path",
      type: "string",
      required: true,
      description:
        "The contact's id from `find_contacts`, or what they are filed under or their full name, exactly; a name that matches nobody is refused with the contacts close to it.",
    },
  ],
  result: {
    kind: "object",
    description: "`deleted`: the contact as it was — `id`, `name`, `fullName` and the `facebookProfiles` that went with it.",
  },
  handler: async (context, params) => deleteContactFromParams(context, params),
};
