"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  parseRecentEntities,
  recordRecentEntity,
  serializeRecentEntities,
  type RecentEntity,
} from "@/lib/recent-entities";

/**
 * The recently visited records of one collection (#599), stored in localStorage and reactive across
 * every component reading the same collection — the list-valued sibling of
 * {@link usePersistedCollectionValue}, and stored the same way for the same reason: a visit is a
 * fact about one person's browsing, not about the collection, so it never reaches the database.
 *
 * What a visit *is* — dedupe, order, cap — lives in the pure `recent-entities.ts`, which is where
 * the unit tests hold it. This module is only the storage and the subscription.
 *
 * SSR-safe: the server / pre-hydration snapshot is the empty list, so the sidebar renders no panel
 * on the server and adopts the stored one after hydration (no mismatch).
 */

const KEY_PREFIX = "stamporama:recent-entities:";

const listenersByKey = new Map<string, Set<() => void>>();

/** `useSyncExternalStore` compares snapshots by identity, so the parsed list has to be the *same*
 *  array until the stored string actually changes — parsing on every call would re-render forever. */
const cacheByKey = new Map<string, { raw: string | null; parsed: RecentEntity[] }>();

const EMPTY: RecentEntity[] = [];

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

function read(key: string): RecentEntity[] {
  const raw = readRaw(key);
  const cached = cacheByKey.get(key);
  if (cached && cached.raw === raw) return cached.parsed;
  const parsed = raw ? parseRecentEntities(raw) : EMPTY;
  cacheByKey.set(key, { raw, parsed });
  return parsed;
}

function write(key: string, list: RecentEntity[]): void {
  try {
    if (list.length > 0) localStorage.setItem(key, serializeRecentEntities(list));
    else localStorage.removeItem(key);
  } catch {
    // ignore (private mode / disabled storage) — a lost history is not worth an error on screen
  }
  cacheByKey.delete(key);
  for (const listener of listenersFor(key)) listener();
}

export interface RecentEntitiesStore {
  /** Most recently visited first. Empty on the server and before hydration. */
  recents: RecentEntity[];
  /** Record a visit. The instant is stamped here, so callers pass only what the record *is*. */
  record: (entry: Omit<RecentEntity, "at">) => void;
  /** Forget everything — the way out of a history one does not want kept. */
  clear: () => void;
}

export function useRecentEntities(collectionId: string): RecentEntitiesStore {
  const key = `${KEY_PREFIX}${collectionId}`;

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
  const getSnapshot = useCallback(() => read(key), [key]);
  const getServerSnapshot = useCallback(() => EMPTY, []);

  const recents = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const record = useCallback(
    (entry: Omit<RecentEntity, "at">) => {
      const current = read(key);
      const next = recordRecentEntity(current, { ...entry, at: Date.now() });
      // A revisit of the entry already at the front changes nothing but the instant, which nothing
      // on screen shows — so it is not worth a write and a re-render of every subscriber.
      const head = current[0];
      if (
        head &&
        head.kind === entry.kind &&
        head.id === entry.id &&
        head.href === entry.href &&
        head.label === entry.label &&
        head.sublabel === entry.sublabel
      ) {
        return;
      }
      write(key, next);
    },
    [key]
  );

  const clear = useCallback(() => {
    write(key, []);
  }, [key]);

  return { recents, record, clear };
}
