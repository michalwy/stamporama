"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// A localStorage-backed set of collapsed node ids, exposed through
// useSyncExternalStore so a component can hold off rendering the tree until the
// persisted state is known (avoiding a flash of the wrong expansion on refresh).
// Persisted in localStorage — not a cookie, which would ride every request. This
// generalizes the area-tree filter's collapse persistence (#81) so any adjacency
// tree can reuse it (e.g. the area management screen, #237).

// Per storage key: its listener set, so writes only notify the trees that share it.
const listenersByKey = new Map<string, Set<() => void>>();

function listenersFor(storageKey: string): Set<() => void> {
  let set = listenersByKey.get(storageKey);
  if (!set) {
    set = new Set();
    listenersByKey.set(storageKey, set);
  }
  return set;
}

function readRaw(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function writeRaw(storageKey: string, ids: Set<string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // ignore (private mode / disabled storage)
  }
  for (const listener of listenersFor(storageKey)) listener();
}

export interface CollapsedSet {
  /** The set of collapsed node ids. */
  collapsed: Set<string>;
  /** False until localStorage has been read on the client — render trees only when true. */
  loaded: boolean;
  /** Flip one node's collapsed state and persist. */
  toggle: (id: string) => void;
}

/**
 * A persisted collapsed-id set for one adjacency tree, keyed by `storageKey`.
 * `computeDefault` supplies the initial collapsed set the first time (before the
 * user has toggled anything); it is only consulted when nothing is stored yet.
 */
export function useCollapsedSet(
  storageKey: string,
  computeDefault?: () => Set<string>
): CollapsedSet {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listenersFor(storageKey);
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
    [storageKey]
  );

  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    // Server / pre-hydration snapshot: null means "not loaded yet".
    () => null as string | null
  );
  const loaded = raw !== null;

  const collapsed = useMemo<Set<string>>(() => {
    if (raw) {
      try {
        return new Set<string>(JSON.parse(raw));
      } catch {
        // fall through to defaults
      }
    }
    return computeDefault ? computeDefault() : new Set<string>();
    // computeDefault is expected to be stable (useCallback) or cheap; re-run on raw change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeRaw(storageKey, next);
    },
    [collapsed, storageKey]
  );

  return { collapsed, loaded, toggle };
}
