"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseScanTileSize, type ScanTileSize } from "@/lib/scan-tile-size";

/**
 * How large a card's tiles are drawn (#1922), remembered in this browser. One setting for the
 * collector rather than one per collection or per order: it is about the screen and the eyes in
 * front of it, which do not change with the parcel.
 *
 * SSR-safe: before hydration it reports the default, and adopts the stored size after. Reactive
 * across every strip on the page, and across tabs through the `storage` event.
 */
const KEY = "stamporama:scan-tile-size";
const CHANGE_EVENT = "stamporama:scan-tile-size";
/** The last size set in this page, for a browser whose storage refuses it: it then holds for the
 * sitting rather than not at all. */
let unsaved: string | null = null;

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function readRaw(): string | null {
  try {
    return unsaved ?? localStorage.getItem(KEY);
  } catch {
    return unsaved;
  }
}

export function useScanTileSize(): [ScanTileSize, (next: ScanTileSize) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);

  const setSize = useCallback((next: ScanTileSize) => {
    unsaved = next;
    try {
      localStorage.setItem(KEY, next);
      // Stored — so a size chosen in another tab later is read rather than shadowed by this one.
      unsaved = null;
    } catch {
      // ignore (private mode / disabled storage) — the size then holds for this sitting only
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [parseScanTileSize(raw), setSize];
}
