"use client";

import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@/lib/tags";

/**
 * The collection's tag dictionary (#152) — what the edit dialogs' tag field suggests (#1192), and
 * what the tag filters and the Copies list's bulk edit offer.
 *
 * Its own hook rather than a prop, for the reason `useCollectionConditions` is one: the dictionary
 * is small, per-collection and rarely changes, and the screens that need it are rendered from
 * pages that have no other reason to load it. What a *chip* draws does not come from here — a tag's
 * name and colour ride on the row (see `tag-chip.tsx`), so a list never waits on this query.
 */
export const tagKeys = {
  all: (collectionId: string) => ["tags", collectionId] as const,
};

export function useCollectionTags(collectionId: string) {
  return useQuery<TagSummary[]>({
    queryKey: tagKeys.all(collectionId),
    queryFn: async () => {
      const { listTagsAction } = await import("@/app/actions/tags");
      return listTagsAction(collectionId);
    },
    staleTime: 60_000,
  });
}
