"use client";

import { useCallback, useState } from "react";

/**
 * A picker's text-search value, persisted per key in localStorage so the picker
 * reopens on the same filter it was left on — matching how the area+year sidebar
 * already survives reopen via {@link useCollectionFilterStore} (#143). Keys are
 * scoped per collection and per picker so the issue browser and the copies picker
 * remember independent searches.
 *
 * Client-only: the pickers that use it are portalled to <body> after a click and
 * never server-render, so reading localStorage in the lazy initializer is safe.
 */
export function usePersistedSearch(id: string): [string, (value: string) => void] {
  const key = `stamporama:picker-search:${id}`;
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const set = useCallback(
    (next: string) => {
      setValue(next);
      try {
        if (next) localStorage.setItem(key, next);
        else localStorage.removeItem(key);
      } catch {
        // ignore (private mode / disabled storage)
      }
    },
    [key]
  );
  return [value, set];
}
