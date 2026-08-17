import { useMemo, useState } from "react";

/** Collapsed-by-default expansion state for a screen's lot / set cards (#382), shared by the
 * purchase order's lots, an offer's sets and an auction sale's lots so the three cannot drift.
 *
 * Collapsed is the baseline because these screens are *scanned* first — which lots are in this
 * order, which sets are in this listing — and a card's contents are a second question asked of
 * one of them. Two things open a card without being asked:
 *
 *  - `initiallyExpandedId` — the card the collector navigated *to* (#374's `?lot=` deep link).
 *    It is seeded into the state rather than forced on every render, so the card can still be
 *    collapsed by hand once it has been read, and clearing the highlight does not shut it.
 *  - a card that **appears while the screen is open** — it was created here, so it is what the
 *    collector is looking at. The first render is the baseline (these views all mount after
 *    their data has loaded), so an ordinary page load opens nothing.
 *
 * The state is held in component state by default and **remembered** when a `store` is passed (the
 * purchase order's, #382 read against the order screen's remembered UI state). Both rules above
 * still hold against a restored set: the baseline is what was restored, so a lot created while the
 * screen is open still opens itself, and a deep-linked card is seeded on top of what was stored.
 */
export interface CardExpansion {
  isExpanded(id: string): boolean;
  toggle(id: string): void;
  /** True when every card is open — what the Collapse all / Expand all control reads. */
  allExpanded: boolean;
  toggleAll(): void;
}

/** Somewhere to keep the open set that outlives the component — the order screen's remembered UI
 * state. `expanded` must be referentially stable while unchanged, since it is what the hook reads
 * on every render. */
export interface CardExpansionStore {
  expanded: readonly string[];
  setExpanded(updater: (prev: Set<string>) => Set<string>): void;
}

export function useCardExpansion(
  ids: string[],
  initiallyExpandedId?: string | null,
  store?: CardExpansionStore | null
): CardExpansion {
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(() =>
    initiallyExpandedId ? new Set([initiallyExpandedId]) : new Set()
  );
  const storedExpanded = useMemo(
    () => (store ? new Set(store.expanded) : null),
    [store?.expanded] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const expanded = storedExpanded ?? localExpanded;
  const setExpanded = store ? store.setExpanded : setLocalExpanded;

  // Ids seen so far. Null until the first render, whose list is the baseline: without it every
  // card of a freshly loaded screen would count as new and the screen would open fully expanded.
  const [known, setKnown] = useState<Set<string> | null>(null);

  // Adjusting state during render (the documented pattern) rather than in an effect: an effect
  // would render the new card collapsed for a frame and only then open it.
  if (known === null) {
    setKnown(new Set(ids));
    // A stored set cannot be seeded by `useState`'s initialiser, so the deep-linked card is opened
    // here instead — guarded, and on the one render where `known` is still null. Writing the same
    // set again is a no-op down in the store, so a double-invoked render costs nothing.
    if (store && initiallyExpandedId && !expanded.has(initiallyExpandedId)) {
      setExpanded((prev) => new Set([...prev, initiallyExpandedId]));
    }
  } else {
    const fresh = ids.filter((id) => !known.has(id));
    if (fresh.length > 0) {
      setKnown(new Set([...known, ...fresh]));
      setExpanded((prev) => new Set([...prev, ...fresh]));
    }
  }

  const allExpanded = ids.length > 0 && ids.every((id) => expanded.has(id));

  return {
    isExpanded: (id) => expanded.has(id),
    toggle: (id) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    allExpanded,
    // Updater form rather than a bare value: a store takes only updaters, and `useState` reads a
    // function as one too, so the one shape works for both.
    toggleAll: () => setExpanded(() => (allExpanded ? new Set() : new Set(ids))),
  };
}
