"use client";

import type { AuctionLotExposure } from "@/lib/auctions";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// Summary bar for the lot list (#523), over the currently filtered lots — the one question a live
// watchlist is worked against that no chip can answer: **how much of my money is this**.
//
// Two figures, because there are two answers and the gap between them is the decision. **Committed**
// is what is already at risk: every proxy maximum lodged with a platform, plus what the lots already
// won fetched, plus each parcel's shipping once. **At ceiling** is what carrying the same watchlist
// through to the collector's own ceilings would cost. The first is the number a budget is checked
// against today; the second is the number that says whether there is room to keep bidding.
//
// A ceiling is an **all-in** valuation already (ADR-0021 §6), so it is counted as it stands — the
// premium is never run over it a second time. Where a bid was placed past the ceiling, that bid is
// what counts: it is money committed whatever the valuation says. Where the *price* has gone past
// both the ceiling and that bid, the lot leaves both totals (#600) and is named in the note beside
// them: it can only be won by raising the ceiling, which has not been decided yet.
//
// Always in the **base currency**, unlike every other auction figure, which stays in the currency
// the bidding happens in (#498): a watchlist spans platforms, and a sum across two currencies is
// not a sum. Read whole through its own endpoint rather than added up from the loaded pages — a
// total that grows as you scroll is worse than none (#151).

const FRAME_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "1.5rem",
  flexWrap: "wrap",
  padding: "0.625rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const AMOUNT_STYLE: React.CSSProperties = {
  fontSize: "1.0625rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const CEILING_AMOUNT_STYLE: React.CSSProperties = {
  ...AMOUNT_STYLE,
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const NOTE_STYLE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** A shimmering placeholder block. `&nbsp;` keeps the span on the text baseline, so its line box is
 * the one the loaded figure will have. */
function SkeletonBlock({ style, width }: { style: React.CSSProperties; width: string }) {
  return (
    <span
      aria-hidden
      style={{
        ...style,
        width,
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

/** Loading placeholder in the loaded bar's own shape and font sizes, so the list below it does not
 * shift when the figures arrive (#151). */
function ExposureBarSkeleton() {
  return (
    <div style={FRAME_STYLE} aria-hidden>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <SkeletonBlock style={LABEL_STYLE} width="5rem" />
        <SkeletonBlock style={AMOUNT_STYLE} width="8rem" />
      </span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <SkeletonBlock style={LABEL_STYLE} width="5rem" />
        <SkeletonBlock style={CEILING_AMOUNT_STYLE} width="8rem" />
      </span>
      <SkeletonBlock style={NOTE_STYLE} width="7rem" />
    </div>
  );
}

function Figure({
  label,
  amount,
  currency,
  hint,
  amountStyle,
}: {
  label: string;
  amount: string;
  currency: string;
  hint: string;
  amountStyle: React.CSSProperties;
}) {
  return (
    <Tooltip content={hint}>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <span style={LABEL_STYLE}>{label}</span>
        <span style={amountStyle}>
          {amount} {currency}
        </span>
      </span>
    </Tooltip>
  );
}

export function AuctionExposureBar({ exposure }: { exposure: AuctionLotExposure | undefined }) {
  if (!exposure) return <ExposureBarSkeleton />;

  // Each note is either a plain reading of the set or one of the reasons a lot fell out of it.
  // Only the latter are tinted: a gap that makes the figures read low is worth the eye, while the
  // count of what was covered is just the caption.
  const notes: { text: string; warn: boolean }[] = [
    {
      text: `${exposure.payableCount} lot${exposure.payableCount === 1 ? "" : "s"} counted`,
      warn: false,
    },
  ];
  if (exposure.outpricedCount > 0) {
    // Not a gap in the data (#600) — these lots genuinely cost nothing at the ceiling recorded on
    // them, so the note is stated plainly rather than as a warning.
    notes.push({ text: `${exposure.outpricedCount} already past your ceiling`, warn: false });
  }
  if (exposure.uncappedCount > 0) {
    notes.push({ text: `${exposure.uncappedCount} with neither a bid nor a ceiling`, warn: true });
  }
  if (exposure.unconvertibleCount > 0) {
    notes.push({ text: `${exposure.unconvertibleCount} in a currency with no rate`, warn: true });
  }

  return (
    <div style={FRAME_STYLE}>
      <Figure
        label="Committed"
        amount={exposure.committedTotal}
        currency={exposure.baseCurrency}
        amountStyle={AMOUNT_STYLE}
        hint="What these lots cost if every bid you have placed wins at your own maximum — plus what the ones already won fetched, and each parcel's shipping once. A lot you have not bid on, or one whose price has already passed your ceiling, costs nothing here."
      />
      <Figure
        label="At ceiling"
        amount={exposure.ceilingTotal}
        currency={exposure.baseCurrency}
        amountStyle={CEILING_AMOUNT_STYLE}
        hint="The same, if every open lot is bid up to its ceiling. A ceiling is already an all-in figure, so it is counted as it stands; where your placed bid is higher, that is what counts. A lot the price has already carried past your ceiling is left out — it needs a new ceiling before it can cost you anything."
      />
      <span style={NOTE_STYLE}>
        {notes.map((note, i) => (
          <span key={note.text} style={note.warn ? { color: "var(--color-warning)" } : undefined}>
            {i > 0 ? " · " : ""}
            {note.text}
          </span>
        ))}
      </span>
    </div>
  );
}
