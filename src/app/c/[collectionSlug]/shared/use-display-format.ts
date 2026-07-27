"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StampFormatData } from "@/lib/stamp-formats";

/**
 * The **physical format** whose price fills list price columns (#343), the peer of
 * `use-display-condition.ts` — a price is keyed on condition × certificate × format (ADR-0020), and
 * a collector working through their blocks wants the block column, not the single one.
 *
 * Mirrors the condition hook deliberately, down to the localStorage-per-collection persistence and
 * the `useSyncExternalStore` read: two switchers sitting side by side must not behave differently.
 *
 * One difference: the default is **Single**, which is a `null` formatId and not a row in the
 * dictionary (ADR-0020 — there is no "single" record and none is seeded). So the stored value is
 * `""` for Single, and "nothing stored" resolves to Single rather than to the first entry.
 */
function storageKey(collectionId: string): string {
  return `stamporama:displayFormat:${collectionId}`;
}

const CHANGE_EVENT = "stamporama:displayFormat";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useCollectionFormats(collectionId: string) {
  return useQuery<StampFormatData[]>({
    queryKey: ["formats", collectionId],
    queryFn: async () => {
      const { getStampFormatsAction } = await import("@/app/actions/stamp-formats");
      return getStampFormatsAction(collectionId);
    },
    staleTime: 60_000,
  });
}

export function useDisplayFormat(collectionId: string) {
  const { data: formats } = useCollectionFormats(collectionId);

  const key = storageKey(collectionId);
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null
  );

  const setDisplayFormatId = useCallback(
    (id: string | null) => {
      try {
        localStorage.setItem(storageKey(collectionId), id ?? "");
        window.dispatchEvent(new Event(CHANGE_EVENT));
      } catch {
        // Ignore storage failures (private mode, quota).
      }
    },
    [collectionId]
  );

  // A stored id that no longer exists (the format was deleted) falls back to Single, which is
  // always valid — unlike the condition hook there is no "first row" to fall back to.
  const displayFormatId = stored && formats?.some((f) => f.id === stored) ? stored : null;

  return {
    formats: formats ?? [],
    displayFormatId,
    setDisplayFormatId,
  };
}
