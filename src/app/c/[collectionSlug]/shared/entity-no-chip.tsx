"use client";

import { formatEntityNo, quickJumpLabel, type QuickJumpEntity } from "@/lib/quick-jump";
import { Tooltip } from "./tooltip";

/** The short per-collection number of an issue, purchase, sale or auction lot (#432), on the row
 * that entity owns.
 *
 * One component rather than four copies of the same span, because the point of these numbers is
 * that they read the same everywhere: the quick-jump box (#431) takes exactly what is on screen,
 * and a number that renders differently per screen would be a number one has to look twice at.
 *
 * Monospace and muted, like the copy number's chip (#268): it identifies the row rather than
 * describing what is on it. Unpadded — padding is a copy-number affordance, for a column of stock
 * cards that has to line up.
 *
 * The tooltip names the prefix, which is where a collector learns the box exists at all. */
export function EntityNoChip({
  entity,
  no,
  prefix,
}: {
  entity: QuickJumpEntity;
  no: number;
  /** The quick-jump prefix for this entity, e.g. `p`. Passed rather than looked up so the tooltip
   * cannot drift from the table if one is ever renamed. */
  prefix: string;
}) {
  return (
    <Tooltip content={`Internal ${quickJumpLabel(entity)} number — jump here by typing "${prefix} ${no}"`}>
      <span
        style={{
          fontSize: "0.75rem",
          fontVariantNumeric: "tabular-nums",
          fontFamily: "monospace",
          color: "var(--color-text-muted)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {formatEntityNo(no)}
      </span>
    </Tooltip>
  );
}
