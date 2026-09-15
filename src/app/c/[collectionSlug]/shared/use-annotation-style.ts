"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readStoredAnnotationStyle, type AnnotationStyle } from "@/lib/annotations";

/**
 * How annotation marks are drawn — colour, thickness, font size (#1300) — remembered in this browser
 * so it is not set again on every picture. One setting for the collector rather than one per
 * collection: it is about how marks stand out on a stamp, which does not change with the collection.
 *
 * SSR-safe: before hydration it reports the default, and adopts the stored style after. Reactive
 * across every viewer reading it, as `usePersistedFlag` is.
 */
const KEY = "stamporama:annotation-style";
const listeners = new Set<() => void>();
/** The last style set in this page, for a browser whose storage refuses it: it then holds for the
 * sitting rather than not at all. */
let unsaved: string | null = null;

function readRaw(): string | null {
  try {
    return unsaved ?? localStorage.getItem(KEY);
  } catch {
    return unsaved;
  }
}

export function useAnnotationStyle(): [AnnotationStyle, (next: AnnotationStyle) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const style = useMemo(() => readStoredAnnotationStyle(raw), [raw]);

  const setStyle = useCallback((next: AnnotationStyle) => {
    unsaved = JSON.stringify(next);
    try {
      localStorage.setItem(KEY, unsaved);
    } catch {
      // ignore (private mode / disabled storage) — the style then holds for this sitting only
    }
    for (const listener of listeners) listener();
  }, []);

  return [style, setStyle];
}
