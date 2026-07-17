# 0004 — TanStack Query for Client-Side Data Fetching

**Status:** Accepted  
**Date:** 2026-07-17

## Context

Collection screens (issues list, area detail) were loading all data server-side and passing it as props. As collections grow, this becomes a bottleneck: large SSR payloads, no pagination, and full re-fetch on every mutation via `router.refresh()`.

AGENTS.md already planned TanStack Query for collection screens and cursor-backed infinite loading for large lists.

## Decision

Introduce `@tanstack/react-query` for client-side data fetching in collection screens.

### Scope

- **Read queries** move to TanStack Query via `useInfiniteQuery` (paginated lists) and `useQuery` (lazy-loaded detail data).
- **Mutations** remain as Next.js server actions. After a successful mutation, the component invalidates the relevant TanStack Query caches instead of calling `router.refresh()`.
- **API routes** serve the paginated data: `GET /api/collections/[collectionId]/issues` and `.../[issueId]/members`.

### Conventions

- `QueryProvider` wraps collection layout only (`src/app/c/[collectionSlug]/layout.tsx`), not the root layout.
- Query keys use a factory pattern in `use-issues-query.ts`: `issueKeys.all(collectionId)`, `issueKeys.list(...)`, `issueKeys.members(...)`.
- After mutations, invalidate `issueKeys.all(collectionId)` to cover both list and member caches. For stamp-level mutations, also invalidate the specific `issueKeys.members(...)`.

## Consequences

- Collection screens no longer block on full data load during SSR. The shell renders immediately; data streams in via client-side queries.
- Pagination (cursor-based, 50 items per page) and infinite scroll keep memory and transfer size bounded.
- Stamp members load on demand (when a row is expanded), reducing initial payload significantly.
- The move-stamp dialog can only target issues from already-loaded pages, not the full set. Acceptable for now.
