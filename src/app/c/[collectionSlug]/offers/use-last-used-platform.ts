"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The last platform an offer was created on, remembered per collection in localStorage and reactive
 * across every component that reads the same collection (mirrors {@link usePersistedFlag}). Offer
 * creation seeds its platform from the current list filter, falling back to this when no filter is
 * set (#241) — so the picker lands on the platform you most recently sold on. A client preference,
 * not shareable URL state.
 */
const listenersByKey = new Map<string, Set<() => void>>();

function keyFor(collectionId: string): string {
  return `stamporama:offers:last-platform:${collectionId}`;
}

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

export function useLastUsedPlatform(
  collectionId: string
): [string | null, (platformId: string) => void] {
  const key = keyFor(collectionId);
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

  const remember = useCallback(
    (platformId: string) => {
      if (!platformId || readRaw(key) === platformId) return;
      try {
        localStorage.setItem(key, platformId);
      } catch {
        // ignore (private mode / disabled storage)
      }
      for (const listener of listenersFor(key)) listener();
    },
    [key]
  );

  return [value, remember];
}
