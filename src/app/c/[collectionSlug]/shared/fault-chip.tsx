"use client";

import type { FaultSummary } from "@/lib/faults";
import { CHIP_SIZE, STAMP_SECONDARY_CHIP, type ChipSize } from "./chip-styles";
import { Tooltip } from "./tooltip";

// A copy's faults (#1557), on its Copies row and on its own screen beside the condition.
//
// **The tag chip's shape in the warning tint**, in the app's own font: a word (*Thinned gum*) reads
// as a word rather than as the monospace code a catalogue number is, and the tint is what keeps a
// fault from passing for an uncoloured tag beside it on the same line — a fault has no colour of its
// own to choose, and every one of them is something a buyer must be told. The name rides on the
// row, so the chip never waits on the dictionary.

const CHIP: React.CSSProperties = {
  ...STAMP_SECONDARY_CHIP,
  fontFamily: "inherit",
  fontWeight: 500,
  color: "var(--color-warning)",
  borderColor: "var(--color-warning-border)",
  background: "var(--color-warning-soft)",
};

export function FaultChip({
  fault,
  size = "small",
}: {
  fault: FaultSummary;
  /** The size of the chips it stands beside, as `TagChip` takes it: `row` on the Copies row, beside
   *  the condition, and `medium` on the copy's own screen. */
  size?: ChipSize;
}) {
  return (
    <Tooltip content={`Fault: ${fault.name}`}>
      <span
        style={{
          ...CHIP,
          ...CHIP_SIZE[size],
        }}
      >
        {fault.name}
      </span>
    </Tooltip>
  );
}

/** Every fault on one copy. Renders **nothing at all** when there are none, which is the normal
 *  case — the tag chips' rule. */
export function FaultChips({
  faults,
  size = "small",
}: {
  faults: FaultSummary[];
  size?: ChipSize;
}) {
  if (faults.length === 0) return null;
  return (
    <>
      {faults.map((f) => (
        <FaultChip key={f.id} fault={f} size={size} />
      ))}
    </>
  );
}
