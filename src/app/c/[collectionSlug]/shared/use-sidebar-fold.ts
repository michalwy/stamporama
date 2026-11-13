"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  NARROW_WINDOW_QUERY,
  SIDEBAR_FOLD_KEY,
  isSidebarFolded,
  parseSidebarFold,
  serializeSidebarFold,
} from "../sidebar-fold";

/**
 * Whether the sidebar is folded to its icon rail (#2505), and the way to fold or unfold it by hand.
 *
 * Two things in the browser decide it — the choice stored on this browser and whether the window is
 * narrow — and both are read as external stores, so every reader follows a change made in another
 * tab or a window dragged narrower. Pre-hydration both read as "nothing": the server draws the
 * sidebar whole and a folded one folds once hydrated, the same trade the section folds make.
 */
const listeners = new Set<() => void>();

/** Where the choice is kept for this page when the browser refuses storage (private mode). */
let unstored: string | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(SIDEBAR_FOLD_KEY);
  } catch {
    return unstored;
  }
}

function subscribeStored(onChange: () => void) {
  listeners.add(onChange);
  // Another tab folding its sidebar folds this one's too — it is one browser's choice.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_FOLD_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW_WINDOW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const readNarrow = () => window.matchMedia(NARROW_WINDOW_QUERY).matches;
const nothingOnServer = () => null;
const wideOnServer = () => false;

export function useSidebarFold(): { folded: boolean; toggle: () => void } {
  const stored = useSyncExternalStore(subscribeStored, readStored, nothingOnServer);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, wideOnServer);
  const folded = isSidebarFolded(parseSidebarFold(stored), narrow);

  const toggle = useCallback(() => {
    // Read at the moment of the click rather than from the render, so a shortcut pressed twice in
    // quick succession toggles twice.
    const now = isSidebarFolded(parseSidebarFold(readStored()), readNarrow());
    const next = serializeSidebarFold(!now);
    try {
      localStorage.setItem(SIDEBAR_FOLD_KEY, next);
    } catch {
      // Storage refused: the fold still happens, for as long as this page is open.
      unstored = next;
    }
    for (const listener of listeners) listener();
  }, []);

  return { folded, toggle };
}
