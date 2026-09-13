/**
 * Which copies a stamp's copy count stands for (#1243): the held copies broken down, under each
 * disposition, by **condition × certificate × format** — one line per combination held.
 *
 * Combinations rather than three separate tallies, because separate tallies cannot say *which*
 * condition carries the certificate: "2 MNH, 1 U, 1 signed" leaves the one question that decides an
 * upgrade unanswered. The lines are what the copy count chip's hover panel draws.
 *
 * Pure, and deliberately not part of `copy-counts.ts`: that module is `server-only`, and the rolling
 * up happens in the client component that also holds the dictionaries the lines are ordered by.
 */

/** One `(condition × certificate × format × disposition-combination)` bucket of held copies, as the
 *  database groups them. The three flags are the combination a copy carries, so a copy both in the
 *  collection and for sale is one row with both set — never two rows. `null` is each axis's own
 *  unmarked default: *no certificate* (ADR-0006 §2) and *single* (ADR-0020). */
export interface StampCopyLine {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  count: number;
}

/** The disposition groups, in the order the copy rows list the markers, followed by the copies
 *  carrying none. A line joins every group whose marker it carries — the markers overlap — so the
 *  groups are listed, never summed. */
export const COPY_BREAKDOWN_GROUPS = ["inCollection", "forSale", "forTrade", "unmarked"] as const;
export type CopyBreakdownGroupKey = (typeof COPY_BREAKDOWN_GROUPS)[number];

/** One combination held under one disposition: this stamp's own copies, and its variants' kept in
 *  their own figure — the two are never added together (#528). */
export interface CopyBreakdownLine {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  own: number;
  variant: number;
}

export interface CopyBreakdownGroup {
  key: CopyBreakdownGroupKey;
  /** The sum of the lines' `own` — the group's total *is* its lines, so the two cannot disagree. */
  own: number;
  /** The sum of the lines' `variant`. */
  variant: number;
  lines: CopyBreakdownLine[];
}

/** The dictionaries' ids in their configured order — what the lines are sorted by. */
export interface CopyBreakdownOrder {
  conditionIds: readonly string[];
  certificateStatusIds: readonly string[];
  formatIds: readonly string[];
}

function inGroup(line: StampCopyLine, key: CopyBreakdownGroupKey): boolean {
  if (key === "unmarked") return !line.inCollection && !line.forSale && !line.forTrade;
  return line[key];
}

function comboKey(line: { conditionId: string; certificateStatusId: string | null; formatId: string | null }) {
  // `~` cannot occur in a cuid, and the empty segment is the null default.
  return `${line.conditionId}~${line.certificateStatusId ?? ""}~${line.formatId ?? ""}`;
}

/**
 * Folds several stamps' lines into one list, adding up the rows that describe the same combination
 * and the same markers — what the variant figure (#528) needs, since it sums copies across every
 * counting descendant.
 */
export function mergeCopyLines(lists: readonly (readonly StampCopyLine[])[]): StampCopyLine[] {
  const merged = new Map<string, StampCopyLine>();
  for (const list of lists) {
    for (const line of list) {
      const key = `${comboKey(line)}~${+line.inCollection}${+line.forSale}${+line.forTrade}`;
      const current = merged.get(key);
      if (current) current.count += line.count;
      else merged.set(key, { ...line });
    }
  }
  return [...merged.values()];
}

/**
 * Where an id sits in its dictionary's order. The unmarked default (`null`) leads — it is the plain
 * copy the others are variations on — and an id the dictionary does not hold goes last rather than
 * throwing the rest out of order.
 */
function rank(order: readonly string[], id: string | null): number {
  if (id === null) return -1;
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}

/**
 * The breakdown the hover panel draws: one group per disposition present, each listing the
 * combinations held under it. Lines follow the order conditions, certificates and formats have in
 * their settings — condition first, then certificate, then format — never a count or an alphabet.
 * A group with nothing in it on either side is left out.
 */
export function breakDownCopies(
  own: readonly StampCopyLine[],
  variant: readonly StampCopyLine[],
  order: CopyBreakdownOrder
): CopyBreakdownGroup[] {
  const groups: CopyBreakdownGroup[] = [];
  for (const key of COPY_BREAKDOWN_GROUPS) {
    const lines = new Map<string, CopyBreakdownLine>();
    const add = (line: StampCopyLine, side: "own" | "variant") => {
      if (!inGroup(line, key) || line.count === 0) return;
      const k = comboKey(line);
      let entry = lines.get(k);
      if (!entry) {
        entry = {
          conditionId: line.conditionId,
          certificateStatusId: line.certificateStatusId,
          formatId: line.formatId,
          own: 0,
          variant: 0,
        };
        lines.set(k, entry);
      }
      entry[side] += line.count;
    };
    for (const line of own) add(line, "own");
    for (const line of variant) add(line, "variant");
    if (lines.size === 0) continue;

    const sorted = [...lines.values()].sort(
      (a, b) =>
        rank(order.conditionIds, a.conditionId) - rank(order.conditionIds, b.conditionId) ||
        rank(order.certificateStatusIds, a.certificateStatusId) -
          rank(order.certificateStatusIds, b.certificateStatusId) ||
        rank(order.formatIds, a.formatId) - rank(order.formatIds, b.formatId) ||
        comboKey(a).localeCompare(comboKey(b))
    );
    groups.push({
      key,
      own: sorted.reduce((n, l) => n + l.own, 0),
      variant: sorted.reduce((n, l) => n + l.variant, 0),
      lines: sorted,
    });
  }
  return groups;
}

/**
 * What a line names, axis by axis. The condition always; the certificate and the format **only when
 * they are not the default** — *MNH — 2* reads as two plain single MNH copies, and a line only grows
 * when there is something to say.
 */
export function copyLineParts(line: {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}): ({ axis: "condition"; id: string } | { axis: "certificate"; id: string } | { axis: "format"; id: string })[] {
  return [
    { axis: "condition" as const, id: line.conditionId },
    ...(line.certificateStatusId !== null
      ? [{ axis: "certificate" as const, id: line.certificateStatusId }]
      : []),
    ...(line.formatId !== null ? [{ axis: "format" as const, id: line.formatId }] : []),
  ];
}
