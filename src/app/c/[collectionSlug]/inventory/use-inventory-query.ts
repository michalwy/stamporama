"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CopyGroupRow,
  IssueGroupCompleteness,
  LocationGroupRow,
  IssueGroupRow,
  ItemListItem,
  ItemSortBy,
  ItemVariantHistoryData,
  ItemYearFacet,
} from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import type { LocationGroupBy } from "@/lib/location-groups";
import type { HoldingsSummary } from "@/lib/valuation";
import type { ContactData } from "@/lib/contacts";
import type { StampNodeData } from "@/lib/issues";
import type { StampSearchItem } from "@/lib/stamps";
import type { StampHoldings } from "@/lib/stamp-holdings";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { LocationData } from "@/lib/locations";
import { DEFAULT_ITEM_NO_PAD } from "@/lib/item-number";

interface InventoryItemsPage {
  items: ItemListItem[];
  nextCursor: string | null;
}

interface CopyGroupsPage {
  groups: CopyGroupRow[];
  nextCursor: string | null;
}

interface LocationGroupsPage {
  groups: LocationGroupRow[];
  nextCursor: string | null;
}

interface IssueGroupsPage {
  groups: IssueGroupRow[];
  nextCursor: string | null;
}

export interface InventoryItemFilters {
  /** The conditions in scope (#425) — an OR, absent meaning every condition. A list because the
   * filter is a multi-select; a duplicate group addressing its members passes the single condition
   * it grouped on through the same field. */
  conditionIds?: string[];
  /** The certificate statuses in scope (#428) — an OR, absent meaning every status. `"none"` is a
   * tickable value like any other and matches the copies with no certificate: null *is* a value here
   * (ADR-0006 §2), which an absent filter cannot express. */
  certificateStatusIds?: string[];
  /** The physical formats in scope (#343, #427) — an OR, absent meaning every format. `"single"` is
   * a tickable value like any other and matches the copies with no format set: null *is* the single
   * (ADR-0020), which an absent filter cannot express. */
  formatIds?: string[];
  /** Restrict to copies whose linked stamp belongs to any of these areas (selected area
   * plus descendants). Mirrors the stamps list area sidebar (#106). */
  areaIds?: string[];
  /** Free-text search over the linked stamp's name, issue name, and catalog numbers (#106). */
  search?: string;
  /** Parsed catalog number + optional vendor when the search box reads as a prefixed
   * catalog number ("Mi PL 200", #146). */
  catalogVendorId?: string;
  catalogNumber?: string;
  /** Restrict to copies of a single stamp (stamp-level inventory popup, #110). */
  stampId?: string;
  /** Restrict to copies of any stamp in an issue (issue-level inventory popup, #110). */
  issueId?: string;
  /** Restrict to copies stored in a location or its descendants (subtree, #56). */
  locationId?: string;
  /** Narrow {@link locationId} to that location alone, dropping its descendants (#385). */
  locationExact?: boolean;
  /** Restrict to copies carrying this exact in-location ref (#421); `"none"` is the copies with
   * none. Set by a ref group to address its own members. */
  locationRef?: string;
  /** Restrict to copies whose linked stamp has this issued year. "none" for the
   * no-year bucket, otherwise a numeric year string (#142). */
  year?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  /** Restrict to copies with no attached photos (#177). */
  noPhotos?: boolean;
  /** Restrict to copies missing a catalog value — unpriced for their condition (#229). */
  missingCatalogValue?: boolean;
  /** Restrict to for-sale copies not yet offered on this platform (#259) — no non-terminal offer
   * on it, and not set aside from it (#506). Implies "for sale". */
  notOfferedPlatformId?: string;
  /** Restrict to the copies deliberately kept off this platform (#506) — the review read that makes
   * an exclusion reversible. Carries no disposition of its own. */
  excludedPlatformId?: string;
  /** The physical delivery states in scope (ADR-0009 §5, #272, #427) — an OR, absent meaning every
   * state, so "everything still on its way to me" is one filter rather than three passes. */
  deliveryStates?: string[];
  /** Show copies that have already sold (#207). Sold copies are hidden by default; set true to
   * include them. */
  includeGone?: boolean;
  /** Show copies no longer held (#394/#395) — lost, damaged in storage, discarded. Hidden by
   * default, since the list answers "what do I have". */
  includeDisposed?: boolean;
  sortBy?: ItemSortBy;
  sortDir?: "asc" | "desc";
}

/** Filters that affect the year facet counts (everything except year itself). */
export interface InventoryYearFacetFilters {
  conditionIds?: string[];
  certificateStatusIds?: string[];
  formatIds?: string[];
  areaIds?: string[];
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  stampId?: string;
  issueId?: string;
  locationId?: string;
  locationExact?: boolean;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  noPhotos?: boolean;
  missingCatalogValue?: boolean;
  /** Restrict to for-sale copies not yet offered on this platform (#259). */
  notOfferedPlatformId?: string;
  /** Restrict to the copies deliberately kept off this platform (#506). */
  excludedPlatformId?: string;
  /** The physical delivery states in scope (ADR-0009 §5, #272, #427) — an OR, absent meaning every
   * state, so "everything still on its way to me" is one filter rather than three passes. */
  deliveryStates?: string[];
  /** Include already-sold copies in the facet counts (#207); hidden by default. */
  includeGone?: boolean;
  /** Include copies no longer held in the facet counts (#395); hidden by default. */
  includeDisposed?: boolean;
}

export const inventoryKeys = {
  all: (collectionId: string) => ["inventory", collectionId] as const,
  list: (collectionId: string, filters: InventoryItemFilters) =>
    ["inventory", collectionId, "list", filters] as const,
  groups: (
    collectionId: string,
    filters: InventoryItemFilters,
    axes: CopyGroupAxes
  ) => ["inventory", collectionId, "groups", filters, axes] as const,
  locationGroups: (
    collectionId: string,
    filters: InventoryItemFilters,
    by: LocationGroupBy
  ) => ["inventory", collectionId, "locationGroups", filters, by] as const,
  issueGroups: (collectionId: string, filters: InventoryItemFilters) =>
    ["inventory", collectionId, "issueGroups", filters] as const,
  issueGroupCompleteness: (
    collectionId: string,
    filters: InventoryItemFilters,
    issueIds: string[]
  ) => ["inventory", collectionId, "issueGroupCompleteness", filters, issueIds] as const,
  years: (collectionId: string, filters: InventoryYearFacetFilters) =>
    ["inventory", collectionId, "years", filters] as const,
};

/** The copy-set half of the query string — everything that decides *which* copies, and nothing
 * about ordering or pagination. Shared by the flat list and the duplicate groups (#372), which
 * narrow the same set and must never disagree about it. */
function itemFilterParams(filters: InventoryItemFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.conditionIds && filters.conditionIds.length > 0)
    params.set("conditionIds", filters.conditionIds.join(","));
  if (filters.certificateStatusIds && filters.certificateStatusIds.length > 0)
    params.set("certificateStatusIds", filters.certificateStatusIds.join(","));
  if (filters.formatIds && filters.formatIds.length > 0)
    params.set("formatIds", filters.formatIds.join(","));
  if (filters.areaIds && filters.areaIds.length > 0)
    params.set("areaIds", filters.areaIds.join(","));
  if (filters.search) params.set("search", filters.search);
  if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
  if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
  if (filters.stampId) params.set("stampId", filters.stampId);
  if (filters.issueId) params.set("issueId", filters.issueId);
  if (filters.locationId) params.set("locationId", filters.locationId);
  if (filters.locationExact) params.set("locationExact", "true");
  if (filters.locationRef) params.set("locationRef", filters.locationRef);
  if (filters.year) params.set("year", filters.year);
  if (filters.inCollection) params.set("inCollection", "true");
  if (filters.forSale) params.set("forSale", "true");
  if (filters.forTrade) params.set("forTrade", "true");
  if (filters.noPhotos) params.set("noPhotos", "true");
  if (filters.missingCatalogValue) params.set("missingCatalogValue", "true");
  if (filters.notOfferedPlatformId)
    params.set("notOfferedPlatformId", filters.notOfferedPlatformId);
  if (filters.excludedPlatformId)
    params.set("excludedPlatformId", filters.excludedPlatformId);
  if (filters.deliveryStates && filters.deliveryStates.length > 0)
    params.set("deliveryStates", filters.deliveryStates.join(","));
  if (filters.includeGone) params.set("includeGone", "true");
  if (filters.includeDisposed) params.set("includeDisposed", "true");
  return params;
}

export function useInventoryItemsInfinite(
  collectionId: string,
  filters: InventoryItemFilters,
  enabled = true
) {
  return useInfiniteQuery<InventoryItemsPage>({
    queryKey: inventoryKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = itemFilterParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortDir) params.set("sortDir", filters.sortDir);
      const res = await fetch(
        `/api/collections/${collectionId}/items?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch inventory items");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** The same copy set collapsed to one row per duplicate key (#372). Grouped server-side because
 * the list is offset-paginated — a client-side grouping would split a group at a page boundary.
 * The group's members are read back through {@link useInventoryItemsInfinite} with the key's own
 * filters, so no second endpoint exists for them. */
export function useCopyGroupsInfinite(
  collectionId: string,
  filters: InventoryItemFilters,
  axes: CopyGroupAxes,
  enabled = true
) {
  return useInfiniteQuery<CopyGroupsPage>({
    queryKey: inventoryKeys.groups(collectionId, filters, axes),
    queryFn: async ({ pageParam }) => {
      const params = itemFilterParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      if (axes.format) params.set("groupByFormat", "true");
      if (axes.certificate) params.set("groupByCertificate", "true");
      const res = await fetch(
        `/api/collections/${collectionId}/items/groups?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch duplicate groups");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** The same copy set collapsed to one row per storage location, or per `(location, ref)` pair
 * (#421). Server-side for the same reason as the duplicate groups, and its members come back
 * through {@link useInventoryItemsInfinite} with the group's own location / ref pinned. */
export function useLocationGroupsInfinite(
  collectionId: string,
  filters: InventoryItemFilters,
  by: LocationGroupBy,
  enabled = true
) {
  return useInfiniteQuery<LocationGroupsPage>({
    queryKey: inventoryKeys.locationGroups(collectionId, filters, by),
    queryFn: async ({ pageParam }) => {
      const params = itemFilterParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      params.set("by", by);
      const res = await fetch(
        `/api/collections/${collectionId}/items/location-groups?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch location groups");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** The same copy set collapsed to one row per issue (#424). Server-side for the same reason as the
 * other two groupings, and its members come back through {@link useInventoryItemsInfinite} with the
 * group's own issue pinned — `NO_ISSUE` for the copies belonging to no series. */
export function useIssueGroupsInfinite(
  collectionId: string,
  filters: InventoryItemFilters,
  enabled = true
) {
  return useInfiniteQuery<IssueGroupsPage>({
    queryKey: inventoryKeys.issueGroups(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = itemFilterParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      const res = await fetch(
        `/api/collections/${collectionId}/items/issue-groups?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch issue groups");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/**
 * Per-checklist, per-condition completeness for the issue groups on screen (#594), keyed by issue
 * id.
 *
 * A second query rather than a field on the groups page: the figure is only drawn in this one
 * grouping, and it is read **whole for the groups loaded so far** rather than per row — the server
 * answers the whole screen in a handful of queries, which is what lets a completeness figure sit on
 * a list at all (#133's reason for keeping the full grid on the issue's own page still stands).
 * Scrolling on a page of groups therefore re-asks for the longer list; the alternative, one request
 * per group row, is the shape that reasoning rules out.
 *
 * It takes the list's own filters, because the figures are counted over the copies the list is
 * showing. `NO_ISSUE` is not among the ids: the copies belonging to no series are no set.
 */
export function useIssueGroupCompleteness(
  collectionId: string,
  filters: InventoryItemFilters,
  issueIds: string[],
  enabled = true
) {
  return useQuery<IssueGroupCompleteness>({
    queryKey: inventoryKeys.issueGroupCompleteness(collectionId, filters, issueIds),
    queryFn: async () => {
      const params = itemFilterParams(filters);
      params.set("issueIds", issueIds.join(","));
      const res = await fetch(
        `/api/collections/${collectionId}/items/issue-groups/completeness?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch issue group completeness");
      return res.json();
    },
    enabled: enabled && issueIds.length > 0,
  });
}

/** Holdings valuation total over the whole filtered copy set (ADR-0007 §7, #101).
 * Shares the list's disposition/condition/certificate filters (not sort/pagination)
 * so the figure tracks what the list is showing.
 *
 * `includeDisposed` is deliberately **not** among them (#396): the server always reads the whole
 * scope and splits it into held copies and a write-off line, so passing the flag would only cost a
 * refetch for an identical answer. */
export function useHoldingsValuation(
  collectionId: string,
  filters: InventoryItemFilters
) {
  return useQuery<HoldingsSummary>({
    queryKey: ["inventory", collectionId, "valuation", {
      conditionIds: filters.conditionIds,
      certificateStatusIds: filters.certificateStatusIds,
      formatIds: filters.formatIds,
      areaIds: filters.areaIds,
      search: filters.search,
      catalogVendorId: filters.catalogVendorId,
      catalogNumber: filters.catalogNumber,
      issueId: filters.issueId,
      locationId: filters.locationId,
      locationExact: filters.locationExact,
      year: filters.year,
      inCollection: filters.inCollection,
      forSale: filters.forSale,
      forTrade: filters.forTrade,
      noPhotos: filters.noPhotos,
      missingCatalogValue: filters.missingCatalogValue,
      notOfferedPlatformId: filters.notOfferedPlatformId,
      excludedPlatformId: filters.excludedPlatformId,
      deliveryStates: filters.deliveryStates,
      includeGone: filters.includeGone,
    }] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.conditionIds && filters.conditionIds.length > 0)
        params.set("conditionIds", filters.conditionIds.join(","));
      if (filters.certificateStatusIds && filters.certificateStatusIds.length > 0)
        params.set("certificateStatusIds", filters.certificateStatusIds.join(","));
      if (filters.formatIds && filters.formatIds.length > 0)
        params.set("formatIds", filters.formatIds.join(","));
      if (filters.areaIds && filters.areaIds.length > 0)
        params.set("areaIds", filters.areaIds.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      if (filters.issueId) params.set("issueId", filters.issueId);
      if (filters.locationId) params.set("locationId", filters.locationId);
      if (filters.locationExact) params.set("locationExact", "true");
      if (filters.year) params.set("year", filters.year);
      if (filters.inCollection) params.set("inCollection", "true");
      if (filters.forSale) params.set("forSale", "true");
      if (filters.forTrade) params.set("forTrade", "true");
      if (filters.noPhotos) params.set("noPhotos", "true");
      if (filters.missingCatalogValue) params.set("missingCatalogValue", "true");
      if (filters.notOfferedPlatformId)
        params.set("notOfferedPlatformId", filters.notOfferedPlatformId);
      if (filters.excludedPlatformId)
        params.set("excludedPlatformId", filters.excludedPlatformId);
      if (filters.deliveryStates && filters.deliveryStates.length > 0)
        params.set("deliveryStates", filters.deliveryStates.join(","));
      if (filters.includeGone) params.set("includeGone", "true");
      const res = await fetch(
        `/api/collections/${collectionId}/items/valuation-summary?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch holdings valuation");
      return res.json();
    },
  });
}

/** Distinct issued years present in the current copy set, with counts (#142).
 * Respects every active filter except the year selection itself, so the panel
 * stays stable while a year is selected. */
export function useItemYears(
  collectionId: string,
  filters: InventoryYearFacetFilters
) {
  return useQuery<ItemYearFacet[]>({
    queryKey: inventoryKeys.years(collectionId, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.conditionIds && filters.conditionIds.length > 0)
        params.set("conditionIds", filters.conditionIds.join(","));
      if (filters.certificateStatusIds && filters.certificateStatusIds.length > 0)
        params.set("certificateStatusIds", filters.certificateStatusIds.join(","));
      if (filters.formatIds && filters.formatIds.length > 0)
        params.set("formatIds", filters.formatIds.join(","));
      if (filters.areaIds && filters.areaIds.length > 0)
        params.set("areaIds", filters.areaIds.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      if (filters.stampId) params.set("stampId", filters.stampId);
      if (filters.issueId) params.set("issueId", filters.issueId);
      if (filters.locationId) params.set("locationId", filters.locationId);
      if (filters.locationExact) params.set("locationExact", "true");
      if (filters.inCollection) params.set("inCollection", "true");
      if (filters.forSale) params.set("forSale", "true");
      if (filters.forTrade) params.set("forTrade", "true");
      if (filters.noPhotos) params.set("noPhotos", "true");
      if (filters.missingCatalogValue) params.set("missingCatalogValue", "true");
      if (filters.notOfferedPlatformId)
        params.set("notOfferedPlatformId", filters.notOfferedPlatformId);
      if (filters.excludedPlatformId)
        params.set("excludedPlatformId", filters.excludedPlatformId);
      if (filters.deliveryStates && filters.deliveryStates.length > 0)
        params.set("deliveryStates", filters.deliveryStates.join(","));
      if (filters.includeGone) params.set("includeGone", "true");
      if (filters.includeDisposed) params.set("includeDisposed", "true");
      const res = await fetch(
        `/api/collections/${collectionId}/items/years?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch inventory years");
      const data = await res.json();
      return data.years;
    },
  });
}

/** Stamp nodes (base + variants) that belong to an issue, for the stamp picker.
 *
 * The picker browser's rows are paged (#604), so a row's tree is read here when the row needs it —
 * on expand, or to work out which of its stamps a search matched — rather than riding along with
 * every row on the page. `enabled` is what the caller holds that back with. */
export function useIssueMembers(collectionId: string, issueId: string, enabled = true) {
  return useQuery<StampNodeData[]>({
    queryKey: ["inventory", collectionId, "issueMembers", issueId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/issues/${issueId}/members`
      );
      if (!res.ok) throw new Error("Failed to fetch issue members");
      const data = await res.json();
      return data.members;
    },
    enabled: enabled && !!issueId,
  });
}

/** Refinement history for a copy (#100). Fetched lazily when a history view is opened. */
export function useItemVariantHistory(
  collectionId: string,
  itemId: string | null,
  enabled: boolean
) {
  return useQuery<ItemVariantHistoryData[]>({
    queryKey: ["inventory", collectionId, "variantHistory", itemId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/items/${itemId}/variant-history`
      );
      if (!res.ok) throw new Error("Failed to fetch variant history");
      const data = await res.json();
      return data.history;
    },
    enabled: enabled && !!itemId,
  });
}

/** Contact suggestions for the acquisition-source autocomplete (#108). Backed by the
 * #107 search API; disabled until the user types (the dropdown only opens then). */
export function useContactSearch(collectionId: string, query: string) {
  return useQuery<ContactData[]>({
    queryKey: ["inventory", collectionId, "contactSearch", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      const res = await fetch(
        `/api/collections/${collectionId}/contacts/search?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to search contacts");
      const data = await res.json();
      return data.items;
    },
    // The dropdown only opens once the user types; skip the redundant empty-query
    // fetch on mount (matches useIssueSearch).
    enabled: query.length >= 1,
  });
}

export function useInvalidateContacts() {
  const queryClient = useQueryClient();
  return {
    invalidateContacts: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: ["inventory", collectionId, "contactSearch"],
      }),
  };
}

/** Stamp/variant suggestions for the inventory picker autocomplete (#104). Backed
 * by the stamp-search API; disabled until the user types (the dropdown only opens
 * then), matching {@link useContactSearch}. */
export function useStampPickerSearch(collectionId: string, query: string) {
  return useQuery<StampSearchItem[]>({
    queryKey: ["inventory", collectionId, "stampSearch", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      const res = await fetch(
        `/api/collections/${collectionId}/stamps/search?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to search stamps");
      const data = await res.json();
      return data.items;
    },
    enabled: query.length >= 1,
  });
}

/**
 * What the collection already holds of one stamp, and what it is still after (#562) — the intake
 * step's *what you already hold* line.
 *
 * Keyed under the inventory prefix so `invalidateList` covers it; nothing invalidates it after an
 * intake, and nothing needs to: the dialog mounts afresh on each pick and the query is stale by
 * then, so the line is re-read for the stamp being looked at rather than kept in step for the
 * hundreds that are not.
 */
export function useStampHoldings(collectionId: string, stampId: string | null) {
  return useQuery<StampHoldings | null>({
    queryKey: ["inventory", collectionId, "stampHoldings", stampId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ stampId: stampId! });
      const res = await fetch(
        `/api/collections/${collectionId}/stamps/holdings?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch what you hold of this stamp");
      const data = await res.json();
      return data.holdings;
    },
    enabled: !!stampId,
  });
}

/** Certificate statuses for the add-copy dialog opened from list rows (#111). Mirrors
 * {@link useCollectionConditions}; both feed the add/edit dialog's selects client-side so
 * the stamp/issue lists don't have to thread server-loaded props down to every row.
 *
 * Re-exported from the shared hook rather than declared again: this file held a second copy under
 * its own query key, so a screen drawing coloured certificate chips (#728) and opening the copy
 * dialog would have fetched the same small dictionary twice and been able to show two answers. */
export { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";

/** Physical formats for the copy dialog's format select. Fetched client-side for the same
 * reason as {@link useCollectionCertificateStatuses}: the dialog is opened from four different
 * screens, and threading one more dictionary through every one of them buys nothing. */
export function useCollectionFormats(collectionId: string) {
  return useQuery<StampFormatData[]>({
    queryKey: ["stampFormats", collectionId] as const,
    queryFn: async () => {
      const { getStampFormatsAction } = await import("@/app/actions/stamp-formats");
      return getStampFormatsAction(collectionId);
    },
    staleTime: 60_000,
  });
}

/** The collection's internal copy-number width (#268), for every surface that renders one. A
 * client-side query rather than a prop for the same reason as the dictionaries above: the copy row
 * is rendered from eight screens, and threading one display setting through all of them to reach
 * it would touch every one. Cached long — it changes about once in a collection's life — and
 * `DEFAULT_ITEM_NO_PAD` covers the first paint, which only ever mis-pads by a leading zero. */
export function useCollectionItemNoPad(collectionId: string): number {
  const { data } = useQuery<number>({
    queryKey: ["itemNoPad", collectionId] as const,
    queryFn: async () => {
      const { getCollectionItemNoPadAction } = await import("@/app/actions/collections");
      return getCollectionItemNoPadAction(collectionId);
    },
    staleTime: 5 * 60_000,
  });
  return data ?? DEFAULT_ITEM_NO_PAD;
}

/** Storage locations for the add-copy dialog opened from list rows and the read-only
 * popup (#56). Mirrors {@link useCollectionCertificateStatuses}: fetched client-side so
 * the stamp/issue lists don't thread server-loaded locations down to every row.
 *
 * Re-read on every window focus, unlike the other dictionaries (#624). A new location is created
 * *mid-task*, in the other tab, precisely because the copies in hand need somewhere to go — and the
 * collector comes straight back to file them, well inside any stale window. Refetching whenever the
 * tab regains focus is what makes the picker show it without a reload; the list is a handful of rows,
 * so asking again costs about as much as deciding not to. */
export function useCollectionLocations(collectionId: string) {
  return useQuery<LocationData[]>({
    queryKey: ["locations", collectionId] as const,
    queryFn: async () => {
      const { getLocationsAction } = await import("@/app/actions/locations");
      return getLocationsAction(collectionId);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: "always",
  });
}

export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: inventoryKeys.all(collectionId),
      }),
    /** Refresh the picker popup's area→issue→stamp data after an inline create
     * (#105), so a new issue/stamp shows without touching the inventory list. */
    invalidatePickerData: (collectionId: string) => {
      // The browser's pages and year facets are the issues list's own caches since #604, and a
      // prefix override an inline-created issue carries (#377) is keyed under the same root — one
      // invalidation covers the rows, the facets and the chips they render through.
      queryClient.invalidateQueries({
        queryKey: ["issues", collectionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["inventory", collectionId, "issueMembers"],
      });
    },
  };
}
