"use client";

import type { CSSProperties, ReactNode } from "react";
import type { LotPoolSummary, LotProposal } from "@/lib/lot-builder";
import type { LotBuilderCriteria } from "@/lib/lot-builder-criteria";
import type { LotAxisReport } from "@/lib/lot-builder-rules";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { FIGURE_FRAME, SkeletonBlock } from "./lot-builder-chrome";

// The lot builder's figures — **one** readout, and one line per question (#760).
//
// This went wrong twice before it came out right, and both wrong turns are worth keeping.
//
// It began as **two banks of wide tiles** a button apart: what the pool holds, and what the pick
// took. Almost the same five questions, asked twice, costing most of a screen — and keeping the one
// comparison that matters (*26 copies available, 26 taken; 2 sets available, 0 taken*) a scroll away
// from itself.
//
// It then became a **table**, a row per question with a column for each side. That paired the
// figures correctly and was *taller than what it replaced*: six rows down the screen, each spending
// a whole line on two numbers, with a note column empty on most of them.
//
// The mistake both times was reading the pair as **two figures**. It is one: the lot took *26 of the
// 26* the pool had, *0 of 2* sets. Written that way a question fits on one line — label, figure,
// note — and the questions sit **side by side across the width** rather than stacked down it, which
// is the space this screen actually has. Six questions come to three lines instead of six rows, and
// the band is short enough to **pin** while the proposal scrolls under it, so *Re-roll* stays under
// the pointer through a hundred rows.
//
// A question only one side can answer — how many *different* stamps the pool holds, what the cap
// would allow, what the lot promised away in a trade — names its side in words (`17 in the pool`)
// rather than leaving a bare figure to be read as whichever the reader assumed. That is also why the
// rows are declared rather than drawn: the pool and the lot are not the same list of questions, only
// mostly.
//
// There is deliberately no "≈ N lots" figure. Dividing the pool by the target answers a different
// question than it appears to — the cap and the atomic series leave remainders no later lot can pick
// up — and division is the one thing the collector can do unaided. The cap bound they cannot, so the
// bar shows that instead: `Σ min(copies of that stamp, cap)` is an exact ceiling, and it is what
// catches a target of 100 against a pool that can physically yield 80.

/** The questions across the width, each as wide as the row can afford. `auto-fit` over a minimum is
 *  what lets a narrow window fall to two across and a wide one carry all six on one line — this app
 *  has no breakpoints, being desktop-only. */
const TILES: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
  gap: "0.625rem 1.5rem",
};

const LABEL: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const FIGURE: CSSProperties = {
  fontSize: "1.0625rem",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
};

/** The half of the pair that is context — `of 26`, `in the pool`. Same line, quieter, so the eye
 *  lands on the answer and reads the denominator only when it wants it. */
const QUALIFIER: CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-muted)",
};

const NOTE: CSSProperties = {
  fontSize: "0.75rem",
  lineHeight: 1.35,
  color: "var(--color-text-muted)",
};

/** One question. `lot` is null for a question the lot cannot answer, `pool` for one the pool cannot. */
interface FigureRow {
  key: string;
  label: string;
  /** Hover on the label, for a figure whose definition is not in its name. */
  hint?: string;
  pool: string | null;
  poolAlarm?: boolean;
  lot: string | null;
  lotAlarm?: boolean;
  note?: string;
}

/**
 * How an axis landed, in the roll-up bar's grammar (#378): the figure, and the target it is read
 * against. A range with no bounds set has nothing to be read against and says so by saying nothing —
 * the pick was not aiming anywhere, and inventing a verdict would be a claim the collector never
 * made.
 */
function describeAxis(axis: LotAxisReport, unit: string): string | undefined {
  if (axis.min === null && axis.max === null) return undefined;
  const target =
    axis.min !== null && axis.max !== null
      ? `${axis.min}–${axis.max}`
      : axis.min !== null
        ? `at least ${axis.min}`
        : `at most ${axis.max}`;
  if (axis.shortBy > 0) return `${axis.shortBy} ${unit} short of ${target}`;
  if (axis.overBy > 0) return `${axis.overBy} ${unit} over ${target}`;
  return `within ${target}`;
}

/** What the pool has to say about a target, before anything is picked: whether it can reach it. */
function poolNote(value: number, min: number | null, max: number | null): string | undefined {
  if (min === null && max === null) return undefined;
  const target =
    min !== null && max !== null ? `${min}–${max}` : min !== null ? `${min}+` : `≤ ${max}`;
  if (min !== null && value < min) return `short of ${target}`;
  return `against ${target}`;
}

function pieces(axis: LotAxisReport): string {
  return axis.shortBy === 1 || axis.overBy === 1 ? "piece" : "pieces";
}

/** The questions, in the order a collector reads them: the four both sides answer first — they are
 *  the comparison the bar exists for — then what only one side can. */
function buildRows(
  criteria: LotBuilderCriteria,
  summary: LotPoolSummary,
  proposal: LotProposal | undefined
): FigureRow[] {
  const plan = proposal?.plan;
  const currency = summary.baseCurrency;

  const rows: FigureRow[] = [
    {
      key: "copies",
      label: "Copies",
      hint: "The pool is for sale, in hand, and not already offered on this platform",
      pool: String(summary.copies),
      poolAlarm: criteria.countMin !== null && summary.copies < criteria.countMin,
      lot: plan ? String(plan.count.value) : null,
      lotAlarm: plan ? !plan.count.withinRange : false,
      note: plan
        ? describeAxis(plan.count, pieces(plan.count))
        : poolNote(summary.copies, criteria.countMin, criteria.countMax),
    },
    {
      key: "value",
      label: `Catalogue value · ${currency}`,
      pool: summary.catalogValue.toFixed(2),
      poolAlarm: criteria.valueMin !== null && summary.catalogValue < criteria.valueMin,
      lot: plan ? plan.catalogValue.value.toFixed(2) : null,
      lotAlarm: plan ? !plan.catalogValue.withinRange : false,
      note: plan
        ? describeAxis(plan.catalogValue, currency)
        : poolNote(summary.catalogValue, criteria.valueMin, criteria.valueMax),
    },
    {
      key: "sets",
      label: "Complete sets",
      hint: "In the pool: checklists every slot of which a copy in the pool covers. In the lot: the ones that went in whole.",
      pool: String(summary.completeChecklists),
      lot: proposal ? String(proposal.takenChecklists.length) : null,
    },
    {
      key: "unpriced",
      label: "No catalogue value",
      hint: "A missing value is a gap in the data, never a zero — such a copy passes the per-copy ceiling and is counted as a piece, but adds nothing to the sum",
      pool: String(summary.unpricedCopies),
      poolAlarm: summary.unpricedCopies > 0,
      lot: plan ? String(plan.unpricedItemIds.length) : null,
      lotAlarm: plan ? plan.unpricedItemIds.length > 0 : false,
      note:
        summary.unpricedCopies > 0 || (plan && plan.unpricedItemIds.length > 0)
          ? "counted as pieces, left out of the sum"
          : undefined,
    },
    {
      key: "stamps",
      label: "Different stamps",
      hint: "Rolled up through variants — two copies of 226 and one of 226y are one stamp here",
      pool: String(summary.stamps),
      lot: null,
    },
  ];

  if (criteria.maxPerStamp !== null) {
    rows.push({
      key: "cap",
      label: "Cap allows at most",
      hint: "The largest lot your per-stamp cap permits out of this pool — an exact ceiling, not an estimate",
      pool: String(summary.capBoundedCapacity),
      poolAlarm: criteria.countMin !== null && summary.capBoundedCapacity < criteria.countMin,
      lot: null,
      note: poolNote(summary.capBoundedCapacity, criteria.countMin, criteria.countMax),
    });
  }

  if (proposal && proposal.tradeCommitments.length > 0) {
    rows.push({
      key: "promised",
      label: "Promised in a trade",
      pool: null,
      lot: String(proposal.tradeCommitments.length),
      lotAlarm: true,
      note: "kept in the lot, named below",
    });
  }

  return rows;
}

function Tile({ row, hasLot }: { row: FigureRow; hasLot: boolean }) {
  // Before a pick there is only the pool to state. After one, the lot leads and the pool becomes its
  // denominator — which is the sentence a collector says out loud: "twenty-six of twenty-six".
  const bothSides = hasLot && row.lot !== null && row.pool !== null;
  const lead = hasLot && row.lot !== null ? row.lot : row.pool;
  const alarm = hasLot && row.lot !== null ? row.lotAlarm : row.poolAlarm;
  const qualifier = bothSides
    ? `of ${row.pool}`
    : !hasLot
      ? undefined
      : row.lot === null
        ? "in the pool"
        : "in this lot";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem", minWidth: 0 }}>
      <Label hint={row.hint}>{row.label}</Label>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.3rem", minWidth: 0 }}>
        <span style={{ ...FIGURE, color: alarm ? "var(--color-warning)" : FIGURE.color }}>
          {lead ?? "—"}
        </span>
        {qualifier && <span style={QUALIFIER}>{qualifier}</span>}
      </span>
      {row.note && <span style={NOTE}>{row.note}</span>}
    </div>
  );
}

export function LotFigures({
  criteria,
  summary,
  proposal,
  loading,
}: {
  criteria: LotBuilderCriteria;
  summary: LotPoolSummary | undefined;
  /** Absent until a lot has been proposed — until then every figure is the pool's alone. */
  proposal: LotProposal | undefined;
  loading: boolean;
}) {
  // A skeleton of the same shape rather than a line of prose: the figures land in one round trip and
  // every criteria change asks for them again, so a bar that shrank to a sentence and grew back would
  // shove the whole screen up and down as the collector types (#151).
  if (loading || !summary) {
    return (
      <div style={{ ...FIGURE_FRAME, ...TILES }} aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <SkeletonBlock style={{ ...LABEL, width: "6rem" }} />
            <SkeletonBlock style={{ ...FIGURE, width: "4rem" }} />
          </div>
        ))}
      </div>
    );
  }

  const hasLot = proposal !== undefined;
  return (
    <div style={{ ...FIGURE_FRAME, ...TILES }}>
      {buildRows(criteria, summary, proposal).map((row) => (
        <Tile key={row.key} row={row} hasLot={hasLot} />
      ))}
    </div>
  );
}

/** The question's name. A hint makes it a hover target and nothing else — the label is not a control,
 *  so it takes no cursor of its own beyond the `help` the shared tooltip already implies. */
function Label({ hint, children }: { hint?: string; children: ReactNode }) {
  const body = <span style={hint ? { ...LABEL, cursor: "help" } : LABEL}>{children}</span>;
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}
