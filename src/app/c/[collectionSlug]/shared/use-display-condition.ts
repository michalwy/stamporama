"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StampConditionData } from "@/lib/conditions";

/**
 * The condition whose price fills list price columns. The choice is persisted in
 * localStorage per collection; there is no server-side default setting (see #95).
 * When nothing is stored, the selection resolves to the first condition by
 * sortOrder — matching the server's fallback in `resolveDisplayConditionId`.
 */
function storageKey(collectionId: string): string {
  return `stamporama:displayCondition:${collectionId}`;
}

const CHANGE_EVENT = "stamporama:displayCondition";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useCollectionConditions(collectionId: string) {
  return useQuery<StampConditionData[]>({
    queryKey: ["conditions", collectionId],
    queryFn: async () => {
      const { getStampConditionsAction } = await import("@/app/actions/conditions");
      return getStampConditionsAction(collectionId);
    },
    staleTime: 60_000,
  });
}

export function useDisplayCondition(collectionId: string) {
  const { data: conditions } = useCollectionConditions(collectionId);

  // Read the persisted choice without setState-in-effect. getServerSnapshot
  // returns null so SSR and the first client render agree.
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

  const setDisplayConditionId = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(storageKey(collectionId), id);
        window.dispatchEvent(new Event(CHANGE_EVENT));
      } catch {
        // Ignore storage failures (private mode, quota).
      }
    },
    [collectionId]
  );

  // Effective selection: stored value if still valid, else the first condition.
  const validStored =
    stored && conditions?.some((c) => c.id === stored) ? stored : null;
  const displayConditionId = validStored ?? conditions?.[0]?.id ?? null;

  return {
    conditions: conditions ?? [],
    displayConditionId,
    setDisplayConditionId,
  };
}
