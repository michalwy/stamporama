import type { InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";

// The notification centre re-reads its items whenever any other read is invalidated
// (`action-items-bell.tsx`), because no mutation knows it exists. That is the right default and stays
// one. This is the way out for a save that knows it cannot change anything the centre counts (#2426) —
// a price typed on a Preparing offer — so the badge is not read again, a collection-wide read, for an
// edit that could not move it.

/** The reads whose next invalidation the centre does not follow, by query hash. */
const quiet = new Set<string>();

/**
 * `invalidateQueries`, without the notification centre following it. Only the queries that this call
 * actually invalidates are marked — one already stale sends no event, and marking it would swallow
 * the next invalidation that does mean something.
 */
export function invalidateWithoutActionItems(
  queryClient: QueryClient,
  filters: InvalidateQueryFilters
): Promise<void> {
  for (const query of queryClient.getQueryCache().findAll(filters)) {
    if (!query.state.isInvalidated) quiet.add(query.queryHash);
  }
  return queryClient.invalidateQueries(filters);
}

/** Whether this invalidation was one of {@link invalidateWithoutActionItems}'s — consumed as read. */
export function takeQuietInvalidation(queryHash: string): boolean {
  return quiet.delete(queryHash);
}
