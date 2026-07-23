"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A single boolean UI preference persisted in localStorage and reactive across the hooks that read
 * the same key (mirrors `use-collection-filter-store`, but for one flag). Used for remembered
 * list toggles like "show sold/withdrawn offers" (#245) that are a client preference rather than
 * shareable URL state. SSR-safe: pre-hydration it reports `defaultValue`.
 */
const listenersByKey = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePersistedFlag(
  key: string,
  defaultValue = false
): [boolean, (next: boolean) => void] {
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
  // Server / pre-hydration snapshot: null → the default.
  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const value = raw === null ? defaultValue : raw === "1";

  const setValue = useCallback(
    (next: boolean) => {
      if ((readRaw(key) === "1") === next && readRaw(key) !== null) return;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // ignore
      }
      for (const listener of listenersFor(key)) listener();
    },
    [key]
  );

  return [value, setValue];
}
