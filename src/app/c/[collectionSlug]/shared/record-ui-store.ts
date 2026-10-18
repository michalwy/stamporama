"use client";

import {
  forgetEntry,
  storedBytes,
  touchAndEvict,
  type Caps,
  type UiStateIndexEntry,
} from "@/lib/purchase-ui-state";

import { lsGet, lsRemove } from "./lot-view-prefs";

/**
 * The `localStorage` writer behind a screen's remembered **per-record** UI state — one entry per
 * record plus a most-recently-used index holding each entry's size, capped on a count and a byte
 * budget at once. The purchase order's state (`purchase-ui-state.ts`) was first; a sale's expanded
 * sold sets (#2034) are the second, and each passes its own index key and caps so the two budgets
 * never compete. The pure half — the eviction rule and the reasoning for it — is in
 * `@/lib/purchase-ui-state`.
 */
export interface RecordUiStore {
  /** Store `raw` under `key`, or remove the entry when `raw` is null — a screen at its defaults is
   * not worth a slot, so a record merely opened in passing never pushes out one being worked on. */
  write(key: string, raw: string | null): void;
}

export function createRecordUiStore(indexKey: string, caps: Caps): RecordUiStore {
  function readIndex(): UiStateIndexEntry[] {
    const raw = lsGet(indexKey);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((row): UiStateIndexEntry[] => {
        if (!Array.isArray(row) || row.length < 3) return [];
        const [key, at, bytes] = row as unknown[];
        if (typeof key !== "string" || typeof at !== "number" || typeof bytes !== "number") return [];
        return [{ key, at, bytes }];
      });
    } catch {
      return [];
    }
  }

  function writeIndex(index: readonly UiStateIndexEntry[]): void {
    // Tuples rather than objects: the index is written on every toggle, and field names repeated
    // fifty times are the larger half of it.
    trySet(indexKey, JSON.stringify(index.map((e) => [e.key, e.at, e.bytes])));
  }

  function removeEntry(key: string): void {
    lsRemove(key);
    writeIndex(forgetEntry(readIndex(), key));
  }

  return {
    write(key, raw) {
      if (raw === null) {
        removeEntry(key);
        return;
      }
      const { index, evicted } = touchAndEvict(readIndex(), key, Date.now(), storedBytes(raw), caps);
      for (const dropped of evicted) lsRemove(dropped);

      // The quota is shared with every other stored preference, so it can be full even when this
      // store is well inside its own budget. Give up the least-recently-used record and try again.
      let live = index;
      while (!trySet(key, raw)) {
        if (live.length <= 1) {
          // Nothing left to trade: keep the screen working and leave the index describing what is
          // actually stored, rather than claiming an entry that failed to write.
          writeIndex(forgetEntry(live, key));
          return;
        }
        const oldest = live[live.length - 1];
        live = live.slice(0, -1);
        lsRemove(oldest.key);
      }
      writeIndex(live);
    },
  };
}

/** `lsSet` swallows a full quota, which is exactly what this store has to react to — so it writes
 * through its own setter and reports whether the write landed. */
function trySet(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
