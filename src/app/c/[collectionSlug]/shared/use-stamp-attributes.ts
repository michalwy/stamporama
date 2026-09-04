"use client";

import { useQuery } from "@tanstack/react-query";
import type { StampAttributeLists } from "@/lib/stamp-attributes";

/**
 * The collection's four attribute dictionaries (#72), cached for the screens that offer them as
 * choices — the stamp list's filters (#737) among them. One query for all four, because they are
 * loaded together everywhere they are used and a screen offering colours also offers papers.
 *
 * Mirrors {@link useCollectionConditions}: a handful of rows a screen can hold, so a control looks
 * a name up rather than having it threaded through every read model that carries an id.
 */
export function useCollectionStampAttributes(collectionId: string) {
  return useQuery<StampAttributeLists>({
    queryKey: ["stamp-attributes", collectionId],
    queryFn: async () => {
      const { getStampAttributeListsAction } = await import("@/app/actions/stamp-attributes");
      return getStampAttributeListsAction(collectionId);
    },
    staleTime: 60_000,
  });
}
