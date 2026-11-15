"use client";

import {
  lineHoldingsLabel,
  showsHoldings,
  type LineHoldings,
} from "@/lib/lot-line-holdings";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

// **What you already have of an auction lot line's stamp** (#2543): *held 2*, *held 2 · 1 on the
// way*. The figure the *Recommended* popover states as *you hold N*, put on the line itself so a
// screen of lots can be read for it without opening one popover per lot.
//
// The chip counts the line's **own** condition — every condition it may be in while that is open
// (#1623) — because a different condition is a different purchase decision. The tooltip lists every
// condition held, the line's own first, so an MH copy against an MNH line is seen all the same.
// A line with nothing at its own condition draws no chip, the copy-count badge's rule (#348).
//
// Information only, as the popover's figure is (ADR-0029 §7): it moves no bid. Hover previews,
// click opens the copies of the stamp — the copy-count badge's split (#721).

/** The copy-count badge's tint: green is what *you hold this* is drawn in everywhere. */
const CHIP: React.CSSProperties = {
  ...STAMP_SECONDARY_CHIP,
  display: "inline-flex",
  alignItems: "center",
  fontFamily: "inherit",
  lineHeight: "inherit",
  fontWeight: 600,
  color: "var(--color-disposition-collection)",
  borderColor: "var(--color-disposition-collection-border)",
  background: "var(--color-disposition-collection-soft)",
};

const PANEL_HEADING: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
};

const NOTE: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

export function LineHoldingsChip({
  holdings,
  onOpenCopies,
}: {
  holdings: LineHoldings | null;
  /** Opens the copies of the line's stamp. Omitted where there is nothing to open; the chip is then
   *  a plain span that previews on hover. */
  onOpenCopies?: () => void;
}) {
  if (!showsHoldings(holdings)) return null;
  const text = lineHoldingsLabel(holdings);
  const label = onOpenCopies ? `${text} — view the copies` : text;

  const panel = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={PANEL_HEADING}>Copies of this stamp</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto auto",
          columnGap: "0.75rem",
          rowGap: "0.2rem",
          fontSize: "0.75rem",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span />
        <span style={NOTE}>Held</span>
        <span style={NOTE}>On the way</span>
        {holdings.conditions.map((c) => (
          <Row key={c.conditionId} label={c.abbreviation || c.name} own={c.own} held={c.held} onTheWay={c.onTheWay} />
        ))}
      </div>
      <div style={NOTE}>
        The chip counts the line&rsquo;s own condition, in bold. On the way is bought and not yet
        arrived. Shown as information — it does not change the recommended bid.
      </div>
    </div>
  );

  return (
    <Tooltip content={panel} maxWidth="20rem" align="start" style={{ flexShrink: 0 }}>
      {onOpenCopies ? (
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onOpenCopies();
          }}
          style={{ ...CHIP, cursor: "pointer" }}
        >
          {text}
        </button>
      ) : (
        <span role="img" aria-label={label} style={CHIP}>
          {text}
        </span>
      )}
    </Tooltip>
  );
}

function Row({ label, own, held, onTheWay }: { label: string; own: boolean; held: number; onTheWay: number }) {
  const weight = own ? 700 : 400;
  return (
    <>
      <span style={{ fontWeight: weight }}>{label}</span>
      <span style={{ fontWeight: weight, textAlign: "right" }}>{held || "—"}</span>
      <span style={{ fontWeight: weight, textAlign: "right" }}>{onTheWay || "—"}</span>
    </>
  );
}

/** The mark on a lot's header while it is collapsed (#2543): some line of it is of a stamp you
 *  already have at that line's condition, so a closed lot is not missed. */
export function LotHoldsCopiesMark() {
  return (
    <Tooltip content="Some of this lot's stamps you already have — held, or bought and on the way. Its lines say which.">
      <span
        role="img"
        aria-label="Holds stamps you already have"
        style={{
          ...CHIP,
          padding: "0 0.3rem",
          gap: "0.2rem",
        }}
      >
        <Icon name="check" size="xs" />
        held
      </span>
    </Tooltip>
  );
}
