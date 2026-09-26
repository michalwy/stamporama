"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CollectionStructure } from "@/lib/collection-structure";
import type { AreaFacet } from "@/lib/area-facets";
import type { ItemYearFacet } from "@/lib/items";

/**
 * The collection structure screen's reads (#1401). Each takes a query string the panel has already
 * built, so the keys are the strings themselves.
 *
 * Under the `inventory` root on purpose: every copy edit invalidates that root
 * (`useInvalidateInventory`), and a count of copies that did not move when a copy did would be the
 * figure disagreeing with the list the screen exists to agree with.
 */
export function useCollectionStructure(collectionId: string, query: string) {
  return useQuery<CollectionStructure>({
    queryKey: ["inventory", collectionId, "structure", query] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/items/structure?${query}`);
      if (!res.ok) throw new Error("Failed to load the collection's structure");
      return res.json();
    },
    // A drill-down keeps the table on screen while the next one loads, rather than blanking it.
    placeholderData: keepPreviousData,
  });
}

/** The rail's year facets — the Copies list's own route, under the screen's filters less the year. */
export function useStructureYearFacets(collectionId: string, query: string) {
  return useQuery<ItemYearFacet[]>({
    queryKey: ["inventory", collectionId, "structure-years", query] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/items/years?${query}`);
      if (!res.ok) throw new Error("Failed to fetch inventory years");
      return (await res.json()).years;
    },
  });
}

/** The rail's area counts — the Copies list's own route, under the screen's filters less the area. */
export function useStructureAreaFacets(collectionId: string, query: string) {
  return useQuery<AreaFacet[]>({
    queryKey: ["inventory", collectionId, "structure-areas", query] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/items/areas?${query}`);
      if (!res.ok) throw new Error("Failed to fetch area counts");
      return (await res.json()).areas;
    },
  });
}
