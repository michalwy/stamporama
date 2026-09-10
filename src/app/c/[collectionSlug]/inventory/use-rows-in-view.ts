"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { rowsInView, sameRowIds } from "@/lib/rows-in-view";

/**
 * *Which copy rows this screen is actually showing* (#1021) — the half of
 * **the bar counts and acts on the ticked rows that are in view** that a paginated, grouped list
 * cannot answer from its filters.
 *
 * The rule itself is in [`ui-patterns.md`](../../../../../docs/agents/ui-patterns.md): a filter is
 * a way of looking, so it never unticks anything, and a bulk action never reaches a row the
 * collector cannot see. On the card-scans strip the second half is a pure function — every tile is
 * loaded, so *in view* is `tilesInView(allTiles, chip)`. Here it is not: the filters are resolved
 * **server-side** (a search, an area subtree, a catalog number), so nothing on the client can be
 * asked whether a copy ticked ten minutes ago still matches. What the screen *can* say is which
 * rows it has, and that is the same answer arrived at from the other end — a copy is in view
 * exactly when the current filter set produced it.
 *
 * **So the lists report what they hold and this collects it.** The flat list needs nothing: the
 * panel already has its pages in hand. What it cannot see is a **group's** members, which arrive
 * through the group row's own member query (#398) — hence one registration point, in
 * `useGroupMembers`, covering all three groupings.
 *
 * **A folded group still reports its members, and that is a decision.** Expansion is a way of
 * reading a row that is *on* the screen — the group's header is right there, drawing the tri-state
 * box that reports its own ticks (#422) — so a bar refusing to count what that box reports would be
 * two controls on one screen answering one question, one of them contradicting the other. It also
 * keeps tick-a-group / fold / tick-the-next / act working, which is what a group's select-all is
 * for; `useGroupMembers` already opens a folded group on select-all so the copies are visible at
 * the moment they are ticked, which is where visibility actually matters.
 *
 * **What it cannot do, stated rather than left to be discovered.** A copy matching the filter but
 * sitting in a page the collector has not scrolled to is ticked, uncounted and out of reach until
 * it loads. Nothing is lost and no action can touch it, and it comes back on scrolling exactly as a
 * hidden tick comes back on releasing the filter — but the count is *what has loaded*, not *what
 * the filter holds*, and a reader expecting the second will be surprised once.
 *
 * The whole register is dropped when the filter set changes, keyed on the same signature the
 * selection used to be reset by: a group row that survives the change holds last filter's members
 * until its own query answers, and one stale id is one row a bulk action could reach.
 */
export interface RowsInView {
  /** The ids of every copy row the registered lists are holding. */
  inView: ReadonlySet<string>;
  /**
   * Report the rows one list holds, or `null` to withdraw them. Stable across renders, so a
   * reporter may depend on it directly.
   */
  register: (token: string, ids: readonly string[] | null) => void;
}

export function useRowsInView(filterSignature: string): RowsInView {
  const [state, setState] = useState<{
    sig: string;
    rows: ReadonlyMap<string, readonly string[]>;
  }>({ sig: filterSignature, rows: new Map() });
  // Adjusted during render rather than in an effect, exactly as the selection's own reset was: a
  // register that survived a filter change would be answering about the previous list for a frame.
  if (state.sig !== filterSignature) {
    setState({ sig: filterSignature, rows: new Map() });
  }

  const register = useCallback((token: string, ids: readonly string[] | null) => {
    setState((prev) => {
      const previous = prev.rows.get(token);
      if (!ids || ids.length === 0) {
        if (previous === undefined) return prev;
        const rows = new Map(prev.rows);
        rows.delete(token);
        return { sig: prev.sig, rows };
      }
      // A reporter is free to call with an unchanged list — a re-render, a refetch answering with
      // the same page — and a new Map every time would put this state in a loop with the effects
      // reading it.
      if (previous && sameRowIds(previous, ids)) return prev;
      const rows = new Map(prev.rows);
      rows.set(token, ids);
      return { sig: prev.sig, rows };
    });
  }, []);

  const inView = useMemo(() => rowsInView(state.rows.values()), [state]);

  return { inView, register };
}

/**
 * Report one list's rows for as long as it is mounted.
 *
 * Keyed on the ids themselves rather than on the array, which a `flatMap` over query pages rebuilds
 * on every render — the effect would otherwise re-register on each one.
 */
export function useReportRowsInView(
  register: RowsInView["register"],
  ids: readonly string[]
): void {
  const token = useId();
  const key = ids.join(" ");
  useEffect(() => {
    register(token, key ? key.split(" ") : null);
    return () => register(token, null);
  }, [register, token, key]);
}
