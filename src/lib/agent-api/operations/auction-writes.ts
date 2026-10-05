import "server-only";
import { prisma } from "../../db";
import { COMMON_CURRENCIES } from "../../currencies";
import {
  AuctionActionBlockedError,
  addAuctionLotThroughApi,
  getAuctionLotDetail,
  recordAuctionLotOutcomeThroughApi,
  replaceAuctionLotLinesThroughApi,
  setAuctionLotCeilingThroughApi,
  updateAuctionLotThroughApi,
  updateAuctionSaleThroughApi,
  type AuctionLotApiOutcome,
  type AuctionLotApiPatch,
  type AuctionSaleApiPatch,
} from "../../auctions";
import type { AuctionLotLineInput } from "../../auction-lines";
import type { AuctionLotOutcome } from "../../auction-lot";
import type { TagEntry } from "../../tag-entry";
import { watchlistLot, type AgentWatchlistLot } from "../auction-reads";
import {
  lotLine,
  parseAuctionAmount,
  parseInstant,
  parseLotLines,
  parsePremiumPercent,
  parseTagNames,
  type AgentLotLine,
  type LotLineSpec,
} from "../auction-writes";
import { resolveAxisValue } from "../catalog-prices";
import { invalidRequest, notFound } from "../errors";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { compact } from "../collection-reads";
import { resolvePlatformParam, resolveSellerParam } from "./purchases";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import { resolveStampRefMap } from "./stamp-refs";
import { readCollectionVocabulary } from "./vocabulary";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// **Auction lots written through the agent API** (#1627) — the register an assistant keeps once the
// collector has decided to bid on a listing it found: the lot and its sale, what is in it, its tags,
// its ceiling, what the auction stands at, and the sale's terms.
//
// ## It never bids
//
// The collector, 2026-10-04: *the API writes the register and never bids.* Nothing here writes the
// collector's own bid (`myBid`) — that records a bid placed by hand on the platform — and nothing
// reaches a platform. It is held by what this module may import: the six `…ThroughApi` writers in
// `auctions.ts` and nothing else that writes there (`tests/unit/agent-api-operation-boundary.test.ts`).
//
// ## It records how an auction ended, and settles nothing (#1628)
//
// `record_auction_lot_outcome` closes a lot with what it went for, or cancels it, through the app's
// own closing rules — so won or lost is derived from the money exactly as the app derives it, and is
// never sent. Settling a won lot into its purchase asks what only the collector answers, and a closed
// lot is reopened only in the app.
//
// ## Every write waits for review
//
// Each writer sets the *to review* marker (#1626) on what it touched, in its own transaction, so a
// write cannot land unmarked; only the collector's *Confirm* clears it, and nothing here can reach
// that. The answers carry the marker as `toReview`. The one thing recorded without marking is a
// lot's current bid (#1652): an observation of the auction, not a decision, refreshed as often as
// the assistant looks.
//
// ## The sale follows the capture's rule
//
// There is no separate sale write to start one: adding a lot names the seller and the platform and
// **joins or starts** the sale as the Assistant's capture and the *Add lot* form do (#352, #742) — on
// a platform whose parcel is the house's named sale (Philasearch) the open sale **of that name**, and
// elsewhere the seller's open sale on the platform. A sale is edited on its own only for its terms.
//
// ## Names, not cuids, and refusals before writes
//
// A seller is matched exactly and never created here (`create_seller` is that act, #1390); a
// platform, a grade, a certificate and a format by `get_collection_vocabulary`'s names; a stamp by
// id, short number or catalogue number. Anything unresolved refuses the whole call and nothing is
// written — a lot's lines are its whole contents. The domain's own refusals are written for a
// collector at a form, so they are re-said here for an agent (`blocked`).

// ── Shared ───────────────────────────────────────────────────────────────────

/** A domain refusal, re-said for an agent: what to send instead, and that nothing was written. */
function blocked(err: unknown): never {
  if (!(err instanceof AuctionActionBlockedError)) throw err;
  switch (err.reason) {
    case "no-seller":
      throw invalidRequest(
        `"seller" is required here: the lot joins the seller's open sale on this platform, or starts one. Send the seller, or add them with \`create_seller\` first. Nothing was written.`
      );
    case "no-sale":
      throw invalidRequest(`${err.message} Send it as "sale_name", as the house names the sale. Nothing was written.`);
    case "no-closing-time":
      throw invalidRequest(`"ends_at" is required here: ${err.message} Nothing was written.`);
    case "settled":
      throw invalidRequest(
        "This lot has been settled into a purchase, so it is a record of what was paid and is not changed from here — only its tags are. Nothing was written."
      );
    case "no-price":
      throw invalidRequest(
        `"final_price" is required: the collector bid on this lot, and a lot they bid on is closed with what it went for — that is what says whether they won it. If the result is not known, leave the lot open. If they never really bid, they clear their bid in the app first. Nothing was written.`
      );
    case "tie-unresolved":
      throw invalidRequest(
        `"won_tie" is required: the lot went for exactly the collector's own bid, so the figures cannot say whose it is — whoever bid that amount first won it. Send "won_tie": true if it was the collector, false if not. Nothing was written.`
      );
    default:
      throw invalidRequest(`${err.message} Nothing was written.`);
  }
}

async function runBlocked<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    return blocked(err);
  }
}

/** The lot this call is about, proved to be in the token's collection. */
async function assertLot(context: OperationContext, lotId: string): Promise<void> {
  const found = await prisma.auctionLot.findFirst({
    where: { id: lotId, auctionSale: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } } },
    select: { id: true },
  });
  if (!found) {
    throw notFound(
      `No auction lot with id "${lotId}" is in this token's collection. \`list_auction_watchlist\` and \`find_tracked_auction_lots\` give a lot's id.`
    );
  }
}

/** A lot as a write answers with it: the watchlist's own row, its lines, and the review marker. */
export interface AgentWrittenLot extends AgentWatchlistLot {
  readonly lines: readonly AgentLotLine[];
}

async function loadLot(context: OperationContext, lotId: string): Promise<AgentWrittenLot> {
  const header = await loadCollectionHeader(context);
  const lot = await getAuctionLotDetail(context.ownerId, context.collectionId, lotId);
  if (!lot) throw new Error(`Lot ${lotId} was written but cannot be read back.`);
  const path = collectionPath(
    header,
    `/auctions/sales/${encodeURIComponent(lot.saleId)}?lot=${encodeURIComponent(lot.id)}`
  );
  return { ...watchlistLot(lot, new Date(), path), lines: lot.lines.map(lotLine) };
}

/** A sale's terms as the agent reads them. Amounts are in its `currency`. */
export interface AgentAuctionSale {
  readonly saleId: string;
  readonly name: string;
  readonly seller: string;
  readonly platform: string;
  readonly currency: string;
  readonly url?: string;
  /** The closing time a house sale's lots share; a marketplace basket's is only a seed. */
  readonly endsAt?: string;
  readonly premiumPercent?: string;
  readonly premiumFixed?: string;
  readonly shippingCost?: string;
  /** `open` while lots are being added, `closed` when nothing was won, `settled` once paid for. */
  readonly status: string;
  readonly lots: number;
  /** What the agent API wrote to the sale's own terms that the collector has not yet confirmed. */
  readonly toReview?: { readonly at: string; readonly created: boolean; readonly changed: readonly string[] };
  readonly path: string;
}

async function loadSale(context: OperationContext, saleId: string): Promise<AgentAuctionSale> {
  const header = await loadCollectionHeader(context);
  const sale = await prisma.auctionSale.findFirstOrThrow({
    where: { id: saleId, collectionId: context.collectionId },
    select: {
      id: true,
      name: true,
      url: true,
      endsAt: true,
      currency: true,
      premiumPercent: true,
      premiumFixed: true,
      shippingCost: true,
      status: true,
      apiReviewAt: true,
      apiReviewCreated: true,
      apiReviewFields: true,
      seller: { select: { name: true } },
      platform: { select: { name: true } },
      _count: { select: { lots: true } },
    },
  });
  return compact({
    saleId: sale.id,
    name: sale.name,
    seller: sale.seller.name,
    platform: sale.platform.name,
    currency: sale.currency,
    url: sale.url,
    endsAt: sale.endsAt?.toISOString(),
    premiumPercent: sale.premiumPercent?.toFixed(2),
    premiumFixed: sale.premiumFixed?.toFixed(2),
    shippingCost: sale.shippingCost?.toFixed(2),
    status: sale.status,
    lots: sale._count.lots,
    toReview: sale.apiReviewAt
      ? { at: sale.apiReviewAt.toISOString(), created: sale.apiReviewCreated, changed: sale.apiReviewFields }
      : undefined,
    path: collectionPath(header, `/auctions/sales/${encodeURIComponent(sale.id)}`),
  }) as AgentAuctionSale;
}

/** Lines as sent, resolved — every stamp, grade, certificate and format — or the call refused. */
async function resolveLines(
  context: OperationContext,
  specs: readonly LotLineSpec[],
  parameter: string
): Promise<AuctionLotLineInput[]> {
  if (specs.length === 0) return [];
  const vocabulary = await readCollectionVocabulary(context);
  const stamps = await resolveStampRefMap(
    context,
    specs.map((spec) => spec.stamp),
    parameter
  );
  return specs.map((spec, index) => {
    const at = `line ${index + 1} of "${parameter}"`;
    const grade = (value: string) =>
      resolveVocabularyValue(value, vocabulary.conditions, { vocabulary: "condition", parameter: at });
    const condition = spec.condition;
    return {
      stampId: stamps.get(spec.stamp.trim())!,
      conditionId: condition.kind === "one" ? grade(condition.value) : null,
      possibleConditionIds: condition.kind === "oneOf" ? condition.values.map(grade) : [],
      certificateStatusId: resolveAxisValue(spec.certificate, vocabulary.certificateStatuses, "none", {
        vocabulary: "certificate status",
        parameter: at,
      }),
      formatId: resolveAxisValue(spec.format, vocabulary.formats, "single", {
        vocabulary: "format",
        parameter: at,
      }),
      quantity: spec.quantity,
    };
  });
}

function tagEntries(names: readonly string[]): TagEntry[] {
  return names.map((name) => ({ id: null, name, color: null }));
}

/** The refusal for a listing another lot already tracks — with that lot, so the agent updates it. */
async function alreadyTracked(context: OperationContext, lotId: string): Promise<never> {
  const lot = await loadLot(context, lotId);
  throw invalidRequest(
    `This listing is already tracked as lot ${lot.lotNumber} ("${lot.name}", in ${lot.sale}). Nothing was written. Use \`update_auction_lot\` with its id to correct it.`,
    [lot.lotId]
  );
}

const LOT_ID_PARAMETER: ParameterSpec = {
  name: "lotId",
  in: "path",
  type: "string",
  required: true,
  description: "The lot's id, as `list_auction_watchlist`, `find_tracked_auction_lots` or `add_auction_lot` gave it.",
};

const LINES_DESCRIPTION =
  "What the lot holds, one line per stamp: `name=value` pairs separated by `;` — `stamp=Mi 309; condition=MNH; quantity=2`. `stamp` is a stamp id, a short number (`st 123`) or a catalogue number naming one stamp (`resolve_catalog_numbers` checks one). `condition` is a grade from `get_collection_vocabulary`, the grades the description leaves open separated by `|` (*Czysty* is `MNH|MH`), or `unknown` when the description says nothing — never a guess. `certificate` and `format` default to none and the single; `quantity` to 1. A run of a set is one line per stamp. Every line must resolve, or nothing is written.";

const TAGS_DESCRIPTION =
  "The lot's tags, by name — free words such as `agent-found`, one word each. A name the collection has no tag for becomes a new tag, as typing it into the lot's tag field in the app does.";

const STARTING_PRICE_DESCRIPTION =
  "What the lot opened at, in the sale's currency, as \"20.00\" — a record of the listing, never a cost: a lot nobody has bid on costs nothing.";

const ENDS_AT_DESCRIPTION =
  "When the auction closes, ISO 8601 with its time zone — \"2026-10-12T20:00:00+02:00\".";

// ── add_auction_lot ──────────────────────────────────────────────────────────

const ADD_LOT_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "platform",
    in: "body",
    type: "string",
    required: true,
    description:
      "Where the lot is listed — Allegro, Philasearch — as a platform's name from `get_collection_vocabulary` or its id. Refused, not created, when the collection does not know it.",
  },
  {
    name: "seller",
    in: "body",
    type: "string",
    required: false,
    description:
      "Who sells the lot — the marketplace seller, or the auction house. Takes what the contact is filed under, their full name, or their id; a name matching nobody is refused with the contacts close to it — add the seller with `create_seller` first. Required unless the lot joins a house's sale that already exists, whose seller it takes.",
  },
  {
    name: "sale_name",
    in: "body",
    type: "string",
    required: false,
    description:
      "The house's sale, as the house names it — \"Christoph Gärtner 66th Auction\". Required on a platform whose lots go into the house's named sale (Philasearch): the lot joins the open sale of that name there, or starts it. Elsewhere the lot joins the seller's open sale, and this only names a sale the call starts.",
  },
  {
    name: "url",
    in: "body",
    type: "string",
    required: false,
    description: "The listing's address. With `lot_number`, it is how the listing is recognised when it turns up again.",
  },
  {
    name: "lot_number",
    in: "body",
    type: "string",
    required: false,
    description:
      "The platform's number for the lot: on Allegro the offer number, at a house the lot's number in its catalogue (`1234`), which is unique only within its sale.",
  },
  {
    name: "title",
    in: "body",
    type: "string",
    required: false,
    description: "The lot's title. Leave it out and the app names the lot after what it holds.",
  },
  { name: "starting_price", in: "body", type: "string", required: false, description: STARTING_PRICE_DESCRIPTION },
  {
    name: "ends_at",
    in: "body",
    type: "string",
    required: false,
    description: `${ENDS_AT_DESCRIPTION} Required unless the lot joins a sale that already has one, whose lots then share it.`,
  },
  {
    name: "ceiling",
    in: "body",
    type: "string",
    required: false,
    description:
      "The most the lot may cost the collector, **all-in** — premium included — in the sale's currency, as \"120.00\": `recommend_bid`'s `fair.allIn`, for instance. It is a ceiling set apart from any bid and stays put. This is not a bid: nothing is bid anywhere.",
  },
  {
    name: "ceiling_note",
    in: "body",
    type: "string",
    required: false,
    description:
      "How the ceiling was reached, kept on the lot beside it — the grade and certificate the recommendation assumed, say. Only with `ceiling`.",
  },
  { name: "lines", in: "body", type: "string[]", required: false, description: LINES_DESCRIPTION },
  { name: "tags", in: "body", type: "string[]", required: false, description: TAGS_DESCRIPTION },
  {
    name: "not_stamps",
    in: "body",
    type: "boolean",
    required: false,
    description:
      "`true` for a lot that is not stamps — a catalogue, literature, an accessory. It then holds no lines, and a won one becomes an expense on the purchase. A forgery is a stamp and is not this.",
  },
  {
    name: "not_stamps_description",
    in: "body",
    type: "string",
    required: false,
    description: "What a not-stamps lot is — \"Michel Europe catalogue 2019\". Only with `not_stamps`.",
  },
];

export interface AgentAddedLot {
  readonly lot: AgentWrittenLot;
  readonly sale: AgentAuctionSale;
  /** The call started this sale rather than joining one already open. */
  readonly saleCreated: boolean;
}

export async function addAuctionLot(context: OperationContext, params: ParsedParams): Promise<AgentAddedLot> {
  await loadCollectionHeader(context);
  const ceiling = optionalString(params, "ceiling");
  const note = optionalString(params, "ceiling_note");
  if (note !== null && ceiling === null) {
    throw invalidRequest(`"ceiling_note" says how a ceiling was reached, and no "ceiling" was sent. Send both, or neither.`);
  }
  const notStamps = optionalBoolean(params, "not_stamps") === true;
  const description = optionalString(params, "not_stamps_description");
  if (description !== null && !notStamps) {
    throw invalidRequest(`"not_stamps_description" describes a lot that is not stamps; send it with "not_stamps": true.`);
  }
  const lineSpecs = parseLotLines(stringList(params, "lines"), "lines");
  if (notStamps && lineSpecs.length > 0) {
    throw invalidRequest(`A lot that is not stamps holds no lines. Send "not_stamps" or "lines", not both.`);
  }
  const endsAt = optionalString(params, "ends_at");
  const startingPrice = optionalString(params, "starting_price");
  const sellerValue = optionalString(params, "seller");

  const input = {
    platformId: await resolvePlatformParam(context, requiredString(params, "platform")),
    sellerId: sellerValue !== null ? await resolveSellerParam(context, sellerValue, "seller") : null,
    saleName: optionalString(params, "sale_name"),
    url: optionalString(params, "url"),
    lotNo: optionalString(params, "lot_number"),
    title: optionalString(params, "title"),
    startingPrice: startingPrice !== null ? parseAuctionAmount(startingPrice, "starting_price") : null,
    endsAt: endsAt !== null ? parseInstant(endsAt, "ends_at") : null,
    ceiling: ceiling !== null ? { maxBid: parseAuctionAmount(ceiling, "ceiling"), note } : null,
    lines: await resolveLines(context, lineSpecs, "lines"),
    tags: tagEntries(parseTagNames(stringList(params, "tags"), "tags")),
    notStamps: notStamps ? { description } : null,
  };
  const result = await runBlocked(() =>
    addAuctionLotThroughApi(context.ownerId, context.collectionId, input)
  );
  if (result.outcome === "tracked") return alreadyTracked(context, result.lotId);
  return {
    lot: await loadLot(context, result.lotId),
    sale: await loadSale(context, result.saleId),
    saleCreated: result.saleCreated,
  };
}

export const addAuctionLotOperation: Operation = {
  name: "add_auction_lot",
  method: "POST",
  path: "/auctions/lots",
  description:
    "Add a listing the collector has decided to bid on to their auction watchlist, as a lot: where it is listed and who sells it, its address and number, title, starting price, closing time, the ceiling, what it holds and its tags. The lot joins the sale it belongs to, or starts it, by the app's own rule: on Philasearch the house's open sale of `sale_name`; elsewhere the seller's open sale on the platform. A new sale takes the seller's usual premium and shipping. A listing already tracked — by its address, or by its number (an Allegro offer number anywhere; a house's lot number within its sale) — is refused with the lot that has it, so a second call never makes a duplicate; correct that one with `update_auction_lot`. This never bids and never sets the collector's own bid: they bid by hand on the platform. Everything written waits for the collector to confirm it in the app.",
  writes: true,
  parameters: ADD_LOT_PARAMETERS,
  result: {
    kind: "object",
    description:
      "`lot` is the new lot in `list_auction_watchlist`'s shape — with its `lotId`, `lotNumber` and `ceilingNote` — plus `lines`, each with its stamp, grade (`condition`, or `possibleConditions`, or `conditionUnknown`), certificate, format, quantity and catalogue value. `sale` is the sale it landed in, with its terms; `saleCreated` says whether this call started it. Both carry `toReview`: what the agent API wrote that the collector has not yet confirmed.",
  },
  handler: async (context, params) => addAuctionLot(context, params),
};

// ── update_auction_lot ───────────────────────────────────────────────────────

const CLEARABLE_LOT = ["title", "lot_number", "url", "starting_price", "current_bid", "tags"] as const;

const UPDATE_LOT_PARAMETERS: readonly ParameterSpec[] = [
  LOT_ID_PARAMETER,
  { name: "title", in: "body", type: "string", required: false, description: "The lot's title." },
  {
    name: "lot_number",
    in: "body",
    type: "string",
    required: false,
    description: "The platform's number for the lot — on Allegro the offer number, at a house its catalogue number.",
  },
  { name: "url", in: "body", type: "string", required: false, description: "The listing's address." },
  { name: "ends_at", in: "body", type: "string", required: false, description: ENDS_AT_DESCRIPTION },
  { name: "starting_price", in: "body", type: "string", required: false, description: STARTING_PRICE_DESCRIPTION },
  {
    name: "current_bid",
    in: "body",
    type: "string",
    required: false,
    description:
      "What the auction stands at now — the highest bid on the listing, whoever placed it — in the sale's currency, as \"45.00\". An observation, dated by `checked_at`; send it even when it has not moved, which records that it was checked. It is never the collector's own bid, and it does not mark the lot for review.",
  },
  {
    name: "checked_at",
    in: "body",
    type: "string",
    required: false,
    description:
      "When `current_bid` was read off the listing, ISO 8601 with its time zone. Defaults to now; send it when the figure comes from a mail or a page read earlier. Only with `current_bid`.",
  },
  {
    name: "tags",
    in: "body",
    type: "string[]",
    required: false,
    description: `${TAGS_DESCRIPTION} The list replaces the lot's tags; name \`tags\` in \`clear\` to take them all off.`,
  },
  {
    name: "not_stamps",
    in: "body",
    type: "boolean",
    required: false,
    description:
      "`true` marks the lot as not stamps — literature, an accessory — refused while it holds lines; `false` removes the mark, only while the lot is open.",
  },
  {
    name: "not_stamps_description",
    in: "body",
    type: "string",
    required: false,
    description: "What a not-stamps lot is. Restates the description of a lot already marked, or goes with `not_stamps: true`.",
  },
  {
    name: "clear",
    in: "body",
    type: "string[]",
    required: false,
    description:
      "Fields to empty: the title, the lot number, the address, the starting price, the current bid, or all the tags. Everything not named here or sent above is left as it is.",
    values: CLEARABLE_LOT,
  },
];

export interface AgentLotChange {
  readonly lot: AgentWrittenLot;
  /** What the call changed, as the review marker names it — though a current bid never marks (#1652);
   * empty when everything sent was already so. */
  readonly changed: readonly string[];
}

export async function updateAuctionLot(context: OperationContext, params: ParsedParams): Promise<AgentLotChange> {
  const lotId = requiredString(params, "lotId");
  await assertLot(context, lotId);
  const clear = new Set(stringList(params, "clear"));
  const field = (name: (typeof CLEARABLE_LOT)[number]): string | null | undefined => {
    const value = optionalString(params, name);
    if (value !== null && clear.has(name)) {
      throw invalidRequest(`"${name}" is both sent and named in "clear". Send one or the other.`);
    }
    return clear.has(name) ? null : (value ?? undefined);
  };

  const patch: AuctionLotApiPatch = {};
  const title = field("title");
  if (title !== undefined) patch.title = title;
  const lotNo = field("lot_number");
  if (lotNo !== undefined) patch.lotNo = lotNo;
  const url = field("url");
  if (url !== undefined) patch.url = url;
  const endsAt = optionalString(params, "ends_at");
  if (endsAt !== null) patch.endsAt = parseInstant(endsAt, "ends_at");
  const startingPrice = field("starting_price");
  if (startingPrice !== undefined) {
    patch.startingPrice = startingPrice === null ? null : parseAuctionAmount(startingPrice, "starting_price");
  }
  const currentBid = field("current_bid");
  const checkedAt = optionalString(params, "checked_at");
  if (checkedAt !== null && currentBid === undefined) {
    throw invalidRequest(`"checked_at" dates a "current_bid", and none was sent.`);
  }
  if (currentBid !== undefined) {
    const at = checkedAt !== null ? parseInstant(checkedAt, "checked_at") : new Date();
    if (at.getTime() > Date.now() + 5 * 60 * 1000) {
      throw invalidRequest(`"checked_at" is in the future. Send when the bid was read, or leave it out for now.`);
    }
    patch.currentBid = {
      amount: currentBid === null ? null : parseAuctionAmount(currentBid, "current_bid"),
      checkedAt: at,
    };
  }
  const tags = stringList(params, "tags");
  if (tags.length > 0 && clear.has("tags")) {
    throw invalidRequest(`"tags" is both sent and named in "clear". Send one or the other.`);
  }
  if (clear.has("tags")) patch.tags = [];
  else if (params.tags !== undefined) patch.tags = tagEntries(parseTagNames(tags, "tags"));
  const notStamps = optionalBoolean(params, "not_stamps");
  const description = optionalString(params, "not_stamps_description");
  if (notStamps !== null || description !== null) {
    if (notStamps === false && description !== null) {
      throw invalidRequest(`"not_stamps_description" describes a lot that is not stamps, and "not_stamps" is false.`);
    }
    if (notStamps === null) {
      const current = await prisma.auctionLot.findUniqueOrThrow({ where: { id: lotId }, select: { notStamps: true } });
      if (!current.notStamps) {
        throw invalidRequest(`"not_stamps_description" describes a lot that is not stamps, and this lot is not marked. Send "not_stamps": true with it.`);
      }
    }
    patch.notStamps = { notStamps: notStamps ?? true, description };
  }
  if (Object.keys(patch).length === 0) {
    throw invalidRequest("Nothing to change was sent. Send a field to correct, `current_bid` to record, or `clear`.");
  }

  const result = await runBlocked(() =>
    updateAuctionLotThroughApi(context.ownerId, context.collectionId, lotId, patch)
  );
  if (result.outcome === "tracked") return alreadyTracked(context, result.lotId);
  return { lot: await loadLot(context, lotId), changed: result.changed };
}

export const updateAuctionLotOperation: Operation = {
  name: "update_auction_lot",
  method: "PATCH",
  path: "/auctions/lots/{lotId}",
  description:
    "Correct a tracked lot — its title, number, address, closing time, starting price, tags or its not-stamps mark — and record what the auction currently stands at, with when it was checked. Only what is sent changes. Its contents and its ceiling have their own operations. It never sets the collector's own bid: they bid by hand on the platform. A settled lot takes only its tags. Every change waits for the collector to confirm it in the app — except the current bid: recording it, with when it was checked, is an observation and leaves the lot's review marker as it was, so a routine refresh does not put a lot up for review.",
  writes: true,
  parameters: UPDATE_LOT_PARAMETERS,
  result: {
    kind: "object",
    description:
      "`lot` as it now stands, in `add_auction_lot`'s shape, and `changed` — what this call changed, in the review marker's words (`title`, `lotNo`, `url`, `endsAt`, `startingPrice`, `currentBid`, `tags`, `notStamps`); empty when every value sent was already so, and then nothing was marked. `currentBid` is listed whenever one was sent but never marks: the marker names the other fields only, and a call that changed nothing else leaves it as it was. A new address or number another lot already tracks is refused with that lot.",
  },
  handler: async (context, params) => updateAuctionLot(context, params),
};

// ── set_auction_lot_lines ────────────────────────────────────────────────────

export async function setAuctionLotLines(context: OperationContext, params: ParsedParams): Promise<{ lot: AgentWrittenLot }> {
  const lotId = requiredString(params, "lotId");
  await assertLot(context, lotId);
  const lines = await resolveLines(context, parseLotLines(stringList(params, "lines"), "lines"), "lines");
  await runBlocked(() => replaceAuctionLotLinesThroughApi(context.ownerId, context.collectionId, lotId, lines));
  return { lot: await loadLot(context, lotId) };
}

export const setAuctionLotLinesOperation: Operation = {
  name: "set_auction_lot_lines",
  method: "POST",
  path: "/auctions/lots/{lotId}/lines",
  description:
    "Say what a tracked lot holds, replacing every line it had: each a stamp with its grade (one, the grades the description leaves open, or unknown), certificate, format and quantity. Its catalogue value and the recommendation are worked out from these. An empty list takes every line off, and the lot reads as not yet described. A lot marked as not stamps holds none. Every line must resolve, or nothing is written. The change waits for the collector to confirm it in the app.",
  writes: true,
  parameters: [
    LOT_ID_PARAMETER,
    { name: "lines", in: "body", type: "string[]", required: true, description: LINES_DESCRIPTION },
  ],
  result: {
    kind: "object",
    description:
      "`lot` as it now stands, in `add_auction_lot`'s shape: its `lines`, its catalogue value and recommended figure — ranges while a grade is to settle (`conditionToSettle`) — and `toReview`.",
  },
  handler: async (context, params) => setAuctionLotLines(context, params),
};

// ── set_auction_lot_ceiling ──────────────────────────────────────────────────

export async function setAuctionLotCeiling(context: OperationContext, params: ParsedParams): Promise<{ lot: AgentWrittenLot }> {
  const lotId = requiredString(params, "lotId");
  await assertLot(context, lotId);
  const ceiling = optionalString(params, "ceiling");
  const note = optionalString(params, "note");
  const clear = optionalBoolean(params, "clear") === true;
  if ((ceiling !== null) === clear) {
    throw invalidRequest(`Send exactly one of "ceiling" (to set it) and "clear": true (to take it off).`);
  }
  if (clear && note !== null) {
    throw invalidRequest(`"note" says how a ceiling was reached; clearing the ceiling clears its note too. Send "clear" alone.`);
  }
  const figure = ceiling !== null ? { maxBid: parseAuctionAmount(ceiling, "ceiling"), note } : null;
  await runBlocked(() => setAuctionLotCeilingThroughApi(context.ownerId, context.collectionId, lotId, figure));
  return { lot: await loadLot(context, lotId) };
}

export const setAuctionLotCeilingOperation: Operation = {
  name: "set_auction_lot_ceiling",
  method: "POST",
  path: "/auctions/lots/{lotId}/ceiling",
  description:
    "Set the most a tracked lot may cost the collector, all-in, with a note on how it was reached — or clear it. A ceiling set here stands apart from the collector's bid and stays put when they bid; cleared, the ceiling follows their bid again, as it does in the app. This is not a bid: nothing is bid anywhere, and the collector's own bid is untouched. The change waits for the collector to confirm it in the app.",
  writes: true,
  parameters: [
    LOT_ID_PARAMETER,
    {
      name: "ceiling",
      in: "body",
      type: "string",
      required: false,
      description:
        "The ceiling, **all-in** — premium included — in the sale's currency, as \"120.00\": `recommend_bid`'s `fair.allIn` for the lot, for instance.",
    },
    {
      name: "note",
      in: "body",
      type: "string",
      required: false,
      description:
        "How the ceiling was reached, kept on the lot beside it — \"recommend_bid fair at MNH, no certificate\". Replaces any note the lot had; leave it out and the lot keeps none.",
    },
    {
      name: "clear",
      in: "body",
      type: "boolean",
      required: false,
      description: "`true` takes the ceiling and its note off; the ceiling then follows the collector's bid.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`lot` as it now stands, in `add_auction_lot`'s shape: `ceiling` and `ceilingSetApart`, `ceilingNote`, `ceilingBid` (the highest hammer price that fits inside the ceiling) and `toReview`.",
  },
  handler: async (context, params) => setAuctionLotCeiling(context, params),
};

// ── record_auction_lot_outcome ───────────────────────────────────────────────

const LOT_END_STATUSES = ["closed", "cancelled"] as const;

/** A lot after its outcome is recorded: the lot, and how it ended as the app reads it. */
export interface AgentLotOutcome extends AgentLotChange {
  /** `closed` or `cancelled` — what was recorded. */
  readonly status: string;
  /** Derived from the figures, as the app derives it: `won` or `lost` where the collector bid,
   *  `observed` where they never did, `cancelled`. */
  readonly outcome: AuctionLotOutcome;
  /** What the lot went for, in the sale's currency. Absent when it was closed without one, or cancelled. */
  readonly finalPrice?: string;
}

export async function recordAuctionLotOutcome(context: OperationContext, params: ParsedParams): Promise<AgentLotOutcome> {
  const lotId = requiredString(params, "lotId");
  await assertLot(context, lotId);
  const status = requiredString(params, "status") as (typeof LOT_END_STATUSES)[number];
  const price = optionalString(params, "final_price");
  const wonTie = optionalBoolean(params, "won_tie");
  if (status === "cancelled" && (price !== null || wonTie !== null)) {
    throw invalidRequest(`A cancelled lot has no result, so it takes no "final_price" or "won_tie". Send "status": "cancelled" alone.`);
  }
  const outcome: AuctionLotApiOutcome =
    status === "closed"
      ? { status, finalPrice: price !== null ? parseAuctionAmount(price, "final_price") : null, wonTie }
      : { status };
  const { changed } = await runBlocked(() =>
    recordAuctionLotOutcomeThroughApi(context.ownerId, context.collectionId, lotId, outcome)
  );
  const lot = await getAuctionLotDetail(context.ownerId, context.collectionId, lotId);
  if (!lot) throw new Error(`Lot ${lotId} was written but cannot be read back.`);
  return compact({
    lot: await loadLot(context, lotId),
    status: lot.status,
    outcome: lot.outcome,
    finalPrice: lot.finalPrice ?? undefined,
    changed,
  }) as AgentLotOutcome;
}

export const recordAuctionLotOutcomeOperation: Operation = {
  name: "record_auction_lot_outcome",
  method: "POST",
  path: "/auctions/lots/{lotId}/outcome",
  description:
    "Record how a tracked lot's auction ended, as closing it in the app does: `closed` with what it went for, or `cancelled` when the listing was withdrawn. Won or lost is never sent — the app works it out from the final price against the collector's own bid, so the answer's `outcome` is what the app shows. A lot the collector bid on needs its final price; one they only watched can be closed without one, when it vanished from view before the result was seen. Recording it again corrects the price. It does not reopen a lot and does not settle a won one into a purchase — both stay with the collector in the app. The result waits for the collector to confirm it in the app.",
  writes: true,
  parameters: [
    LOT_ID_PARAMETER,
    {
      name: "status",
      in: "body",
      type: "string",
      required: true,
      description: "`closed` — the auction ended, with or without a final price seen; `cancelled` — it ended with no result.",
      values: LOT_END_STATUSES,
    },
    {
      name: "final_price",
      in: "body",
      type: "string",
      required: false,
      description:
        "What the lot went for — the hammer price on the listing, without the premium — in the sale's currency, as \"45.00\". Required when the collector bid on the lot. Leave it out only when the result was never seen. Only with `closed`.",
    },
    {
      name: "won_tie",
      in: "body",
      type: "boolean",
      required: false,
      description:
        "Only when `final_price` equals the collector's own bid, where the figures cannot say whose the lot is: `true` if the collector's bid came first and won, `false` if not. Required there and ignored anywhere else. Only with `closed`.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`lot` in `add_auction_lot`'s shape with its `toReview`; `status` as recorded; `outcome` — `won`, `lost`, `observed` (the collector never bid) or `cancelled`, derived as the app derives it; `finalPrice` when one was recorded; and `changed` — `[\"outcome\"]`, or empty when the same result was already recorded and nothing was marked.",
  },
  handler: async (context, params) => recordAuctionLotOutcome(context, params),
};

// ── update_auction_sale ──────────────────────────────────────────────────────

const CLEARABLE_SALE = ["url", "ends_at", "premium_percent", "premium_fixed", "shipping_cost"] as const;

export async function updateAuctionSale(
  context: OperationContext,
  params: ParsedParams
): Promise<{ sale: AgentAuctionSale; changed: readonly string[] }> {
  const saleId = requiredString(params, "saleId");
  const found = await prisma.auctionSale.findFirst({
    where: { id: saleId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true },
  });
  if (!found) {
    throw notFound(
      `No auction sale with id "${saleId}" is in this token's collection. A lot's \`saleId\` in \`list_auction_watchlist\` names its sale.`
    );
  }
  const clear = new Set(stringList(params, "clear"));
  const field = (name: string): string | null | undefined => {
    const value = optionalString(params, name);
    if (value !== null && clear.has(name)) {
      throw invalidRequest(`"${name}" is both sent and named in "clear". Send one or the other.`);
    }
    return clear.has(name) ? null : (value ?? undefined);
  };
  const patch: AuctionSaleApiPatch = {};
  const name = optionalString(params, "name");
  if (name !== null) patch.name = name;
  const url = field("url");
  if (url !== undefined) patch.url = url;
  const endsAt = field("ends_at");
  if (endsAt !== undefined) patch.endsAt = endsAt === null ? null : parseInstant(endsAt, "ends_at");
  const currency = optionalString(params, "currency");
  if (currency !== null) patch.currency = currency;
  const percent = field("premium_percent");
  if (percent !== undefined) patch.premiumPercent = percent === null ? null : parsePremiumPercent(percent, "premium_percent");
  const fixed = field("premium_fixed");
  if (fixed !== undefined) patch.premiumFixed = fixed === null ? null : parseAuctionAmount(fixed, "premium_fixed");
  const shipping = field("shipping_cost");
  if (shipping !== undefined) patch.shippingCost = shipping === null ? null : parseAuctionAmount(shipping, "shipping_cost");
  if (Object.keys(patch).length === 0) {
    throw invalidRequest("Nothing to change was sent. Send a term to correct, or `clear`.");
  }
  const { changed } = await runBlocked(() =>
    updateAuctionSaleThroughApi(context.ownerId, context.collectionId, saleId, patch)
  );
  return { sale: await loadSale(context, saleId), changed };
}

export const updateAuctionSaleOperation: Operation = {
  name: "update_auction_sale",
  method: "PATCH",
  path: "/auctions/sales/{saleId}",
  description:
    "Correct a sale's terms — its name, address, closing time, currency, buyer's premium and shipping — as the house's or seller's conditions state them. A sale is one parcel from one seller; its seller and platform are not changed here, and lots join a sale through `add_auction_lot`. A settled sale is refused. Every change waits for the collector to confirm it in the app.",
  writes: true,
  parameters: [
    {
      name: "saleId",
      in: "path",
      type: "string",
      required: true,
      description: "The sale's id — a lot's `saleId`, or `sale.saleId` from `add_auction_lot`.",
    },
    { name: "name", in: "body", type: "string", required: false, description: "The sale's name — a house's own name for its sale." },
    { name: "url", in: "body", type: "string", required: false, description: "The house's catalogue or the seller's page." },
    {
      name: "ends_at",
      in: "body",
      type: "string",
      required: false,
      description: `${ENDS_AT_DESCRIPTION} A house sale's closing time, which lots added to it later take; it does not move the lots already in it.`,
    },
    {
      name: "currency",
      in: "body",
      type: "string",
      required: false,
      description:
        "The currency every amount on the sale and its lots is in. Changing it restates what the amounts are in rather than converting them.",
      values: COMMON_CURRENCIES,
    },
    {
      name: "premium_percent",
      in: "body",
      type: "string",
      required: false,
      description: "The buyer's premium in percent of the hammer price — \"20\" or \"17.5\".",
    },
    {
      name: "premium_fixed",
      in: "body",
      type: "string",
      required: false,
      description: "A fixed fee charged on each lot won, in the sale's currency, as \"1.50\" — beside the percentage, not instead of it.",
    },
    {
      name: "shipping_cost",
      in: "body",
      type: "string",
      required: false,
      description: "What shipping the parcel costs, in the sale's currency, as \"25.00\" — charged once however many lots are won.",
    },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Terms to empty: the address, the closing time, either premium component or the shipping.",
      values: CLEARABLE_SALE,
    },
  ],
  result: {
    kind: "object",
    description:
      "`sale` with its terms as they now stand, its `status`, how many `lots` it holds and `toReview`; and `changed` — what this call changed in the review marker's words (`name`, `url`, `endsAt`, `currency`, `premium`, `shipping`), empty when everything sent was already so.",
  },
  handler: async (context, params) => updateAuctionSale(context, params),
};
