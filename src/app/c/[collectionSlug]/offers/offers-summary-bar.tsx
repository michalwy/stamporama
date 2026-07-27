"use client";

import type { OffersSummary } from "@/lib/offers";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// Summary bar for the offer list (#317), over the currently filtered offers. It leads with the one
// figure the toolbar cannot already give: the **asking value** — what the filtered offers would
// bring in at their listed prices, in the base currency. Counts per state live in the filter chips
// (#332), so repeating them here would be noise.
//
// Expanding adds the two figures that put the asking value in context — the catalog value and the
// purchase cost of the copies under those offers, the same pair the holdings bar shows (#134) —
// and a per-platform breakdown. They are behind the expander because they cost a valuation pass to
// read and answer a question ("am I pricing this right?") that is occasional, not per-visit.

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  // Fixed width so every row's amount lines up in a column.
  width: "7.5rem",
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

const TOGGLE_STYLE: React.CSSProperties = {
  marginLeft: "auto",
  flexShrink: 0,
  alignSelf: "center",
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  padding: "0.125rem 0.375rem",
  border: "none",
  borderRadius: "0.25rem",
  background: "transparent",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
};

/** The breakdown is a grid rather than a row of flex items so the three amount columns sit in a
 * fixed block on the **left**, right next to the platform name — on a wide screen a right-aligned
 * far edge means reading across empty space to pair a figure with its platform. The first two
 * columns match the totals above (`LABEL_STYLE` width + the same gap), so a platform's asking value
 * lands directly under the total asking value. */
const PLATFORM_GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "9rem repeat(3, 8rem) minmax(0, 1fr)",
  columnGap: "0.75rem",
  rowGap: "0.25rem",
  alignItems: "baseline",
};

const PLATFORM_HEAD_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  textAlign: "right",
};

const PLATFORM_NAME_STYLE: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const PLATFORM_AMOUNT_STYLE: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
};

const PLATFORM_NOTE_STYLE: React.CSSProperties = {
  ...NOTE_STYLE,
  fontSize: "0.75rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const DIVIDER_STYLE: React.CSSProperties = {
  height: "1px",
  background: "var(--color-border)",
  margin: "0.25rem 0",
};

/** A shimmering placeholder block. ` ` keeps the span on the text baseline so its line box
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

function SkeletonRow() {
  return (
    <div style={ROW_STYLE}>
      <SkeletonBlock style={LABEL_STYLE} />
      <SkeletonBlock style={AMOUNT_STYLE} />
      <SkeletonBlock style={{ ...NOTE_STYLE, width: "8rem" }} />
    </div>
  );
}

/** Loading placeholder. Mirrors the loaded structure in the *current* mode — same frame, same
 * per-span font sizes — so the bar reserves its final height and the toolbar below it does not
 * shift when the figures arrive (#151). The expanded breakdown stands in with a single platform
 * line: how many platforms there are is exactly what has not loaded yet. */
function OffersSummaryBarSkeleton({ expanded }: { expanded: boolean }) {
  return (
    <div style={FRAME_STYLE} aria-hidden>
      <SkeletonRow />
      {expanded && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <div style={DIVIDER_STYLE} />
          <div style={PLATFORM_GRID_STYLE}>
            <SkeletonBlock style={{ ...PLATFORM_HEAD_STYLE, textAlign: "left" }} />
            <SkeletonBlock style={PLATFORM_HEAD_STYLE} />
            <SkeletonBlock style={PLATFORM_HEAD_STYLE} />
            <SkeletonBlock style={PLATFORM_HEAD_STYLE} />
            <span />
            <SkeletonBlock style={PLATFORM_NAME_STYLE} />
            <SkeletonBlock style={PLATFORM_AMOUNT_STYLE} />
            <SkeletonBlock style={PLATFORM_AMOUNT_STYLE} />
            <SkeletonBlock style={PLATFORM_AMOUNT_STYLE} />
            <span />
          </div>
        </>
      )}
    </div>
  );
}

/** One platform's line in the breakdown: the same three figures as the total, then the counts
 * behind them. A Fragment, not a wrapper — the cells are direct children of the grid, so the
 * columns line up across every platform. */
function PlatformRow({ platform }: { platform: OffersSummary["platforms"][number] }) {
  const notes: string[] = [
    `${platform.offerCount} ${platform.offerCount === 1 ? "offer" : "offers"}`,
    `${platform.setCount} sets`,
    `${platform.itemCount} copies`,
  ];
  if (platform.unpricedCount > 0) notes.push(`${platform.unpricedCount} not priced yet`);
  if (platform.unconvertibleCount > 0) {
    notes.push(`${platform.unconvertibleCount} not convertible`);
  }
  if (platform.holdings.unpricedCount > 0) {
    notes.push(`${platform.holdings.unpricedCount} without catalog value`);
  }
  const note = notes.join(" · ");

  return (
    <>
      <span style={PLATFORM_NAME_STYLE} title={platform.platformName}>
        {platform.platformName}
      </span>
      <span style={PLATFORM_AMOUNT_STYLE}>{platform.askingBaseAmount}</span>
      <span style={PLATFORM_AMOUNT_STYLE}>{platform.holdings.totalBaseAmount}</span>
      <span style={PLATFORM_AMOUNT_STYLE}>{platform.holdings.cost.totalCostBasis}</span>
      <span style={PLATFORM_NOTE_STYLE} title={note}>
        {note}
      </span>
    </>
  );
}

/** Offer summary for the current filter set (#317). Collapsed it shows the asking value alone;
 * expanded it adds the catalog value and purchase cost of the copies under those offers, and the
 * per-platform split. The expanded/collapsed choice is a client preference remembered per
 * collection, like the list's own "show sold/withdrawn" toggle (#245). */
export function OffersSummaryBar({
  summary,
  collectionId,
}: {
  summary: OffersSummary | undefined;
  collectionId: string;
}) {
  const [expanded, setExpanded] = usePersistedFlag(
    `stamporama:offers:summaryExpanded:${collectionId}`
  );

  if (!summary) return <OffersSummaryBarSkeleton expanded={expanded} />;

  const askingNotes: string[] = [`${summary.setCount} sets`, `${summary.itemCount} copies`];
  if (summary.unpricedCount > 0) askingNotes.push(`${summary.unpricedCount} not priced yet`);
  if (summary.unconvertibleCount > 0) {
    askingNotes.push(`${summary.unconvertibleCount} not convertible to ${summary.baseCurrency}`);
  }

  const holdings = summary.holdings;
  const valuationNotes: string[] = [];
  if (holdings.uncertainCount > 0) {
    valuationNotes.push(
      `includes ~${holdings.uncertainBaseAmount} ${holdings.baseCurrency} uncertain (${holdings.uncertainCount} unknown-variant)`
    );
  }
  if (holdings.unpricedCount > 0) valuationNotes.push(`${holdings.unpricedCount} unpriced`);
  if (holdings.unconvertibleCount > 0) {
    valuationNotes.push(
      `${holdings.unconvertibleCount} not convertible to ${holdings.baseCurrency}`
    );
  }

  const cost = holdings.cost;
  const costNotes: string[] = [];
  if (cost.pendingCount > 0) costNotes.push(`${cost.pendingCount} pending`);
  if (cost.noneCount > 0) costNotes.push(`${cost.noneCount} no cost recorded`);

  return (
    <div style={FRAME_STYLE}>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Asking value</span>
        <span style={AMOUNT_STYLE}>
          {summary.askingBaseAmount} {summary.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {summary.offerCount} {summary.offerCount === 1 ? "offer" : "offers"} ·{" "}
          {askingNotes.join(" · ")}
        </span>
        <Tooltip
          content={
            expanded
              ? "Hide the catalog value, purchase cost, and per-platform split"
              : "Show the catalog value, purchase cost, and per-platform split"
          }
          align="end"
        >
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            style={TOGGLE_STYLE}
          >
            {expanded ? "Less" : "More"}
            <span aria-hidden>{expanded ? "▾" : "▸"}</span>
          </button>
        </Tooltip>
      </div>

      {expanded && (
        <>
          {/* The same pair the holdings bar shows (#134), here over the copies these offers hold —
              counted once each, however many offers list them. */}
          <div style={ROW_STYLE}>
            <span style={LABEL_STYLE}>Catalog value</span>
            <span style={AMOUNT_STYLE}>
              {holdings.totalBaseAmount} {holdings.baseCurrency}
            </span>
            <span style={NOTE_STYLE}>
              {holdings.pricedCount} priced
              {valuationNotes.length > 0 ? ` · ${valuationNotes.join(" · ")}` : ""}
            </span>
          </div>
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

          {summary.platforms.length > 0 && (
            <>
              <div style={DIVIDER_STYLE} />
              <div style={PLATFORM_GRID_STYLE}>
                <span style={{ ...PLATFORM_HEAD_STYLE, textAlign: "left" }}>
                  Platform · {summary.baseCurrency}
                </span>
                <span style={PLATFORM_HEAD_STYLE}>Asking</span>
                <span style={PLATFORM_HEAD_STYLE}>Catalog</span>
                <span style={PLATFORM_HEAD_STYLE}>Cost</span>
                <span />
                {summary.platforms.map((p) => (
                  <PlatformRow key={p.platformId} platform={p} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
