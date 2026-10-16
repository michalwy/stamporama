"use client";

import { useQuery } from "@tanstack/react-query";
import type { PlatformListItem } from "@/lib/platforms";

export const platformKeys = {
  all: (collectionId: string) => ["platforms", collectionId] as const,
};

/**
 * Every platform of the collection (#1955), switched off ones included. A screen offering platforms
 * for a **new** record keeps `enabled` ones — plus whichever one the record already names — and a
 * screen naming the platform of something already recorded reads them all. Bounded, so fetched whole.
 */
export function usePlatforms(collectionId: string) {
  return useQuery<PlatformListItem[]>({
    queryKey: platformKeys.all(collectionId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/platforms`);
      if (!res.ok) throw new Error("Failed to fetch platforms");
      const data = await res.json();
      return data.items;
    },
  });
}
