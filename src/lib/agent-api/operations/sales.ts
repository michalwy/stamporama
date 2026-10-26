import "server-only";
import { prisma } from "../../db";
import { normalizeFacebookProfileUrl } from "../../facebook-profile-rules";
import {
  SaleActionBlockedError,
  countSales,
  getSaleDetail,
  listSalesPaginated,
  listSellableOffers,
  moveSaleLinesThroughApi,
  recordSaleLinesThroughApi,
  type ApiSaleTarget,
  type SaleStatus,
} from "../../sales";
import { SELLABLE_OFFER_STATES } from "../../sale-rules";
import { saleLineAddedAction } from "../../sale-review";
import {
  FACEBOOK_PROFILES_SELECT,
  facebookOfferSaleCurrency,
  findOrCreateBuyer,
  lookupFacebookBuyer,
} from "../../facebook-sales";
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
  MAX_SELLER_SUGGESTIONS,
  closeContacts,
  parseIsoDate,
  resolveSeller,
} from "../purchase-reads";
import {
  AGENT_SALE_STATUSES,
  buyer as buyerProjection,
  parseSalePrice,
  saleRecord,
  saleRow,
} from "../sale-reads";
import { parseSaleRef } from "../conversation-log-reads";
import { readCollectionVocabulary } from "./vocabulary";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { AgentBuyer, AgentSale, AgentSaleRow } from "../sale-reads";
import type { SellerCandidate } from "../purchase-reads";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Sales (#1949) — the agent reads the sales already recorded, finds or adds the buyer, and records
// what sold: the collector's scenario is *list my Facebook offers → find what sold and to whom →
// record it*, where reading Facebook is the agent's own work and recording it is this module's.
//
// ## What it writes, and the boundary
//
// **Two writes, both the app's own.** `find_or_create_buyer` is *Sell*'s buyer lookup on Facebook
// (#1777) — profile link first, then name, a name held by somebody with another link refused as
// somebody else — reached with or without a link. `sell_offer` and `sell_offer_set` are *Sell* and
// *Sell set* (#225, #473): the offer's sets that are left, or one of them, into a sale already there
// or a new one, through `recordSaleLinesThroughApi`, which runs the dialog's guards and writes the
// lines and the *to review* marker (#1948) in one transaction. The sale waits for the collector's
// *Confirm*, which nothing here can reach.
//
// **A third write, since #2204**: `move_sale_sets` moves sold sets to another sale of the same buyer —
// a new one or an open one — through `moveSaleLinesThroughApi`, the sale screen's own move under its
// rules, marking both sales *to review* in the move's transaction.
//
// **No deleting, and no moving a sale.** No operation removes a sale or a line, changes a sale's
// status, its header, a line's price or set, or its packing, shipping or share link — those stay in
// the app, where the collector has the parcel in view. `tests/unit/agent-api-operation-boundary.test.ts`
// holds it as a fact about what this module imports.
//
// **Narrower than the dialog in one place**: a sale already *Sent* is never added to. The dialog does
// it behind *Show sent sales too*, as a correction (#1950); a correction is the collector's.
//
// ## Contacts
//
// **A buyer is named exactly or not at all** where a sale is recorded or narrowed — the purchase
// operations' rule (#1390), over the contacts that are buyers: an id, or a name equal to the input
// once case and surrounding space are set aside, and an unknown name refused with the close ones.
// Adding a buyer is its own act, `find_or_create_buyer`, which refuses a name close to an existing
// contact unless the agent states it is a different person — the typo that makes a second
// *Kowalski* is exactly what the dialog's lookup lets through, and an agent cannot see the name list.

// ── Loading what a call is about ─────────────────────────────────────────────

async function assertSale(
  context: OperationContext,
  saleId: string
): Promise<{ buyerId: string | null; currency: string }> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { buyerId: true, currency: true },
  });
  if (!sale) {
    throw notFound(
      `No sale with id "${saleId}" is in this token's collection. Use \`list_sales\` to find the right id.`
    );
  }
  return sale;
}

/** Every contact that is a buyer, reduced to what a buyer is matched against. */
async function loadBuyerCandidates(context: OperationContext): Promise<SellerCandidate[]> {
  return prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId }, buyer: true },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
}

const BUYER_NEWCOMER = { who: "buyer", operation: "find_or_create_buyer" } as const;

async function resolveBuyerParam(context: OperationContext, value: string): Promise<string> {
  return resolveSeller(value, await loadBuyerCandidates(context), "buyer", BUYER_NEWCOMER);
}

/** A domain refusal as one the agent can act on: the sale module's own sentence, as `invalid_request`
 *  — the offer verbs' arrangement (`agent-api.md`, *Refusals*). */
async function refusingDomainGuards<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SaleActionBlockedError) throw invalidRequest(error.message);
    throw error;
  }
}

// ── list_sales ───────────────────────────────────────────────────────────────

const LIST_SALES_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "platform",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to sales on this marketplace. Takes the platform's name from `get_collection_vocabulary` or its id.",
  },
  {
    name: "buyer",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to sales to this buyer. Takes the contact's name or id; a name that matches no buyer is refused with the buyers close to it.",
  },
  {
    name: "status",
    in: "query",
    type: "string[]",
    required: false,
    description:
      "Restrict to sales in these fulfilment statuses: `ordered`, `paid`, `packed`, `sent`, `received`. Left out, every status.",
    values: AGENT_SALE_STATUSES,
  },
  {
    name: "sold_from",
    in: "query",
    type: "string",
    required: false,
    description: "Restrict to sales made on or after this day, yyyy-mm-dd.",
  },
  {
    name: "sold_to",
    in: "query",
    type: "string",
    required: false,
    description: "Restrict to sales made on or before this day, yyyy-mm-dd.",
  },
  {
    name: "to_review",
    in: "query",
    type: "boolean",
    required: false,
    description:
      "Send true for only the sales recorded or added to through this API that the collector has not confirmed yet.",
  },
  {
    name: "sale_no",
    in: "query",
    type: "integer",
    required: false,
    description: "One sale by the short number the collector calls it by — what `s12` means in the app's quick-jump box.",
  },
];

export async function readSales(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentSaleRow>> {
  const platform = optionalString(params, "platform");
  const buyerValue = optionalString(params, "buyer");
  const statuses = stringList(params, "status");
  const from = optionalString(params, "sold_from");
  const to = optionalString(params, "sold_to");
  const saleNo = optionalInteger(params, "sale_no");

  const filters = {
    ...(platform !== null
      ? {
          platformId: resolveVocabularyValue(platform, (await readCollectionVocabulary(context)).platforms, {
            vocabulary: "platform",
            parameter: "platform",
          }),
        }
      : {}),
    ...(buyerValue !== null ? { buyerId: await resolveBuyerParam(context, buyerValue) } : {}),
    ...(statuses.length > 0 ? { statuses: [...statuses] as SaleStatus[] } : {}),
    ...(from !== null ? { soldFrom: new Date(`${parseIsoDate(from, "sold_from")}T00:00:00.000Z`) } : {}),
    ...(to !== null ? { soldTo: new Date(`${parseIsoDate(to, "sold_to")}T00:00:00.000Z`) } : {}),
    ...(optionalBoolean(params, "to_review") === true ? { toReview: true } : {}),
    ...(saleNo !== null ? { saleNo } : {}),
  };

  const window = parseListWindow(params);
  const [page, total, header] = await Promise.all([
    listSalesPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // The match count and never `items.length` (#706).
    countSales(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
  ]);

  return listResponse(
    page.items.map((row) => saleRow(row, collectionPath(header, `/sales/${encodeURIComponent(row.id)}`))),
    total,
    window
  );
}

export const listSalesOperation: Operation = {
  name: "list_sales",
  method: "GET",
  path: "/sales",
  description:
    "The sales in this collection, newest first — narrowed to a marketplace, a buyer, fulfilment statuses, a span of days, the ones waiting for the collector's review, or one sale number. This is how a sale id is found, and how to check that a sale is not already recorded before recording it again.",
  writes: false,
  parameters: LIST_SALES_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The sales. `gross` is what the sold sets fetched, in the sale's own `currency`; `net` is what the sale brought in after the buyer's handling, the commission and my shipping, in the collection's `baseCurrency`. `sets` and `copies` count what left on it. `toReview` is present while a sale recorded or added to through this API waits for the collector's confirmation, naming what was done.",
  },
  handler: async (context, params) => readSales(context, params),
};

// ── get_sale ─────────────────────────────────────────────────────────────────

const SALE_ID_PARAMETER: ParameterSpec = {
  name: "saleId",
  in: "path",
  type: "string",
  required: true,
  description: "The sale's id, from `list_sales`, `sell_offer` or `sell_offer_set`.",
};

/** The sale in `get_sale`'s shape, read fresh — every write answers with what it left. */
async function loadSale(context: OperationContext, saleId: string): Promise<AgentSale> {
  const [detail, header] = await Promise.all([
    getSaleDetail(context.ownerId, saleId),
    loadCollectionHeader(context),
  ]);
  if (!detail || detail.collectionId !== context.collectionId) {
    throw notFound(
      `No sale with id "${saleId}" is in this token's collection. Use \`list_sales\` to find the right id.`
    );
  }
  const offerIds = [...new Set(detail.lines.flatMap((line) => (line.offerId ? [line.offerId] : [])))];
  const offers = await prisma.offer.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, offerNo: true },
  });
  return saleRecord(
    detail,
    new Map(offers.map((offer) => [offer.id, offer.offerNo])),
    collectionPath(header, `/sales/${encodeURIComponent(saleId)}`)
  );
}

export async function readSale(context: OperationContext, params: ParsedParams): Promise<AgentSale> {
  const saleId = requiredString(params, "saleId");
  await assertSale(context, saleId);
  return loadSale(context, saleId);
}

export const getSaleOperation: Operation = {
  name: "get_sale",
  method: "GET",
  path: "/sales/{saleId}",
  description:
    "One sale in full: its buyer, its marketplace, when it was made, its status, every sold set with the offer it came from and its price, and what the sale fetched and brought in.",
  writes: false,
  parameters: [SALE_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "The sale. Each line is one sold set: `offerNo` is the offer it sold from — null, with `offerId` and `setId`, on a set of copies sold on no offer — `set` how the set reads, `price` what it sold for in the sale's `currency`, and `copies` the copies that left with it; `setChoicePending` says the line names one of the offer's interchangeable sets that nobody has chosen yet. `gross` is the lines added up; `buyerHandling`, `buyerPaidTotal` and `commission` are in the sale's currency, `shippingCost` in `shippingCurrency`, and `net` in `baseCurrency`. `toReview` is present while what this API recorded waits for the collector's confirmation.",
  },
  handler: async (context, params) => readSale(context, params),
};

// ── find_or_create_buyer ─────────────────────────────────────────────────────

const FIND_OR_CREATE_BUYER_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "name",
    in: "body",
    type: "string",
    required: false,
    description:
      "The buyer's name, as the marketplace shows it — on Facebook, as their profile does. Needed to create a buyer; a buyer already known by their profile link is found without it.",
  },
  {
    name: "facebook_profile",
    in: "body",
    type: "string",
    required: false,
    description:
      "The link to the buyer's Facebook profile, as copied from Facebook. Names repeat on Facebook, so the link is what a buyer there is recognised by: it is looked up first, then the name, and it is kept on the contact. A name held by a contact with a different profile link is refused as somebody else.",
  },
  {
    name: "different_person",
    in: "body",
    type: "boolean",
    required: false,
    description:
      "Send true only when a first attempt was refused for being close to an existing contact and that contact is **not** this buyer. Never send it on a first attempt.",
  },
];

export async function findOrCreateBuyerFor(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentBuyer> {
  const name = optionalString(params, "name") ?? "";
  const profile = optionalString(params, "facebook_profile") ?? "";
  if (!name && !profile) {
    throw invalidRequest('Send the buyer\'s "name", their "facebook_profile" link, or both. Nobody was found or created.');
  }

  // The dialog's lookup first, so that what is found is found exactly as *Sell* finds it.
  const lookup = await lookupFacebookBuyer(context.collectionId, { name, profileUrl: profile });
  if (lookup.conflict) throw invalidRequest(`${lookup.conflict} Nobody was found or created.`);

  // Nobody found: a new buyer — refused while their name is close to somebody already here, unless
  // the agent says they are a different person (#1390's rule for `create_seller`).
  if (!lookup.contact && name && optionalBoolean(params, "different_person") !== true) {
    const candidates = await prisma.contact.findMany({
      where: { collectionId: context.collectionId },
      select: { id: true, name: true, fullName: true },
      orderBy: { name: "asc" },
    });
    const close = closeContacts([name], candidates);
    if (close.length > 0) {
      const shown = close.slice(0, MAX_SELLER_SUGGESTIONS);
      throw invalidRequest(
        `"${name}" is close to ${close.length === 1 ? "a contact" : `${close.length} contacts`} already in this collection: ${shown
          .map((candidate) => `${candidate.name} (${candidate.id})`)
          .join(", ")}. If one of them is this buyer, send its name or id as "buyer" instead. If none is, call again with "different_person": true.`,
        shown.map((candidate) => candidate.id)
      );
    }
  }

  const resolved = await findOrCreateBuyer(context.collectionId, { name, profileUrl: profile });
  if (!resolved.ok) throw invalidRequest(`${resolved.message} Nobody was found or created.`);
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id: resolved.buyerId! },
    select: {
      id: true,
      name: true,
      facebookProfiles: FACEBOOK_PROFILES_SELECT,
    },
  });
  const asked = normalizeFacebookProfileUrl(profile);
  return buyerProjection(
    { id: contact.id, name: contact.name, facebookProfileUrls: contact.facebookProfiles.map((p) => p.url) },
    resolved.created ? "created" : (resolved.matchedBy ?? "name"),
    asked.ok ? asked.value : null
  );
}

export const findOrCreateBuyerOperation: Operation = {
  name: "find_or_create_buyer",
  method: "POST",
  path: "/buyers",
  description:
    "Find the contact a buyer is, or add them — before recording a sale to them. On Facebook send their profile link: a buyer is found by it — any of the profiles their contact holds — first and by name second, the way the app's own Sell dialog finds them, and a name held by somebody with other links but not this one is refused as somebody else. A new buyer whose name is close to a contact already here is refused with the candidates until you state it is a different person. A contact found is made a buyer and given the profile link if it had none at all; nothing else about it changes.",
  writes: true,
  parameters: FIND_OR_CREATE_BUYER_PARAMETERS,
  result: {
    kind: "object",
    description:
      "The buyer: its id, to send as `buyer`, the name it is filed under, its Facebook profile link (`facebookProfile` — the one sent when it is theirs, else their first) and all of them (`facebookProfiles`; a buyer may bid from more than one account, and any of them finds the contact), and `found` — `profile` or `name` for a contact already here, `created` for a new one. It cannot be edited or deleted from here.",
  },
  handler: async (context, params) => findOrCreateBuyerFor(context, params),
};

// ── sell_offer / sell_offer_set ──────────────────────────────────────────────

const OFFER_ID_PARAMETER: ParameterSpec = {
  name: "offerId",
  in: "path",
  type: "string",
  required: true,
  description: "The listing's id, from `list_offers`.",
};

const SELL_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "price",
    in: "body",
    type: "string",
    required: true,
    description:
      "What **one set** sold for, in the offer's own currency, with at most two decimal places — on an auction the winning bid, on a quick buy the price paid. Every set sold by this call is recorded at it.",
  },
  {
    name: "sale",
    in: "body",
    type: "string",
    required: false,
    description:
      "The id of a sale already recorded to add to, from `list_sales` — the buyer's open sale on the same marketplace and in the same currency. Left out, a new sale is started. A sale already sent is refused: adding to one is a correction the collector makes.",
  },
  {
    name: "buyer",
    in: "body",
    type: "string",
    required: false,
    description:
      "Who bought it: a buyer's name or id, from `find_or_create_buyer`. A name that matches no buyer is refused with the close ones — nothing is created from here. With `sale`, it must be that sale's buyer.",
  },
  {
    name: "sold_at",
    in: "body",
    type: "string",
    required: false,
    description:
      "The day it sold, yyyy-mm-dd — required when a new sale is started, and refused with `sale`, which keeps its own date.",
  },
];

const SET_ID_PARAMETER: ParameterSpec = {
  name: "setId",
  in: "path",
  type: "string",
  required: true,
  description: "The set's id, from `get_offer`'s `sets`.",
};

/** *Sell* and *Sell set*: the offer's sets left — or the one named — sold into a sale. */
async function sell(
  context: OperationContext,
  params: ParsedParams,
  setId: string | null
): Promise<AgentSale> {
  const offerId = requiredString(params, "offerId");
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { offerNo: true, platformId: true, currency: true, state: true, sets: { select: { id: true } } },
  });
  if (!offer) {
    throw notFound(`No offer with id "${offerId}" is in this token's collection. Use \`list_offers\` to find the right id.`);
  }
  if (setId !== null && !offer.sets.some((set) => set.id === setId)) {
    throw notFound(`Offer #${offer.offerNo} has no set with id "${setId}". \`get_offer\` lists its sets.`);
  }
  const price = parseSalePrice(requiredString(params, "price"), "price");

  // What is left to sell is the dialog's own list (`listSellableOffers`), so the two cannot disagree.
  if (!(SELLABLE_OFFER_STATES as readonly string[]).includes(offer.state)) {
    throw invalidRequest(
      `Offer #${offer.offerNo} is ${offer.state}. Only a listing that is up — pending, active or paused — is sold; a draft has not been listed and a closed one has already ended.`
    );
  }
  const sellable = (
    await listSellableOffers(context.ownerId, context.collectionId, { platformId: offer.platformId })
  ).find((candidate) => candidate.offerId === offerId);
  const sets = (sellable?.sets ?? []).filter((set) => setId === null || set.offerSetId === setId);
  if (sets.length === 0) {
    throw invalidRequest(
      setId !== null
        ? `That set of offer #${offer.offerNo} has already sold. \`list_sales\` finds the sale it is on.`
        : `Nothing is left to sell on offer #${offer.offerNo} — every set has already sold. \`list_sales\` finds the sales they are on.`
    );
  }

  const saleId = optionalString(params, "sale");
  const buyerValue = optionalString(params, "buyer");
  const soldAtValue = optionalString(params, "sold_at");
  const buyerId = buyerValue !== null ? await resolveBuyerParam(context, buyerValue) : null;

  let target: ApiSaleTarget;
  let currency = offer.currency;
  if (saleId !== null) {
    const sale = await assertSale(context, saleId);
    if (soldAtValue !== null) {
      throw invalidRequest('"sold_at" is refused with "sale": the sale keeps its own date. Drop it, or leave out "sale" to start a new sale.');
    }
    if (buyerId !== null && sale.buyerId !== buyerId) {
      throw invalidRequest(
        `That sale is ${sale.buyerId === null ? "to no named buyer" : "to a different buyer"}. Add to the buyer's own sale — \`list_sales\` with "buyer" finds it — or leave out "sale" to start a new one.`
      );
    }
    target = { saleId };
    currency = sale.currency;
  } else {
    if (soldAtValue === null) {
      throw invalidRequest('"sold_at" is required to start a new sale: send the day it sold, yyyy-mm-dd. To add to a sale already recorded, send its id as "sale".');
    }
    const offerCurrency = await facebookOfferSaleCurrency(context.ownerId, context.collectionId, offerId);
    target = {
      header: {
        platformId: offer.platformId,
        buyerId,
        externalRef: null,
        transactionUrl: null,
        soldAt: new Date(`${parseIsoDate(soldAtValue, "sold_at")}T00:00:00.000Z`),
        // Only consulted on a platform with no currency yet (#196), as the dialog's form sends it.
        currency: offer.currency,
        buyerHandling: null,
        buyerPaidTotal: null,
        commission: null,
      },
      ...(offerCurrency ? { offerCurrency } : {}),
    };
  }

  const named = offer.sets.length > 1;
  const recorded = await refusingDomainGuards(() =>
    recordSaleLinesThroughApi(
      context.ownerId,
      context.collectionId,
      target,
      sets.map((set) => ({ offerId, offerSetId: set.offerSetId, price, itemIds: set.itemIds })),
      sets.map((set) =>
        saleLineAddedAction({ offerNo: offer.offerNo, setLabel: named ? set.label : null, price, currency })
      )
    )
  );
  return loadSale(context, recorded.saleId);
}

const SELL_RESULT = {
  kind: "object",
  description:
    "The sale as it now stands, in `get_sale`'s shape, marked `toReview` with what was recorded. The offer is `sold` once every set of it has sold.",
} as const;

export const sellOfferOperation: Operation = {
  name: "sell_offer",
  method: "POST",
  path: "/offers/{offerId}/sale",
  description:
    "Record that a listing sold: every set it still has is added to a sale — the buyer's sale already recorded, named by `sale`, or a new one started with `buyer` and `sold_at` — at `price` each, as the app's Sell does and refusing what it refuses. The sale waits for the collector's review. Check `list_sales` first so a sale is not recorded twice; for one set of several, use `sell_offer_set`.",
  writes: true,
  parameters: [OFFER_ID_PARAMETER, ...SELL_PARAMETERS],
  result: SELL_RESULT,
  handler: async (context, params) => sell(context, params, null),
};

export const sellOfferSetOperation: Operation = {
  name: "sell_offer_set",
  method: "POST",
  path: "/offers/{offerId}/sets/{setId}/sale",
  description:
    "Record that one set of a listing sold — on a listing offering the same thing several times over, one buyer's purchase. Otherwise exactly `sell_offer`: into the buyer's sale named by `sale`, or a new one started with `buyer` and `sold_at`, at `price`. The sale waits for the collector's review.",
  writes: true,
  parameters: [OFFER_ID_PARAMETER, SET_ID_PARAMETER, ...SELL_PARAMETERS],
  result: SELL_RESULT,
  handler: async (context, params) => sell(context, params, requiredString(params, "setId")),
};

// ── move_sale_sets ───────────────────────────────────────────────────────────

/** The word for *a new sale*, where the target of a move is named. */
const NEW_SALE = "new";

const MOVE_SALE_SETS_PARAMETERS: readonly ParameterSpec[] = [
  { ...SALE_ID_PARAMETER, description: "The id of the sale the sets leave, from `list_sales`." },
  {
    name: "lines",
    in: "body",
    type: "string[]",
    required: true,
    description:
      "The sold sets to move, by their line ids from `get_sale`'s `lines`. At least one, and never every line of the sale — moving everything is not a split.",
  },
  {
    name: "to",
    in: "body",
    type: "string",
    required: true,
    description: `Where they go: \`${NEW_SALE}\` for a new sale for the same buyer, or the number (\`12\` or \`s12\`) or id of an open sale of the same buyer, marketplace and currency.`,
  },
];

/** Both sales after a move: the one the sets left and the one they joined. */
export interface AgentSaleMove {
  from: AgentSale;
  to: AgentSale;
}

export async function moveSaleSets(context: OperationContext, params: ParsedParams): Promise<AgentSaleMove> {
  const saleId = requiredString(params, "saleId");
  await assertSale(context, saleId);
  const lineIds = stringList(params, "lines");
  if (lineIds.length === 0) {
    throw invalidRequest('Send the sets to move as "lines" — their line ids from `get_sale`. Nothing was moved.');
  }

  const toValue = requiredString(params, "to").trim();
  let targetSaleId: string | null = null;
  if (toValue.toLocaleLowerCase() !== NEW_SALE) {
    const ref = parseSaleRef(toValue);
    if (ref.kind === "none") {
      throw invalidRequest(`"to" takes \`${NEW_SALE}\` or a sale's number or id. Nothing was moved.`);
    }
    const target = await prisma.sale.findFirst({
      where: {
        collectionId: context.collectionId,
        collection: { ownerId: context.ownerId },
        ...(ref.kind === "number" ? { saleNo: ref.saleNo } : { id: ref.id }),
      },
      select: { id: true },
    });
    if (!target) {
      throw notFound(
        `No sale ${ref.kind === "number" ? `numbered ${ref.saleNo}` : `with id "${ref.id}"`} is in this token's collection. \`list_sales\` with "buyer" lists the buyer's sales.`
      );
    }
    targetSaleId = target.id;
  }

  const moved = await refusingDomainGuards(() =>
    moveSaleLinesThroughApi(context.ownerId, context.collectionId, {
      sourceSaleId: saleId,
      lineIds,
      target: targetSaleId ? { saleId: targetSaleId } : { newSale: true },
    })
  );
  const [from, to] = await Promise.all([loadSale(context, moved.sourceSaleId), loadSale(context, moved.targetSaleId)]);
  return { from, to };
}

export const moveSaleSetsOperation: Operation = {
  name: "move_sale_sets",
  method: "POST",
  path: "/sales/{saleId}/lines/move",
  description:
    "Split a sale: move some of its sold sets to another sale of the same buyer — a new one, or an open one of theirs on the same marketplace and in the same currency — as the app's Move to another sale does. The sets keep their prices, copies and packing; nothing goes back to stock and no offer changes. The sale's own amounts — handling or total paid, commission, postage, shipping option, packing supplies — stay where they are, and a new sale starts with none, with the same buyer, order number and date. A sale already sent, or a move of every set, is refused. Both sales wait for the collector's review.",
  writes: true,
  parameters: MOVE_SALE_SETS_PARAMETERS,
  result: {
    kind: "object",
    description:
      "Both sales as they now stand, in `get_sale`'s shape: `from`, the sale the sets left, and `to`, the sale they joined or started — each marked `toReview` with what moved.",
  },
  handler: async (context, params) => moveSaleSets(context, params),
};
