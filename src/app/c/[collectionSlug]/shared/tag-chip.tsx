"use client";

import type { TagSummary } from "@/lib/tags";
import { tagColorTokens } from "@/lib/tag-colors";
import { STAMP_SECONDARY_CHIP } from "./chip-styles";
import { Tooltip } from "./tooltip";

// The collector's own labels (#152), wherever the thing carrying them is drawn — the Issues list,
// the stamp tree inside it, the flat Stamps list, and the issue's and stamp's own screens.
//
// **The name is the chip and the colour is the chip's tint.** A tag has no abbreviation and nothing
// shorter to fall back on, which is why these read in the app's own font rather than the monospace
// every catalog-number chip beside them uses: a catalog number is a code, a tag is a word.
//
// **The tag rides on the row rather than being looked up per chip**, which is the one place this
// departs from #728's rule for the condition and certificate chips. There the row already carries
// the label and only the *tint* is resolved from the cached dictionary, so a chip drawn before the
// dictionary arrives is right, only quieter. A tag chip has no label of its own to draw, so the
// same arrangement would put a row of empty boxes on screen until a second query landed. The cost
// is that renaming or recolouring a tag stales the Issues and Stamps caches — which is what the
// Settings panel invalidates, in one call it already has to make.
//
// **Nothing is inherited** (ADR-0010's own answer for catalogue attributes): these are the rows
// stored against this very thing. An issue's tags never appear on its stamps, and a parent stamp's
// never appear on its variants.

const CHIP: React.CSSProperties = {
  ...STAMP_SECONDARY_CHIP,
  fontFamily: "inherit",
  fontWeight: 500,
};

export function TagChip({
  tag,
  /** Slightly larger variant for the surfaces that size their chips up — the flat stamp list and
   *  the detail screens — mirroring `SubtypeChip` and `ColnectChip`. */
  size = "small",
}: {
  tag: TagSummary;
  size?: "small" | "medium";
}) {
  const tokens = tagColorTokens(tag.color);
  const medium = size === "medium";
  return (
    <Tooltip content={`Tag: ${tag.name}`}>
      <span
        style={{
          ...CHIP,
          color: tokens.color,
          borderColor: tokens.border,
          background: tokens.background,
          fontSize: medium ? "0.75rem" : "0.6875rem",
          padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
        }}
      >
        {tag.name}
      </span>
    </Tooltip>
  );
}

/** Every tag on one thing. Renders **nothing at all** when there are none — which is the normal
 *  case, and an empty marker repeated down every row of a list is a column saying nothing. */
export function TagChips({
  tags,
  size = "small",
}: {
  tags: TagSummary[];
  size?: "small" | "medium";
}) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} size={size} />
      ))}
    </>
  );
}
