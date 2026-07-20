"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Shared area + year filter selection, persisted per collection in localStorage
 * and shared across every list where those filters appear (issues, stamps,
 * inventory) — #143. The URL keeps priority: a panel reads `areaId` / `year` from
 * the query when present (so links stay shareable and an explicit "all" is
 * recorded with the `all` sentinel), and falls back to this store only when the
 * param is absent (a fresh navigation to the list). Panels mirror their effective
 * selection back here so it carries to the next list.
 */
export interface StoredListFilters {
  /** Area id, or null for "all". */
  areaId: string | null;
  /** Year value ("none" for the no-year bucket, a numeric string), or null for "all". */
  year: string | null;
}

const EMPTY: StoredListFilters = { areaId: null, year: null };

const listenersByKey = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}

function storageKey(collectionId: string): string {
  return `stamporama:list-filters:${collectionId}`;
}

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): StoredListFilters {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    return {
      areaId: typeof parsed.areaId === "string" ? parsed.areaId : null,
      year: typeof parsed.year === "string" ? parsed.year : null,
    };
  } catch {
    return EMPTY;
  }
}

export function useCollectionFilterStore(collectionId: string) {
  const key = storageKey(collectionId);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listenersFor(key);
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
    [key]
  );
  const getSnapshot = useCallback(() => readRaw(key), [key]);
  // Server / pre-hydration snapshot: "" parses to the empty (no-filter) state.
  const getServerSnapshot = useCallback(() => "", []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const stored = useMemo(() => parse(raw), [raw]);

  const writeStore = useCallback(
    (next: StoredListFilters) => {
      const current = parse(readRaw(key));
      // No-op when unchanged, so the persist effect that mirrors the effective
      // selection here can't trigger a notify → re-render loop.
      if (current.areaId === next.areaId && current.year === next.year) return;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
      for (const listener of listenersFor(key)) listener();
    },
    [key]
  );

  return { storedAreaId: stored.areaId, storedYear: stored.year, writeStore };
}
