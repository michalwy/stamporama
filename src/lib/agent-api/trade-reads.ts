// What the trade operations answer with, and the projections that build it (#712).
//
// **Pure, and structurally typed on purpose**, `collection-reads.ts` (#710) and `offer-reads.ts`
// (#711)'s own shape and for their reason (`agent-api.md`, *The module layout is the Prisma-free
// split*). No Prisma, no `server-only`, so `pnpm test:unit` holds every decision below.
//
// Four of those decisions are the ones worth a test:
//
//  - **A trade's share block never leaves this layer.** `TradeData.share` carries the address of the
//    read-only link the partner opens (#640), and handing an agent that address would hand it the
//    one thing this issue's boundary exists to keep out of its reach. The projection is the guard —
//    the same lesson #708 records about the platform vocabulary, where the `where` and the `select`
//    turned out to be depth behind a mapper that names its fields. **Do not replace a mapper here
//    with a spread.**
//  - **The two valuations are never merged**, in either direction: own is the collection's base
//    currency and agreed is the trade's, and one field holding either would be the failure ADR-0039
//    §7 exists to prevent.
//  - **A missing figure is counted, never summed as zero.** `ownMissing` is what the gate is built
//    on, and a total that quietly assumed nought would read as an answer while being a guess.
//  - **A line row states its own worth and carries no verdict**; the verdict is
//    `get_trade_balance`'s and is about the trade rather than about any row. Two readings of one
//    question in two responses is how they come to disagree.

import { catalogLabels, compact, copyValue, subtypeName } from "./collection-reads";
import type { AgentCopyValue, CatalogLabelRow, CopyValueRow } from "./collection-reads";

// ── The trade ────────────────────────────────────────────────────────────────

/** How a trade is judged. Two words rather than a boolean, because `balanceByValue: false` reads as
 *  *not balanced by value* rather than as *balanced on pieces*, which is what it means. */
export type AgentBalanceBasis = "value" | "pieces";

export function balanceBasis(byValue: boolean): AgentBalanceBasis {
  return byValue ? "value" : "pieces";
}

/**
 * One section of a trade.
 *
 * **A section states its rule whole or inherits the trade's whole** (ADR-0039 §3), so the four
 * override fields are present together or not at all. `inherited` says which, because *tolerance 0
 * because the trade says so* and *tolerance 0 because this section says so* are indistinguishable
 * from the numbers alone.
 */
export interface AgentTradeSection {
  readonly sectionId: string;
  readonly name: string;
  readonly giveLines: number;
  readonly receiveLines: number;
  /** Pieces on the receive side, which is **not** its line count — three lines can be thirty
   *  stamps. A give line is always one copy, so the give side has no second figure. */
  readonly receivePieces: number;
  readonly balanceBy: AgentBalanceBasis;
  readonly countTolerance: number;
  readonly valueTolerancePct: number;
  readonly ownValueWarnPct: number;
  /** The rule above is the trade's rather than this section's own. */
  readonly inherited: boolean;
}

/**
 * One trade.
 *
 * **What is deliberately not here is the share link.** `TradeData.share` holds the address the
 * partner reads the list at; this surface never reaches a counterparty, and an address is the
 * shortest possible way to reach one.
 */
export interface AgentTrade {
  readonly tradeId: string;
  readonly tradeNo: number;
  readonly partner: string;
  readonly partnerId: string;
  /** `preparing`, `shared`, `agreed`, `closed` or `cancelled`. Nothing on this surface moves it. */
  readonly status: string;
  /**
   * Whether lines may still be written. False from `agreed` on — the partner is holding a copy of
   * the list, and a figure changed underneath an agreement is what freezing exists to prevent. An
   * agent should read this before trying to add anything rather than after being refused.
   */
  readonly contentEditable: boolean;
  /** The currency the **agreed** valuation is stated in. The collector's own valuation is in the
   *  collection's base currency, which `get_trade_balance` states beside it. */
  readonly currency: string;
  readonly balanceBy: AgentBalanceBasis;
  readonly countTolerance: number;
  readonly valueTolerancePct: number;
  readonly ownValueWarnPct: number;
  /** The catalogue **publisher** both sides agreed to read in — never one book, because a trade
   *  routinely spans several areas and one book prices only one of them. Absent where the trade
   *  names none, which a value-balanced trade may not do. */
  readonly agreedCatalog?: string;
  readonly notes?: string;
  readonly sentAt?: string;
  readonly receivedAt?: string;
  readonly createdAt: string;
  readonly sections: AgentTradeSection[];
  readonly path: string;
}

export interface TradeSectionRow {
  readonly id: string;
  readonly name: string;
  readonly balanceByValue: boolean | null;
  readonly countTolerance: number | null;
  readonly valueTolerancePct: number | null;
  readonly ownValueWarnPct: number | null;
  readonly giveCount: number;
  readonly receiveCount: number;
  readonly receiveQuantity: number;
}

export interface TradeRow {
  readonly id: string;
  readonly tradeNo: number;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly status: string;
  readonly currency: string;
  readonly notes: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string | null;
  readonly catalogVendorName: string | null;
  readonly balanceByValue: boolean;
  readonly countTolerance: number;
  readonly valueTolerancePct: number;
  readonly ownValueWarnPct: number;
  readonly createdAt: Date;
  readonly sections: readonly TradeSectionRow[];
}

export interface TradeContext {
  readonly contentEditable: boolean;
  readonly path: string;
}

export function trade(row: TradeRow, context: TradeContext): AgentTrade {
  return compact({
    tradeId: row.id,
    tradeNo: row.tradeNo,
    partner: row.partnerName,
    partnerId: row.partnerId,
    status: row.status,
    contentEditable: context.contentEditable,
    currency: row.currency,
    balanceBy: balanceBasis(row.balanceByValue),
    countTolerance: row.countTolerance,
    valueTolerancePct: row.valueTolerancePct,
    ownValueWarnPct: row.ownValueWarnPct,
    agreedCatalog: row.catalogVendorName ?? undefined,
    notes: row.notes ?? undefined,
    sentAt: row.sentAt ?? undefined,
    receivedAt: row.receivedAt ?? undefined,
    createdAt: row.createdAt.toISOString(),
    sections: row.sections.map((section) => tradeSection(section, row)),
    path: context.path,
  });
}

/** A section's effective rule, resolved the way `resolveBalanceRule` resolves it — all four
 *  overrides or none, `balanceByValue` the discriminator. */
function tradeSection(section: TradeSectionRow, parent: TradeRow): AgentTradeSection {
  const own = section.balanceByValue !== null;
  return {
    sectionId: section.id,
    name: section.name,
    giveLines: section.giveCount,
    receiveLines: section.receiveCount,
    receivePieces: section.receiveQuantity,
    balanceBy: balanceBasis(own ? section.balanceByValue! : parent.balanceByValue),
    countTolerance: (own ? section.countTolerance : parent.countTolerance) ?? 0,
    valueTolerancePct: (own ? section.valueTolerancePct : parent.valueTolerancePct) ?? 0,
    ownValueWarnPct: (own ? section.ownValueWarnPct : parent.ownValueWarnPct) ?? 0,
    inherited: !own,
  };
}

// ── list_trades ──────────────────────────────────────────────────────────────

/**
 * One row of the trades list.
 *
 * **Both sides are counted and counted separately, because that difference *is* the trade**: ten
 * cheap ones for two good ones is an ordinary value trade, and one total would hide the fact the
 * list is read for. Value figures are not on the row — they need the balancing engine, and a blank
 * where a number belongs is better than a zero that is not one.
 */
export interface AgentTradeRow {
  readonly tradeId: string;
  readonly tradeNo: number;
  readonly partner: string;
  readonly status: string;
  readonly currency: string;
  readonly balanceBy: AgentBalanceBasis;
  readonly sections: number;
  readonly giveLines: number;
  readonly receiveLines: number;
  readonly receivePieces: number;
  /** The partner has said something nobody has dealt with yet (#641). It is **derived**, never a
   *  status: a negotiation goes back and forth several times, and as a status it would record the
   *  collector's diligence rather than the trade. */
  readonly partnerResponded?: boolean;
  readonly createdAt: string;
  readonly path: string;
}

export interface TradeListRow {
  readonly id: string;
  readonly tradeNo: number;
  readonly partnerName: string;
  readonly status: string;
  readonly currency: string;
  readonly balanceByValue: boolean;
  readonly sectionCount: number;
  readonly giveCount: number;
  readonly receiveCount: number;
  readonly receiveQuantity: number;
  readonly hasPartnerFeedback: boolean;
  readonly createdAt: Date;
}

export function tradeRow(row: TradeListRow, path: string): AgentTradeRow {
  return compact({
    tradeId: row.id,
    tradeNo: row.tradeNo,
    partner: row.partnerName,
    status: row.status,
    currency: row.currency,
    balanceBy: balanceBasis(row.balanceByValue),
    sections: row.sectionCount,
    giveLines: row.giveCount,
    receiveLines: row.receiveCount,
    receivePieces: row.receiveQuantity,
    partnerResponded: row.hasPartnerFeedback || undefined,
    createdAt: row.createdAt.toISOString(),
    path,
  });
}

// ── list_trade_lines ─────────────────────────────────────────────────────────

/**
 * One line of a trade.
 *
 * **The two sides carry different payloads because they *are* different things** (ADR-0039 §1): a
 * give line names a **concrete copy** the collection holds, with a number and a filing place, while
 * a receive line names a `Want`-shaped key — stamp × condition × certificate × format — describing
 * material in nobody's inventory. Rendering the second as a copy row would print an empty copy
 * number and five blank slots and call that consistency.
 *
 * **There is no pairing between the sides** (§2) and the counts routinely differ, so nothing may
 * read a give line as having a receive line opposite it.
 */
export interface AgentTradeLine {
  readonly lineId: string;
  readonly side: "give" | "receive";
  readonly sectionId: string;
  readonly stampId: string;
  readonly stamp?: string;
  readonly catalogNumbers: string[];
  readonly issue?: string;
  readonly issueYear?: number;
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  /** Pieces this line is about. **Always 1 on the give side** — a multiple is one copy in one
   *  format, never N singles (ADR-0020) — and any positive number on the receive side. */
  readonly quantity: number;
  /** `pending`, `fulfilled`, `missing` or `withdrawn` (#642). Everything is `pending` until the
   *  trade is agreed and somebody records what actually moved; nothing on this surface writes it. */
  readonly fulfillment: string;
  /** The catalogue's figure at this line's exact key, **per piece**. `quantity` is on the row
   *  beside it, and a figure silently multiplied by it would not be the catalogue's. */
  readonly catalogValue: AgentCopyValue;
  // ── give side only ──
  readonly copyId?: string;
  readonly itemNo?: number;
  readonly location?: string;
  readonly locationRef?: string;
  readonly deliveryState?: string;
  // ── receive side only ──
  /** The line points at a base stamp that has variants: *one of these, which one is not recorded*. */
  readonly unknownVariant?: boolean;
  readonly subtype?: string;
}

/** A give line's copy, as `listItemsPaginated` states it — `CopyRow`'s own shape, narrowed. */
export interface GiveLineRow {
  readonly id: string;
  readonly itemNo: number;
  readonly stampId: string;
  readonly stampName: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly conditionName: string;
  readonly certificateStatusName: string | null;
  readonly formatName: string | null;
  readonly locationRef: string | null;
  readonly deliveryState: string;
  readonly value: CopyValueRow;
}

export interface ReceiveLineRow {
  readonly stampId: string;
  readonly stampName: string | null;
  readonly unknownVariant: boolean;
  readonly subtype: { readonly name: string; readonly isDefault: boolean } | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly conditionName: string;
  readonly certificateStatusName: string | null;
  readonly formatName: string | null;
  readonly quantity: number;
  readonly value: CopyValueRow;
}

export interface TradeLineContext {
  readonly lineId: string;
  readonly sectionId: string;
  readonly fulfillment: string;
  readonly catalogNumbers: readonly CatalogLabelRow[];
  readonly location: string | null;
}

export function giveLine(row: GiveLineRow, context: TradeLineContext): AgentTradeLine {
  return compact({
    lineId: context.lineId,
    side: "give" as const,
    sectionId: context.sectionId,
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    condition: row.conditionName,
    certificate: row.certificateStatusName ?? undefined,
    format: row.formatName ?? undefined,
    quantity: 1,
    fulfillment: context.fulfillment,
    catalogValue: copyValue(row.value),
    copyId: row.id,
    itemNo: row.itemNo,
    location: context.location ?? undefined,
    locationRef: row.locationRef ?? undefined,
    deliveryState: row.deliveryState,
  });
}

export function receiveLine(row: ReceiveLineRow, context: TradeLineContext): AgentTradeLine {
  return compact({
    lineId: context.lineId,
    side: "receive" as const,
    sectionId: context.sectionId,
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    unknownVariant: row.unknownVariant || undefined,
    subtype: subtypeName(row.subtype) ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    condition: row.conditionName,
    certificate: row.certificateStatusName ?? undefined,
    format: row.formatName ?? undefined,
    quantity: row.quantity,
    fulfillment: context.fulfillment,
    catalogValue: copyValue(row.value),
  });
}

// ── get_trade_balance ────────────────────────────────────────────────────────

/** One side's totals. */
export interface AgentSideTotals {
  readonly lines: number;
  readonly pieces: number;
  /** The **collector's own** valuation, in the collection's base currency. */
  readonly own: number;
  /** Lines carrying no own figure. **Never folded into `own` as a zero**: a total that quietly
   *  assumed one would read as an answer while being a guess, and this count is exactly what the
   *  `preparing → shared` and `→ agreed` gates refuse on. */
  readonly ownMissing: number;
  /** Lines whose own figure is an unknown-variant estimate (#238) — the total is that much of an
   *  estimate too, and says so rather than being withheld. */
  readonly ownUncertain: number;
  /** Lines valued from the collector's own typed figure rather than from a catalogue. */
  readonly ownManual: number;
  /** The **agreed** valuation, in the trade's currency. Never added to `own`: two units. */
  readonly agreed: number;
  readonly agreedMissing: number;
  readonly agreedUncertain: number;
  readonly agreedManual: number;
}

/**
 * The verdict for one section, or for the whole trade.
 *
 * **Both modes are computed and only one is the verdict.** The piece count is a fact whatever the
 * trade is balanced on, and the own-valuation skew is computed in **both** modes, because *am I
 * giving away 1000 for 10* is a question a piece-count trade gets wrong just as easily as a value
 * one. `balanceBy` says which of `countBalanced` and `valueBalanced` is the verdict.
 *
 * **Skew is measured against the larger side**, which is what *within 5%* means to a reader and is
 * the only formula that survives swapping the sides.
 */
export interface AgentBalanceVerdict {
  readonly balanceBy: AgentBalanceBasis;
  readonly give: AgentSideTotals;
  readonly receive: AgentSideTotals;
  /** Pieces given minus pieces received. Positive = more is leaving than arriving. */
  readonly countDiff: number;
  readonly countTolerance: number;
  readonly countBalanced: boolean;
  /** Agreed value given minus received, in the trade's currency. */
  readonly valueDiff: number;
  readonly valuePct: number;
  readonly valueTolerancePct: number;
  readonly valueBalanced: boolean;
  /**
   * Whether a value verdict could be reached at all: false while any line on either side has no
   * agreed figure. A percentage taken over a side with a line missing describes a different trade,
   * so `valueBalanced` is false and this says why rather than a number being printed.
   */
  readonly valueComplete: boolean;
  /** Own value given minus received, base currency. Positive = the collector is giving more away. */
  readonly ownDiff: number;
  readonly ownSkewPct: number;
  readonly ownWarnPct: number;
  /** Past the threshold — **a warning and never a block**. A deliberately uneven trade is a normal
   *  thing and the app has no business forbidding it; what this does is make sure it is deliberate. */
  readonly ownWarn: boolean;
  readonly ownIncomplete: boolean;
}

/** Why the trade cannot move on, named line by line. */
export interface AgentBalanceBlocker {
  readonly kind: string;
  readonly message: string;
  /** The lines at fault, by id. Empty for a fault that is the trade's rather than any line's —
   *  a value-balanced trade naming no agreed catalogue is the one that is. */
  readonly lineIds: string[];
}

export interface AgentSectionBalance extends AgentBalanceVerdict {
  readonly sectionId: string;
  readonly name: string;
  /** The rule judged against is the trade's rather than this section's own. */
  readonly inherited: boolean;
}

/**
 * The whole balancing read for one trade.
 *
 * **One read for the whole trade, never one per section**: the sections' verdicts and the trade's
 * are taken off one set of figures at one moment, and assembling them from several calls could show
 * every section balanced and the trade not.
 *
 * **The trade's verdict is judged against the *trade's* own rule**, never a section's — it is the
 * one the two collectors struck, and a section stating its own rule says nothing about the total.
 */
export interface AgentTradeBalance {
  readonly tradeId: string;
  readonly status: string;
  /** The collector's own valuation is in this. */
  readonly baseCurrency: string;
  /** The agreed valuation is in this. Labelled apart from `baseCurrency` everywhere both appear, or
   *  somebody will one day add 340 to 78. */
  readonly tradeCurrency: string;
  readonly agreedCatalog?: string;
  /** The line figures are the frozen snapshot rather than today's catalogues: the trade is `agreed`
   *  or beyond, and the partner is holding a printout of exactly these numbers. */
  readonly frozen: boolean;
  readonly frozenAt?: string;
  /** The rates are the trade's own, taken at the first share, rather than today's. */
  readonly ratesFrozen: boolean;
  readonly trade: AgentBalanceVerdict;
  readonly sections: AgentSectionBalance[];
  readonly blockers: AgentBalanceBlocker[];
}

export interface SideTotalsRow {
  readonly lines: number;
  readonly pieces: number;
  readonly own: number;
  readonly ownMissing: number;
  readonly ownUncertain: number;
  readonly ownManual: number;
  readonly agreed: number;
  readonly agreedMissing: number;
  readonly agreedUncertain: number;
  readonly agreedManual: number;
}

export interface VerdictRow {
  readonly byValue: boolean;
  readonly give: SideTotalsRow;
  readonly receive: SideTotalsRow;
  readonly countDiff: number;
  readonly countTolerance: number;
  readonly countBalanced: boolean;
  readonly valueDiff: number;
  readonly valuePct: number;
  readonly valueTolerancePct: number;
  readonly valueBalanced: boolean;
  readonly valueComplete: boolean;
  readonly ownDiff: number;
  readonly ownSkewPct: number;
  readonly ownWarnPct: number;
  readonly ownWarn: boolean;
  readonly ownIncomplete: boolean;
}

function sideTotals(row: SideTotalsRow): AgentSideTotals {
  return {
    lines: row.lines,
    pieces: row.pieces,
    own: row.own,
    ownMissing: row.ownMissing,
    ownUncertain: row.ownUncertain,
    ownManual: row.ownManual,
    agreed: row.agreed,
    agreedMissing: row.agreedMissing,
    agreedUncertain: row.agreedUncertain,
    agreedManual: row.agreedManual,
  };
}

export function balanceVerdict(row: VerdictRow): AgentBalanceVerdict {
  return {
    balanceBy: balanceBasis(row.byValue),
    give: sideTotals(row.give),
    receive: sideTotals(row.receive),
    countDiff: row.countDiff,
    countTolerance: row.countTolerance,
    countBalanced: row.countBalanced,
    valueDiff: row.valueDiff,
    valuePct: row.valuePct,
    valueTolerancePct: row.valueTolerancePct,
    valueBalanced: row.valueBalanced,
    valueComplete: row.valueComplete,
    ownDiff: row.ownDiff,
    ownSkewPct: row.ownSkewPct,
    ownWarnPct: row.ownWarnPct,
    ownWarn: row.ownWarn,
    ownIncomplete: row.ownIncomplete,
  };
}

export interface BalanceRow {
  readonly tradeId: string;
  readonly status: string;
  readonly baseCurrency: string;
  readonly tradeCurrency: string;
  readonly agreedCatalogVendorName: string | null;
  readonly frozen: boolean;
  readonly frozenAt: string | null;
  readonly ratesFrozen: boolean;
  readonly trade: VerdictRow;
  readonly sections: readonly {
    readonly sectionId: string;
    readonly name: string;
    readonly rule: { readonly inherited: boolean };
    readonly verdict: VerdictRow;
  }[];
  readonly blockers: readonly {
    readonly kind: string;
    readonly message: string;
    readonly lines: readonly { readonly lineId: string }[];
  }[];
}

export function tradeBalance(row: BalanceRow): AgentTradeBalance {
  return compact({
    tradeId: row.tradeId,
    status: row.status,
    baseCurrency: row.baseCurrency,
    tradeCurrency: row.tradeCurrency,
    agreedCatalog: row.agreedCatalogVendorName ?? undefined,
    frozen: row.frozen,
    frozenAt: row.frozenAt ?? undefined,
    ratesFrozen: row.ratesFrozen,
    trade: balanceVerdict(row.trade),
    sections: row.sections.map((section) => ({
      sectionId: section.sectionId,
      name: section.name,
      inherited: section.rule.inherited,
      ...balanceVerdict(section.verdict),
    })),
    blockers: row.blockers.map((blocker) => ({
      kind: blocker.kind,
      message: blocker.message,
      lineIds: blocker.lines.map((line) => line.lineId),
    })),
  });
}

// ── The write verbs' reports ─────────────────────────────────────────────────

/**
 * What promising copies came to.
 *
 * **A refusal is named per copy rather than thrown**, `attachItemsToLot`'s rule: one copy sold in
 * the minute the agent was thinking is no reason to drop the other nineteen, and an agent told
 * *which* one and *why* corrects itself in one turn.
 */
export interface AgentGiveLineResult {
  readonly added: number;
  readonly refused: { readonly copyId: string; readonly reason: string }[];
  /**
   * What each stated requirement came to, when the copies were resolved from one rather than named
   * outright. **A gap is an outcome and not an error** (#659) — *you do not hold this in this
   * condition* is the useful half of an answer about somebody else's wish list, so it survives to
   * the report instead of being dropped or thrown.
   */
  readonly requirements?: {
    readonly stamp: string;
    readonly requested: number;
    readonly served: number;
    readonly missing: number;
  }[];
}
