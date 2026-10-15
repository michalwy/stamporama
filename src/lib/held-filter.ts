// ── The Copies list's *Held* filter (#1932) ─────────────────────────────────
//
// Grouped by duplicates, the list shows one row per stamp with its count (`×1`, `×3`), and most rows
// are `×1`. This filter keeps the stacks of one size or the other, so a collector looking for what is
// held several times does not scroll past every single. The rule lives here, pure, so the server's
// narrowing and the tests count a stack by the very key duplicate grouping groups on
// (`copyGroupKey`) — the filter cannot come to disagree with the `×N` on screen.

import {
  copyGroupKey,
  encodeCopyGroupKey,
  type CopyGroupAxes,
  type GroupableCopy,
} from "./copy-groups";

/**
 * The filter's values. **Absent is *Any*** — the default, and not a value of its own, so an
 * untouched list and a cleared one key the same query (`MultiStampFilter`'s rule).
 *
 * - `once` — the stacks of exactly one copy.
 * - `several` — the stacks of two or more: *More than once*.
 */
export type HeldFilter = "once" | "several";

export const HELD_FILTERS: readonly HeldFilter[] = ["once", "several"];

/** Read a filter value off a query string or storage. Anything unrecognised is **no filter** rather
 *  than an unmatchable one: a stale or hand-edited link should show the list, not an empty screen. */
export function asHeldFilter(value: string | null | undefined): HeldFilter | undefined {
  return (HELD_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as HeldFilter)
    : undefined;
}

/** Whether a stack of `count` copies answers the filter. */
export function stackMatchesHeld(count: number, filter: HeldFilter): boolean {
  return filter === "once" ? count === 1 : count >= 2;
}

/**
 * The *Split by …* switches as the query string carries them for this filter — `heldSplit`, a
 * comma list of the axes that are on. Sent only while the list is grouped by duplicates: the
 * switches apply to that grouping alone, so anywhere else a stack is every copy of one stamp.
 */
export function heldSplitParam(axes: CopyGroupAxes): string {
  return (Object.keys(axes) as (keyof CopyGroupAxes)[]).filter((axis) => axes[axis]).join(",");
}

/** {@link heldSplitParam} read back; absent or empty is no switch on — one stack per stamp. */
export function readHeldSplit(value: string | null | undefined): CopyGroupAxes {
  const on = new Set((value ?? "").split(","));
  return { condition: on.has("condition"), format: on.has("format"), certificate: on.has("certificate") };
}

/**
 * The stacks that answer the filter, as encoded group keys: `counted` are the copies the stacks
 * are counted over — those every other filter lets through, carriers of several stamps already set
 * aside, exactly what duplicate grouping counts. A copy is then kept when its own key is among
 * these, which is how a read narrower than the counted set (one location's members) still keeps
 * the copies of the stacks the whole list kept.
 */
export function heldStackKeys(
  counted: readonly GroupableCopy[],
  axes: CopyGroupAxes,
  filter: HeldFilter
): Set<string> {
  const counts = new Map<string, number>();
  for (const copy of counted) {
    const key = encodeCopyGroupKey(copyGroupKey(copy, axes), axes);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].flatMap(([key, n]) => (stackMatchesHeld(n, filter) ? [key] : [])));
}

/** Whether one copy sits in a kept stack — {@link heldStackKeys}' other half. */
export function inHeldStack(
  copy: GroupableCopy,
  axes: CopyGroupAxes,
  kept: ReadonlySet<string>
): boolean {
  return kept.has(encodeCopyGroupKey(copyGroupKey(copy, axes), axes));
}
