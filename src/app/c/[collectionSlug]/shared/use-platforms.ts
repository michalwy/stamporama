"use client";

import { useQuery } from "@tanstack/react-query";
import type { PlatformListItem } from "@/lib/platforms";
import type { PlatformFigures } from "@/lib/platform-figures";

export const platformKeys = {
  all: (collectionId: string) => ["platforms", collectionId] as const,
  figures: (collectionId: string, platformId: string) =>
    ["platforms", collectionId, "figures", platformId] as const,
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

/** A platform's figures (#1960) — the summary strip's second row on its Settings page. */
export function usePlatformFigures(collectionId: string, platformId: string) {
  return useQuery<PlatformFigures>({
    queryKey: platformKeys.figures(collectionId, platformId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/platforms/${platformId}/figures`);
      if (!res.ok) throw new Error("Failed to fetch the platform's figures");
      return res.json();
    },
  });
}
