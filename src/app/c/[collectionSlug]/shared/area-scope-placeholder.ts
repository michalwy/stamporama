import { hashKey } from "@tanstack/react-query";

/**
 * The collector's area selection — the row they clicked and the sub-area toggle — as distinct from
 * the ids it resolves to against the tree (`resolveAreaFilterIds`).
 */
export interface AreaSelection {
  areaId: string | null;
  includeSubAreas: boolean;
}

const SCOPE = "areaScope";

/**
 * Query options that keep a picker's rows drawn while the **area tree** changes under an unchanged
 * selection (#977).
 *
 * A picker sends the ids its selection resolves to, so the key carries the tree: add an area under
 * the selected one from the facet's `＋`, and the `router.refresh()` that puts it in the tree also
 * hands the query a key it has never fetched. With nothing to show for that key the list falls back
 * to its loading line, and the rows unmount — the scroll position and every expanded row with them,
 * for an area that holds nothing and so changes nothing about the answer.
 *
 * So the previous rows stand in while the new key loads — **only** when everything but the tree is
 * the same: the selection, and every other part of the key (`keyWithoutAreaIds`). A click on another
 * area, or a keystroke in the search, still shows the loading line rather than the last answer: in a
 * picker a row is pressed to pick it, and a stale row pressed in that gap would pick the wrong thing.
 *
 * The comparison is against the query the previous rows **came from**, which is what TanStack hands
 * `placeholderData`, and the scope rides in that query's `meta` rather than in this render's
 * memory — a render that already changed the selection and then re-renders while still loading must
 * not find the old rows acceptable on the second look.
 */
export function keepRowsAcrossTreeChange<TData>(
  selection: AreaSelection,
  keyWithoutAreaIds: readonly unknown[]
) {
  const scope = hashKey([selection.areaId, selection.includeSubAreas, ...keyWithoutAreaIds]);
  return {
    meta: { [SCOPE]: scope },
    placeholderData: (
      previous: TData | undefined,
      previousQuery?: { meta?: Record<string, unknown> }
    ): TData | undefined => (previousQuery?.meta?.[SCOPE] === scope ? previous : undefined),
  };
}
