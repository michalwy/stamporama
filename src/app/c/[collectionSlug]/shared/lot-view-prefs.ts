"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// localStorage-backed UI preferences for the lot views — the group-by / sort toggles and
// per-group collapse state, shared by the purchase-order intake view (#121, #157) and the
// sale-lot composition view (#164) so both persist and behave identically. Values are read via
// useSyncExternalStore: getServerSnapshot returns null so SSR and the first client render agree
// (no hydration mismatch), and every write dispatches an event so all lot views re-render in sync.

export function lsGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function lsRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const LOT_PREF_EVENT = "stamporama:lotPref";

function subscribeLotPref(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(LOT_PREF_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LOT_PREF_EVENT, callback);
  };
}

function useRawStored(key: string): string | null {
  return useSyncExternalStore(
    subscribeLotPref,
    () => lsGet(key),
    () => null
  );
}

/** False on the server and during the first client render (so it matches the SSR output),
 * then true. Lets preference-dependent UI wait for the localStorage-backed value instead of
 * flashing the fallback first. Uses useSyncExternalStore (no setState-in-effect). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function writeLotPref(key: string, value: string): void {
  lsSet(key, value);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOT_PREF_EVENT));
}

function parseStringSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

/** A boolean UI preference persisted under `key`, defaulting to `fallback` when unset. */
export function usePersistentToggle(
  key: string,
  fallback: boolean
): [boolean, (value: boolean) => void] {
  const stored = useRawStored(key);
  const value = stored === "1" ? true : stored === "0" ? false : fallback;
  const set = useCallback((next: boolean) => writeLotPref(key, next ? "1" : "0"), [key]);
  return [value, set];
}

/** A string UI preference persisted under `key`, defaulting to `fallback` when unset. */
export function usePersistentString(
  key: string,
  fallback: string
): [string, (value: string) => void] {
  const stored = useRawStored(key);
  const value = stored ?? fallback;
  const set = useCallback((next: string) => writeLotPref(key, next), [key]);
  return [value, set];
}

/** A set of string keys persisted under `key` as a JSON array. */
export function usePersistentStringSet(
  key: string
): [Set<string>, (updater: (prev: Set<string>) => Set<string>) => void] {
  const stored = useRawStored(key);
  const value = useMemo(() => parseStringSet(stored), [stored]);
  const update = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      // Re-read the authoritative value at write time so concurrent lot views don't clobber
      // each other's collapse state.
      const next = updater(parseStringSet(lsGet(key)));
      writeLotPref(key, JSON.stringify([...next]));
    },
    [key]
  );
  return [value, update];
}
