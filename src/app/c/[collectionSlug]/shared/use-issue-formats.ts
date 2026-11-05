"use client";

import { useQuery } from "@tanstack/react-query";
import type { StampIssueFormatData } from "@/lib/stamp-issue-formats";

/** The query key of the collection's issue formats; Settings invalidates it on every change. */
export function issueFormatsQueryKey(collectionId: string) {
  return ["issueFormats", collectionId] as const;
}

/**
 * The collection's issue formats (#2439), fetched client-side for the issue-format filter (#2440):
 * the filter sits on a dozen lists, builders and pickers, and threading one more dictionary through
 * every page and dialog that draws one buys nothing — the copy formats' `useCollectionFormats` reason.
 */
export function useCollectionIssueFormats(collectionId: string) {
  return useQuery<StampIssueFormatData[]>({
    queryKey: issueFormatsQueryKey(collectionId),
    queryFn: async () => {
      const { getStampIssueFormatsAction } = await import("@/app/actions/stamp-issue-formats");
      return getStampIssueFormatsAction(collectionId);
    },
    staleTime: 60_000,
  });
}
