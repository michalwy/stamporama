// How the Copies list's grouping control describes itself (#372, #421, #424, #868) — the pure half,
// so the label the closed dropdown reads is a function the unit tests can pin rather than a string
// built inline in a 2 000-line panel.
//
// The control is **one dropdown carrying its own sub-controls** (#868). That shape is what forces
// the summary below: the two *Split by …* switches live inside the panel, so with the panel shut
// there has to be somewhere for them to show, and the trigger is a fixed-width box on a bar already
// carrying eleven controls. Hence the same rule `MultiSelectFilter` uses on its trigger — name the
// one, count the many — rather than concatenating both switch labels.

import type { CopyGroupAxes } from "./copy-groups";

/** The readings of the Copies list, exactly one of which can be in effect. `ref` is the filing
 * grouping walked by what is written on the location rather than by the location itself. */
export type CopyGroupMode = "none" | "duplicates" | "location" | "ref" | "issue";

export const COPY_GROUP_MODES: CopyGroupMode[] = [
  "none",
  "duplicates",
  "location",
  "ref",
  "issue",
];

/** What each mode is called in the dropdown's own option list, where there is room to say it in
 * full. The trigger may say something shorter — see {@link describeCopyGrouping}. */
export const COPY_GROUP_MODE_LABEL: Record<CopyGroupMode, string> = {
  none: "No grouping",
  duplicates: "Group duplicates",
  location: "Group by location",
  ref: "Group by location ref",
  issue: "Group by issue",
};

/**
 * The longest string the control may put in its closed trigger, in characters — the option labels
 * and every summary {@link describeCopyGrouping} can produce alike.
 *
 * It is a **budget, not a measurement**: the trigger is a fixed 14rem box (#868), and at the
 * toolbar's 0.8125rem that holds about this much before the ellipsis starts eating the part of the
 * label that says what is on. Nothing enforces it at runtime — a longer label simply truncates —
 * so it is pinned by a unit test instead, and a new grouping mode or a third split that fails that
 * test wants the trigger widened rather than the assertion relaxed.
 */
export const COPY_GROUPING_LABEL_BUDGET = 24;

/** A stored preference that is no longer a mode reads as no grouping rather than as a broken
 * screen — the same rule an unrecognised delivery state follows (#425). */
export function asCopyGroupMode(value: string): CopyGroupMode {
  return (COPY_GROUP_MODES as string[]).includes(value) ? (value as CopyGroupMode) : "none";
}

/**
 * What the closed dropdown reads. The splits only join the duplicate key, so they are the only
 * thing that can qualify a mode, and they are summarised rather than listed: with both on,
 * `Duplicates + format + certificate` is half again as wide as the box it has to fit in.
 */
export function describeCopyGrouping(mode: CopyGroupMode, axes: CopyGroupAxes): string {
  if (mode !== "duplicates") return COPY_GROUP_MODE_LABEL[mode];
  const splits = [axes.format ? "format" : null, axes.certificate ? "certificate" : null].filter(
    (s): s is string => s !== null
  );
  if (splits.length === 0) return COPY_GROUP_MODE_LABEL.duplicates;
  if (splits.length === 1) return `Duplicates + ${splits[0]}`;
  return `Duplicates + ${splits.length} splits`;
}

/**
 * Why the sort control cannot be honoured under a grouping, or `null` while it can.
 *
 * Every grouping brings **its own** total order — duplicate groups by how many copies each holds
 * (#372), the filing groups by location path and ref (`location-groups.ts`), issue groups by the
 * Issues list's own reading order (#181, `issue-groups.ts`) — and each is applied server-side
 * because paging over it must neither repeat nor skip a group. So there is nothing for a sort
 * choice to do.
 *
 * It reads as a **reason on a control that is still there** rather than as the control vanishing
 * (#868): a sort group that disappears the moment a grouping is picked takes about ten characters'
 * width off the bar with it, moves everything beside it, and leaves the collector to work out for
 * themselves where their ordering went.
 */
export function copyGroupingSortReason(mode: CopyGroupMode): string | null {
  switch (mode) {
    case "none":
      return null;
    case "duplicates":
      return "Grouped lists carry their own order. Duplicate groups are ordered by how many copies each holds.";
    case "location":
    case "ref":
      return "Grouped lists carry their own order. Filing groups are ordered by where the copies are kept.";
    case "issue":
      return "Grouped lists carry their own order. Issue groups follow the Issues list's own reading order.";
  }
}
