"use client";

import { useCallback, useSyncExternalStore } from "react";

interface SortPreference {
  sortBy: string;
  sortDir: "asc" | "desc";
}

const listeners = new Set<() => void>();

function storageKey(listKey: string): string {
  return `stamporama:sort:${listKey}`;
}

/** The raw stored string, or null. Kept raw (a primitive) so `useSyncExternalStore` sees a stable
 * snapshot — returning a parsed object would be a new reference on every call and loop. */
function readRaw(listKey: string): string | null {
  try {
    return localStorage.getItem(storageKey(listKey));
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): SortPreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.sortBy === "string" &&
      (parsed.sortDir === "asc" || parsed.sortDir === "desc")
    ) {
      return parsed as SortPreference;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * A list's remembered sort (column + direction), persisted per list in localStorage and overridden
 * by the URL when it carries one. Read through `useSyncExternalStore` with a **null server
 * snapshot** — mirroring `usePersistedFlag` — so the pre-hydration render matches the server's and
 * the stored preference is picked up in the render right after hydration. Reading localStorage
 * directly during render instead makes the server and client disagree, and React then throws the
 * whole tree away and re-renders it client-side.
 */
export function usePersistedSort<T extends string>(
  listKey: string,
  defaultSortBy: T,
  defaultSortDir: "asc" | "desc",
  urlSortBy: string | null,
  urlSortDir: string | null,
  validValues: readonly T[]
): { sortBy: T; sortDir: "asc" | "desc"; persistSort: (sortBy: T, sortDir: "asc" | "desc") => void } {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  const getSnapshot = useCallback(() => readRaw(listKey), [listKey]);
  // Server / pre-hydration snapshot: nothing stored → the defaults (or whatever the URL carries).
  const getServerSnapshot = useCallback(() => null, []);

  const stored = parseStored(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot));
  const validSet = new Set<string>(validValues);

  const rawSortBy = urlSortBy ?? stored?.sortBy ?? defaultSortBy;
  const sortBy: T = validSet.has(rawSortBy) ? (rawSortBy as T) : defaultSortBy;
  const sortDir =
    (urlSortDir === "asc" || urlSortDir === "desc" ? urlSortDir : null) ??
    stored?.sortDir ??
    defaultSortDir;

  const persistSort = useCallback(
    (newSortBy: T, newSortDir: "asc" | "desc") => {
      try {
        localStorage.setItem(
          storageKey(listKey),
          JSON.stringify({ sortBy: newSortBy, sortDir: newSortDir })
        );
      } catch {
        /* ignore */
      }
      for (const listener of listeners) listener();
    },
    [listKey]
  );

  return { sortBy, sortDir, persistSort };
}
