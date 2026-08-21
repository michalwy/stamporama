import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { assertLineOwner } from "./trade-access";
import { LABEL_STAMP_SELECT, loadTradeLineLabeller } from "./trade-line-label";
import { isTradeSide, isTradeStatus, type TradeSide, type TradeStatus } from "./trade-rules";
import {
  canRecordTradeRealisation,
  countTradeRealisation,
  describeStruckOff,
  parseTradeFulfillment,
  readTradeFulfillment,
  tradeClosingBlockerMessage,
  tradeRealisationClosedMessage,
  UNANSWERED_FULFILLMENTS,
  type TradeFulfillment,
  type TradeRealisationCounts,
} from "./trade-realisation-rules";

// **What actually happened to this trade** (#642; ADR-0039 §11) — the database half. The vocabulary,
// the per-side wording and every sentence a refusal is made in live in the pure
// `trade-realisation-rules.ts`, beside this module exactly as `trade-feedback-rules.ts` sits beside
// `trade-feedback.ts`.
//
// **It writes two columns and touches nothing else.** Not the quantity, not the key, not
// `manualValue`, and above all not the frozen `TradeLineValuation` rows: the agreement is what both
// sides shook hands on and the partner is holding a printout of it. Realisation is a second layer on
// the same line, and the realised balance is derived from the two together — the agreement minus what
// was struck off — rather than by rewriting the first.
//
// It sits **below** `trades.ts` and imports neither it nor `trade-lines.ts`, because `setTradeStatus`
// asks it whether the trade may close. The guard it needs comes from `trade-access.ts`, the level
// further down that exists for exactly this (ADR-0039, #638).

/** One line's verdict, as the screen reads it. */
export interface TradeLineRealisation {
  lineId: string;
  side: TradeSide;
  fulfillment: TradeFulfillment;
  note: string | null;
}

/**
 * What is recorded about this trade's realisation, and what still stands between it and closing.
 *
 * Rides with the trade's detail read beside the reservation and the feedback, for their reason: it is
 * one light query over lines the screen is about to draw anyway, and the closing refusal has to be
 * met **while the list is being read** rather than by pressing the button — #638's rule for the
 * valuation gate and #639's for the listing gate, kept.
 */
export interface TradeRealisationRead {
  /** Whether a verdict may be recorded at all right now — `agreed`, and nothing else. */
  recordable: boolean;
  /** Said in place of the controls when it may not be, so a collector who cannot answer is told why
   *  rather than left looking for a menu entry that is not there. */
  closedMessage: string | null;
  lines: TradeLineRealisation[];
  counts: TradeRealisationCounts;
  /** What was struck off, in a phrase, or null. */
  struckOff: string | null;
  /** Why this trade cannot be closed yet, named line by line, or null. */
  blocker: string | null;
}

const REALISATION_SELECT = {
  id: true,
  side: true,
  fulfillment: true,
  fulfillmentNote: true,
} satisfies Prisma.TradeLineSelect;

/**
 * Every line's verdict, keyed by line.
 *
 * The light half of the read below, exported on its own because the partner's page wants exactly
 * this and nothing else (#640): it prints what changed on the rows it is already drawing, and has no
 * use for the closing gate or the dictionaries naming it costs.
 */
export async function readTradeLineFulfillments(
  tradeId: string
): Promise<Map<string, TradeLineRealisation>> {
  const rows = await prisma.tradeLine.findMany({
    where: { tradeId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: REALISATION_SELECT,
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        lineId: row.id,
        side: isTradeSide(row.side) ? row.side : "give",
        fulfillment: readTradeFulfillment(row.fulfillment),
        note: row.fulfillmentNote,
      },
    ])
  );
}

/** The realisation of one trade. Two reads at most: the lines, and — only where something is still
 *  unanswered — the dictionaries the labeller names them from. */
export async function readTradeRealisation(tradeId: string): Promise<TradeRealisationRead> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { collectionId: true, status: true },
  });
  if (!trade) {
    return {
      recordable: false,
      closedMessage: null,
      lines: [],
      counts: countTradeRealisation([]),
      struckOff: null,
      blocker: null,
    };
  }
  const status: TradeStatus = isTradeStatus(trade.status) ? trade.status : "preparing";

  const lines = [...(await readTradeLineFulfillments(tradeId)).values()];
  const counts = countTradeRealisation(lines.map((l) => l.fulfillment));
  const recordable = canRecordTradeRealisation(status);

  return {
    recordable,
    closedMessage: recordable ? null : tradeRealisationClosedMessage(status),
    lines,
    counts,
    struckOff: describeStruckOff(counts),
    // Only where the collector is actually near the end of it. A trade being composed has every line
    // pending by construction, and saying so on it would be a warning about the ordinary state of
    // things — the exact noise `describeStruckOff` avoids on the other side.
    blocker: recordable ? await closingBlocker(trade.collectionId, tradeId) : null,
  };
}

/**
 * Record what became of one line.
 *
 * Refused **by name** anywhere but `agreed`: before it nothing has happened, and `closed` and
 * `cancelled` are history. Note that this is deliberately the *opposite* gate from every other write
 * on a line — `assertContentEditable` refuses at `agreed`, and this refuses everywhere else. That is
 * the whole shape of the issue: the list locks because the partner holds a copy of it, and recording
 * that reality diverged from that copy is a different act with its own window.
 */
export async function setTradeLineFulfillment(
  ownerId: string,
  lineId: string,
  input: { fulfillment: unknown; note?: unknown }
): Promise<void> {
  const { status } = await assertLineOwner(ownerId, lineId);
  if (!canRecordTradeRealisation(status)) {
    throw new Error(tradeRealisationClosedMessage(status));
  }

  const parsed = parseTradeFulfillment(input.fulfillment, input.note);
  if (!parsed.ok) throw new Error(parsed.message);

  await prisma.tradeLine.update({
    where: { id: lineId },
    data: {
      fulfillment: parsed.value.fulfillment,
      fulfillmentNote: parsed.value.note,
    },
  });
}

/**
 * Why this trade may not be closed, or null.
 *
 * Re-run on **every** attempt rather than stamped once, like every other trade gate: a line added
 * while the trade was `shared` and agreed since must not slip through on a check that passed before
 * it existed.
 */
export async function tradeClosingRefusal(tradeId: string): Promise<string | null> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { collectionId: true },
  });
  if (!trade) return null;
  return closingBlocker(trade.collectionId, tradeId);
}

/** The pending lines, named by catalogue number through #638's own labeller — so a line named here
 *  and the same line named in a valuation refusal are recognisably the same line. */
async function closingBlocker(
  collectionId: string,
  tradeId: string
): Promise<string | null> {
  // Narrowed by the pure module's own list rather than by a spelling typed into a `where`: what
  // counts as unanswered is one judgement, and a second copy of it here would be a second copy to
  // keep in step.
  const unanswered = await prisma.tradeLine.findMany({
    where: { tradeId, fulfillment: { in: [...UNANSWERED_FULFILLMENTS] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      condition: { select: { name: true, abbreviation: true } },
      stamp: { select: LABEL_STAMP_SELECT },
      item: {
        select: {
          condition: { select: { name: true, abbreviation: true } },
          stamp: { select: LABEL_STAMP_SELECT },
        },
      },
    },
  });
  if (unanswered.length === 0) return null;

  const label = await loadTradeLineLabeller(collectionId);
  return tradeClosingBlockerMessage(unanswered.map(label));
}
