"use client";

import { useCallback, useMemo } from "react";
import { usePersistedCollectionValue } from "./use-persisted-collection-value";

/**
 * A **whole filter set** remembered per collection (#693), under #325's rule applied key by key:
 * the URL wins wherever it names a value — so a shared or bookmarked link keeps meaning what it
 * meant — the stored value fills in otherwise, and every change writes both.
 *
 * It exists because a list screen's filters are one way of working, not a dozen independent
 * preferences: the Copies list carries a dozen of them, and a `usePersistedCollectionValue` per
 * filter would be a dozen storage keys to keep in step and a dozen chances for one of them to be
 * remembered while its neighbour is not. The tracked keys are stored as one serialized query
 * string, which is also what makes the value readable in the storage inspector and cheap to clear.
 *
 * **Every change must go through {@link remember}**, and that is why the panel's single
 * `updateParams` funnel is where it is called: a filter cleared to nothing leaves the URL entirely,
 * so a fallback that was not written at the same moment would read the stored value straight back
 * and re-apply the filter the collector just switched off.
 *
 * What a screen tracks is its own call. A free-text search box is deliberately *not* a filter of
 * this kind — it is a lookup one finishes, and greeting the next visit with a list narrowed to a
 * phrase nobody remembers typing is the failure this hook must not cause.
 *
 * SSR-safe through the hook it wraps: the pre-hydration snapshot is empty, so the server renders
 * the URL's own filters and the stored ones arrive with hydration.
 */
export function usePersistedFilterParams(
  namespace: string,
  collectionId: string,
  /** The params this screen remembers. Module-level constant, so the returned callbacks stay stable. */
  keys: readonly string[],
  searchParams: URLSearchParams | { has(key: string): boolean; get(key: string): string | null }
): {
  /** The value in force for one tracked key: the URL's where it names one, else the stored one. */
  readParam: (key: string) => string | null;
  /** Store the tracked set as it stands *after* `updates` — pass exactly what is being written to the URL. */
  remember: (updates: Record<string, string>) => void;
} {
  const [stored, setStored] = usePersistedCollectionValue(namespace, collectionId);
  const storedParams = useMemo(() => new URLSearchParams(stored ?? ""), [stored]);

  const readParam = useCallback(
    (key: string) => (searchParams.has(key) ? searchParams.get(key) : storedParams.get(key)),
    [searchParams, storedParams]
  );

  const remember = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams();
      for (const key of keys) {
        // An update names the new value — including `""`, which is how a filter is cleared and the
        // one case that must not fall back to what is stored. Everything else keeps what is in
        // force, which is not the same as what is in the URL: a filter restored from storage is
        // live without ever having been written there.
        const value = key in updates ? updates[key] : (readParam(key) ?? "");
        if (value) next.set(key, value);
      }
      setStored(next.toString());
    },
    [keys, readParam, setStored]
  );

  return { readParam, remember };
}
