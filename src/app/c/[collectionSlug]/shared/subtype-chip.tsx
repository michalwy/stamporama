"use client";

import { STAMP_SECONDARY_CHIP } from "./chip-styles";
import { Tooltip } from "./tooltip";

// The subtype tag shown next to a stamp's identity wherever stamps are listed or picked (#340):
// the issue tree, the flat stamp list, the inventory list and the stamp pickers.
//
// **The collection's default subtype renders nothing.** The default is the unmarked case — most
// child stamps are ordinary variants — so badging every one of them "Variant" would add a column of
// noise that says nothing. A base stamp has no subtype at all and likewise shows none. The same rule
// governs the `{subtype}` token (#339), so what a row shows and what a listing prints agree.
//
// Which subtype is default is the collector's choice (Settings → Subtypes), so a collection that
// wants "Variant" visible can make something else the default instead.

/** The shape every list's row already carries: the subtype's name and whether it is the collection
 * default. Null when the stamp has no subtype (a base stamp). */
export interface StampSubtypeLabel {
  name: string;
  isDefault: boolean;
}

const CHIP: React.CSSProperties = {
  ...STAMP_SECONDARY_CHIP,
  fontFamily: "inherit",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
};

export function SubtypeChip({
  subtype,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up (mirrors
   * `ColnectChip`). */
  size = "small",
}: {
  subtype: StampSubtypeLabel | null | undefined;
  size?: "small" | "medium";
}) {
  if (!subtype || subtype.isDefault) return null;
  const medium = size === "medium";
  return (
    <Tooltip content={`Subtype: ${subtype.name}`}>
      <span
        style={{
          ...CHIP,
          fontSize: medium ? "0.75rem" : "0.6875rem",
          padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
        }}
      >
        {subtype.name}
      </span>
    </Tooltip>
  );
}
