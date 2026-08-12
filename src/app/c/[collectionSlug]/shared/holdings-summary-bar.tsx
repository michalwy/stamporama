"use client";

import type { HoldingsSummary } from "@/lib/valuation";
import type { PurchaseReturn } from "@/lib/purchase-return";

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  // Fixed width so both rows' amounts line up in a column.
  width: "6.5rem",
  flexShrink: 0,
};

const AMOUNT_STYLE: React.CSSProperties = {
  fontSize: "1.0625rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  // Fixed width + right-align so the currency codes align and digits share a column.
  minWidth: "9rem",
  textAlign: "right",
};

const NOTE_STYLE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const FRAME_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "0.625rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.75rem",
  flexWrap: "wrap",
};

/** A shimmering placeholder block. ` ` keeps the span on the text baseline so its line box
 * matches the loaded row; the amount block carries the row height via {@link AMOUNT_STYLE}. */
function SkeletonBlock({ style }: { style: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        ...style,
        display: "inline-block",
        borderRadius: "0.25rem",
        background: "var(--color-border)",
        color: "transparent",
      }}
    >
      &nbsp;
    </span>
  );
}

/** Loading placeholder for {@link HoldingsSummaryBar}. Mirrors the loaded structure — same frame,
 * same per-span font sizes — so the bar reserves its final height and surrounding content does not
 * shift when the figures arrive (#151). Three rows: catalogue value, market value and purchase
 * cost, the ones a loaded bar all but always draws. The write-off row is not among them, being the
 * exception rather than the shape. */
function HoldingsSummaryBarSkeleton() {
  return (
    <div style={FRAME_STYLE} aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} style={ROW_STYLE}>
          <SkeletonBlock style={LABEL_STYLE} />
          <SkeletonBlock style={AMOUNT_STYLE} />
          <SkeletonBlock style={{ ...NOTE_STYLE, width: "5rem" }} />
        </div>
      ))}
    </div>
  );
}

/** A gain is stated in the accent-positive hue and a loss in the error one (#559). A bare figure in
 * the same colour as everything above it is one a collector has to read twice to tell which way it
 * went. */
function signedStyle(amount: string): React.CSSProperties {
  return {
    ...AMOUNT_STYLE,
    color:
      Number(amount) < 0 ? "var(--color-error)" : "var(--color-success, var(--color-text-primary))",
  };
}

/** `+120.00` / `−12.00` — the sign is always printed, the minus being the typographic one the
 * write-off row already uses. */
function signed(amount: string): string {
  const value = Number(amount);
  return value < 0 ? `−${Math.abs(value).toFixed(2)}` : `+${value.toFixed(2)}`;
}

function percentNote(percent: number | null): string {
  return percent == null ? "" : ` · ${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function copiesWord(n: number): string {
  return `cop${n === 1 ? "y" : "ies"}`;
}

/**
 * What this scope has earned back so far (#559), as further rows of the bar rather than a frame of
 * its own: cost and return are the two halves of one question about the very same copies, and two
 * stacked boxes would make them look like two subjects.
 *
 * **Only once something has sold.** A scope with nothing sold has no return to state, and a
 * standing `+0.00 / −100%` on every purchase and every lot would be noise wearing a figure's
 * clothes — the cost side above already says what was spent.
 */
function ReturnRows({ ret }: { ret: PurchaseReturn }) {
  return (
    <>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Realized</span>
        <span style={AMOUNT_STYLE}>
          {ret.realized} {ret.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {ret.soldCount} of {ret.copyCount} {copiesWord(ret.copyCount)} sold
          {/* A sold copy whose sale line mixed several purchases and could not be split (ADR-0012
              §6.3) is stated rather than silently counted as nothing: the figure is short, and by
              how many copies is the only honest thing to say about it. */}
          {ret.unattributedCount > 0 ? ` · ${ret.unattributedCount} not attributable here` : ""}
        </span>
      </div>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Net return</span>
        <span style={signedStyle(ret.netReturn)}>
          {signed(ret.netReturn)} {ret.baseCurrency}
        </span>
        {/* The spend is named rather than left to be read off the rows above: those split what was
            paid into what is still held and what was written off (#396), and this figure is both. */}
        <span style={NOTE_STYLE}>
          against {ret.spent.totalCostBasis} {ret.spent.baseCurrency} spent on all {ret.copyCount}{" "}
          {copiesWord(ret.copyCount)}
          {percentNote(ret.netReturnPercent)}
        </span>
      </div>
      {/* The figure above reads deeply negative until most of a purchase has sold, which says
          nothing about how the sales went. This one does: realized against the cost of the copies
          that actually left. Both, because neither answers the other. */}
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>On sold</span>
        <span style={signedStyle(ret.soldMargin)}>
          {signed(ret.soldMargin)} {ret.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          against {ret.soldCost.totalCostBasis} {ret.soldCost.baseCurrency} spent on the{" "}
          {ret.soldCount} sold {copiesWord(ret.soldCount)}
          {percentNote(ret.soldMarginPercent)}
        </span>
      </div>
    </>
  );
}

/** Holdings summary for the current filter set (ADR-0007 §7, #101; ADR-0009, #134). Shows
 * two lines over the same copy set: the summed **catalog value** in the base currency (with
 * the uncertain/unpriced/unconvertible breakdown), and the total **actual purchase cost** —
 * the frozen cost-basis snapshots — calling out copies whose cost is still pending (open
 * lot) or has no cost recorded. Renders a fixed-height skeleton until the figures have loaded
 * so no layout shift occurs (#151).
 *
 * `ret` (#559) adds the return rows beneath, on the surfaces that know what the same copies have
 * since fetched — a purchase order and each of its lots. Omitted everywhere else, and drawn only
 * once something in scope has sold. */
export function HoldingsSummaryBar({
  total,
  ret,
}: {
  total: HoldingsSummary | undefined;
  ret?: PurchaseReturn;
}) {
  if (!total) return <HoldingsSummaryBarSkeleton />;

  const valuationNotes: string[] = [];
  if (total.uncertainCount > 0) {
    valuationNotes.push(
      `includes ~${total.uncertainBaseAmount} ${total.baseCurrency} uncertain (${total.uncertainCount} unknown-variant)`
    );
  }
  if (total.unpricedCount > 0) {
    valuationNotes.push(`${total.unpricedCount} unpriced`);
  }
  if (total.unconvertibleCount > 0) {
    valuationNotes.push(`${total.unconvertibleCount} not convertible to ${total.baseCurrency}`);
  }

  // What the market paid for copies like these (#458; ADR-0022 §8). Coverage is stated, never
  // implied: market value exists only where lots have been recorded, so the count of copies behind
  // the figure — and the count it could say nothing about — is part of the figure.
  const market = total.market;
  const marketCovered = market.valuedCount + market.noEvidenceCount;

  const cost = total.cost;
  const costNotes: string[] = [];
  if (cost.pendingCount > 0) {
    costNotes.push(`${cost.pendingCount} pending`);
  }
  if (cost.noneCount > 0) {
    costNotes.push(`${cost.noneCount} no cost recorded`);
  }

  // Copies no longer held (#396). Their cost is stated on its own line rather than folded into
  // the purchase total: what was spent on the collection and what was spent on copies that are
  // gone are two different questions, and adding them answers neither.
  const writeOff = total.writeOff;
  const writeOffNotes: string[] = [];
  if (writeOff.cost.pendingCount > 0) {
    writeOffNotes.push(`${writeOff.cost.pendingCount} cost pending`);
  }
  if (writeOff.cost.noneCount > 0) {
    writeOffNotes.push(`${writeOff.cost.noneCount} no cost recorded`);
  }

  return (
    <div style={FRAME_STYLE}>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Catalog value</span>
        <span style={AMOUNT_STYLE}>
          {total.totalBaseAmount} {total.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {total.pricedCount} priced
          {valuationNotes.length > 0 ? ` · ${valuationNotes.join(" · ")}` : ""}
        </span>
      </div>
      {/* Market value (#458). Only drawn when there are copies to have covered at all — an empty
          scope's 0.00 would state a market answer about nothing. A scope with copies but no
          evidence still draws, saying so: "0 of 84 copies" is the answer, and hiding the row would
          leave the collector to guess whether the figure is missing or the evidence is. */}
      {marketCovered > 0 && (
        <div style={ROW_STYLE}>
          <span style={LABEL_STYLE}>Market value</span>
          <span style={AMOUNT_STYLE}>
            {market.totalBaseAmount} {market.baseCurrency}
          </span>
          <span style={NOTE_STYLE}>
            from {market.valuedCount} of {marketCovered} cop{marketCovered === 1 ? "y" : "ies"}
            {market.noEvidenceCount > 0
              ? ` · ${market.noEvidenceCount} with no auction results`
              : ""}
          </span>
        </div>
      )}
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Purchase cost</span>
        <span style={AMOUNT_STYLE}>
          {cost.totalCostBasis} {cost.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {cost.knownCount} costed
          {costNotes.length > 0 ? ` · ${costNotes.join(" · ")}` : ""}
        </span>
      </div>
      {/* Copies in scope that are gone (#396): disposed after delivery, or never arrived in usable
          form. Only shown when there are some — a permanent 0.00 row would put a loss on every
          screen that has never had one. It carries a **cost** and no catalog value on purpose: a
          copy that is gone is worth nothing to its owner however the catalog prices it, but it did
          cost what it cost, and dropping that would flatter what the purchases achieved. */}
      {writeOff.count > 0 && (
        <div style={ROW_STYLE}>
          <span style={{ ...LABEL_STYLE, color: "var(--color-error)" }}>Written off</span>
          <span style={{ ...AMOUNT_STYLE, color: "var(--color-error)" }}>
            −{writeOff.cost.totalCostBasis} {writeOff.cost.baseCurrency}
          </span>
          <span style={NOTE_STYLE}>
            {writeOff.count} no longer held
            {writeOffNotes.length > 0 ? ` · ${writeOffNotes.join(" · ")}` : ""}
          </span>
        </div>
      )}
      {/* What the same copies have since fetched (#559) — a rule under them, because the rows above
          are what this scope *is worth* and the rows below what it has *made*. */}
      {ret && ret.soldCount > 0 && (
        <>
          <hr
            style={{
              margin: "0.25rem 0",
              border: 0,
              borderTop: "1px solid var(--color-border)",
            }}
          />
          <ReturnRows ret={ret} />
        </>
      )}
    </div>
  );
}
