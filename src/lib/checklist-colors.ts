// The colour each of an issue's checklists is drawn in on the Issues list (#1519): the chip on a
// stamp row naming the checklists it is on, the checklist filter chip that selects it (#772), and
// the heading of its branch in tree mode (#1520).
//
// **By position in the issue's own checklist order, never stored.** The order is the collector's
// and is already load-bearing (the first checklist is the one a new stamp joins), so the same
// checklist reads in the same colour every time the issue is opened, without a column nobody would
// ever set by hand. Reordering the checklists recolours them, which is the honest reading: the
// colour says *which of this issue's sets*, not anything about the set itself.
//
// The hues are the tag palette's (#728), so they are already defined for both themes in
// `globals.css`. Red and slate are left out: red reads as an error beside the warning chips on the
// same row, and slate is the neutral chip every other row already carries. A chip is told apart by
// its name as well as its colour, so an issue with more checklists than hues simply repeats them.
//
// Pure — no Prisma, no React — so the rule is unit-tested on its own.

import { tagColorTokens, type TagColor, type TagColorTokens } from "./tag-colors";

export const CHECKLIST_HUES: readonly TagColor[] = [
  "blue",
  "amber",
  "teal",
  "violet",
  "pink",
  "green",
  "orange",
  "indigo",
];

/** The hue of the checklist at `index` in its issue's order. */
export function checklistHue(index: number): TagColor {
  return CHECKLIST_HUES[((index % CHECKLIST_HUES.length) + CHECKLIST_HUES.length) % CHECKLIST_HUES.length];
}

/** Each checklist's tokens, keyed by id, from the issue's checklists **in the issue's order**. */
export function checklistColorMap(checklists: readonly { id: string }[]): Map<string, TagColorTokens> {
  return new Map(checklists.map((c, i) => [c.id, tagColorTokens(checklistHue(i))]));
}
