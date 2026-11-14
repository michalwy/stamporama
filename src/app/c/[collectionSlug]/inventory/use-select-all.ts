"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { GroupSelectState } from "@/lib/select-all";

/**
 * The grouped half of the Copies list's header box (#2538): every loaded group's own select-all
 * box, collected so the header can read them together (`groupedHeaderBoxState`).
 *
 * The shape is `useRowsInView`'s, for its reasons: the groups report from `useGroupMembers`, the
 * one place all three groupings share, and the register is **dropped when the list becomes a
 * different list** — another filter set or another grouping — since a group row surviving the
 * change would answer about the previous list for a frame.
 */
export interface GroupSelectStates {
  states: readonly GroupSelectState[];
  /** Report one group's state, or `null` to withdraw it. Stable across renders. */
  report: (token: string, state: GroupSelectState | null) => void;
}

export function useGroupSelectStates(signature: string): GroupSelectStates {
  const [store, setStore] = useState<{
    sig: string;
    states: ReadonlyMap<string, GroupSelectState>;
  }>({ sig: signature, states: new Map() });
  // Adjusted during render, as `useRowsInView` is.
  if (store.sig !== signature) {
    setStore({ sig: signature, states: new Map() });
  }

  const report = useCallback((token: string, state: GroupSelectState | null) => {
    setStore((prev) => {
      const previous = prev.states.get(token);
      if (previous === (state ?? undefined)) return prev;
      const states = new Map(prev.states);
      if (state) states.set(token, state);
      else states.delete(token);
      return { sig: prev.sig, states };
    });
  }, []);

  const states = useMemo(() => [...store.states.values()], [store]);
  return { states, report };
}

/** Report one group's select-all state for as long as the group is mounted. */
export function useReportGroupSelectState(
  report: GroupSelectStates["report"] | undefined,
  state: GroupSelectState
): void {
  const token = useId();
  useEffect(() => {
    if (!report) return;
    report(token, state);
  }, [report, token, state]);
  useEffect(() => {
    if (!report) return;
    return () => report(token, null);
  }, [report, token]);
}
