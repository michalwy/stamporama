import "server-only";
import { prisma } from "../../db";
import { COMMON_CURRENCIES } from "../../currencies";
import { ContactNameTakenError, createContact } from "../../contacts";
import {
  countPurchases,
  createPurchase,
  getPurchase,
  listPurchasesPaginated,
  updatePurchase,
  type PurchaseStatus,
} from "../../purchases";
import { createLot, deleteEmptyLot, getPurchaseDetail, updateLot } from "../../lots";
import {
  createPurchaseExpense,
  deletePurchaseExpense,
  updatePurchaseExpense,
} from "../../purchase-expenses";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import {
  optionalBoolean,
  optionalInteger,
  optionalString,
  requiredString,
  stringList,
} from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import {
  closeContacts,
  parseAmount,
  parseIsoDate,
  purchase as purchaseProjection,
  purchaseRow,
  resolveSeller,
  seller as sellerProjection,
  MAX_SELLER_SUGGESTIONS,
} from "../purchase-reads";
import { readCollectionVocabulary } from "./vocabulary";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type {
  AgentPurchase,
  AgentPurchaseExpense,
  AgentPurchaseLot,
  AgentPurchaseRow,
  AgentSeller,
  AgentSpend,
  SellerCandidate,
} from "../purchase-reads";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Purchases (#1390) — entering an order the agent has in front of it as text: an order
// confirmation, an auction invoice, a seller's email.
//
// ## What it writes, and the boundary
//
// **The purchase itself and nothing past it**: the header, empty lots, and the non-inventory
// expenses — plus the one thing outside a purchase the collector allowed, **creating its seller**
// when the address book has nobody by that name yet. Everything written here can be seen and undone
// on the purchase's own screen.
//
// **No copies, and nothing irreversible.** No operation identifies, adds, moves or removes a copy;
// none closes or reopens a lot (closing freezes the cost basis onto the copies, ADR-0009 §3.5), marks
// an order arrived (which moves its copies to *to sort*), changes the delivery status, or deletes a
// purchase. Copies enter the collection's counts, wants and values, and the collector deliberately
// kept that step. `tests/unit/agent-api-operation-boundary.test.ts` holds it as a fact about what
// this module imports: `deleteLot` is on its list because it deletes a lot's copies with it, which
// is why removal goes through `deleteEmptyLot` instead.
//
// **The incoming half of a trade is read-only here.** Its lot prices are the carried-over cost basis
// of the copies that went the other way (#644) and are kept in step with them, not money anybody
// paid, so no figure on it is the agent's to write. Opening balances are not reachable at all (#1321
// is its own track).
//
// ## Contacts
//
// **A seller is matched first and created only on purpose.** `resolvePurchaseContact`, which the
// purchase form uses, creates a contact from any name it does not recognise — right for a person
// typing, wrong here, where a misspelling would quietly become a second person. So every operation
// that takes a seller resolves it exactly (`resolveSeller`) and refuses an unknown one, naming the
// close contacts, and `create_seller` is the separate act that adds one. It refuses a name close to
// an existing contact unless the agent states it is a different person.
//
// **A contact is read and written as two fields.** What it is filed under — a marketplace login,
// where the seller has one (#463) — and, beside a login, the person's name as `fullName`. Email,
// phone and notes stay the collector's, and no operation edits or deletes a contact.
//
// ## Refusals
//
// The purchase domain throws plain `Error`s written for a collector, which #706 does not relay. So
// the inputs an agent controls are checked here first, against the same rules — the trades
// module's arrangement (`agent-api.md`, *Refusals*).

// ── Loading what a call is about ─────────────────────────────────────────────

interface PurchaseRef {
  readonly purchaseNo: number;
  readonly fromTrade: boolean;
}

/**
 * The purchase this call is about, proved to be a **purchase** in the token's collection. An
 * opening balance answers as not found: it is the same table, and not something this surface reads.
 */
async function assertPurchase(context: OperationContext, purchaseId: string): Promise<PurchaseRef> {
  const row = await prisma.purchase.findFirst({
    where: {
      id: purchaseId,
      kind: "purchase",
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
    },
    select: { purchaseNo: true, tradeId: true },
  });
  if (!row) {
    throw notFound(
      `No purchase with id "${purchaseId}" is in this token's collection. Use \`list_purchases\` to find the right id.`
    );
  }
  return { purchaseNo: row.purchaseNo, fromTrade: row.tradeId !== null };
}

/** Refuse a write onto the incoming half of a trade — see the header. */
function assertEditable(ref: PurchaseRef, what: string): void {
  if (!ref.fromTrade) return;
  throw invalidRequest(
    `This purchase is the incoming half of a trade, so ${what} is refused. Its lot prices are the cost of the copies that went the other way, carried over and kept in step with them, not money anybody paid; the collector edits it on its own screen.`
  );
}

/** Every contact, reduced to what a seller is matched against. */
async function loadSellerCandidates(context: OperationContext): Promise<SellerCandidate[]> {
  return prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
}

async function resolveSellerParam(
  context: OperationContext,
  value: string,
  parameter: string
): Promise<string> {
  return resolveSeller(value, await loadSellerCandidates(context), parameter);
}

// ── list_purchases ───────────────────────────────────────────────────────────

const LIST_PURCHASES_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "seller",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to purchases from this seller. Takes what the contact is filed under, their full name, or their id; a name that matches nobody is refused with the contacts close to it.",
  },
  {
    name: "purchased_from",
    in: "query",
    type: "string",
    required: false,
    description: "Restrict to purchases made on or after this date, yyyy-mm-dd.",
  },
  {
    name: "purchased_to",
    in: "query",
    type: "string",
    required: false,
    description: "Restrict to purchases made on or before this date, yyyy-mm-dd.",
  },
  {
    name: "purchase_no",
    in: "query",
    type: "integer",
    required: false,
    description:
      "One purchase by the short number the collector calls it by — what `p12` means in the app's quick-jump box.",
  },
];

export async function readPurchases(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentPurchaseRow>> {
  const sellerValue = optionalString(params, "seller");
  const from = optionalString(params, "purchased_from");
  const to = optionalString(params, "purchased_to");
  const purchaseNo = optionalInteger(params, "purchase_no");

  const filters = {
    kind: "purchase" as const,
    ...(sellerValue !== null
      ? { contactId: await resolveSellerParam(context, sellerValue, "seller") }
      : {}),
    ...(from !== null ? { purchasedFrom: parseIsoDate(from, "purchased_from") } : {}),
    ...(to !== null ? { purchasedTo: parseIsoDate(to, "purchased_to") } : {}),
    ...(purchaseNo !== null ? { purchaseNo } : {}),
  };

  const window = parseListWindow(params);
  const [page, total, header] = await Promise.all([
    listPurchasesPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // The match count and never `items.length` (#706).
    countPurchases(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
  ]);

  return listResponse(
    page.items.map((row) =>
      purchaseRow(row, collectionPath(header, `/purchases/${encodeURIComponent(row.id)}`))
    ),
    total,
    window
  );
}

export const listPurchasesOperation: Operation = {
  name: "list_purchases",
  method: "GET",
  path: "/purchases",
  description:
    "The purchases in this collection, newest first — narrowed to a seller, a span of dates, or one purchase number. This is how a purchase id is found before reading or editing one, and how to check that an order is not already entered before entering it again.",
  writes: false,
  parameters: LIST_PURCHASES_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The purchases. `total` is lots, expenses and shipping added up in the purchase's own `currency`; `get_purchase` states the same money in the collection's base currency too. `fromTrade` marks the incoming half of a trade, which this surface reads and does not edit.",
  },
  handler: async (context, params) => readPurchases(context, params),
};

// ── get_purchase ─────────────────────────────────────────────────────────────

const PURCHASE_ID_PARAMETER: ParameterSpec = {
  name: "purchaseId",
  in: "path",
  type: "string",
  required: true,
  description: "The purchase's id, from `list_purchases` or `create_purchase`.",
};

/** The purchase in `get_purchase`'s shape, read fresh — every write answers with what it left. */
async function loadPurchase(
  context: OperationContext,
  purchaseId: string,
  ref: PurchaseRef
): Promise<AgentPurchase> {
  const [detail, header, linked] = await Promise.all([
    getPurchaseDetail(context.ownerId, purchaseId),
    loadCollectionHeader(context),
    prisma.purchaseLot.findMany({
      where: {
        purchaseId,
        OR: [{ auctionLot: { isNot: null } }, { tradeLineId: { not: null } }],
      },
      select: { id: true },
    }),
  ]);
  if (!detail) {
    throw notFound(
      `No purchase with id "${purchaseId}" is in this token's collection. Use \`list_purchases\` to find the right id.`
    );
  }
  return purchaseProjection(detail, {
    purchaseNo: ref.purchaseNo,
    path: collectionPath(header, `/purchases/${encodeURIComponent(purchaseId)}`),
    linkedLotIds: new Set(linked.map((lot) => lot.id)),
  });
}

export async function readPurchase(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentPurchase> {
  const purchaseId = requiredString(params, "purchaseId");
  return loadPurchase(context, purchaseId, await assertPurchase(context, purchaseId));
}

export const getPurchaseOperation: Operation = {
  name: "get_purchase",
  method: "GET",
  path: "/purchases/{purchaseId}",
  description:
    "One purchase in full: who it was bought from and through, when, in what currency, its shipping, its lots and its expenses, and what it all cost.",
  writes: false,
  parameters: [PURCHASE_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "The purchase. `spend` is what the order cost as its screen states it: `paid` in the purchase's currency, and `base` in the collection's base currency at the rate frozen on the purchase — `null`, with `baseMissing` saying why, when no rate is recorded. Each lot carries its own `spend`, its price plus its share of the shipping, which is spread over every lot and expense by price. A lot's `copies` are managed in the app, never here; `removable` says whether `remove_purchase_lot` would take it. `editable` is false on the incoming half of a trade.",
  },
  handler: async (context, params) => readPurchase(context, params),
};

// ── create_seller ────────────────────────────────────────────────────────────

const CREATE_SELLER_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "name",
    in: "body",
    type: "string",
    required: true,
    description:
      "The seller's name — a person's or a business's, as the order states it. Nothing else about them is recorded here: an email, a phone number or an address is the collector's to add on the contact's own screen.",
  },
  {
    name: "marketplace_login",
    in: "body",
    type: "string",
    required: false,
    description:
      "The seller's login on the marketplace the purchase came through, when it came through one. A marketplace seller is filed under their login, because that is what the collector sees on the site; the name is then kept beside it as their full name.",
  },
  {
    name: "different_person",
    in: "body",
    type: "boolean",
    required: false,
    description:
      "Send true only when a first attempt was refused for being close to an existing contact and that contact is **not** this seller. Never send it on a first attempt.",
  },
];

export async function addSeller(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentSeller> {
  const name = requiredString(params, "name");
  const login = optionalString(params, "marketplace_login");
  const differentPerson = optionalBoolean(params, "different_person") ?? false;

  // Filed under the login where there is one (#463), with the name beside it — unless the two are
  // the same string, when there is nothing to keep beside it.
  const filedUnder = login ?? name;
  const fullName =
    login !== null && login.toLocaleLowerCase() !== name.toLocaleLowerCase() ? name : null;

  const candidates = await loadSellerCandidates(context);
  const refuseExisting = (existing: { id: string; name: string }) =>
    invalidRequest(
      `A contact is already filed under "${existing.name}" (${existing.id}). If that is this seller, send its id as "seller"; if it is somebody else, the collector has to tell the two apart in Contacts first.`,
      [existing.id]
    );

  const same = candidates.find(
    (candidate) => candidate.name.toLocaleLowerCase() === filedUnder.toLocaleLowerCase()
  );
  if (same) throw refuseExisting(same);

  if (!differentPerson) {
    const close = closeContacts([filedUnder, name], candidates);
    if (close.length > 0) {
      const shown = close.slice(0, MAX_SELLER_SUGGESTIONS);
      throw invalidRequest(
        `"${filedUnder}" is close to ${close.length === 1 ? "a contact" : `${close.length} contacts`} already in this collection: ${shown
          .map((candidate) => `${candidate.name} (${candidate.id})`)
          .join(", ")}. If one of them is this seller, send its id as "seller" instead of creating anybody. If none is, call again with "different_person": true.`,
        shown.map((candidate) => candidate.id)
      );
    }
  }

  try {
    const created = await createContact(context.ownerId, context.collectionId, {
      name: filedUnder,
      fullName,
      seller: true,
    });
    return sellerProjection(created);
  } catch (err) {
    // Lost a race with a contact created under the same name since the check above.
    if (err instanceof ContactNameTakenError) {
      const existing = (await loadSellerCandidates(context)).find(
        (candidate) => candidate.name === filedUnder
      );
      if (existing) throw refuseExisting(existing);
    }
    throw err;
  }
}

export const createSellerOperation: Operation = {
  name: "create_seller",
  method: "POST",
  path: "/sellers",
  description:
    "Add a seller to the collection's contacts, for a purchase from somebody it has never bought from. Only when `list_purchases` or `create_purchase` has refused the name as unknown: an existing contact is always used rather than duplicated, and a name close to one already there is refused with the candidates until you state it is a different person. The contact is created with a name and, for a marketplace seller, their login — nothing else.",
  writes: true,
  parameters: CREATE_SELLER_PARAMETERS,
  result: {
    kind: "object",
    description:
      "The new contact: its id, to send as `seller`, and the name it is filed under. It cannot be edited or deleted from here.",
  },
  handler: async (context, params) => addSeller(context, params),
};

// ── create_purchase / update_purchase ────────────────────────────────────────

const SELLER_PARAMETER: ParameterSpec = {
  name: "seller",
  in: "body",
  type: "string",
  required: false,
  description:
    "Who the purchase was bought from. Takes what the contact is filed under, their full name, or their id. A name matching nobody is refused with the contacts close to it — use one of those, or add the seller with `create_seller` first. Nothing is created from here.",
};

const PLATFORM_PARAMETER: ParameterSpec = {
  name: "platform",
  in: "body",
  type: "string",
  required: false,
  description:
    "The marketplace or intermediary it was bought through — Allegro, eBay, Delcampe — as distinct from the seller. Takes a platform's name from `get_collection_vocabulary` or its id; a platform the collection does not know is refused, not created.",
};

const SHIPPING_PARAMETER: ParameterSpec = {
  name: "shipping_cost",
  in: "body",
  type: "string",
  required: false,
  description:
    "What was paid for postage and handling on the whole order, in the purchase's currency, as \"12.50\". It is spread over the lots and expenses by price.",
};

const CURRENCY_PARAMETER: ParameterSpec = {
  name: "currency",
  in: "body",
  type: "string",
  required: false,
  description:
    "The currency the order was paid in — every amount on the purchase, its lots and its expenses is in it. Defaults to the collection's base currency. The exchange rate to the base currency is frozen at the purchase date.",
  values: COMMON_CURRENCIES,
};

const CREATE_PURCHASE_PARAMETERS: readonly ParameterSpec[] = [
  SELLER_PARAMETER,
  PLATFORM_PARAMETER,
  {
    name: "purchased_at",
    in: "body",
    type: "string",
    required: true,
    description: "The day the money was spent, yyyy-mm-dd — the order date on the confirmation.",
  },
  CURRENCY_PARAMETER,
  SHIPPING_PARAMETER,
];

async function resolvePlatformParam(
  context: OperationContext,
  value: string
): Promise<string> {
  const vocabulary = await readCollectionVocabulary(context);
  return resolveVocabularyValue(value, vocabulary.platforms, {
    vocabulary: "platform",
    parameter: "platform",
  });
}

export async function addPurchase(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentPurchase> {
  const sellerValue = optionalString(params, "seller");
  const platformValue = optionalString(params, "platform");
  const shipping = optionalString(params, "shipping_cost");
  const purchasedAt = parseIsoDate(requiredString(params, "purchased_at"), "purchased_at");
  const header = await loadCollectionHeader(context);

  const created = await createPurchase(context.ownerId, context.collectionId, {
    kind: "purchase",
    // Ids only, never names: the domain would create a contact from a name it does not know.
    contactId: sellerValue !== null ? await resolveSellerParam(context, sellerValue, "seller") : null,
    platformId: platformValue !== null ? await resolvePlatformParam(context, platformValue) : null,
    purchasedAt,
    currency: optionalString(params, "currency") ?? header.baseCurrency,
    shippingCost: shipping !== null ? parseAmount(shipping, "shipping_cost") : null,
    // Where the collector's own form starts a new order. Moving it is theirs.
    status: "preparing",
  });

  const row = await prisma.purchase.findUniqueOrThrow({
    where: { id: created.id },
    select: { purchaseNo: true },
  });
  return loadPurchase(context, created.id, { purchaseNo: row.purchaseNo, fromTrade: false });
}

export const createPurchaseOperation: Operation = {
  name: "create_purchase",
  method: "POST",
  path: "/purchases",
  description:
    "Enter a purchase: who it was bought from and through, when, in what currency, and what the shipping cost. It starts with no lots — add them with `add_purchase_lot`, and anything bought with the stamps that is not stock with `add_purchase_expense`. Check `list_purchases` first so an order is not entered twice. The copies themselves are identified in the app, never here.",
  writes: true,
  parameters: CREATE_PURCHASE_PARAMETERS,
  result: {
    kind: "object",
    description:
      "The new purchase in `get_purchase`'s shape. Its status is `preparing`; marking it in transit or arrived is the collector's, on its screen.",
  },
  handler: async (context, params) => addPurchase(context, params),
};

/** What `update_purchase` may take off a purchase — the three header fields that may be empty. */
const CLEARABLE_HEADER = ["seller", "platform", "shipping_cost"] as const;

const UPDATE_PURCHASE_PARAMETERS: readonly ParameterSpec[] = [
  PURCHASE_ID_PARAMETER,
  SELLER_PARAMETER,
  PLATFORM_PARAMETER,
  {
    name: "purchased_at",
    in: "body",
    type: "string",
    required: false,
    description:
      "The day the money was spent, yyyy-mm-dd. Changing it re-freezes the exchange rate at the new date.",
  },
  CURRENCY_PARAMETER,
  SHIPPING_PARAMETER,
  {
    name: "clear",
    in: "body",
    type: "string[]",
    required: false,
    description:
      "Header fields to empty — the seller, the platform or the shipping cost. Everything not named here or sent above is left as it is.",
    values: CLEARABLE_HEADER,
  },
];

export async function editPurchase(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentPurchase> {
  const purchaseId = requiredString(params, "purchaseId");
  const ref = await assertPurchase(context, purchaseId);
  assertEditable(ref, "editing its header");

  const clear = new Set(stringList(params, "clear"));
  const sellerValue = optionalString(params, "seller");
  const platformValue = optionalString(params, "platform");
  const shipping = optionalString(params, "shipping_cost");
  for (const [field, value] of [
    ["seller", sellerValue],
    ["platform", platformValue],
    ["shipping_cost", shipping],
  ] as const) {
    if (value !== null && clear.has(field)) {
      throw invalidRequest(`"${field}" is both sent and named in "clear". Send one or the other.`);
    }
  }

  const current = await getPurchase(context.ownerId, purchaseId);
  if (!current) {
    throw notFound(
      `No purchase with id "${purchaseId}" is in this token's collection. Use \`list_purchases\` to find the right id.`
    );
  }
  const purchasedAt = optionalString(params, "purchased_at");

  // `updatePurchase` replaces the whole header, so every field is restated: what was sent, or
  // what is there. The delivery status is always restated as it stands — nothing here moves it.
  await updatePurchase(context.ownerId, purchaseId, {
    kind: "purchase",
    contactId: clear.has("seller")
      ? null
      : sellerValue !== null
        ? await resolveSellerParam(context, sellerValue, "seller")
        : current.contactId,
    platformId: clear.has("platform")
      ? null
      : platformValue !== null
        ? await resolvePlatformParam(context, platformValue)
        : current.platformId,
    purchasedAt: purchasedAt !== null ? parseIsoDate(purchasedAt, "purchased_at") : current.purchasedAt,
    currency: optionalString(params, "currency") ?? current.currency,
    shippingCost: clear.has("shipping_cost")
      ? null
      : shipping !== null
        ? parseAmount(shipping, "shipping_cost")
        : current.shippingCost !== null
          ? Number(current.shippingCost)
          : null,
    status: current.status as PurchaseStatus,
  });

  return loadPurchase(context, purchaseId, ref);
}

export const updatePurchaseOperation: Operation = {
  name: "update_purchase",
  method: "PATCH",
  path: "/purchases/{purchaseId}",
  description:
    "Correct a purchase's header: its seller, platform, date, currency or shipping. Only what is sent changes. Its lots and expenses have their own operations, and its delivery status is the collector's.",
  writes: true,
  parameters: UPDATE_PURCHASE_PARAMETERS,
  result: {
    kind: "object",
    description:
      "The purchase as it now stands, in `get_purchase`'s shape. Changing the currency restates what every existing amount is in rather than converting it — correct the prices too if they were entered in the old one.",
  },
  handler: async (context, params) => editPurchase(context, params),
};

// ── Lots ─────────────────────────────────────────────────────────────────────

/** A write on one line answers with that line and what the whole order now costs. */
export interface AgentLotChange {
  readonly lot: AgentPurchaseLot;
  readonly purchaseSpend: AgentSpend;
}

async function lotChange(
  context: OperationContext,
  purchaseId: string,
  ref: PurchaseRef,
  lotId: string
): Promise<AgentLotChange> {
  const purchase = await loadPurchase(context, purchaseId, ref);
  const lot = purchase.lots.find((candidate) => candidate.lotId === lotId);
  if (!lot) throw new Error(`Lot ${lotId} is not on purchase ${purchaseId}.`);
  return { lot, purchaseSpend: purchase.spend };
}

const LOT_TITLE_PARAMETER: ParameterSpec = {
  name: "title",
  in: "body",
  type: "string",
  required: false,
  description:
    "What the lot is — \"Album Polska 1950s\", \"Box lot\", a lot number from an auction invoice. Leave it out and the app names the lot by the copies identified into it.",
};

const LOT_PRICE_PARAMETER: ParameterSpec = {
  name: "price",
  in: "body",
  type: "string",
  required: true,
  description:
    "What was paid for the lot, in the purchase's currency, as \"45.00\" — hammer price plus premium for an auction lot. The shipping is spread over it separately.",
};

export async function addLot(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentLotChange> {
  const purchaseId = requiredString(params, "purchaseId");
  const ref = await assertPurchase(context, purchaseId);
  assertEditable(ref, "adding a lot");
  const lotId = await createLot(
    context.ownerId,
    purchaseId,
    parseAmount(requiredString(params, "price"), "price"),
    optionalString(params, "title")
  );
  return lotChange(context, purchaseId, ref, lotId);
}

export const addPurchaseLotOperation: Operation = {
  name: "add_purchase_lot",
  method: "POST",
  path: "/purchases/{purchaseId}/lots",
  description:
    "Add a lot to a purchase — one priced line of what was bought: a stamp, a set, an album, a box. It is created open and empty; the collector identifies the copies into it in the app.",
  writes: true,
  parameters: [PURCHASE_ID_PARAMETER, LOT_TITLE_PARAMETER, LOT_PRICE_PARAMETER],
  result: {
    kind: "object",
    description:
      "The new lot, and `purchaseSpend` — what the whole order now costs, since adding a line moves how the shipping is spread.",
  },
  handler: async (context, params) => addLot(context, params),
};

interface LotRef {
  readonly purchaseId: string;
  readonly purchase: PurchaseRef;
  readonly title: string | null;
  readonly price: string | null;
  readonly status: string;
  readonly copies: number;
  readonly linked: boolean;
}

/** The lot this call is about, on a purchase in the token's collection. */
async function assertLot(context: OperationContext, lotId: string): Promise<LotRef> {
  const row = await prisma.purchaseLot.findFirst({
    where: {
      id: lotId,
      purchase: {
        kind: "purchase",
        collectionId: context.collectionId,
        collection: { ownerId: context.ownerId },
      },
    },
    select: {
      purchaseId: true,
      title: true,
      price: true,
      status: true,
      tradeLineId: true,
      auctionLot: { select: { id: true } },
      _count: { select: { items: true } },
      purchase: { select: { purchaseNo: true, tradeId: true } },
    },
  });
  if (!row) {
    throw notFound(
      `No purchase lot with id "${lotId}" is in this token's collection. \`get_purchase\` lists a purchase's lots with their ids.`
    );
  }
  return {
    purchaseId: row.purchaseId,
    purchase: { purchaseNo: row.purchase.purchaseNo, fromTrade: row.purchase.tradeId !== null },
    title: row.title,
    price: row.price?.toFixed(2) ?? null,
    status: row.status,
    copies: row._count.items,
    linked: row.auctionLot !== null || row.tradeLineId !== null,
  };
}

/** Refuse a change to a closed lot — its price is frozen into its copies' cost basis. */
function assertOpen(lot: LotRef, what: string): void {
  if (lot.status === "open") return;
  throw invalidRequest(
    `This lot is closed: its cost has been frozen onto its copies, so ${what} is refused. Reopening it is the collector's decision and nothing on this surface can take it.`
  );
}

const LOT_ID_PARAMETER: ParameterSpec = {
  name: "lotId",
  in: "path",
  type: "string",
  required: true,
  description: "The lot's id, from `get_purchase` or `add_purchase_lot`.",
};

export async function editLot(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentLotChange> {
  const lotId = requiredString(params, "lotId");
  const lot = await assertLot(context, lotId);
  assertEditable(lot.purchase, "changing a lot");
  assertOpen(lot, "renaming or repricing it");

  const title = optionalString(params, "title");
  const price = optionalString(params, "price");
  const clearTitle = stringList(params, "clear").includes("title");
  if (title !== null && clearTitle) {
    throw invalidRequest('"title" is both sent and named in "clear". Send one or the other.');
  }
  if (title === null && price === null && !clearTitle) {
    throw invalidRequest('Nothing to change: send "title", "price", or "clear": ["title"].');
  }

  // `updateLot` writes both, so each is restated: what was sent, or what is there.
  await updateLot(context.ownerId, lotId, {
    title: clearTitle ? null : (title ?? lot.title),
    price: price !== null ? parseAmount(price, "price") : Number(lot.price ?? 0),
  });
  return lotChange(context, lot.purchaseId, lot.purchase, lotId);
}

export const updatePurchaseLotOperation: Operation = {
  name: "update_purchase_lot",
  method: "PATCH",
  path: "/purchase-lots/{lotId}",
  description:
    "Rename or reprice a lot while it is open. A closed lot has had its cost frozen onto its copies and is refused.",
  writes: true,
  parameters: [
    LOT_ID_PARAMETER,
    { ...LOT_TITLE_PARAMETER, description: "The lot's new title." },
    { ...LOT_PRICE_PARAMETER, required: false, description: "The lot's new price, in the purchase's currency, as \"45.00\"." },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Send [\"title\"] to take the title off, so the app names the lot by its copies again.",
      values: ["title"],
    },
  ],
  result: {
    kind: "object",
    description: "The lot as it now stands, and what the whole order now costs.",
  },
  handler: async (context, params) => editLot(context, params),
};

export async function removeLot(
  context: OperationContext,
  params: ParsedParams
): Promise<{ removed: number; purchaseSpend: AgentSpend }> {
  const lotId = requiredString(params, "lotId");
  const lot = await assertLot(context, lotId);
  assertEditable(lot.purchase, "removing a lot");
  assertOpen(lot, "removing it");
  const holdsCopies = () =>
    invalidRequest(
      `This lot holds ${lot.copies === 1 ? "a copy" : "copies"}, and this surface never touches copies, so removing it is refused. The collector removes the copies, or the lot with them, on the purchase's screen.`
    );
  if (lot.copies > 0) throw holdsCopies();
  if (lot.linked) {
    throw invalidRequest(
      "This lot is what a won auction lot or a trade line points at, so removing it would cut that record's link to the purchase. The collector decides that on the purchase's screen."
    );
  }
  if (!(await deleteEmptyLot(context.ownerId, lotId))) throw holdsCopies();

  const purchase = await loadPurchase(context, lot.purchaseId, lot.purchase);
  return { removed: 1, purchaseSpend: purchase.spend };
}

export const removePurchaseLotOperation: Operation = {
  name: "remove_purchase_lot",
  method: "DELETE",
  path: "/purchase-lots/{lotId}",
  description:
    "Take an empty lot off a purchase — one entered by mistake or twice. Only an open lot with no copies in it can go; `get_purchase` says which are `removable`.",
  writes: true,
  parameters: [LOT_ID_PARAMETER],
  result: {
    kind: "object",
    description: "How many lots were removed — one — and what the whole order now costs.",
  },
  handler: async (context, params) => removeLot(context, params),
};

// ── Expenses ─────────────────────────────────────────────────────────────────

/** A write on one expense answers with it and what the whole order now costs. */
export interface AgentExpenseChange {
  readonly expense: AgentPurchaseExpense;
  readonly purchaseSpend: AgentSpend;
}

async function expenseChange(
  context: OperationContext,
  purchaseId: string,
  ref: PurchaseRef,
  expenseId: string
): Promise<AgentExpenseChange> {
  const purchase = await loadPurchase(context, purchaseId, ref);
  const expense = purchase.expenses.find((candidate) => candidate.expenseId === expenseId);
  if (!expense) throw new Error(`Expense ${expenseId} is not on purchase ${purchaseId}.`);
  return { expense, purchaseSpend: purchase.spend };
}

const EXPENSE_LABEL_PARAMETER: ParameterSpec = {
  name: "label",
  in: "body",
  type: "string",
  required: true,
  description: "What it is — \"Magnifier\", \"Michel Europa catalogue\", \"Stockbook A4\".",
};

const EXPENSE_PRICE_PARAMETER: ParameterSpec = {
  name: "price",
  in: "body",
  type: "string",
  required: true,
  description: "What it cost, in the purchase's currency, as \"19.90\".",
};

export async function addExpense(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentExpenseChange> {
  const purchaseId = requiredString(params, "purchaseId");
  const ref = await assertPurchase(context, purchaseId);
  assertEditable(ref, "adding an expense");
  const expenseId = await createPurchaseExpense(context.ownerId, purchaseId, {
    label: requiredString(params, "label"),
    price: parseAmount(requiredString(params, "price"), "price"),
  });
  return expenseChange(context, purchaseId, ref, expenseId);
}

export const addPurchaseExpenseOperation: Operation = {
  name: "add_purchase_expense",
  method: "POST",
  path: "/purchases/{purchaseId}/expenses",
  description:
    "Add something bought with the stamps that is not stock — a magnifier, a catalogue, a stockbook. It takes its share of the shipping, so the stamps are not costed for it. Postage itself is the purchase's `shipping_cost`, not an expense.",
  writes: true,
  parameters: [PURCHASE_ID_PARAMETER, EXPENSE_LABEL_PARAMETER, EXPENSE_PRICE_PARAMETER],
  result: {
    kind: "object",
    description: "The new expense, and what the whole order now costs.",
  },
  handler: async (context, params) => addExpense(context, params),
};

/** The expense this call is about, on a purchase in the token's collection. */
async function assertExpense(
  context: OperationContext,
  expenseId: string
): Promise<{ purchaseId: string; purchase: PurchaseRef; label: string; price: string }> {
  const row = await prisma.purchaseExpense.findFirst({
    where: {
      id: expenseId,
      purchase: {
        kind: "purchase",
        collectionId: context.collectionId,
        collection: { ownerId: context.ownerId },
      },
    },
    select: {
      purchaseId: true,
      label: true,
      price: true,
      purchase: { select: { purchaseNo: true, tradeId: true } },
    },
  });
  if (!row) {
    throw notFound(
      `No expense with id "${expenseId}" is in this token's collection. \`get_purchase\` lists a purchase's expenses with their ids.`
    );
  }
  return {
    purchaseId: row.purchaseId,
    purchase: { purchaseNo: row.purchase.purchaseNo, fromTrade: row.purchase.tradeId !== null },
    label: row.label,
    price: row.price.toFixed(2),
  };
}

const EXPENSE_ID_PARAMETER: ParameterSpec = {
  name: "expenseId",
  in: "path",
  type: "string",
  required: true,
  description: "The expense's id, from `get_purchase` or `add_purchase_expense`.",
};

export async function editExpense(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentExpenseChange> {
  const expenseId = requiredString(params, "expenseId");
  const expense = await assertExpense(context, expenseId);
  assertEditable(expense.purchase, "changing an expense");
  const label = optionalString(params, "label");
  const price = optionalString(params, "price");
  if (label === null && price === null) {
    throw invalidRequest('Nothing to change: send "label", "price", or both.');
  }
  await updatePurchaseExpense(context.ownerId, expenseId, {
    label: label ?? expense.label,
    price: price !== null ? parseAmount(price, "price") : Number(expense.price),
  });
  return expenseChange(context, expense.purchaseId, expense.purchase, expenseId);
}

export const updatePurchaseExpenseOperation: Operation = {
  name: "update_purchase_expense",
  method: "PATCH",
  path: "/purchase-expenses/{expenseId}",
  description: "Correct an expense's label or price. Only what is sent changes.",
  writes: true,
  parameters: [
    EXPENSE_ID_PARAMETER,
    { ...EXPENSE_LABEL_PARAMETER, required: false },
    { ...EXPENSE_PRICE_PARAMETER, required: false },
  ],
  result: {
    kind: "object",
    description: "The expense as it now stands, and what the whole order now costs.",
  },
  handler: async (context, params) => editExpense(context, params),
};

export async function removeExpense(
  context: OperationContext,
  params: ParsedParams
): Promise<{ removed: number; purchaseSpend: AgentSpend }> {
  const expenseId = requiredString(params, "expenseId");
  const expense = await assertExpense(context, expenseId);
  assertEditable(expense.purchase, "removing an expense");
  await deletePurchaseExpense(context.ownerId, expenseId);
  const purchase = await loadPurchase(context, expense.purchaseId, expense.purchase);
  return { removed: 1, purchaseSpend: purchase.spend };
}

export const removePurchaseExpenseOperation: Operation = {
  name: "remove_purchase_expense",
  method: "DELETE",
  path: "/purchase-expenses/{expenseId}",
  description: "Take an expense off a purchase.",
  writes: true,
  parameters: [EXPENSE_ID_PARAMETER],
  result: {
    kind: "object",
    description: "How many expenses were removed — one — and what the whole order now costs.",
  },
  handler: async (context, params) => removeExpense(context, params),
};
