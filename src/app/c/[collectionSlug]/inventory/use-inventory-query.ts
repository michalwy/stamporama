"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CopyGroupRow,
  LocationGroupRow,
  ItemListItem,
  ItemSortBy,
  ItemVariantHistoryData,
  ItemYearFacet,
} from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import type { LocationGroupBy } from "@/lib/location-groups";
import type { HoldingsSummary } from "@/lib/valuation";
import type { ContactData } from "@/lib/contacts";
import type { StampNodeData, IssueData } from "@/lib/issues";
import type { StampSearchItem } from "@/lib/stamps";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
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

export interface InventoryItemFilters {
  conditionId?: string;
  /** Restrict to copies with one certificate status. `"none"` matches the copies with no
   * certificate — needed to address a duplicate group whose members carry none (#372). */
  certificateStatusId?: string;
  /** Restrict to copies of one physical format (#343). `"single"` matches the copies with no
   * format set — null *is* the single (ADR-0020), which an absent filter cannot express. */
  formatId?: string;
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
   * on it. Implies "for sale". */
  notOfferedPlatformId?: string;
  /** Restrict to copies in one physical delivery state (ADR-0009 §5, #272) — e.g. only the
   * copies still in transit. */
  deliveryState?: string;
  /** Show copies that have already sold (#207). Sold copies are hidden by default; set true to
   * include them. */
  includeSold?: boolean;
  /** Show copies no longer held (#394/#395) — lost, damaged in storage, discarded. Hidden by
   * default, since the list answers "what do I have". */
  includeDisposed?: boolean;
  sortBy?: ItemSortBy;
  sortDir?: "asc" | "desc";
}

/** Filters that affect the year facet counts (everything except year itself). */
export interface InventoryYearFacetFilters {
  conditionId?: string;
  certificateStatusId?: string;
  formatId?: string;
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
  /** Restrict to copies in one physical delivery state (ADR-0009 §5, #272) — e.g. only the
   * copies still in transit. */
  deliveryState?: string;
  /** Include already-sold copies in the facet counts (#207); hidden by default. */
  includeSold?: boolean;
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
  years: (collectionId: string, filters: InventoryYearFacetFilters) =>
    ["inventory", collectionId, "years", filters] as const,
};

/** The copy-set half of the query string — everything that decides *which* copies, and nothing
 * about ordering or pagination. Shared by the flat list and the duplicate groups (#372), which
 * narrow the same set and must never disagree about it. */
function itemFilterParams(filters: InventoryItemFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.conditionId) params.set("conditionId", filters.conditionId);
  if (filters.certificateStatusId)
    params.set("certificateStatusId", filters.certificateStatusId);
  if (filters.formatId) params.set("formatId", filters.formatId);
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
  if (filters.deliveryState) params.set("deliveryState", filters.deliveryState);
  if (filters.includeSold) params.set("includeSold", "true");
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
      conditionId: filters.conditionId,
      certificateStatusId: filters.certificateStatusId,
      formatId: filters.formatId,
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
      deliveryState: filters.deliveryState,
      includeSold: filters.includeSold,
    }] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.conditionId) params.set("conditionId", filters.conditionId);
      if (filters.certificateStatusId)
        params.set("certificateStatusId", filters.certificateStatusId);
      if (filters.formatId) params.set("formatId", filters.formatId);
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
      if (filters.deliveryState) params.set("deliveryState", filters.deliveryState);
      if (filters.includeSold) params.set("includeSold", "true");
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
      if (filters.conditionId) params.set("conditionId", filters.conditionId);
      if (filters.certificateStatusId)
        params.set("certificateStatusId", filters.certificateStatusId);
      if (filters.formatId) params.set("formatId", filters.formatId);
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
      if (filters.deliveryState) params.set("deliveryState", filters.deliveryState);
      if (filters.includeSold) params.set("includeSold", "true");
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

/** Stamp nodes (base + variants) that belong to an issue, for the stamp picker. */
export function useIssueMembers(collectionId: string, issueId: string) {
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
    enabled: !!issueId,
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

/** Full issues (with embedded stamp members) for the picker popup browser's
 * issue → stamp/variant drill-down (#104). `areaIds` scopes to a set of areas (a
 * selected area plus its descendants, so a parent selection includes children);
 * `null` means "All areas" and returns every issue in the collection. */
export function useIssuesByArea(collectionId: string, areaIds: string[] | null) {
  const key = areaIds && areaIds.length > 0 ? [...areaIds].sort() : null;
  return useQuery<IssueData[]>({
    queryKey: ["inventory", collectionId, "issuesByArea", key ?? "all"] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (key) params.set("areaIds", key.join(","));
      const res = await fetch(
        `/api/collections/${collectionId}/issues/by-area?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch issues for area");
      const data = await res.json();
      return data.items;
    },
  });
}

/** Certificate statuses for the add-copy dialog opened from list rows (#111). Mirrors
 * {@link useCollectionConditions}; both feed the add/edit dialog's selects client-side so
 * the stamp/issue lists don't have to thread server-loaded props down to every row. */
export function useCollectionCertificateStatuses(collectionId: string) {
  return useQuery<CertificateStatusData[]>({
    queryKey: ["certificateStatuses", collectionId] as const,
    queryFn: async () => {
      const { getCertificateStatusesAction } = await import(
        "@/app/actions/certificate-statuses"
      );
      return getCertificateStatusesAction(collectionId);
    },
    staleTime: 60_000,
  });
}

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
 * the stamp/issue lists don't thread server-loaded locations down to every row. */
export function useCollectionLocations(collectionId: string) {
  return useQuery<LocationData[]>({
    queryKey: ["locations", collectionId] as const,
    queryFn: async () => {
      const { getLocationsAction } = await import("@/app/actions/locations");
      return getLocationsAction(collectionId);
    },
    staleTime: 60_000,
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
      queryClient.invalidateQueries({
        queryKey: ["inventory", collectionId, "issuesByArea"],
      });
      queryClient.invalidateQueries({
        queryKey: ["inventory", collectionId, "issueMembers"],
      });
      // An issue created from the picker may carry prefix overrides of its own (#377), and its
      // catalog chips render through them.
      queryClient.invalidateQueries({
        queryKey: ["issues", collectionId, "catalog-prefixes"],
      });
    },
  };
}
