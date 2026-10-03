import { faultReducedTotalHint, faultReductionNote } from "@/lib/fault-reduction";
import { Tooltip } from "./tooltip";

/**
 * The mark beside a figure lowered for a copy's faults (#1560): *−40 %*, in the fault chip's warning
 * tone, so the figure says it is reduced on sight. The full figure is the surrounding hover's to
 * name — this is only the flag. The note is spelled out for a screen reader.
 */
export function FaultReductionMark({ percent }: { percent: number }) {
  return (
    <span
      aria-label={faultReductionNote(percent)}
      style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        color: "var(--color-warning)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      −{percent} %
    </span>
  );
}

/**
 * The note a **total** carries when some of its copies were lowered for their faults (#1560): how
 * many, with the figure the total would be without the reductions in the hover. Nothing when none
 * was, so a surface can render it unconditionally. Starts with its own separator unless told not
 * to, to sit at the end of a row's existing note.
 */
export function FaultReducedNote({
  reducedCount,
  totalBaseAmount,
  reductionBaseAmount,
  baseCurrency,
  separator = true,
}: {
  reducedCount: number;
  totalBaseAmount: string;
  reductionBaseAmount: string;
  baseCurrency: string;
  /** Lead with ` · `, to follow a row's existing note. False where the note stands alone. */
  separator?: boolean;
}) {
  const hint = faultReducedTotalHint(
    reducedCount,
    totalBaseAmount,
    reductionBaseAmount,
    baseCurrency
  );
  if (!hint) return null;
  return (
    <>
      {separator && " · "}
      <Tooltip content={hint}>
        <span style={{ color: "var(--color-warning)" }}>
          {reducedCount} lowered for faults
        </span>
      </Tooltip>
    </>
  );
}
