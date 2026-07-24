"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A single string UI preference persisted per collection in localStorage and reactive across every
 * component that reads the same (namespace, collection) key — the string-valued sibling of
 * {@link usePersistedFlag}. Used for remembered list-filter selections that are a client preference
 * rather than shareable URL state: the catalog vendor filter (#115) and the "not offered on"
 * platform filter (#275).
 *
 * A list panel keeps the URL param authoritative when present (so links stay shareable) and falls
 * back to this stored value on a fresh navigation, mirroring the current selection back on change.
 * Passing "" clears the stored value (so an explicit "all" doesn't re-apply a stale vendor).
 *
 * SSR-safe: the server / pre-hydration snapshot is `null`, so panels render the no-preference state
 * on the server and adopt the stored value after hydration (no mismatch).
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

export function usePersistedCollectionValue(
  namespace: string,
  collectionId: string
): [string | null, (value: string) => void] {
  const key = `stamporama:${namespace}:${collectionId}`;

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
  const getServerSnapshot = useCallback(() => null, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string) => {
      if (readRaw(key) === (next || null)) return;
      try {
        if (next) localStorage.setItem(key, next);
        else localStorage.removeItem(key);
      } catch {
        // ignore (private mode / disabled storage)
      }
      for (const listener of listenersFor(key)) listener();
    },
    [key]
  );

  return [value, setValue];
}
