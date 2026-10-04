/**
 * The stamp picker's remembered tree (#1616): which issues are expanded, which of their checklist
 * branches were opened or closed by hand, and the issue last picked from.
 *
 * Identifying a card opens the picker once per tile, usually within the same few issues, and each
 * open used to start folded — so the collector unfolded the same issue and the same branch over and
 * over. It is remembered **per collection and per browser**, as the sidebar's sections are (#762),
 * and **one state serves every use of the picker**: identification, a lot, a trade, an offer all
 * browse the same catalogue.
 *
 * Only the collector's **own toggles** are stored. A row a search forced open (#186) and a branch a
 * search opened (#631) are derived on screen and never written, so a search neither adds to the
 * state nor discards it: clearing the search shows the tree as it was.
 *
 * **Capped by count alone.** Each expanded issue is one id plus at most a handful of branch keys (an
 * issue's checklists), so the entry's size follows the count; `MAX_EXPANDED` most-recently-expanded
 * issues is far past what one sitting reaches back to and a few KB at most. No TTL, on
 * `purchase-ui-state.ts`' reasoning: an id that no longer exists is simply not on screen.
 *
 * Pure, so it tests without a DOM; the storage half is `use-picker-tree-state.ts` beside the picker.
 */

/** Expanded issues kept before the least-recently-expanded one folds again. */
export const MAX_EXPANDED = 50;

export interface PickerTreeState {
  /** Expanded issues, least recently expanded first. */
  expanded: string[];
  /** Branches toggled by hand, keyed by issue and then by branch (a checklist id, or `none` for
   *  *Not on a checklist*). Held only for expanded issues: folding an issue forgets its branches,
   *  as it always has. */
  branches: Record<string, Record<string, boolean>>;
  /** The issue last picked from, which the picker scrolls to on open. */
  lastPickedIssueId: string | null;
}

export const EMPTY_PICKER_TREE_STATE: PickerTreeState = {
  expanded: [],
  branches: {},
  lastPickedIssueId: null,
};

/**
 * The stored state, read back tolerantly: storage from an older build, or hand-edited, degrades to
 * everything folded rather than to a picker that throws (`parseOpenSections`' rule). Anything that
 * is not the expected shape is dropped field by field.
 */
export function parsePickerTreeState(raw: string | null): PickerTreeState {
  if (!raw) return EMPTY_PICKER_TREE_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PICKER_TREE_STATE;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return EMPTY_PICKER_TREE_STATE;
  }
  const stored = parsed as Record<string, unknown>;

  const expanded = Array.isArray(stored.expanded)
    ? [...new Set(stored.expanded.filter((id): id is string => typeof id === "string" && id !== ""))]
    : [];
  const kept = expanded.slice(-MAX_EXPANDED);
  const keptSet = new Set(kept);

  const branches: Record<string, Record<string, boolean>> = {};
  if (typeof stored.branches === "object" && stored.branches !== null && !Array.isArray(stored.branches)) {
    for (const [issueId, toggles] of Object.entries(stored.branches as Record<string, unknown>)) {
      if (!keptSet.has(issueId)) continue;
      if (typeof toggles !== "object" || toggles === null || Array.isArray(toggles)) continue;
      const clean: Record<string, boolean> = {};
      for (const [key, open] of Object.entries(toggles as Record<string, unknown>)) {
        if (typeof open === "boolean") clean[key] = open;
      }
      if (Object.keys(clean).length > 0) branches[issueId] = clean;
    }
  }

  const lastPickedIssueId =
    typeof stored.lastPickedIssueId === "string" && stored.lastPickedIssueId !== ""
      ? stored.lastPickedIssueId
      : null;

  return { expanded: kept, branches, lastPickedIssueId };
}

/** Expand or fold an issue by hand. Expanding makes it the most recent, and past the cap the least
 *  recent folds; folding forgets its branches. */
export function setIssueExpanded(
  state: PickerTreeState,
  issueId: string,
  open: boolean
): PickerTreeState {
  const rest = state.expanded.filter((id) => id !== issueId);
  if (!open) {
    const branches = { ...state.branches };
    delete branches[issueId];
    return { ...state, expanded: rest, branches };
  }
  const expanded = [...rest, issueId].slice(-MAX_EXPANDED);
  const keptSet = new Set(expanded);
  const branches: Record<string, Record<string, boolean>> = {};
  for (const [id, toggles] of Object.entries(state.branches)) {
    if (keptSet.has(id)) branches[id] = toggles;
  }
  return { ...state, expanded, branches };
}

/** Open or close one of an expanded issue's branches by hand. A branch of an issue that is not
 *  expanded has nothing to remember it by and is left alone. */
export function setBranchOpen(
  state: PickerTreeState,
  issueId: string,
  branchKey: string,
  open: boolean
): PickerTreeState {
  if (!state.expanded.includes(issueId)) return state;
  return {
    ...state,
    branches: {
      ...state.branches,
      [issueId]: { ...state.branches[issueId], [branchKey]: open },
    },
  };
}

/** Remember the issue a pick was made from. */
export function setLastPickedIssue(state: PickerTreeState, issueId: string): PickerTreeState {
  return state.lastPickedIssueId === issueId ? state : { ...state, lastPickedIssueId: issueId };
}

/** The stored form; the empty state is stored as nothing at all. */
export function serializePickerTreeState(state: PickerTreeState): string {
  if (
    state.expanded.length === 0 &&
    Object.keys(state.branches).length === 0 &&
    state.lastPickedIssueId === null
  ) {
    return "";
  }
  return JSON.stringify(state);
}
