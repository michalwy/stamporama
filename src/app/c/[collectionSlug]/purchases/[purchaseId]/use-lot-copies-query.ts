"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CopyDispositionFilter,
  ItemListItem,
  LotCopySort,
  LotCopyFilter,
  LotIntakeSummary,
  PurchaseIntakeSummary,
} from "@/lib/items";
import type { LocationRefUsage } from "@/lib/locations";
import type { SetCompletenessByIssue } from "@/lib/lot-set-completeness";
import type { PurchaseReturn } from "@/lib/purchase-return";
import type { CopyContainer } from "@/lib/lot-selection";
import { formatTilePhotoRoles, type TilePhotoRole } from "@/lib/tile-photo-roles";

interface LotCopiesPage {
  items: ItemListItem[];
  nextCursor: string | null;
}

/** The two filter axes the sort screen can narrow its copies by (#622) — the header chip and what
 * the copies are kept for. Travel together everywhere: the paged reads, the summaries whose issue
 * groups must not outlive them (#623), and the containers a selection records. */
export interface IntakeFilterParams {
  filter?: LotCopyFilter;
  disposition?: CopyDispositionFilter;
}

export interface LotCopiesParams extends IntakeFilterParams {
  sort?: LotCopySort;
  sortDir?: "asc" | "desc";
  /** Photo slots that must be free, for a scan tile's assign list (#567). Part of the params, so it
   * is part of the query key: two tiles needing different slots are two different lists, and one
   * needing the same slots is served from cache. */
  freePhotoSlots?: readonly TilePhotoRole[];
  /** Restrict to a single issue group (issue id or `"__none__"`) for the grouped view. */
  issueKey?: string;
}

export const lotCopiesKeys = {
  all: (collectionId: string) => ["lot-copies", collectionId] as const,
  lot: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId] as const,
  list: (collectionId: string, lotId: string, params: LotCopiesParams) =>
    ["lot-copies", collectionId, lotId, "list", params] as const,
  summary: (collectionId: string, lotId: string, filters: IntakeFilterParams) =>
    ["lot-copies", collectionId, lotId, "summary", filters] as const,
  purchaseList: (collectionId: string, purchaseId: string, params: LotCopiesParams) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "list", params] as const,
  purchaseSummary: (collectionId: string, purchaseId: string, filters: IntakeFilterParams) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "summary", filters] as const,
  purchaseReturn: (collectionId: string, purchaseId: string) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "return"] as const,
  lotReturn: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId, "return"] as const,
  completeness: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId, "completeness"] as const,
  purchaseCompleteness: (collectionId: string, purchaseId: string) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "completeness"] as const,
};

/** A server-resolved bulk scope (#172/#571): the lot or purchase the screen is about, plus the
 * selection's own dimensions. Mirrors the server `LotBulkScope` minus the collection id. */
export interface BulkScopeClient {
  lotId?: string;
  purchaseId?: string;
  onlyOpenLots?: boolean;
  /** The ticked containers — a lot, an issue group, or everything — unioned. */
  selectors?: CopyContainer[];
  /** Copies ticked one by one, taken in addition to the containers. */
  itemIds?: string[];
  excludeSelectors?: CopyContainer[];
  excludeItemIds?: string[];
}

/** The scope as name/value pairs — the one encoding both the count read and the write use, so
 * what the bar says it is about and what the write touches cannot drift apart (#571). The
 * containers go as JSON: they are records of optional fields, and flattening them into parallel
 * lists is exactly how a lot and an issue key end up paired with the wrong partner. */
export function bulkScopeFields(scope: BulkScopeClient): [string, string][] {
  const out: [string, string][] = [];
  const put = (name: string, value: string | undefined) => {
    if (value) out.push([name, value]);
  };
  put("lotId", scope.lotId);
  put("purchaseId", scope.purchaseId);
  put("selectors", scope.selectors?.length ? JSON.stringify(scope.selectors) : undefined);
  put(
    "excludeSelectors",
    scope.excludeSelectors?.length ? JSON.stringify(scope.excludeSelectors) : undefined
  );
  put("itemIds", scope.itemIds?.join(","));
  put("excludeItemIds", scope.excludeItemIds?.join(","));
  if (scope.onlyOpenLots) out.push(["onlyOpenLots", "true"]);
  return out;
}

/** How many copies the current selection holds (#571). Read from the server because the bar
 * cannot count itself: a ticked issue group under a filter chip has no client-side figure, and
 * `unpriced` is a valuation rather than a column. `placeholderData` keeps the last number on
 * screen while a tick is being counted, so the bar never blinks to nothing mid-selection. */
export function useLotSelectionCount(collectionId: string, scope: BulkScopeClient | null) {
  const fields = scope ? bulkScopeFields(scope) : [];
  return useQuery<{ count: number }>({
    queryKey: ["lot-copies", collectionId, "selection-count", fields] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/selection-count?${new URLSearchParams(
          fields
        ).toString()}`
      );
      if (!res.ok) throw new Error("Failed to count the selection");
      return res.json();
    },
    placeholderData: (prev) => prev,
    enabled: !!scope,
  });
}

function buildCopyParams(params: LotCopiesParams, offset?: string): URLSearchParams {
  const sp = new URLSearchParams();
  if (offset) sp.set("offset", offset);
  if (params.sort) sp.set("sort", params.sort);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  if (params.filter) sp.set("filter", params.filter);
  if (params.disposition) sp.set("disposition", params.disposition);
  if (params.issueKey) sp.set("issueKey", params.issueKey);
  if (params.freePhotoSlots?.length) {
    sp.set("freePhotoSlots", formatTilePhotoRoles(params.freePhotoSlots));
  }
  return sp;
}

/** Infinite (cursor) list of a lot's copies for the paginated intake view (#172). Ordering,
 * filtering, and the issue-group scope are resolved server-side so scrolling never drops a
 * copy — replacing the old whole-lot load capped at 1000. */
export function useLotCopiesInfinite(
  collectionId: string,
  lotId: string,
  params: LotCopiesParams,
  enabled = true,
  /**
   * How long a fetched page stays fresh. Default 0, as everywhere else on this screen.
   *
   * The scan-tile assign list (#567) sets one, because it *waits* for a non-stale answer before
   * choosing which outcome to open on: at the default every reopen refetches, so a card of forty
   * tiles would pause forty times. Invalidation is unaffected — `isInvalidated` short-circuits
   * ahead of `staleTime` in `isStaleByTime` — so every write on this screen still forces the next
   * open to re-ask, which is what the caller's window is sized against.
   */
  staleTime = 0
) {
  return useInfiniteQuery<LotCopiesPage>({
    queryKey: lotCopiesKeys.list(collectionId, lotId, params),
    staleTime,
    queryFn: async ({ pageParam }) => {
      const sp = buildCopyParams(params, pageParam as string | undefined);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/copies?${sp.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch lot copies");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** Infinite (cursor) list of a whole purchase's copies (across all lots), for the order-level
 * intake view with "By lot" grouping off — one globally-ordered flat/by-issue stream (#172) — and,
 * since #586, for a scan tile's assign list, whose candidates are the order's copies rather than
 * one lot's. `staleTime` carries the same reasoning it does on the per-lot read above. */
export function usePurchaseCopiesInfinite(
  collectionId: string,
  purchaseId: string,
  params: LotCopiesParams,
  enabled = true,
  staleTime = 0
) {
  return useInfiniteQuery<LotCopiesPage>({
    queryKey: lotCopiesKeys.purchaseList(collectionId, purchaseId, params),
    staleTime,
    queryFn: async ({ pageParam }) => {
      const sp = buildCopyParams(params, pageParam as string | undefined);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/copies?${sp.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch purchase copies");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** Whole-lot aggregates (header counts, cost-estimate denominator, derived label, issue
 * groups) the paginated views can no longer compute client-side (#172).
 *
 * Takes the list's filters, and keys on them: the issue groups it reports are the groups the filters
 * leave with copies in them (#623), so a summary shared across chips would keep drawing the ones the
 * chip just emptied. The chip counts inside it stay whole-lot whatever is passed. */
export function useLotSummary(
  collectionId: string,
  lotId: string,
  filters: IntakeFilterParams = {},
  enabled = true
) {
  return useQuery<LotIntakeSummary>({
    queryKey: lotCopiesKeys.summary(collectionId, lotId, filters),
    queryFn: async () => {
      const sp = buildCopyParams(filters);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/copies/summary?${sp.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch lot summary");
      return res.json();
    },
    enabled,
  });
}

/** Whole-purchase aggregates for the order-level view (#172): the per-lot estimate denominator
 * (each copy's estimate uses its own lot's pool + weight base) and issue groups merged across
 * all the purchase's lots. */
export function usePurchaseSummary(
  collectionId: string,
  purchaseId: string,
  filters: IntakeFilterParams = {},
  enabled = true
) {
  return useQuery<PurchaseIntakeSummary>({
    queryKey: lotCopiesKeys.purchaseSummary(collectionId, purchaseId, filters),
    queryFn: async () => {
      const sp = buildCopyParams(filters);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/copies/summary?${sp.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch purchase summary");
      return res.json();
    },
    enabled,
  });
}

/** What the order cost against what selling its copies has brought back (#559). Keyed under the
 * purchase's copies, since attaching, removing or closing copies moves the figure exactly as a sale
 * does — one invalidation covers both. */
export function usePurchaseReturn(collectionId: string, purchaseId: string, enabled = true) {
  return useQuery<PurchaseReturn>({
    queryKey: lotCopiesKeys.purchaseReturn(collectionId, purchaseId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/purchases/${purchaseId}/return`);
      if (!res.ok) throw new Error("Failed to fetch purchase return");
      return res.json();
    },
    enabled,
  });
}

/** The same figure for one lot (#559). Loaded beside the lot's own summary, and only while the lot
 * card is expanded — a collapsed lot draws no bar to put it in. */
export function useLotReturn(collectionId: string, lotId: string, enabled = true) {
  return useQuery<PurchaseReturn>({
    queryKey: lotCopiesKeys.lotReturn(collectionId, lotId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/return`
      );
      if (!res.ok) throw new Error("Failed to fetch lot return");
      return res.json();
    },
    enabled,
  });
}

/**
 * Per-checklist for-sale completeness for a lot's issue groups (#563), keyed by issue id.
 *
 * One read for **every** group on screen rather than one per header: the copies are cursor-paged but
 * the groups are not, so this costs the same whether the collector scrolls to the end of the lot or
 * not. Loaded only while the card is open *and* grouped by issue — there is nowhere else to draw it,
 * and the collection-wide half is the expensive one.
 *
 * Keyed under the lot's copies, so filing, sorting or re-identifying a copy refetches it along with
 * everything else: moving a copy to *For sale*, or out of `ordered`, is exactly what moves this
 * figure.
 */
export function useLotSetCompleteness(collectionId: string, lotId: string, enabled = true) {
  return useQuery<SetCompletenessByIssue>({
    queryKey: lotCopiesKeys.completeness(collectionId, lotId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/copies/completeness`
      );
      if (!res.ok) throw new Error("Failed to fetch lot completeness");
      return res.json();
    },
    enabled,
  });
}

/** The same for the order-level *by issue* view, whose groups span every lot of the purchase — so
 * *from here* reads as "arrived in this parcel". */
export function usePurchaseSetCompleteness(
  collectionId: string,
  purchaseId: string,
  enabled = true
) {
  return useQuery<SetCompletenessByIssue>({
    queryKey: lotCopiesKeys.purchaseCompleteness(collectionId, purchaseId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/copies/completeness`
      );
      if (!res.ok) throw new Error("Failed to fetch purchase completeness");
      return res.json();
    },
    enabled,
  });
}

/** The refs already written in one storage location, and the next one to suggest (#565). Read when
 * the file dialog's location changes — the whole set at once, because a location holds as many refs
 * as it has cards in it, and having them client-side is what lets the dialog answer *"`A147`
 * already holds 12 copies"* the moment a ref is typed instead of a round trip per keystroke. */
export function useLocationRefUsage(collectionId: string, locationId: string) {
  return useQuery<LocationRefUsage>({
    queryKey: ["location-ref-usage", collectionId, locationId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/locations/${locationId}/ref-usage`
      );
      if (!res.ok) throw new Error("Failed to fetch location refs");
      return res.json();
    },
    enabled: !!locationId,
  });
}

/** Invalidate every lot-copies list and summary for a collection after a copy/lot mutation,
 * so paginated pages and their aggregates refetch together. */
export function useInvalidateLotCopies() {
  const queryClient = useQueryClient();
  return {
    invalidateLotCopies: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: lotCopiesKeys.all(collectionId) }),
  };
}
