import type { LotCopyFilter } from "./items";

/**
 * *Which copies the intake screen's action bar is about* (#571).
 *
 * The screen's copies stream in pages, so a selection can never be a list of rows: ticking a lot
 * header or an issue group has to mean **the whole thing on the server**, including the copies
 * that have not loaded. This module is the pure half of that — the state the checkboxes produce
 * and the scope it resolves to. The write layer (`lots.ts`) turns that scope into one `where`.
 *
 * **Containers, not expansions.** Ticking a lot or a group records *the container*, never its
 * ids; unticking something underneath records an *exclusion*. That is what lets a level behave
 * the same whether its members are on screen or a thousand rows down, and it is why the
 * checkboxes need no per-level rules: each ticks what is beneath it, shows a dash while only part
 * of it is ticked, and falls back to the dash when a row below is lifted out.
 *
 * **One selection for the whole order.** It is held above the lot cards, not inside them, because
 * a batch on the desk does not respect lot boundaries — copies from three lots go onto one
 * transport card in one act. A per-lot selection would put the same action bar over every card
 * and make the collector press it once per lot.
 *
 * **A row knows where it sits**, from the copy itself ({@link CopyRef}) rather than from the
 * heading it happens to be rendered under, so the same selection reads correctly in a by-lot
 * card, a by-issue group and a flat list. Switching how the list is grouped is a change of view,
 * not of what was picked.
 */
export interface CopyContainer {
  /** All copies of this lot. */
  lotId?: string;
  /** All copies under this issue group — an issue id, or `"__none__"` for copies with none. */
  issueKey?: string;
  /**
   * The list's filter chip at the moment this container was ticked, carried so the write means
   * the same set the collector was looking at (#565) — "all 40 to sort" must not become "all
   * 900". The chip changing **retires the container**, which is the caller's job to do at the
   * moment the chip is pressed, so nothing here ever has to re-judge a row against a filter it
   * cannot evaluate.
   */
  filter?: LotCopyFilter;
}

/** A copy as the selection sees it: its own id, and the containers it falls under. */
export interface CopyRef {
  id: string;
  lotId: string | null;
  /** The issue group it is grouped under — its first issue membership, or `"__none__"`. */
  issueKey: string;
}

export interface CopySelection {
  /** Ticked containers, unioned. */
  containers: CopyContainer[];
  /** Copies ticked one by one, with where they sit so a container above can absorb them. */
  ids: CopyRef[];
  /** Containers lifted back out of a broader one. */
  exContainers: CopyContainer[];
  /** Copies lifted back out of a container above them. */
  exIds: CopyRef[];
}

export const EMPTY_SELECTION: CopySelection = {
  containers: [],
  ids: [],
  exContainers: [],
  exIds: [],
};

/** Does this container hold that copy? */
function covers(c: CopyContainer, row: CopyRef): boolean {
  if (c.lotId && c.lotId !== row.lotId) return false;
  if (c.issueKey && c.issueKey !== row.issueKey) return false;
  return true;
}

/** Is everything `inner` holds also held by `outer`? (A lot subsumes its own issue groups.) */
function subsumes(outer: CopyContainer, inner: CopyContainer): boolean {
  if (outer.lotId && outer.lotId !== inner.lotId) return false;
  if (outer.issueKey && outer.issueKey !== inner.issueKey) return false;
  return true;
}

/** Could the two name a copy in common? Two different lots never can. */
function intersects(a: CopyContainer, b: CopyContainer): boolean {
  if (a.lotId && b.lotId && a.lotId !== b.lotId) return false;
  if (a.issueKey && b.issueKey && a.issueKey !== b.issueKey) return false;
  return true;
}

export function isRowSelected(sel: CopySelection, row: CopyRef): boolean {
  if (sel.exIds.some((r) => r.id === row.id)) return false;
  if (sel.ids.some((r) => r.id === row.id)) return true;
  if (!sel.containers.some((c) => covers(c, row))) return false;
  return !sel.exContainers.some((c) => covers(c, row));
}

export type BoxState = "on" | "off" | "partial";

/**
 * The state of the checkbox standing for `c` — a lot header, an issue group, or (with an empty
 * container) everything on the screen. One rule at every level: **on** when something at or above
 * it is ticked and nothing under it has been lifted out, **partial** when only part of it is in,
 * **off** otherwise.
 */
export function containerBoxState(sel: CopySelection, c: CopyContainer): BoxState {
  const whole =
    sel.containers.some((t) => subsumes(t, c)) &&
    !sel.exContainers.some((x) => intersects(x, c)) &&
    !sel.exIds.some((r) => covers(c, r));
  if (whole) return "on";
  // A ticked container only puts part of `c` in when the overlap between them survives the
  // exclusions — a ticked lot says nothing about an issue group that was lifted back out of it.
  const someIn =
    sel.containers.some(
      (t) => intersects(t, c) && !sel.exContainers.some((x) => subsumes(x, overlap(t, c)))
    ) || sel.ids.some((r) => covers(c, r));
  return someIn ? "partial" : "off";
}

/** What two intersecting containers hold in common — the narrower of them on each axis. */
function overlap(a: CopyContainer, b: CopyContainer): CopyContainer {
  return {
    ...(a.lotId ?? b.lotId ? { lotId: a.lotId ?? b.lotId } : {}),
    ...(a.issueKey ?? b.issueKey ? { issueKey: a.issueKey ?? b.issueKey } : {}),
  };
}

/** Tick or untick everything `c` holds. */
export function toggleContainer(sel: CopySelection, c: CopyContainer): CopySelection {
  const turningOn = containerBoxState(sel, c) !== "on";
  // Whatever was recorded *under* `c` stops meaning anything either way: it is either absorbed
  // into the container or dropped with it.
  const cleaned: CopySelection = {
    containers: sel.containers.filter((t) => !subsumes(c, t)),
    ids: sel.ids.filter((r) => !covers(c, r)),
    exContainers: sel.exContainers.filter((x) => !subsumes(c, x)),
    exIds: sel.exIds.filter((r) => !covers(c, r)),
  };
  if (turningOn) {
    // Already inside a broader tick — putting it back is just dropping the exclusion, which
    // `cleaned` has done.
    if (cleaned.containers.some((t) => subsumes(t, c))) return cleaned;
    return { ...cleaned, containers: [...cleaned.containers, c] };
  }
  // Still inside a broader tick after its own record went — say so explicitly.
  if (cleaned.containers.some((t) => subsumes(t, c))) {
    return { ...cleaned, exContainers: [...cleaned.exContainers, c] };
  }
  return cleaned;
}

/** Tick or untick one copy. Unticking one a container covers records an exclusion — the
 *  container's other copies run past the loaded page and cannot be enumerated to replace it. */
export function toggleRow(sel: CopySelection, row: CopyRef): CopySelection {
  const coveredAbove =
    sel.containers.some((c) => covers(c, row)) &&
    !sel.exContainers.some((c) => covers(c, row));
  if (isRowSelected(sel, row)) {
    const ids = sel.ids.filter((r) => r.id !== row.id);
    return coveredAbove ? { ...sel, ids, exIds: [...sel.exIds, row] } : { ...sel, ids };
  }
  const exIds = sel.exIds.filter((r) => r.id !== row.id);
  if (coveredAbove) return { ...sel, exIds };
  return { ...sel, exIds, ids: [...sel.ids.filter((r) => r.id !== row.id), row] };
}

/** Nothing is selected — the action bar draws nothing. */
export function isSelectionEmpty(sel: CopySelection): boolean {
  return sel.containers.length === 0 && sel.ids.length === 0;
}

/** Drop every container taken under a filter chip on `lotId` (#565). Called when that chip is
 *  pressed: the set it named is no longer the set on screen, and nothing downstream can re-judge
 *  a copy against a chip it cannot evaluate. */
export function dropFilteredContainers(sel: CopySelection, lotId: string): CopySelection {
  const stale = (c: CopyContainer) => !!c.filter && c.lotId === lotId;
  if (!sel.containers.some(stale) && !sel.exContainers.some(stale)) return sel;
  return {
    ...sel,
    containers: sel.containers.filter((c) => !stale(c)),
    exContainers: sel.exContainers.filter((c) => !stale(c)),
  };
}

/** The selection as the write layer's scope dimensions, or as a plain id list when that is all it
 *  is. A plain list is worth keeping distinct: it needs no server round trip to count, and it is
 *  what a single copy's row menu already sends. */
export interface SelectionScope {
  selectors?: CopyContainer[];
  itemIds?: string[];
  excludeSelectors?: CopyContainer[];
  excludeItemIds?: string[];
}

export type SelectionResolution =
  | { kind: "none" }
  | { kind: "ids"; ids: string[] }
  | { kind: "scope"; scope: SelectionScope };

export function resolveSelection(sel: CopySelection): SelectionResolution {
  const itemIds = sel.ids.map((r) => r.id);
  if (sel.containers.length === 0) {
    return itemIds.length > 0 ? { kind: "ids", ids: itemIds } : { kind: "none" };
  }
  const excludeItemIds = sel.exIds.map((r) => r.id);
  return {
    kind: "scope",
    scope: {
      selectors: sel.containers,
      ...(itemIds.length > 0 ? { itemIds } : {}),
      ...(sel.exContainers.length > 0 ? { excludeSelectors: sel.exContainers } : {}),
      ...(excludeItemIds.length > 0 ? { excludeItemIds } : {}),
    },
  };
}
