import type { ValueModifier } from "@/lib/valuation";
import { valueModifierLabel } from "@/lib/value-modifier";

/**
 * The mark beside a figure adjusted by a copy's value modifier (#2357): *+200 %*, *+5.00*, in the
 * accent tone so it never reads as the fault reduction's warning beside it. The catalogue figure and
 * the note are the surrounding hover's to name — this is only the flag. Spelled out, note included,
 * for a screen reader.
 */
export function ValueModifierMark({
  modifier,
  currency,
}: {
  modifier: ValueModifier;
  /** The currency of the figure it adjusts, for the screen reader's reading of the amount. */
  currency: string | null;
}) {
  const label = valueModifierLabel(modifier, currency);
  return (
    <span
      aria-label={`Value modifier ${label}${modifier.note ? `, ${modifier.note}` : ""}`}
      style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        color: "var(--color-accent)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {valueModifierLabel(modifier, null)}
    </span>
  );
}
