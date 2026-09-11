import "server-only";
import { prisma } from "../../db";
import { COMMON_CURRENCIES } from "../../currencies";
import {
  countTrades,
  createTrade,
  getTrade,
  listTradesPaginated,
} from "../../trades";
import {
  addTradeGiveLines,
  addTradeReceiveLines,
  deleteTradeLine,
  listTradeLinePage,
} from "../../trade-lines";
import { addTradeGiveLinesFromRequirement } from "../../trade-give-resolution";
import { readTradeBalance } from "../../trade-valuation";
import { readTradeLineFulfillments } from "../../trade-realisation";
import {
  TRADE_SIDES,
  TRADE_STATUSES,
  isTradeContentEditable,
  isTradeStatus,
} from "../../trade-rules";
import type { TradeSide, TradeStatus } from "../../trade-rules";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import {
  optionalInteger,
  optionalString,
  requiredString,
  stringList,
} from "../params";
import { resolveOptionalVocabularyValue, resolveVocabularyValue } from "../vocabulary";
import {
  giveLine,
  receiveLine,
  trade as tradeProjection,
  tradeBalance,
  tradeRow,
} from "../trade-reads";
import { readCollectionVocabulary } from "./vocabulary";
import {
  collectionPath,
  loadCatalogLabelling,
  loadCollectionHeader,
  loadLocationPaths,
} from "./reads-shared";
import type {
  AgentGiveLineResult,
  AgentTrade,
  AgentTradeBalance,
  AgentTradeLine,
  AgentTradeRow,
} from "../trade-reads";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Trades (#712) — the third agent workflow's second half: read an exchange, build both its sides,
// and see whether it balances.
//
// ## The boundary, and why it is absence rather than a flag
//
// **The agent writes inside Stamporama and never reaches a counterparty.** It drafts a trade,
// promises copies, asks for material, takes a line off and reads the verdict. It does **not** send a
// proposal, mint or alter or revoke the partner's share link, write the partner's feedback or copy
// request, move the trade's lifecycle, record what actually arrived, close a trade into a purchase,
// or claim that a Colnect list has been brought into step. There is no operation for any of those,
// and an operation that does not exist cannot be called (`agent-api.md`, *What is deliberately
// absent*).
//
// **The asymmetry is the argument, exactly as it is for publishing (#711).** An agent that misreads
// a trade costs a minute. An agent that shares a list, or that agrees one, hands a real person a
// commitment in the collector's name — and `agreed` is the point of the whole lifecycle, because
// from there the list is frozen and the partner is holding a printout of it.
//
// **The send-shaped surface is *wider* than the publish-shaped one, and that is worth knowing before
// this file's guard is read as the same guard.** Publishing is an outbound act with a handful of
// entry points doing one kind of thing. Nothing here posts anything to anybody: the partner opens a
// link. So the forbidden set is six different kinds of act rather than one —
// `tests/unit/agent-api-operation-boundary.test.ts` enumerates them and says which is which, and
// `tests/integration/agent-api-trades.test.ts` fails on a send-shaped **name** beside it, which is
// the half that still works when somebody adds an operation without reading this file.
//
// ## Twelve verbs across this file and `wants.ts`, and what each of #712's bullets became
//
// | #712's bullet | here |
// | --- | --- |
// | read a trade with its sections and lines | `get_trade`, then `list_trade_lines` per section and side |
// | add and adjust trade lines | `add_trade_give_lines`, `serve_trade_requirement`, `add_trade_receive_lines`, `remove_trade_line` |
// | balance a trade through the existing balancing logic | `get_trade_balance` |
//
// **`list_trades` and `create_trade` are additions**, and both for reasons #711 already settled.
// `search_collection` (#710) reaches stamps, issues and copies and nothing else, so without
// `list_trades` every verb here is callable only on a trade drafted in the same session — which is
// `list_offers`' own argument. And #712's *Done when* asks the agent to **leave a drafted, balanced
// trade behind**, which needs something to leave it on: `create_trade` is `draft_offer`'s analogue,
// making a `preparing` trade with one section and nothing that reaches anybody.
//
// **No operation sets a line's manual value, and the hole is deliberate rather than forgotten.**
// #712's *add and adjust trade lines* arguably asks for one, and two arguments keep it out.
//
// **The decisive one is the contract.** `/api/v1` only ever grows: once an operation is published,
// its name, its parameters and the meaning of its answer are fixed, and a break is `/api/v2`. So
// the two directions are not symmetrical — **leaving it out is reversible next week and publishing
// it is not** — and absent a positive reason to ship it now, out. **That argument is bounded, and
// stating the bound is what stops it being used to refuse everything**: every operation here is
// equally irreversible, so it decides nothing on its own. It decides *this* case because the
// positive reason is weak, which is the second argument.
//
// **And the second is what makes it weak.** `trades.md` keeps the manual value narrow on purpose —
// *the default reflex stays type the price on the stamp*, a price being a property of the stamp —
// so an agent reaching for it would be an agent **making the valuation gate pass rather than making
// a trade balance**. The gate exists because a trade whose lines carry no figure cannot be judged,
// and a typed number clears the refusal without answering it. `get_trade_balance` names the
// blocking lines instead, so the agent hands them back and the collector prices the stamp — after
// which the figure is true on every screen rather than true inside one trade.
//
// ## Nothing here computes a figure or decides a rule
//
// Every refusal is a domain guard's, the ranking that turns *this stamp, used* into a copy is
// #659's, the arithmetic is `trade-balance.ts`'s, and the freeze regimes are
// `trade-valuation.ts`'s. Two counts were added — `countTrades` and `countWants` — and both went
// **beside the reads they belong with**, which is #711's move for `countOffers`.
//
// ## On refusals, and the one place this differs from #711
//
// #711 had `OfferActionBlockedError` to catch. The trade domain throws a plain `Error` with a
// sentence written for a **collector**, and #706 deliberately does not relay one of those — an
// internal message may carry an internal identifier and spends an agent's context on something it
// cannot act on. So the inputs an agent controls are checked here, against the domain's own pure
// answers: `isTradeContentEditable` for the lock, the vocabulary resolver for every dictionary
// value, and a scoped `findFirst` for every id. That is not a second rule; it is the same rule read
// early so the refusal can be written for the caller — `set_offer_text`'s `regeneratable`
// pre-check, said again.

// ── Refusals ─────────────────────────────────────────────────────────────────

/**
 * The trade this call is about, proved to be in the **token's** collection.
 *
 * Scoped by collection as well as by owner, which is #710's rule and not belt-and-braces: a token is
 * pinned to one collection and a collector routinely owns several, so *the owner's trade* is the
 * wrong question. `assertTradeOwner` inside `trade-access.ts` asks the owner's — correctly, for a
 * screen that knows its collection from the URL — and throws a plain `Error`, which would reach an
 * agent as a bare `internal_error` saying nothing it could act on.
 */
async function assertTrade(
  context: OperationContext,
  tradeId: string
): Promise<{ status: TradeStatus; tradeNo: number }> {
  const row = await prisma.trade.findFirst({
    where: {
      id: tradeId,
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
    },
    select: { status: true, tradeNo: true },
  });
  if (!row) {
    throw notFound(
      `No trade with id "${tradeId}" is in this token's collection. Use \`list_trades\` to find the right id.`
    );
  }
  return {
    status: isTradeStatus(row.status) ? row.status : "preparing",
    tradeNo: row.tradeNo,
  };
}

/** The section this call is about, and the trade it hangs off. */
async function assertSection(
  context: OperationContext,
  sectionId: string
): Promise<{ tradeId: string; status: TradeStatus }> {
  const row = await prisma.tradeSection.findFirst({
    where: {
      id: sectionId,
      trade: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    },
    select: { tradeId: true, trade: { select: { status: true } } },
  });
  if (!row) {
    throw notFound(
      `No trade section with id "${sectionId}" is in this token's collection. \`get_trade\` lists a trade's sections with their ids.`
    );
  }
  return {
    tradeId: row.tradeId,
    status: isTradeStatus(row.trade.status) ? row.trade.status : "preparing",
  };
}

/**
 * Refuse a write onto a list the partner is already holding a copy of.
 *
 * **The lock is the point of the whole lifecycle** (ADR-0039 §5): from `agreed` the list is what two
 * people shook hands on, and a figure or a line changed underneath it is exactly what freezing
 * exists to prevent. The domain asserts this too — this is the same `isTradeContentEditable`, read
 * early so the sentence can be written for an agent rather than for a collector, and so that an
 * agent is told *which step would unfreeze it* rather than simply refused.
 */
function assertEditable(status: TradeStatus, what: string): void {
  if (isTradeContentEditable(status)) return;
  throw invalidRequest(
    `This trade is ${status}, so its list cannot be changed and ${what} is refused. Only a trade that is preparing or shared takes new lines; reopening an agreed trade is the collector's decision and nothing on this surface can take it.`
  );
}

// ── list_trades ──────────────────────────────────────────────────────────────

const LIST_TRADES_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "status",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to trades at this stage. `preparing` is a list being composed, `shared` one the partner has been given a link to, `agreed` one both sides have committed to and which is therefore frozen, `closed` one that has been carried out, `cancelled` one that was not.",
    values: TRADE_STATUSES,
  },
  {
    name: "partner",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to trades with this exchange partner. Takes the partner's name from `get_collection_vocabulary` or their id.",
  },
  {
    name: "trade_no",
    in: "query",
    type: "integer",
    required: false,
    description:
      "One trade by the short number the collector calls it by — what `#7` means on the trades screen.",
  },
];

export async function readTrades(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentTradeRow>> {
  const partner = optionalString(params, "partner");
  const vocabulary = partner !== null ? await readCollectionVocabulary(context) : null;
  const status = optionalString(params, "status");
  const tradeNo = optionalInteger(params, "trade_no");

  const filters = {
    ...(status !== null && isTradeStatus(status) ? { status } : {}),
    ...(tradeNo !== null ? { tradeNo } : {}),
    ...(partner !== null && vocabulary
      ? {
          partnerId: resolveVocabularyValue(partner, vocabulary.exchangePartners, {
            vocabulary: "exchange partner",
            parameter: "partner",
          }),
        }
      : {}),
  };

  const window = parseListWindow(params);
  const [page, total, header] = await Promise.all([
    listTradesPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // The match count and never `items.length` (#706).
    countTrades(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
  ]);

  return listResponse(
    page.items.map((row) =>
      tradeRow(row, collectionPath(header, `/trades/${encodeURIComponent(row.id)}`))
    ),
    total,
    window
  );
}

export const listTradesOperation: Operation = {
  name: "list_trades",
  method: "GET",
  path: "/trades",
  description:
    "The exchanges in this collection, newest first — narrowed to a stage, to one partner, or to a single trade number. This is how a trade id is found before reading or building one; `get_trade` then states any of them with its sections.",
  writes: false,
  parameters: LIST_TRADES_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The trades. **Both sides are counted separately, because that difference is the trade** — ten cheap ones for two good ones is an ordinary value exchange — and `receivePieces` is not `receiveLines`, since three lines can be thirty stamps. No value figures here: they need the balancing engine, and a blank where a number belongs beats a zero that is not one. `partnerResponded` means the partner has said something nobody has dealt with yet; it is derived and is deliberately not a stage of the trade.",
  },
  handler: async (context, params) => readTrades(context, params),
};

// ── get_trade ────────────────────────────────────────────────────────────────

const TRADE_ID_PARAMETER: ParameterSpec = {
  name: "tradeId",
  in: "path",
  type: "string",
  required: true,
  description: "The trade's id, from `list_trades` or from `create_trade`.",
};

export async function readTrade(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentTrade> {
  const tradeId = requiredString(params, "tradeId");
  const { status } = await assertTrade(context, tradeId);
  const [row, header] = await Promise.all([
    getTrade(context.ownerId, tradeId),
    loadCollectionHeader(context),
  ]);
  if (!row) {
    throw notFound(
      `No trade with id "${tradeId}" is in this token's collection. Use \`list_trades\` to find the right id.`
    );
  }

  // **The agreed catalogue is named by its canonical name, and that is a correction rather than a
  // preference.** `TradeData.catalogVendorName` is the vendor's **abbreviation** — `Mi` — because
  // that is what the trades row has room for and what a collector reads a catalogue by. The
  // balancing read beside it carries the vendor's `name`, `Michel`. Published as they stand, one
  // agent surface would call the same catalogue two different things, and neither is the value
  // `get_collection_vocabulary` tells the agent to **send back** (#708: `name` is the canonical
  // value). So it is resolved here, off the vocabulary the agent already holds, and the balance
  // read states the same string. Caught by the integration suite disagreeing with itself.
  const agreedCatalogName =
    row.catalogVendorId === null
      ? null
      : ((await readCollectionVocabulary(context)).catalogVendors.find(
          (vendor) => vendor.id === row.catalogVendorId
        )?.name ?? row.catalogVendorName);

  return tradeProjection(
    {
      ...row,
      catalogVendorName: agreedCatalogName,
      // The sections come off `TradeData` under their own names; the projection reads them
      // structurally so that it never has to name `TradeSectionData`'s sixty-odd siblings.
      sections: row.sections.map((section) => ({
        id: section.id,
        name: section.name,
        balanceByValue: section.balanceByValue,
        countTolerance: section.countTolerance,
        valueTolerancePct: section.valueTolerancePct,
        ownValueWarnPct: section.ownValueWarnPct,
        giveCount: section.giveCount,
        receiveCount: section.receiveCount,
        receiveQuantity: section.receiveQuantity,
      })),
    },
    {
      contentEditable: isTradeContentEditable(status),
      path: collectionPath(header, `/trades/${encodeURIComponent(tradeId)}`),
    }
  );
}

export const getTradeOperation: Operation = {
  name: "get_trade",
  method: "GET",
  path: "/trades/{tradeId}",
  description:
    "One exchange in full: the partner, where it stands, the terms it is judged on, and its sections with what each holds on both sides. A trade's lines live under its sections — `list_trade_lines` reads them — and what it comes to is `get_trade_balance`.",
  writes: false,
  parameters: [TRADE_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "The trade. `contentEditable` is the field to read before trying to write: a trade that has been agreed is frozen, because the partner is holding a copy of the list, and nothing on this surface can reopen it. `balanceBy` says whether the exchange is judged on pieces or on value, and a section may state its own rule instead of the trade's — `inherited` says which it is doing. `currency` is what the **agreed** valuation is stated in; the collector's own valuation is in the collection's base currency, which `get_trade_balance` states beside it. **Nothing here says how the partner sees the list**, because nothing on this surface reaches a partner.",
  },
  handler: async (context, params) => readTrade(context, params),
};

// ── list_trade_lines ─────────────────────────────────────────────────────────

const SECTION_ID_PARAMETER: ParameterSpec = {
  name: "sectionId",
  in: "path",
  type: "string",
  required: true,
  description: "The section's id, from `get_trade`.",
};

export async function readTradeLines(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentTradeLine>> {
  const sectionId = requiredString(params, "sectionId");
  const { tradeId } = await assertSection(context, sectionId);
  const side = requiredString(params, "side") as TradeSide;
  const search = optionalString(params, "search");

  const window = parseListWindow(params);
  const [page, fulfillments, labelling, locations] = await Promise.all([
    listTradeLinePage(context.ownerId, tradeId, {
      sectionId,
      side,
      // **Flat, and no grouping levels.** The screen nests by area › year › issue › grade because a
      // collector reads a column; an agent reads rows and would pay for every heading twice. The
      // arrangement is a view, and this is the list under it.
      ...(search !== null ? { filters: { search } } : {}),
      offset: window.offset,
      pageSize: window.limit,
    }),
    // What became of each line (#642). Read, never written: recording what actually moved happens
    // after the handshake, which is past this surface's boundary in both directions.
    readTradeLineFulfillments(tradeId),
    loadCatalogLabelling(context.collectionId),
    loadLocationPaths(context.collectionId),
  ]);

  return listResponse(
    page.items.map((item) => {
      const fulfillment = fulfillments.get(item.lineId)?.fulfillment ?? "pending";
      if (item.side === "give") {
        const copy = item.copy;
        return giveLine(copy, {
          lineId: item.lineId,
          sectionId,
          fulfillment,
          catalogNumbers: labelling.labelFor(copy.areaId, copy.issueId, copy.catalogNumbers),
          location: locations.pathFor(copy.locationId),
        });
      }
      const line = item.line;
      return receiveLine(line, {
        lineId: item.lineId,
        sectionId,
        fulfillment,
        catalogNumbers: labelling.labelFor(line.areaId, line.issueId, line.catalogNumbers),
        // A receive line names material in nobody's inventory, so there is nowhere for it to be
        // filed and nothing to state here.
        location: null,
      });
    }),
    page.total,
    window
  );
}

export const listTradeLinesOperation: Operation = {
  name: "list_trade_lines",
  method: "GET",
  path: "/trade-sections/{sectionId}/lines",
  description:
    "One side of one section of a trade. A section is the unit a collector reasons in — mint against mint — and the two sides are two independent bags with no pairing between them, so they are read one at a time and their counts routinely differ. Each row states its own catalogue value; what the two sides come to together is `get_trade_balance`.",
  writes: false,
  parameters: [
    SECTION_ID_PARAMETER,
    {
      name: "side",
      in: "query",
      type: "string",
      required: true,
      description:
        "Which bag to read. `give` is what would leave the collection — each line names a concrete copy, with its number and where it is filed. `receive` is what would arrive: material in nobody's inventory, so a line names a stamp, a grade and a quantity instead of a copy.",
      values: TRADE_SIDES,
    },
    {
      name: "search",
      in: "query",
      type: "string",
      required: false,
      description:
        "Free text matched against the stamp's name, its series and its catalogue numbers — and, on the give side, the copy's own number and where it is filed.",
    },
  ],
  result: {
    kind: "list",
    description:
      "The lines on that side, in the order they were entered. `quantity` is always 1 on a give line — a multiple is one copy in one format, never several singles — and any number on a receive line, which is why `receivePieces` and `receiveLines` differ on the trade. `catalogValue` is the catalogue's figure at that line's exact grade, **per piece**. `fulfillment` is `pending` until somebody records what actually moved after the handshake; nothing on this surface writes it.",
  },
  handler: async (context, params) => readTradeLines(context, params),
};

// ── get_trade_balance ────────────────────────────────────────────────────────

export async function readBalance(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentTradeBalance> {
  const tradeId = requiredString(params, "tradeId");
  await assertTrade(context, tradeId);
  const row = await readTradeBalance(context.ownerId, tradeId);
  if (!row) {
    throw notFound(
      `No trade with id "${tradeId}" is in this token's collection. Use \`list_trades\` to find the right id.`
    );
  }
  return tradeBalance(row);
}

export const getTradeBalanceOperation: Operation = {
  name: "get_trade_balance",
  method: "GET",
  path: "/trades/{tradeId}/balance",
  description:
    "What a trade comes to, on both sides, in both valuations — and whether it balances. This is the whole of *would this be a fair exchange*: the pieces on each side, what the collector's own catalogue says their material is worth, what the agreed catalogue says, how far apart the two sides are, and what is stopping the trade moving on.",
  writes: false,
  parameters: [TRADE_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "**The two valuations are never merged.** `own` is the collector's own figure in `baseCurrency` and `agreed` is the figure in the catalogue both sides named, in `tradeCurrency` — two units, and adding them would be meaningless. **A missing figure is counted, never summed as zero**: `ownMissing` is what the gates refuse on, and a total that assumed nought would read as an answer while being a guess. `balanceBy` says which of `countBalanced` and `valueBalanced` is the verdict; the other is computed anyway, because *am I giving away a thousand for ten* is a question a piece-count trade gets wrong just as easily. `ownWarn` is a **warning and never a block** — a deliberately uneven exchange is a normal thing. `blockers` names what stops the trade being shared or agreed, line by line; adding a catalogue price to the stamp is what clears the commonest of them, and nothing on this surface does it. `frozen` means the figures are the snapshot taken when both sides committed rather than today's catalogues.",
  },
  handler: async (context, params) => readBalance(context, params),
};

// ── create_trade ─────────────────────────────────────────────────────────────

const CREATE_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "partner",
    in: "body",
    type: "string",
    required: true,
    description:
      "The exchange partner. Takes their name from `get_collection_vocabulary` or their id. It must be somebody the collection already knows — this surface does not add people to the address book.",
  },
  {
    name: "currency",
    in: "body",
    type: "string",
    required: false,
    description:
      "The currency the **partner's** figures are in, which is what the agreed valuation is stated in. Defaults to the collection's own base currency, which is what a first trade with somebody usually is.",
    values: COMMON_CURRENCIES,
  },
  {
    name: "balance_by",
    in: "body",
    type: "string",
    required: false,
    description:
      "How the exchange is to be judged. `pieces` counts stamps and is the default; `value` compares what each side is worth in the agreed catalogue, and then `agreed_catalog` has to be named or nothing can be judged.",
    values: ["pieces", "value"],
  },
  {
    name: "agreed_catalog",
    in: "body",
    type: "string",
    required: false,
    description:
      "The catalogue **publisher** both sides read the figures in — Michel, Fischer. A publisher rather than one book, because a trade routinely spans several areas and one book prices only one of them; which volume a line is read in follows from its stamp's area. Takes a vendor's name or abbreviation from `get_collection_vocabulary` or its id.",
  },
  {
    name: "notes",
    in: "body",
    type: "string",
    required: false,
    description: "A note on the exchange, for the collector to read.",
  },
];

export async function draftTrade(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentTrade> {
  const vocabulary = await readCollectionVocabulary(context);
  const partnerId = resolveVocabularyValue(
    requiredString(params, "partner"),
    vocabulary.exchangePartners,
    { vocabulary: "exchange partner", parameter: "partner" }
  );
  const catalogVendorId = resolveOptionalVocabularyValue(
    optionalString(params, "agreed_catalog"),
    vocabulary.catalogVendors,
    { vocabulary: "catalog vendor", parameter: "agreed_catalog" }
  );
  const balanceByValue = optionalString(params, "balance_by") === "value";
  if (balanceByValue && catalogVendorId === null) {
    // The one fault the gate names as the trade's rather than as forty lines' each (#638). Caught
    // here so the refusal arrives before the trade exists rather than on the first balance read.
    throw invalidRequest(
      'A trade balanced by value needs "agreed_catalog": with no catalogue named, there is no second valuation to judge either side in and every line would be unvalued by construction. Name a publisher, or leave "balance_by" out and judge the exchange on pieces.'
    );
  }

  const created = await createTrade(context.ownerId, context.collectionId, {
    partnerId,
    // The trade's currency, defaulted the way the collector's own form defaults it.
    currency: optionalString(params, "currency") ?? vocabulary.baseCurrency,
    notes: optionalString(params, "notes"),
    catalogVendorId,
    balanceByValue,
    // **The tolerances are deliberately not parameters.** How close is close enough is a term of the
    // agreement between two people, and the column defaults (0 pieces, 0%, warn past 25% skew) are
    // what the collector's own form opens on. An agent choosing them would be an agent deciding what
    // counts as fair.
  });

  const header = await loadCollectionHeader(context);
  return tradeProjection(
    {
      ...created,
      // The canonical name rather than `TradeData`'s abbreviation, so `create_trade`, `get_trade`
      // and `get_trade_balance` all name one catalogue one way — see `readTrade` for why.
      catalogVendorName:
        catalogVendorId === null
          ? null
          : (vocabulary.catalogVendors.find((vendor) => vendor.id === catalogVendorId)?.name ??
            created.catalogVendorName),
      sections: created.sections.map((section) => ({
        id: section.id,
        name: section.name,
        balanceByValue: section.balanceByValue,
        countTolerance: section.countTolerance,
        valueTolerancePct: section.valueTolerancePct,
        ownValueWarnPct: section.ownValueWarnPct,
        giveCount: section.giveCount,
        receiveCount: section.receiveCount,
        receiveQuantity: section.receiveQuantity,
      })),
    },
    {
      contentEditable: true,
      path: collectionPath(header, `/trades/${encodeURIComponent(created.id)}`),
    }
  );
}

export const createTradeOperation: Operation = {
  name: "create_trade",
  method: "POST",
  path: "/trades",
  description:
    "Start an exchange with a partner the collection already knows. It is created as a **draft** — nothing is sent, nobody is told, and this surface has no way to share it or to agree it; both of those stay with the collector. It comes with one section to put lines in, which is what most exchanges need; splitting mint from used is a decision the collector makes when their material asks for it.",
  writes: true,
  parameters: CREATE_PARAMETERS,
  result: {
    kind: "object",
    description:
      "The new trade, in `get_trade`'s shape, with the id of the section to add lines to. Its status is `preparing` and no operation on this surface can move it. The tolerances are the collection's defaults; how close is close enough is a term two people agree, not one an agent picks.",
  },
  handler: async (context, params) => draftTrade(context, params),
};

// ── add_trade_give_lines ─────────────────────────────────────────────────────

export async function addGiveLines(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentGiveLineResult> {
  const sectionId = requiredString(params, "sectionId");
  const { status } = await assertSection(context, sectionId);
  assertEditable(status, "promising copies");

  const copyIds = [...new Set(stringList(params, "copy_ids"))];
  if (copyIds.length === 0) {
    throw invalidRequest(
      '"copy_ids" is empty. A give line promises a copy the collection holds — get some from `list_holdings` or `find_checklist_gaps`, or state what the partner asked for and use `serve_trade_requirement` instead.'
    );
  }

  const { added, refused } = await addTradeGiveLines(context.ownerId, sectionId, copyIds);
  return {
    added,
    refused: refused.map((refusal) => ({ copyId: refusal.itemId, reason: refusal.reason })),
  };
}

export const addTradeGiveLinesOperation: Operation = {
  name: "add_trade_give_lines",
  method: "POST",
  path: "/trade-sections/{sectionId}/give",
  description:
    "Promise particular copies on a trade — the material that would leave the collection. Each copy is re-checked as it goes on: one that has sold, left, is still in the post, or is already promised to another live exchange is refused **by name** rather than dropped quietly, and the rest still go on. Use `serve_trade_requirement` instead when the partner asked for a stamp rather than for a copy.",
  writes: true,
  parameters: [
    SECTION_ID_PARAMETER,
    {
      name: "copy_ids",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "The copies to promise, from `list_holdings` or `get_copy`. A copy may be on a trade once, so re-adding one already on this trade does nothing.",
    },
  ],
  result: {
    kind: "object",
    description:
      "How many lines were made, and every copy that was refused with the reason a person can act on. A promise is not a claim: the copies stay in the collection and stay listed wherever they were, and only an **agreed** trade commits one.",
  },
  handler: async (context, params) => addGiveLines(context, params),
};

// ── serve_trade_requirement ──────────────────────────────────────────────────

const REQUIREMENT_PARAMETERS: readonly ParameterSpec[] = [
  SECTION_ID_PARAMETER,
  {
    name: "stamp_id",
    in: "body",
    type: "string",
    required: false,
    description:
      "The stamp the partner asked for, from `search_collection`. Send this or `checklist_id`, not both.",
  },
  {
    name: "checklist_id",
    in: "body",
    type: "string",
    required: false,
    description:
      "A whole set the partner asked for, from `get_issue` or `find_checklist_gaps` — it expands into one requirement per stamp on it, all in the same grade. There is no such thing as a line that *is* a set: a partner asking for `Michel 1–12, complete` is asking for twelve stamps, and every reader downstream works per stamp.",
  },
  {
    name: "condition",
    in: "body",
    type: "string",
    required: true,
    description:
      "The grade asked for. Takes a name or abbreviation from `get_collection_vocabulary` (`MNH` works) or an id. Required, because a copy is chosen on it: a wish list says a stamp and a grade and stops.",
  },
  {
    name: "certificate",
    in: "body",
    type: "string",
    required: false,
    description:
      "Narrow to copies with this certificate. Leave it out and any certificate will do, which is what a wish list means — it is not the same as asking for one with none.",
  },
  {
    name: "format",
    in: "body",
    type: "string",
    required: false,
    description:
      "Narrow to copies in this physical format — a pair, a block. Leave it out and any format will do.",
  },
  {
    name: "quantity",
    in: "body",
    type: "integer",
    required: false,
    description:
      "How many pieces were asked for; 1 when omitted. N takes N **distinct** copies, and no copy serves two requirements.",
  },
];

export async function serveRequirement(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentGiveLineResult> {
  const sectionId = requiredString(params, "sectionId");
  const { status } = await assertSection(context, sectionId);
  assertEditable(status, "promising copies");

  const stampId = optionalString(params, "stamp_id");
  const checklistId = optionalString(params, "checklist_id");
  if ((stampId === null) === (checklistId === null)) {
    throw invalidRequest(
      'Send exactly one of "stamp_id" and "checklist_id": one requirement is about one stamp, or about one named set which expands into one requirement per stamp on it.'
    );
  }

  const vocabulary = await readCollectionVocabulary(context);
  const conditionId = resolveVocabularyValue(
    requiredString(params, "condition"),
    vocabulary.conditions,
    { vocabulary: "condition", parameter: "condition" }
  );
  const quantity = optionalInteger(params, "quantity") ?? 1;
  if (quantity < 1) {
    throw invalidRequest('"quantity" must be at least 1 — a requirement is for at least one piece.');
  }

  if (stampId !== null) {
    const stamp = await prisma.stamp.findFirst({
      where: { id: stampId, collectionId: context.collectionId },
      select: { id: true },
    });
    if (!stamp) {
      throw notFound(
        `No stamp with id "${stampId}" is in this token's collection. Use \`search_collection\` to find the right id.`
      );
    }
  } else {
    const checklist = await prisma.checklist.findFirst({
      where: { id: checklistId!, collectionId: context.collectionId },
      select: { id: true },
    });
    if (!checklist) {
      throw notFound(
        `No checklist with id "${checklistId}" is in this token's collection. \`get_issue\` lists a series' checklists with their ids.`
      );
    }
  }

  const report = await addTradeGiveLinesFromRequirement(context.ownerId, sectionId, {
    ...(stampId !== null ? { stampId } : {}),
    ...(checklistId !== null ? { checklistId } : {}),
    conditionId,
    // **Absent means *anything on this axis*, and that is not the same as *none*.** A wish list says
    // nothing about a certificate, and a requirement that read silence as *no certificate* would
    // refuse to send a certificated copy the partner would have been delighted with (#659).
    certificateStatusId: resolveOptionalVocabularyValue(
      optionalString(params, "certificate"),
      vocabulary.certificateStatuses,
      { vocabulary: "certificate status", parameter: "certificate" }
    ) ?? undefined,
    formatId:
      resolveOptionalVocabularyValue(optionalString(params, "format"), vocabulary.formats, {
        vocabulary: "format",
        parameter: "format",
      }) ?? undefined,
    quantity,
  });

  return {
    added: report.added,
    refused: report.refused.map((refusal) => ({
      copyId: refusal.itemId,
      reason: refusal.reason,
    })),
    requirements: report.outcomes.map((outcome) => ({
      stamp: outcome.stampLabel,
      requested: outcome.requested,
      served: outcome.served,
      missing: outcome.missing,
    })),
  };
}

export const serveTradeRequirementOperation: Operation = {
  name: "serve_trade_requirement",
  method: "POST",
  path: "/trade-sections/{sectionId}/requirements",
  description:
    "The partner asked for a stamp, or for a whole set, in a particular grade — find the copies that would serve it and promise them. The collection routinely holds several copies that answer one request, and which one goes is decided by the app's own order: one already marked for trade first, then a plain single, then one with a picture, then the oldest. What is not held comes back as a **shortfall**, which is the half you send the partner back.",
  writes: true,
  parameters: REQUIREMENT_PARAMETERS,
  result: {
    kind: "object",
    description:
      "How many lines were made, what the write refused by copy, and every requirement's own outcome. **A gap is an outcome and not an error** — *you do not hold this in this grade* is exactly what the collector has to send back, so it survives here rather than being dropped. `missing` is stated rather than left to be worked out, because it is the number that goes back to the partner. A copy already promised elsewhere, sold, gone or still in the post is not a candidate, and one the collector has held back for this trade is not either.",
  },
  handler: async (context, params) => serveRequirement(context, params),
};

// ── add_trade_receive_lines ──────────────────────────────────────────────────

export async function addReceiveLines(
  context: OperationContext,
  params: ParsedParams
): Promise<{ added: number }> {
  const sectionId = requiredString(params, "sectionId");
  const { status } = await assertSection(context, sectionId);
  assertEditable(status, "asking for material");

  const stampId = optionalString(params, "stamp_id");
  const checklistId = optionalString(params, "checklist_id");
  if ((stampId === null) === (checklistId === null)) {
    throw invalidRequest(
      'Send exactly one of "stamp_id" and "checklist_id": a receive line is about one stamp, or about one named set which expands into one line per stamp on it.'
    );
  }

  const vocabulary = await readCollectionVocabulary(context);
  const conditionId = resolveVocabularyValue(
    requiredString(params, "condition"),
    vocabulary.conditions,
    { vocabulary: "condition", parameter: "condition" }
  );
  const quantity = optionalInteger(params, "quantity") ?? 1;
  if (quantity < 1) {
    throw invalidRequest('"quantity" must be at least 1 — a line is for at least one piece.');
  }

  const target = stampId ?? checklistId!;
  const found =
    stampId !== null
      ? await prisma.stamp.findFirst({
          where: { id: stampId, collectionId: context.collectionId },
          select: { id: true },
        })
      : await prisma.checklist.findFirst({
          where: { id: checklistId!, collectionId: context.collectionId },
          select: { id: true },
        });
  if (!found) {
    throw notFound(
      stampId !== null
        ? `No stamp with id "${target}" is in this token's collection. Use \`search_collection\` to find the right id — the picker creates a stamp when a partner offers something from an area the collection has never touched, and this surface does not.`
        : `No checklist with id "${target}" is in this token's collection. \`get_issue\` lists a series' checklists with their ids.`
    );
  }

  const added = await addTradeReceiveLines(context.ownerId, sectionId, {
    stampId: stampId ?? "",
    ...(checklistId !== null ? { checklistId } : {}),
    conditionId,
    // Null **is** a value on both axes — *no certificate* (ADR-0006 §2) and *single* (ADR-0020) —
    // and on a receive line it is what an unstated axis means: a wish list says a stamp and a grade
    // and stops. That is the opposite of `serve_trade_requirement`, where silence means *anything
    // will do*, because there the axis narrows a search rather than describing a piece.
    certificateStatusId: resolveOptionalVocabularyValue(
      optionalString(params, "certificate"),
      vocabulary.certificateStatuses,
      { vocabulary: "certificate status", parameter: "certificate" }
    ),
    formatId: resolveOptionalVocabularyValue(optionalString(params, "format"), vocabulary.formats, {
      vocabulary: "format",
      parameter: "format",
    }),
    quantity,
  });
  return { added };
}

export const addTradeReceiveLinesOperation: Operation = {
  name: "add_trade_receive_lines",
  method: "POST",
  path: "/trade-sections/{sectionId}/receive",
  description:
    "Ask for material on a trade — the stamps that would arrive. A receive line names a stamp, a grade and how many, because the partner's stamps are in nobody's inventory and there is no copy to point at. A whole set may be asked for at once and fans out into one line per stamp on it.",
  writes: true,
  parameters: [
    SECTION_ID_PARAMETER,
    {
      name: "stamp_id",
      in: "body",
      type: "string",
      required: false,
      description:
        "The stamp being asked for, from `search_collection`. Send this or `checklist_id`, not both. It has to be a stamp this collection already knows — when a partner offers material from an area the collection has never touched, adding that stamp is the collector's act on their own screen.",
    },
    {
      name: "checklist_id",
      in: "body",
      type: "string",
      required: false,
      description:
        "A whole set being offered, from `get_issue` or `find_checklist_gaps`. It becomes one line per stamp on the set, all described the same way — which is what *this series, complete, used* means.",
    },
    {
      name: "condition",
      in: "body",
      type: "string",
      required: true,
      description:
        "The grade being offered. Takes a name or abbreviation from `get_collection_vocabulary` or an id. Required on every line, on both sides of a trade.",
    },
    {
      name: "certificate",
      in: "body",
      type: "string",
      required: false,
      description:
        "The certificate the material carries. Left out it means **no certificate**, which is a value rather than a gap — a wish list that says nothing is describing an uncertificated piece.",
    },
    {
      name: "format",
      in: "body",
      type: "string",
      required: false,
      description:
        "The physical format. Left out it means a **single**, which is a value rather than a gap and is what most material is.",
    },
    {
      name: "quantity",
      in: "body",
      type: "integer",
      required: false,
      description:
        "How many pieces of this; 1 when omitted. This is why a section's receive pieces and its receive lines are two different numbers.",
    },
  ],
  result: {
    kind: "object",
    description:
      "How many lines were made — one for a stamp, one per member for a set. Nothing is reserved and nobody is told: a receive line is a statement of what the exchange is supposed to contain.",
  },
  handler: async (context, params) => addReceiveLines(context, params),
};

// ── remove_trade_line ────────────────────────────────────────────────────────

export async function removeTradeLine(
  context: OperationContext,
  params: ParsedParams
): Promise<{ removed: number }> {
  const lineId = requiredString(params, "lineId");
  const row = await prisma.tradeLine.findFirst({
    where: {
      id: lineId,
      trade: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    },
    select: { trade: { select: { status: true } } },
  });
  if (!row) {
    throw notFound(
      `No trade line with id "${lineId}" is in this token's collection. Use \`list_trade_lines\` to find the right id.`
    );
  }
  assertEditable(
    isTradeStatus(row.trade.status) ? row.trade.status : "preparing",
    "taking a line off"
  );
  await deleteTradeLine(context.ownerId, lineId);
  return { removed: 1 };
}

export const removeTradeLineOperation: Operation = {
  name: "remove_trade_line",
  method: "DELETE",
  path: "/trade-lines/{lineId}",
  description:
    "Take one line off a trade — which is half of making an exchange balance, the other half being adding to the lighter side. On the give side the copy itself is untouched: a give line is a promise about a copy, never a claim on it.",
  writes: true,
  parameters: [
    {
      name: "lineId",
      in: "path",
      type: "string",
      required: true,
      description: "The line's id, from `list_trade_lines`.",
    },
  ],
  result: {
    kind: "object",
    description:
      "How many lines were taken off — one. Refused on a trade that has been agreed, because the partner is holding a copy of that list.",
  },
  handler: async (context, params) => removeTradeLine(context, params),
};
