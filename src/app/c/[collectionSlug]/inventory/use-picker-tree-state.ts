"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import {
  parsePickerTreeState,
  serializePickerTreeState,
  setBranchOpen,
  setIssueExpanded,
  setLastPickedIssue,
  type PickerTreeState,
} from "@/lib/picker-tree-state";

/**
 * The stamp picker's remembered tree (#1616), per collection and per browser — one key for every use
 * of the picker. The rules are `lib/picker-tree-state.ts`; this is the storage half.
 *
 * Pre-hydration the stored value reads as nothing, which is everything folded: the picker is
 * portalled on the client only, so it adopts the stored tree on its first render in practice.
 */
export function usePickerTreeState(collectionId: string) {
  const [raw, setRaw] = usePersistedCollectionValue("stamp-picker-tree", collectionId);
  const state = useMemo(() => parsePickerTreeState(raw), [raw]);

  // Writes start from the latest state rather than the one a callback closed over, so a write made
  // after an await (an issue created inline, then expanded) cannot undo a toggle made meanwhile.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const update = useCallback(
    (change: (current: PickerTreeState) => PickerTreeState) => {
      const next = change(latest.current);
      latest.current = next;
      setRaw(serializePickerTreeState(next));
    },
    [setRaw]
  );

  return {
    state,
    setIssueExpanded: useCallback(
      (issueId: string, open: boolean) => update((s) => setIssueExpanded(s, issueId, open)),
      [update]
    ),
    setBranchOpen: useCallback(
      (issueId: string, branchKey: string, open: boolean) =>
        update((s) => setBranchOpen(s, issueId, branchKey, open)),
      [update]
    ),
    setLastPickedIssue: useCallback(
      (issueId: string) => update((s) => setLastPickedIssue(s, issueId)),
      [update]
    ),
  };
}

export type PickerTree = ReturnType<typeof usePickerTreeState>;
