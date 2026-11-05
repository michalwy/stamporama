"use client";

import { useMemo } from "react";
import { issueFormatChipView, type StampIssueFormatLabel } from "@/lib/stamp-issue-format-defaults";
import { tagColorTokens } from "@/lib/tag-colors";
import { CHIP_SIZE, STAMP_SECONDARY_CHIP } from "./chip-styles";
import { useCollectionIssueFormats } from "./use-issue-formats";
import { Tooltip } from "./tooltip";

// A stamp's issue format (#2439) as the chip every stamp row and copy row draws beside the
// catalogue numbers (#2441): *Bl*, *MS*, *HBl* — the abbreviation, the full name on hover.
//
// **An ordinary stamp draws nothing.** No issue format is the unmarked case, as a single is for the
// copy's format and the default subtype is for `SubtypeChip`, so a chip on every ordinary row would
// say nothing and make the rows heavy.
//
// **The colour is looked up from the cached dictionary, not carried on the row** — the condition
// chip's reason (#728, `dictionary-chip.tsx`): the rows carry the stamp's `issueFormatId`, the
// dictionary is a handful of entries behind one query the Settings panel invalidates, and a recolour
// then reaches every row without a read model having copied the old colour into a payload.
//
// **It is drawn unlike the copy's format chip** (*Blk4*, a block of four), so a souvenir sheet is
// never read as a multiple: the format chip is the neutral `ROW_CHIP` on the copy's condition line,
// this one is a catalogue-line chip in the format's own colour, beside the numbers it qualifies.

function chipStyle(color: string | null | undefined, size: "small" | "medium"): React.CSSProperties {
  const tokens = tagColorTokens(color);
  return {
    ...STAMP_SECONDARY_CHIP,
    ...CHIP_SIZE[size],
    fontFamily: "inherit",
    fontWeight: 600,
    color: tokens.color,
    borderColor: tokens.border,
    background: tokens.background,
  };
}

export function IssueFormatChip({
  collectionId,
  issueFormatId,
  /** What a row that already has the stamp's label resolved can draw while the dictionary is still
   *  loading — a chip that appears late is a row that moves under the reader. */
  fallback,
  /** `medium` where the surface sizes its chips up (the flat stamp list, the detail screens), as
   *  `SubtypeChip` and `ColnectChip` do. */
  size = "small",
}: {
  collectionId: string;
  /** Null is an ordinary stamp, which draws no chip. */
  issueFormatId: string | null | undefined;
  fallback?: StampIssueFormatLabel | null;
  size?: "small" | "medium";
}) {
  const { data: formats } = useCollectionIssueFormats(collectionId);
  const chip = useMemo(
    () => issueFormatChipView(issueFormatId, formats, fallback),
    [issueFormatId, formats, fallback]
  );
  if (!chip) return null;
  return (
    <Tooltip content={`Issue format: ${chip.name}`}>
      <span style={chipStyle(chip.color, size)}>{chip.label}</span>
    </Tooltip>
  );
}
