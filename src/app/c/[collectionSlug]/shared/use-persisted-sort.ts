"use client";

import { useCallback } from "react";

interface SortPreference {
  sortBy: string;
  sortDir: "asc" | "desc";
}

function storageKey(listKey: string): string {
  return `stamporama:sort:${listKey}`;
}

function readStored(listKey: string): SortPreference | null {
  try {
    const raw = localStorage.getItem(storageKey(listKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.sortBy === "string" && (parsed.sortDir === "asc" || parsed.sortDir === "desc")) {
      return parsed as SortPreference;
    }
  } catch { /* ignore */ }
  return null;
}

export function usePersistedSort<T extends string>(
  listKey: string,
  defaultSortBy: T,
  defaultSortDir: "asc" | "desc",
  urlSortBy: string | null,
  urlSortDir: string | null,
  validValues: readonly T[]
): { sortBy: T; sortDir: "asc" | "desc"; persistSort: (sortBy: T, sortDir: "asc" | "desc") => void } {
  const stored = readStored(listKey);
  const validSet = new Set<string>(validValues);

  const rawSortBy = urlSortBy ?? stored?.sortBy ?? defaultSortBy;
  const sortBy: T = validSet.has(rawSortBy) ? (rawSortBy as T) : defaultSortBy;
  const sortDir = (urlSortDir === "asc" || urlSortDir === "desc" ? urlSortDir : null) ?? stored?.sortDir ?? defaultSortDir;

  const persistSort = useCallback(
    (newSortBy: T, newSortDir: "asc" | "desc") => {
      try {
        localStorage.setItem(storageKey(listKey), JSON.stringify({ sortBy: newSortBy, sortDir: newSortDir }));
      } catch { /* ignore */ }
    },
    [listKey]
  );

  return { sortBy, sortDir, persistSort };
}
