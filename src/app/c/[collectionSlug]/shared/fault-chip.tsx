"use client";

import type { FaultSummary } from "@/lib/faults";
import { STAMP_SECONDARY_CHIP } from "./chip-styles";
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
  /** The larger variant for the copy's own screen, as `TagChip` sizes up there. */
  size?: "small" | "medium";
}) {
  const medium = size === "medium";
  return (
    <Tooltip content={`Fault: ${fault.name}`}>
      <span
        style={{
          ...CHIP,
          fontSize: medium ? "0.75rem" : "0.6875rem",
          padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
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
  size?: "small" | "medium";
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
