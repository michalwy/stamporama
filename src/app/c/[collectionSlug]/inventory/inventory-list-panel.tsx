"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { ItemListItem, ItemSortBy } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import type { LocationGroupBy } from "@/lib/location-groups";
import { isDelivered } from "@/lib/delivery-state";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { ConfirmDialog } from "@/app/dialog-shell";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { SubtreeScopeToggle, useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { ListToolbar, type SortOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { parseCatalogSearch } from "@/lib/catalog-number";
import { DELIVERY_STATES, DELIVERY_STATE_META } from "@/lib/delivery-state";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { IssueFilterAutocomplete } from "@/app/c/[collectionSlug]/stamps/issue-filter-autocomplete";
import { formatItemNo } from "@/lib/item-number";
import { formatEntityNo } from "@/lib/quick-jump";
import { useStampConditionCollisions } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import {
  useInventoryItemsInfinite,
  useCopyGroupsInfinite,
  useLocationGroupsInfinite,
  useIssueGroupsInfinite,
  useHoldingsValuation,
  useItemYears,
  useInvalidateInventory,
  useCollectionItemNoPad,
  type InventoryItemFilters,
  type InventoryYearFacetFilters,
} from "./use-inventory-query";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { usePersistentString } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { HoldingsSummaryBar } from "@/app/c/[collectionSlug]/shared/holdings-summary-bar";
import { InventoryCopyList } from "./inventory-copy-list";
import { DuplicateGroupList } from "./duplicate-group-list";
import { LocationGroupList } from "./location-group-list";
import { IssueGroupList } from "./issue-group-list";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import { DisposeCopyDialog } from "./dispose-copy-dialog";
import { IdentifyVariantDialog } from "./identify-variant-dialog";
import { VariantHistoryDialog } from "./variant-history-dialog";
import { AddToOfferDialog } from "./add-to-offer-dialog";
import { OffersPopupDialog } from "@/app/c/[collectionSlug]/offers/offers-popup-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { useContacts } from "@/app/c/[collectionSlug]/contacts/use-contacts-query";
import { useLastUsedPlatform } from "@/app/c/[collectionSlug]/offers/use-last-used-platform";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; item: ItemListItem }
  | { kind: "editStamp"; item: ItemListItem }
  | { kind: "identify"; item: ItemListItem }
  | { kind: "history"; item: ItemListItem }
  | { kind: "delete"; item: ItemListItem }
  // One entry point, one or many copies (#373): a row's own action passes `[item]`, the bulk bar
  // passes the whole selection. `targetOfferId` opens the picker with one offer already picked —
  // the bar's "add to the conflicting offer instead" shortcut (#513).
  | { kind: "addToOffer"; items: ItemListItem[]; targetOfferId?: string }
  // Straight into offer creation, packaging already decided (#277, #497) — so the picker and the
  // "Add as" control are both skipped. `packaging` is what the two quick bulk buttons carry.
  | { kind: "addToNewOffer"; items: ItemListItem[]; packaging?: "per-copy" | "one-set" }
  | { kind: "viewOffers"; item: ItemListItem }
  // The disposal axis (#394/#395). Marking needs a reason and a note, so it is a form; reversing
  // it is one fact with nothing to fill in, so it is a confirmation.
  | { kind: "dispose"; item: ItemListItem }
  | { kind: "restore"; item: ItemListItem }
  | { kind: "quickPrice"; item: ItemListItem };


/** The bulk bar's new-offer shortcuts (#497), for a selection of `count` copies. One copy has no
 * packaging to decide, so it gets a single button; several get one per composition. */
function newOfferShortcuts(
  count: number
): { packaging: "one-set" | "per-copy"; label: string; hint: string }[] {
  if (count === 1) {
    return [
      {
        packaging: "one-set",
        label: "New offer",
        hint: "Create a new offer from this copy, skipping the picker.",
      },
    ];
  }
  return [
    {
      packaging: "one-set",
      label: "New offer · one set",
      hint: "Create a new offer holding all of them as one set — a series or a lot sold together.",
    },
    {
      packaging: "per-copy",
      label: `New offer · ${count} sets`,
      hint: "Create a new offer with each copy as its own single-copy set — a quantity of interchangeable singles.",
    },
  ];
}

/** Marks the *set aside* half of the platform select (#506). The two readings share one control and
 * one `<select>` value space, so the review options are prefixed rather than given a second control
 * nobody would connect to the first. */
const EXCLUDED_OPTION_PREFIX = "excluded:";

const DISPOSITION_FILTERS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

const SORT_OPTIONS: SortOption[] = [
  { value: "created", label: "Date added" },
];

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

/** A comma-separated multi-select filter read off the URL (#425, #427), memoised so the filter
 * objects it feeds stay referentially stable and do not refetch every render. An absent or
 * all-blank parameter is the empty list — the absence of the filter, never an empty set. */
function useCsvParam(searchParams: ReturnType<typeof useSearchParams>, key: string): string[] {
  const raw = searchParams.get(key);
  return useMemo(() => (raw ? raw.split(",").filter(Boolean) : []), [raw]);
}

interface InventoryListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  /** The collection's physical formats (#343) — drives the format filter, and absent when empty. */
  formats: StampFormatData[];
  baseCurrency: string;
}

export function InventoryListPanel({
  collectionId,
  collectionSlug,
  areas,
  locations,
  conditions,
  certificateStatuses,
  formats,
  baseCurrency,
}: InventoryListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateInventory();

  const { data: contacts = [] } = useContacts(collectionId);
  const offerPlatforms = useMemo(() => contacts.filter((c) => c.platform), [contacts]);
  const [lastPlatformId, rememberPlatform] = useLastUsedPlatform(collectionId);

  // Area + year shared across lists (#143): URL param wins ("all" sentinel marks
  // an explicit "all"); absent param falls back to the per-collection store. The
  // effective selection is mirrored back into the store below.
  const { storedAreaId, storedYear, writeStore } =
    useCollectionFilterStore(collectionId);
  const urlAreaId = searchParams.get("areaId");
  const urlYear = searchParams.get("year");
  const filterAreaId =
    urlAreaId !== null ? (urlAreaId === "all" ? null : urlAreaId) : storedAreaId;
  const year =
    urlYear !== null ? (urlYear === "all" ? "" : urlYear) : (storedYear ?? "");

  useEffect(() => {
    writeStore({ areaId: filterAreaId, year: year || null });
  }, [filterAreaId, year, writeStore]);

  // Whether a selected area brings its sub-areas with it is the collector's choice (#385); the
  // toggle lives in the area sidebar and the resolution is shared so every list agrees.
  const [includeSubAreas] = useSubtreeScope("area");
  const filterAreaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [filterAreaId, areas, includeSubAreas]
  );

  const search = searchParams.get("search") ?? "";
  // Condition, format and delivery state are **multi-selects** (#425, #427): a copy is in exactly
  // one of each, but the question asked of the list is routinely a group of them — "the mint
  // grades", "everything still on its way to me" — and asking it three times over is not the same as
  // asking it once. Comma-separated in the URL exactly as `areaIds` is; an empty list is the absence
  // of the filter.
  const conditionIds = useCsvParam(searchParams, "conditionIds");
  // Format is a *filter* here, not a price switcher (#343): a copy's format is a fact it carries,
  // so the list narrows to it exactly the way it narrows to a condition. `"single"` is a real
  // choice — the copies with no format — which an absent value could not express.
  const formatIds = useCsvParam(searchParams, "formatIds");
  // Certificate is the fourth fact a copy carries that this list reasons about — it is a
  // duplicate-grouping axis, a valuation axis and a listing axis — and until #428 it was the one with
  // no filter at all. `"none"` is a tickable value, not the absence of the filter: null *is* a value
  // here (ADR-0006 §2), exactly as `"single"` is for format.
  const certificateStatusIds = useCsvParam(searchParams, "certificateStatusIds");
  const locationId = searchParams.get("locationId") ?? "";
  // Whether a picked location brings the boxes filed under it (#385). Server-side, unlike the
  // area axis — the location subtree is resolved in `resolveLocationScope`.
  const [includeSubLocations, setIncludeSubLocations] = useSubtreeScope("location");
  const issueId = searchParams.get("issueId") ?? "";
  const noPhotos = searchParams.get("noPhotos") === "true";
  const missingCatalogValue = searchParams.get("missingCatalogValue") === "true";
  // "For sale, not yet offered on platform X" (#259), remembered per collection (#275): the URL
  // param wins when present (shareable), else fall back to the stored selection on a fresh visit.
  // A stale value (platform since removed) is ignored so the filter can't silently narrow to nothing.
  const [storedNotOfferedPlatform, rememberNotOfferedPlatform] = usePersistedCollectionValue(
    "inventory-not-offered-platform",
    collectionId
  );
  const notOfferedPlatformParam = searchParams.has("notOfferedPlatform")
    ? (searchParams.get("notOfferedPlatform") ?? "")
    : (storedNotOfferedPlatform ?? "");
  const notOfferedPlatformId =
    notOfferedPlatformParam && offerPlatforms.some((p) => p.id === notOfferedPlatformParam)
      ? notOfferedPlatformParam
      : "";
  // The other reading of the same control (#506): the copies deliberately set aside from a platform.
  // A second URL param rather than a mode flag, because the two are different filters and a link
  // should say which one it carries; they are mutually exclusive, so setting either clears the
  // other. Validated against the platform list exactly as the worklist one is.
  const excludedPlatformParam = searchParams.get("excludedPlatform") ?? "";
  const excludedPlatformId =
    excludedPlatformParam && offerPlatforms.some((p) => p.id === excludedPlatformParam)
      ? excludedPlatformParam
      : "";
  // Which platform the screen is working through, whichever way round it is being asked (#506).
  // It is what the row's and the bulk bar's one-click entries act on: a decision is always about
  // one platform, and with none picked the copy form is where the whole set is edited.
  const scopedPlatform = useMemo(
    () =>
      offerPlatforms.find((p) => p.id === (notOfferedPlatformId || excludedPlatformId)) ?? null,
    [offerPlatforms, notOfferedPlatformId, excludedPlatformId]
  );
  // Which platform seeds the "create new offer" sub-flow of Add to offer (#241). The list's own
  // "not offered on X" filter (#259) wins: while it is set, the screen *is* that platform's
  // worklist, and listing what it shows anywhere else would be a surprise. Without it, the last
  // platform used is the only signal.
  const preferredPlatform = useMemo(() => {
    const id = notOfferedPlatformId || lastPlatformId;
    return id ? offerPlatforms.find((p) => p.id === id) : undefined;
  }, [offerPlatforms, notOfferedPlatformId, lastPlatformId]);

  // Physical delivery state (#272): the axis the row chip shows, and a multi-select like the
  // condition one (#427) — the states worth asking about come in groups ("ordered, in transit, to
  // sort" is one question: what is still on its way).
  const deliveryStates = useCsvParam(searchParams, "deliveryStates");
  // Sold copies are hidden by default (#207); this toggle brings them back into the list.
  const includeSold = searchParams.get("includeSold") === "true";
  // Copies no longer held are hidden the same way (#394/#395): the list answers "what do I have".
  const includeDisposed = searchParams.get("includeDisposed") === "true";
  // How the rows are grouped (#372, #421, #424). A client preference rather than URL state — it
  // changes *what the rows are*, not what is being looked at, and it is a way of working the
  // collector keeps. The modes answer different questions: what stock do I have in duplicate (#372),
  // where is it filed (#421, at two levels of one axis), and what have I got of this series (#424).
  // Which axes join the duplicate key is remembered separately, so switching away and back does not
  // lose the split.
  const [groupMode, setGroupMode] = usePersistentString(
    `stamporama:inventory:groupMode:${collectionId}`,
    "none"
  );
  const groupDuplicates = groupMode === "duplicates";
  // A filing grouping needs somewhere to file things: with no locations defined it is not offered,
  // and a remembered choice from before they were deleted falls back to the flat list rather than to
  // a screen of one "No location" row.
  const locationGroupBy: LocationGroupBy | null =
    locations.length === 0
      ? null
      : groupMode === "location"
        ? "location"
        : groupMode === "ref"
          ? "ref"
          : null;
  // Grouping by issue needs no precondition the way the filing modes do: every collection has
  // stamps, and the copies belonging to no issue are a legitimate group rather than a degenerate one.
  const groupIssues = groupMode === "issue";
  /** Nothing is collapsed: the list is the copies themselves. */
  const flatList = !groupDuplicates && !locationGroupBy && !groupIssues;
  const [groupByFormat, setGroupByFormat] = usePersistedFlag(
    `stamporama:inventory:groupByFormat:${collectionId}`
  );
  const [groupByCertificate, setGroupByCertificate] = usePersistedFlag(
    `stamporama:inventory:groupByCertificate:${collectionId}`
  );
  const axes: CopyGroupAxes = useMemo(
    () => ({ format: groupByFormat, certificate: groupByCertificate }),
    [groupByFormat, groupByCertificate]
  );
  // Names the offers popup for a copy whose stamp is unnamed (#276) — the internal copy number,
  // padded to the collection's chosen width.
  const itemNoPad = useCollectionItemNoPad(collectionId);
  const { sortBy, sortDir, persistSort } = usePersistedSort<ItemSortBy>(
    "inventory", "created", "asc",
    searchParams.get("sortBy"),
    searchParams.get("sortDir"),
    ["created"]
  );
  const activeDispositions = useMemo(() => {
    const set = new Set<string>();
    for (const { key } of DISPOSITION_FILTERS) {
      if (searchParams.get(key) === "true") set.add(key);
    }
    return set;
  }, [searchParams]);

  // Prefixed catalog search (#146): the inventory list has no dedicated vendor
  // dropdown, so its single search box doubles as the catalog input. Parse a leading
  // vendor abbreviation ("Mi PL 200") against the collection's vendors and pass the
  // bare number + resolved vendor alongside the raw text, so the query matches
  // catalog numbers even when the typed prefix isn't a substring of the stored value.
  const catalogVendors = useMemo(() => {
    const seen = new Map<string, { id: string; abbreviation: string }>();
    for (const area of areas) {
      for (const entry of area.catalogEntries) {
        if (!seen.has(entry.catalogVendorId)) {
          seen.set(entry.catalogVendorId, {
            id: entry.catalogVendorId,
            abbreviation: entry.vendorAbbreviation,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [areas]);
  const parsedCatalog = useMemo(
    () => parseCatalogSearch(search, catalogVendors),
    [search, catalogVendors]
  );

  const filters: InventoryItemFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: parsedCatalog.vendorId ?? undefined,
      catalogNumber: parsedCatalog.number || undefined,
      conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
      certificateStatusIds:
        certificateStatusIds.length > 0 ? certificateStatusIds : undefined,
      formatIds: formatIds.length > 0 ? formatIds : undefined,
      locationId: locationId || undefined,
      locationExact: locationId && !includeSubLocations ? true : undefined,
      issueId: issueId || undefined,
      year: year || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      noPhotos: noPhotos || undefined,
      missingCatalogValue: missingCatalogValue || undefined,
      notOfferedPlatformId: notOfferedPlatformId || undefined,
      excludedPlatformId: excludedPlatformId || undefined,
      deliveryStates: deliveryStates.length > 0 ? deliveryStates : undefined,
      includeSold: includeSold || undefined,
      includeDisposed: includeDisposed || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, parsedCatalog, conditionIds, certificateStatusIds, formatIds, locationId, includeSubLocations, issueId, year, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, excludedPlatformId, deliveryStates, includeSold, includeDisposed, sortBy, sortDir]
  );

  const yearFacetFilters: InventoryYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: parsedCatalog.vendorId ?? undefined,
      catalogNumber: parsedCatalog.number || undefined,
      conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
      certificateStatusIds:
        certificateStatusIds.length > 0 ? certificateStatusIds : undefined,
      formatIds: formatIds.length > 0 ? formatIds : undefined,
      locationId: locationId || undefined,
      locationExact: locationId && !includeSubLocations ? true : undefined,
      issueId: issueId || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      noPhotos: noPhotos || undefined,
      missingCatalogValue: missingCatalogValue || undefined,
      notOfferedPlatformId: notOfferedPlatformId || undefined,
      excludedPlatformId: excludedPlatformId || undefined,
      deliveryStates: deliveryStates.length > 0 ? deliveryStates : undefined,
      includeSold: includeSold || undefined,
      includeDisposed: includeDisposed || undefined,
    }),
    [filterAreaIds, search, parsedCatalog, conditionIds, certificateStatusIds, formatIds, locationId, includeSubLocations, issueId, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, excludedPlatformId, deliveryStates, includeSold, includeDisposed]
  );

  const { data: yearFacets, isLoading: yearsLoading } = useItemYears(
    collectionId,
    yearFacetFilters
  );

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const hasChildLocations = useMemo(
    () => !!locationId && locations.some((l) => l.parentId === locationId),
    [locations, locationId]
  );

  // Per-area vendor maps + area names for the quick-price dialog (#228), resolved once here so the
  // dialog can format catalog numbers identically to the rows (mirrors the purchase intake view).
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/inventory${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  function handleNavigateFilter(areaId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    // "all" sentinel (not delete) so an explicit "all areas" is distinguishable
    // from an absent param that falls back to the store (#143).
    params.set("areaId", areaId ?? "all");
    const qs = params.toString();
    router.push(`/c/${collectionSlug}/inventory${qs ? `?${qs}` : ""}`);
  }

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters, flatList);
  const groupsQuery = useCopyGroupsInfinite(collectionId, filters, axes, groupDuplicates);
  const locationGroupsQuery = useLocationGroupsInfinite(
    collectionId,
    filters,
    locationGroupBy ?? "location",
    !!locationGroupBy
  );
  const issueGroupsQuery = useIssueGroupsInfinite(collectionId, filters, groupIssues);
  // Grouping narrows the set to for-sale, delivered, unsold copies, so the holdings bar must narrow
  // with it — a total counting copies the list no longer shows is worse than none (#151).
  const valuationFilters: InventoryItemFilters = useMemo(
    () =>
      groupDuplicates
        ? {
            ...filters,
            forSale: true,
            deliveryStates: ["delivered"],
            includeSold: undefined,
            includeDisposed: undefined,
          }
        : filters,
    [filters, groupDuplicates]
  );
  const { data: holdingsTotal } = useHoldingsValuation(collectionId, valuationFilters);

  const allCopies = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );
  const allGroups = useMemo(
    () => groupsQuery.data?.pages.flatMap((p) => p.groups) ?? [],
    [groupsQuery.data]
  );
  const allLocationGroups = useMemo(
    () => locationGroupsQuery.data?.pages.flatMap((p) => p.groups) ?? [],
    [locationGroupsQuery.data]
  );
  const allIssueGroups = useMemo(
    () => issueGroupsQuery.data?.pages.flatMap((p) => p.groups) ?? [],
    [issueGroupsQuery.data]
  );

  // Multi-select (#373). Restricted to copies that can actually be listed — for sale and in hand,
  // the offer composition picker's own eligibility. The selection is keyed on the filter set and
  // reset when it changes (adjusted during render, never a `setState` in an effect): a selection
  // surviving a filter change would act on copies no longer on screen.
  //
  // It holds the **copies themselves**, not their ids: grouping (#398) ticks copies loaded by a
  // group's own member query, and there is no flat page here to resolve those ids against.
  const filterSignature = JSON.stringify(filters);
  const [selection, setSelection] = useState<{ sig: string; items: Map<string, ItemListItem> }>({
    sig: filterSignature,
    items: new Map(),
  });
  if (selection.sig !== filterSignature) {
    setSelection({ sig: filterSignature, items: new Map() });
  }
  const selectedIds = useMemo(() => new Set(selection.items.keys()), [selection]);
  const selectedCopies = useMemo(() => [...selection.items.values()], [selection]);
  const toggleSelected = useCallback((item: ItemListItem) => {
    setSelection((prev) => {
      const items = new Map(prev.items);
      if (items.has(item.id)) items.delete(item.id);
      else items.set(item.id, item);
      return { sig: prev.sig, items };
    });
  }, []);
  const setManySelected = useCallback((batch: ItemListItem[], selected: boolean) => {
    setSelection((prev) => {
      const items = new Map(prev.items);
      for (const item of batch) {
        if (selected) items.set(item.id, item);
        else items.delete(item.id);
      }
      return { sig: prev.sig, items };
    });
  }, []);
  const clearSelection = useCallback(
    () => setSelection((prev) => ({ sig: prev.sig, items: new Map() })),
    []
  );

  // Setting a copy aside from a platform, or bringing it back (#506). No dialog on either path: it
  // is one reversible flag, and a confirmation for something the very next click can undo is noise.
  // The failure has nowhere to be shown for the same reason, so it gets the strip above the list.
  const [exclusionError, setExclusionError] = useState<string | undefined>();
  const applyPlatformExclusion = useCallback(
    (items: ItemListItem[], platformId: string, excluded: boolean, clearAfter: boolean) => {
      startTransition(async () => {
        const { setItemPlatformExclusionAction } = await import("@/app/actions/items");
        const result = await setItemPlatformExclusionAction(
          collectionId,
          items.map((i) => i.id),
          platformId,
          excluded
        );
        if (result.status === "error") {
          setExclusionError(result.message);
          return;
        }
        setExclusionError(undefined);
        invalidateList(collectionId);
        // A selection that has been dealt with is left ticked only long enough to invite doing it
        // twice; a single row's toggle never touched the selection, so it leaves it alone.
        if (clearAfter) clearSelection();
      });
    },
    [collectionId, invalidateList, clearSelection]
  );
  // The stamp × condition conflict for the selection (#513): live offers on the platform in scope
  // that already list one of these stamps in this condition — which Colnect refuses a second time.
  // Only asked while a platform *is* in scope (#506's shared reading of the platform filter): a
  // collision is always a collision on some platform, and with none named there is no listing being
  // planned to warn about.
  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const { data: selectionCollisions = [] } = useStampConditionCollisions(
    collectionId,
    selectedIdList,
    scopedPlatform?.id ?? null,
    selectedIdList.length > 0
  );
  // The offer the bar's shortcut points at: the one accounting for the most of the selection, which
  // is how `findStampConditionCollisions` already orders them.
  const collisionOffer = selectionCollisions[0];
  const collidingCopies = useMemo(
    () => new Set(selectionCollisions.flatMap((c) => c.itemIds)).size,
    [selectionCollisions]
  );

  // Whether the whole selection is already set aside from the platform in scope — which is what the
  // bulk button offers to undo. "All of them", not "any": with a mixed selection the useful action
  // is still to set the rest aside, and the excluded ones absorb it as a no-op.
  const selectionExcluded =
    !!scopedPlatform &&
    selectedCopies.length > 0 &&
    selectedCopies.every((c) => c.excludedPlatformIds.includes(scopedPlatform.id));

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidateList(collectionId);
    // What was picked has been dealt with; leaving it ticked invites doing it twice.
    clearSelection();
  }

  const listLoading = groupDuplicates
    ? groupsQuery.isLoading
    : locationGroupBy
      ? locationGroupsQuery.isLoading
      : groupIssues
        ? issueGroupsQuery.isLoading
        : isLoading;
  const listEmpty = groupDuplicates
    ? allGroups.length === 0
    : locationGroupBy
      ? allLocationGroups.length === 0
      : groupIssues
        ? allIssueGroups.length === 0
        : allCopies.length === 0;

  // Only a for-sale, in-hand copy can be listed — the offer composition picker's own eligibility
  // (#164/#188). A copy that fails it gets no checkbox rather than a disabled one: its disposition
  // and delivery chips are on the row, so the row already answers the question.
  const copySelection = useMemo(
    () => ({
      selected: selectedIds,
      onToggle: toggleSelected,
      onSetMany: setManySelected,
      // A copy no longer held cannot be listed either (#394) — same eligibility, second axis.
      isEligible: (item: ItemListItem) =>
        item.forSale && isDelivered(item.deliveryState) && item.disposedAt == null,
    }),
    [selectedIds, toggleSelected, setManySelected]
  );

  const hasActiveFilters =
    !!search ||
    !!issueId ||
    conditionIds.length > 0 ||
    certificateStatusIds.length > 0 ||
    formatIds.length > 0 ||
    !!locationId ||
    !!year ||
    noPhotos ||
    missingCatalogValue ||
    !!notOfferedPlatformId ||
    !!excludedPlatformId ||
    deliveryStates.length > 0 ||
    includeSold ||
    includeDisposed ||
    activeDispositions.size > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Header: holdings total (left) + Add copy (right) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <HoldingsSummaryBar total={holdingsTotal} />
        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
          style={{
            ...CONTROL_STYLE,
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.375rem 0.875rem",
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          Add copy
        </button>
      </div>

      {/* Sidebar + list, mirroring the stamps list layout (#106) */}
      <div
        style={{
          display: "flex",
          gap: 0,
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "24rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        <ListFilterSidebar
          areas={areas}
          filterAreaId={filterAreaId}
          onNavigateArea={handleNavigateFilter}
          yearFacets={yearFacets}
          yearsLoading={yearsLoading}
          selectedYear={year || null}
          onSelectYear={(y) => updateParams({ year: y ?? "all" })}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          {/* Toolbar: shared search + sort, inventory-specific filters as children */}
          <ListToolbar
            search={search}
            onSearchChange={(v) => updateParams({ search: v })}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(sb, sd) => {
              persistSort(sb as ItemSortBy, sd);
              updateParams({ sortBy: sb, sortDir: sd });
            }}
            sortOptions={SORT_OPTIONS}
            hideSort={!flatList}
            footer={
              selectedCopies.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid var(--color-accent)",
                    background: "var(--color-accent-soft)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      color: "var(--color-accent)",
                    }}
                  >
                    {selectedCopies.length} cop{selectedCopies.length === 1 ? "y" : "ies"} selected
                  </span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                      color: "var(--color-text-secondary)",
                      textDecoration: "underline",
                    }}
                  >
                    Clear
                  </button>
                  {/* The conflict this selection would create on the platform in scope (#513):
                      another live offer already lists one of these stamps in this condition, and
                      Colnect refuses a second. Stated where the listing actions are, with the
                      shortcut that resolves it — adding to that offer instead of making a new one.
                      A warning beside the buttons, never a disabled button: the collector may know
                      exactly what they are doing. */}
                  {collisionOffer && (
                    <Tooltip
                      content={selectionCollisions
                        .map(
                          (c) =>
                            `${formatEntityNo(c.offerNo)} ${c.offerLabel} — ${c.itemIds.length} cop${c.itemIds.length === 1 ? "y" : "ies"}`
                        )
                        .join(" · ")}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          fontSize: "0.8125rem",
                          color: "var(--color-warning)",
                        }}
                      >
                        <Icon name="warning" size="sm" />
                        {collidingCopies === 1
                          ? "1 copy is"
                          : `${collidingCopies} copies are`}{" "}
                        already offered on {collisionOffer.platformName} in this condition
                      </span>
                    </Tooltip>
                  )}
                  {collisionOffer && (
                    <Tooltip
                      content={`Add the selection to ${formatEntityNo(collisionOffer.offerNo)} ${collisionOffer.offerLabel} instead of creating a second listing for the same stamps.`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setDialog({
                            kind: "addToOffer",
                            items: selectedCopies,
                            targetOfferId: collisionOffer.offerId,
                          })
                        }
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontSize: "0.8125rem",
                          fontWeight: 600,
                          color: "var(--color-accent)",
                          textDecoration: "underline",
                        }}
                      >
                        Add to {formatEntityNo(collisionOffer.offerNo)} instead
                      </button>
                    </Tooltip>
                  )}
                  {/* The picker flow, and beside it the shortcuts that skip it (#497): a new offer
                      is the common quick start, so the only decision left — one set or one each —
                      is made by which button is pressed. Secondary next to the primary, since they
                      are narrower paths through the same flow. With a single copy there is no
                      packaging to choose, so the pair collapses into one ＋ New offer button. */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}
                  >
                    {/* Clearing the worklist in one go (#506) — the reason the flag exists: a
                        thousand copies deliberately kept off a platform are set aside in one
                        press. Only offered while a platform is in scope, since the decision names
                        one; without the filter, the copy form owns the whole set. */}
                    {scopedPlatform && (
                      <Tooltip
                        content={
                          selectionExcluded
                            ? `Bring these copies back into the "not offered on ${scopedPlatform.name}" worklist.`
                            : `Keep these copies out of the "not offered on ${scopedPlatform.name}" worklist for good. Nothing about the copies themselves changes.`
                        }
                      >
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            applyPlatformExclusion(
                              selectedCopies,
                              scopedPlatform.id,
                              !selectionExcluded,
                              true
                            )
                          }
                          style={{
                            ...CONTROL_STYLE,
                            cursor: isPending ? "default" : "pointer",
                            fontWeight: 600,
                            color: "var(--color-text-secondary)",
                            borderColor: "var(--color-border-strong)",
                            background: "var(--color-bg-elevated)",
                            padding: "0.375rem 0.75rem",
                          }}
                        >
                          <Icon name={selectionExcluded ? "check" : "excluded"} size="sm" />{" "}
                          {selectionExcluded
                            ? `List on ${scopedPlatform.name} again`
                            : `Never list on ${scopedPlatform.name}`}
                        </button>
                      </Tooltip>
                    )}
                    {newOfferShortcuts(selectedCopies.length).map(({ packaging, label, hint }) => (
                      <Tooltip key={packaging} content={hint}>
                        <button
                          type="button"
                          onClick={() =>
                            setDialog({ kind: "addToNewOffer", items: selectedCopies, packaging })
                          }
                          style={{
                            ...CONTROL_STYLE,
                            cursor: "pointer",
                            fontWeight: 600,
                            color: "var(--color-accent)",
                            borderColor: "var(--color-accent)",
                            background: "var(--color-bg-elevated)",
                            padding: "0.375rem 0.75rem",
                          }}
                        >
                          <Icon name="add" size="sm" /> {label}
                        </button>
                      </Tooltip>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "addToOffer", items: selectedCopies })}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: 600,
                        color: "#fff",
                        background: "var(--color-action-primary)",
                        border: "none",
                        padding: "0.375rem 0.875rem",
                      }}
                    >
                      <Icon name="addToOffer" size="sm" /> Add selected to offer
                    </button>
                  </div>
                </div>
              ) : undefined
            }
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                flex: 1,
              }}
            >
              <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                {DISPOSITION_FILTERS.map(({ key, label }) => {
                  const active = activeDispositions.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateParams({ [key]: active ? "" : "true" })}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: active ? "var(--color-accent)" : "var(--color-border-strong)",
                        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
                <Tooltip content="Show only copies with no attached photos">
                  <button
                    type="button"
                    onClick={() => updateParams({ noPhotos: noPhotos ? "" : "true" })}
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      fontWeight: noPhotos ? 600 : 400,
                      color: noPhotos ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: noPhotos ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: noPhotos ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    No photos
                  </button>
                </Tooltip>
                <Tooltip content="Show only copies with no catalog value recorded for their condition">
                  <button
                    type="button"
                    onClick={() =>
                      updateParams({ missingCatalogValue: missingCatalogValue ? "" : "true" })
                    }
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      fontWeight: missingCatalogValue ? 600 : 400,
                      color: missingCatalogValue ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: missingCatalogValue ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: missingCatalogValue ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Missing catalog value
                  </button>
                </Tooltip>
                <Tooltip
                  content={
                    groupDuplicates
                      ? "Duplicate groups only cover copies you can still list, so sold ones stay out."
                      : "Also show copies that have already sold (hidden by default)"
                  }
                >
                  <button
                    type="button"
                    disabled={groupDuplicates}
                    onClick={() => updateParams({ includeSold: includeSold ? "" : "true" })}
                    style={{
                      ...CONTROL_STYLE,
                      cursor: groupDuplicates ? "default" : "pointer",
                      opacity: groupDuplicates ? 0.5 : 1,
                      fontWeight: includeSold ? 600 : 400,
                      color: includeSold ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: includeSold ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: includeSold ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Include sold
                  </button>
                </Tooltip>
                {/* Copies no longer held (#394/#395), beside the sold toggle: the two are the
                    ways a copy leaves the shelf, one with proceeds and one without. Hidden by
                    default for the same reason — the list answers "what do I have". */}
                <Tooltip
                  content={
                    groupDuplicates
                      ? "Duplicate groups only cover copies you can still list, so ones you no longer hold stay out."
                      : "Also show copies you no longer hold — lost, damaged in storage, discarded (hidden by default)"
                  }
                >
                  <button
                    type="button"
                    disabled={groupDuplicates}
                    onClick={() =>
                      updateParams({ includeDisposed: includeDisposed ? "" : "true" })
                    }
                    style={{
                      ...CONTROL_STYLE,
                      cursor: groupDuplicates ? "default" : "pointer",
                      opacity: groupDuplicates ? 0.5 : 1,
                      fontWeight: includeDisposed ? 600 : 400,
                      color: includeDisposed ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: includeDisposed ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: includeDisposed ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Include no longer held
                  </button>
                </Tooltip>
              </div>

              {/* Grouping (#372, #421, #424). *Duplicates* collapses the list to one row per
                  `stamp × condition` — Colnect's own rule, since it refuses a second offer for the
                  same stamp in the same condition — *Location* and *Ref* collapse it by where the
                  copies are filed, and *Issue* by the series they belong to. One select rather than
                  a chip each: they are readings of the same list and exactly one can be in effect.
                  The two splits join a further axis to the duplicate key; with both on, every group
                  has one unambiguous per-copy catalog value. They only appear under Duplicates,
                  because elsewhere they name nothing. */}
              <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                {/* The icon sits *beside* the select, not inside its options: a native `<option>`
                    renders text only, which is what the ▦ in each label used to work around. */}
                <Icon
                  name="group"
                  size="sm"
                  style={{
                    color: groupMode === "none" ? "var(--color-text-muted)" : "var(--color-accent)",
                  }}
                />
                <Tooltip content="Collapse the list into groups: duplicates ready to list as one offer with a quantity, the copies filed in one place, or what you hold of one issue.">
                  <select
                    value={groupMode}
                    onChange={(e) => setGroupMode(e.target.value)}
                    aria-label="Group rows"
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      ...(groupMode !== "none"
                        ? {
                            fontWeight: 600,
                            color: "var(--color-accent)",
                            border: "1px solid var(--color-accent)",
                            background: "var(--color-accent-soft)",
                          }
                        : null),
                    }}
                  >
                    <option value="none">No grouping</option>
                    <option value="duplicates">Group duplicates</option>
                    {locations.length > 0 && <option value="location">Group by location</option>}
                    {locations.length > 0 && <option value="ref">Group by location ref</option>}
                    <option value="issue">Group by issue</option>
                  </select>
                </Tooltip>
                {groupDuplicates && formats.length > 0 && (
                  <Tooltip content="Treat a pair, block or strip as a different item from a single, instead of grouping them together.">
                    <button
                      type="button"
                      onClick={() => setGroupByFormat(!groupByFormat)}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: groupByFormat ? 600 : 400,
                        color: groupByFormat ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: groupByFormat ? "var(--color-accent)" : "var(--color-border-strong)",
                        background: groupByFormat ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      }}
                    >
                      Split by format
                    </button>
                  </Tooltip>
                )}
                {groupDuplicates && certificateStatuses.length > 0 && (
                  <Tooltip content="Treat a certified copy as a different item from an uncertified one, instead of grouping them together.">
                    <button
                      type="button"
                      onClick={() => setGroupByCertificate(!groupByCertificate)}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: groupByCertificate ? 600 : 400,
                        color: groupByCertificate ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: groupByCertificate ? "var(--color-accent)" : "var(--color-border-strong)",
                        background: groupByCertificate ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      }}
                    >
                      Split by certificate
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Several conditions at once (#425): a copy is in exactly one condition, but the
                  question asked of the list is routinely a group of them ("the mint grades"). */}
              <MultiSelectFilter
                options={conditions.map((c) => ({ id: c.id, label: c.name }))}
                selected={conditionIds}
                onChange={(ids) => updateParams({ conditionIds: ids.join(",") })}
                allLabel="All conditions"
                itemNoun="conditions"
                ariaLabel="Filter by condition"
              />

              {/* Delivery state filter (#272), beside the condition one: the axis the row chip
                  shows, so "what is still in transit?" is one click from seeing it flagged. A
                  multi-select (#427) because the states worth asking about come in groups —
                  *Ordered*, *In transit* and *To sort* together are "what is still on its way". */}
              <Tooltip
                content={
                  groupDuplicates
                    ? "Duplicate groups only cover copies in hand, so the delivery state is fixed to Delivered."
                    : ""
                }
              >
                <span>
                  <MultiSelectFilter
                    options={DELIVERY_STATES.map((state) => ({
                      id: state,
                      label: DELIVERY_STATE_META[state].label,
                    }))}
                    selected={deliveryStates}
                    onChange={(ids) => updateParams({ deliveryStates: ids.join(",") })}
                    allLabel="All delivery states"
                    itemNoun="delivery states"
                    ariaLabel="Filter by delivery state"
                    disabled={groupDuplicates}
                  />
                </span>
              </Tooltip>

              {/* Format filter (#343), beside the condition one, and a multi-select like it (#427).
                  Absent entirely when the collection defines no formats — most never do. "Single" is
                  a tickable choice because it is a real answer (no format set), not the absence of a
                  filter, and it can be ticked *alongside* a format: null is never a member of an
                  `in`, so the server ORs the two branches. */}
              {formats.length > 0 && (
                <MultiSelectFilter
                  options={[
                    { id: "single", label: "Single" },
                    ...formats.map((f) => ({ id: f.id, label: f.name })),
                  ]}
                  selected={formatIds}
                  onChange={(ids) => updateParams({ formatIds: ids.join(",") })}
                  allLabel="All formats"
                  itemNoun="formats"
                  ariaLabel="Filter by format"
                />
              )}

              {/* Certificate filter (#428), beside the format one and built the same way: absent
                  when the collection defines no statuses, and "No certificate" is a tickable value
                  rather than the absence of the filter — null *is* a value on this axis
                  (ADR-0006 §2), so the server ORs the two branches exactly as it does for Single. */}
              {certificateStatuses.length > 0 && (
                <MultiSelectFilter
                  options={[
                    { id: "none", label: "No certificate" },
                    ...certificateStatuses.map((c) => ({ id: c.id, label: c.name })),
                  ]}
                  selected={certificateStatusIds}
                  onChange={(ids) => updateParams({ certificateStatusIds: ids.join(",") })}
                  allLabel="All certificates"
                  itemNoun="certificates"
                  ariaLabel="Filter by certificate status"
                />
              )}

              {/* "For sale, not yet offered on platform X" (#259): pick a platform to surface
                  for-sale copies still needing a listing there. Lists every platform contact
                  (not just ones with existing offers), since the point is to catch platforms
                  that haven't been used yet. Only shown once at least one platform contact
                  exists. */}
              {offerPlatforms.length > 0 && (
                <Tooltip content="Show for-sale copies with no active offer on the chosen platform — or the copies deliberately kept off it">
                  <select
                    value={
                      excludedPlatformId
                        ? `${EXCLUDED_OPTION_PREFIX}${excludedPlatformId}`
                        : notOfferedPlatformId
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      const excluded = value.startsWith(EXCLUDED_OPTION_PREFIX);
                      const notOffered = excluded ? "" : value;
                      // Only the worklist choice is remembered (#275): the review of what was set
                      // aside (#506) is something one goes to look at and then leaves, and a
                      // remembered one would greet the next visit with the copies deliberately
                      // *not* being worked on.
                      rememberNotOfferedPlatform(notOffered);
                      updateParams({
                        notOfferedPlatform: notOffered,
                        excludedPlatform: excluded
                          ? value.slice(EXCLUDED_OPTION_PREFIX.length)
                          : "",
                      });
                    }}
                    style={{
                      ...CONTROL_STYLE,
                      ...(notOfferedPlatformId || excludedPlatformId
                        ? {
                            fontWeight: 600,
                            color: "var(--color-accent)",
                            border: "1px solid var(--color-accent)",
                            background: "var(--color-accent-soft)",
                          }
                        : null),
                    }}
                    aria-label="Filter by a platform's listing worklist"
                  >
                    <option value="">For sale: any platform</option>
                    {/* The two halves of one question (#506): what still needs listing there, and
                        what was deliberately taken out of that answer. One control, because the
                        second only ever exists to correct the first. */}
                    <optgroup label="Still to list">
                      {offerPlatforms.map((p) => (
                        <option key={p.id} value={p.id}>
                          Not offered on {p.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Set aside">
                      {offerPlatforms.map((p) => (
                        <option
                          key={p.id}
                          value={`${EXCLUDED_OPTION_PREFIX}${p.id}`}
                        >
                          Never listed on {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </Tooltip>
              )}

              {locations.length > 0 && (
                <div style={{ width: "12rem" }}>
                  <LocationTreeSelect
                    locations={locations}
                    locationTree={locationTree}
                    name="location-filter"
                    selectedId={locationId}
                    onSelectedIdChange={(id) => updateParams({ locationId: id })}
                    noneOptionLabel="All locations"
                  />
                </div>
              )}

              {/* Scope of the location filter (#385), shown only once a location with boxes
                  under it is picked — on a leaf both readings select the same copies. */}
              {hasChildLocations && (
                <SubtreeScopeToggle
                  axis="location"
                  includeDescendants={includeSubLocations}
                  onChange={setIncludeSubLocations}
                />
              )}

              <IssueFilterAutocomplete
                collectionId={collectionId}
                areaIds={filterAreaIds}
                selectedIssueId={issueId}
                onSelect={(id) => updateParams({ issueId: id })}
              />
            </div>
          </ListToolbar>

          {/* A platform-exclusion write that failed (#506) has no dialog to report into, so it
              reports here, directly above the rows it did not change. */}
          {exclusionError && (
            <div
              role="alert"
              style={{
                margin: "0.75rem 1rem 0",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--color-error-border, var(--color-border))",
                background: "var(--color-error-soft, var(--color-bg-page))",
                color: "var(--color-error)",
                fontSize: "0.8125rem",
              }}
            >
              {exclusionError}
            </div>
          )}

          {/* List — flat copies, one row per duplicate group (#372), per place (#421), or per
              issue (#424) */}
          {listLoading && (
            <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              {groupDuplicates
                ? "Grouping duplicates…"
                : locationGroupBy
                  ? "Grouping by location…"
                  : groupIssues
                    ? "Grouping by issue…"
                    : "Loading copies…"}
            </div>
          )}

          {!listLoading && listEmpty && (
            <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              {groupDuplicates
                ? "No duplicate groups here. Grouping covers copies that are For sale, delivered and unsold."
                : locationGroupBy
                ? "No copies match these filters, so there is nothing filed to group."
                : groupIssues
                ? "No copies match these filters, so there is nothing to group by issue."
                : hasActiveFilters
                  ? "No copies match these filters."
                  : filterAreaId
                    ? "No copies in this area."
                    : "No copies yet. Add your first physical copy."}
            </div>
          )}

          {groupDuplicates && allGroups.length > 0 && (
            <div style={{ flex: 1 }}>
              <DuplicateGroupList
                collectionId={collectionId}
                groups={allGroups}
                axes={axes}
                baseFilters={filters}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                hasNextPage={!!groupsQuery.hasNextPage}
                isFetchingNextPage={groupsQuery.isFetchingNextPage}
                onLoadMore={groupsQuery.fetchNextPage}
                selection={copySelection}
              />
            </div>
          )}

          {locationGroupBy && allLocationGroups.length > 0 && (
            <div style={{ flex: 1 }}>
              <LocationGroupList
                collectionId={collectionId}
                groups={allLocationGroups}
                by={locationGroupBy}
                baseFilters={filters}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                hasNextPage={!!locationGroupsQuery.hasNextPage}
                isFetchingNextPage={locationGroupsQuery.isFetchingNextPage}
                onLoadMore={locationGroupsQuery.fetchNextPage}
                selection={copySelection}
              />
            </div>
          )}

          {groupIssues && allIssueGroups.length > 0 && (
            <div style={{ flex: 1 }}>
              <IssueGroupList
                collectionId={collectionId}
                groups={allIssueGroups}
                baseFilters={filters}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                hasNextPage={!!issueGroupsQuery.hasNextPage}
                isFetchingNextPage={issueGroupsQuery.isFetchingNextPage}
                onLoadMore={issueGroupsQuery.fetchNextPage}
                selection={copySelection}
              />
            </div>
          )}

          {flatList && allCopies.length > 0 && (
            <div style={{ flex: 1 }}>
              <InventoryCopyList
                collectionId={collectionId}
                copies={allCopies}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                hasNextPage={!!hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={fetchNextPage}
                selection={copySelection}
                onEdit={(it) => setDialog({ kind: "edit", item: it })}
                onEditStamp={(it) => setDialog({ kind: "editStamp", item: it })}
                onIdentify={(it) => setDialog({ kind: "identify", item: it })}
                onViewHistory={(it) => setDialog({ kind: "history", item: it })}
                onDelete={(it) => setDialog({ kind: "delete", item: it })}
                onAddToOffer={(it) => setDialog({ kind: "addToOffer", items: [it] })}
                onAddToNewOffer={(it) => setDialog({ kind: "addToNewOffer", items: [it] })}
                onViewOffers={(it) => setDialog({ kind: "viewOffers", item: it })}
                onViewPurchase={(it) =>
                  it.purchase &&
                  router.push(
                    `/c/${collectionSlug}/purchases/${it.purchase.id}?lot=${it.lotId}`
                  )
                }
                onDispose={(it) => setDialog({ kind: "dispose", item: it })}
                onRestore={(it) => setDialog({ kind: "restore", item: it })}
                exclusionPlatform={scopedPlatform}
                onSetPlatformExclusion={(it, platformId, excluded) =>
                  applyPlatformExclusion([it], platformId, excluded, false)
                }
                onSetCatalogPrice={(it) => setDialog({ kind: "quickPrice", item: it })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit dialog */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <InventoryItemFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          item={dialog.kind === "edit" ? dialog.item : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createItemAction } = await import("@/app/actions/items");
                const result = await createItemAction(collectionId, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateItemAction } = await import("@/app/actions/items");
                const result = await updateItemAction(dialog.item.id, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Edit the copy's underlying stamp (#243): the shared stamp edit dialog, reused
          exactly as the stamps list and purchase intake do, opened straight from the row. */}
      {dialog.kind === "editStamp" && (
        <StampFormDialog
          mode="edit"
          stampId={dialog.item.stampId}
          collectionId={collectionId}
          stamp={{
            name: dialog.item.stampName,
            issuedDay: dialog.item.issuedDay,
            issuedMonth: dialog.item.issuedMonth,
            issuedYear: dialog.item.issuedYear,
            catalogNumbers: dialog.item.catalogNumbers,
          }}
          areaVendors={[...vendorMapFor(dialog.item.areaId, dialog.item.issueId).values()]}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const stampId = dialog.item.stampId;
            setActionError(undefined);
            startTransition(async () => {
              const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
              const result = await updateStampWithCatalogAction(stampId, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* Identify variant */}
      {dialog.kind === "identify" && (
        <IdentifyVariantDialog
          collectionId={collectionId}
          item={dialog.item}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              const { resolveItemVariantAction } = await import("@/app/actions/items");
              const result = await resolveItemVariantAction(dialog.item.id, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* Refinement history */}
      {dialog.kind === "history" && (
        <VariantHistoryDialog
          collectionId={collectionId}
          item={dialog.item}
          onClose={closeDialog}
        />
      )}

      {/* Add copies to an offer: the full picker (#188), or straight into offer creation when the
          "Add to new offer" action was used (#277). Same dialog, `startInCreate` skips the picker. */}
      {(dialog.kind === "addToOffer" || dialog.kind === "addToNewOffer") && (
        <AddToOfferDialog
          collectionId={collectionId}
          items={dialog.items}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          // No platform filter here, so seed the "create new offer" sub-flow from the last-used
          // platform (#241) and record it when one is created.
          initialPlatform={preferredPlatform}
          onPlatformUsed={rememberPlatform}
          startInCreate={dialog.kind === "addToNewOffer"}
          initialTargetOfferId={dialog.kind === "addToOffer" ? dialog.targetOfferId : undefined}
          initialPackaging={dialog.kind === "addToNewOffer" ? dialog.packaging : undefined}
          onClose={closeDialog}
          onDone={handleSuccess}
        />
      )}

      {/* Every offer this copy is in (#276): read-only, all platforms and states. Closing returns
          to the list; a row opens the offer's detail screen. */}
      {dialog.kind === "viewOffers" && (
        <OffersPopupDialog
          collectionId={collectionId}
          target={{
            kind: "item",
            itemId: dialog.item.id,
            label: dialog.item.stampName ?? formatItemNo(dialog.item.itemNo, itemNoPad),
          }}
          onClose={closeDialog}
        />
      )}

      {/* Quick-add catalog value (#228): the shared price dialog (#147/#170), opened from the
          row action on copies with no catalog value for their condition. */}
      {dialog.kind === "quickPrice" && (
        <QuickPriceDialog
          subject={dialog.item}
          collectionId={collectionId}
          areaName={dialog.item.areaId ? (areaNameById.get(dialog.item.areaId) ?? null) : null}
          primaryVendorId={
            dialog.item.areaId ? (primaryVendorByArea.get(dialog.item.areaId) ?? null) : null
          }
          vendorMap={vendorMapFor(dialog.item.areaId, dialog.item.issueId)}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(entries) => {
            const it = dialog.item;
            setActionError(undefined);
            startTransition(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const result = await quickSetCatalogPricesAction(
                it.stampId,
                it.conditionId,
                it.certificateStatusId,
                entries
              );
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* No longer held (#394/#395): reason + note. The domain's refusals — a copy that has not
          arrived, or one sitting in a live offer — come back as the dialog's error, naming the
          offer to withdraw first. */}
      {dialog.kind === "dispose" && (
        <DisposeCopyDialog
          collectionId={collectionId}
          item={dialog.item}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const id = dialog.item.id;
            setActionError(undefined);
            startTransition(async () => {
              const { disposeItemAction } = await import("@/app/actions/items");
              const result = await disposeItemAction(id, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* The copy turned up again: one fact with nothing to fill in, so a confirmation rather
          than a form. */}
      {dialog.kind === "restore" && (
        <ConfirmDialog
          title="Mark as held again"
          message="This copy goes back into the collection: it counts towards collection value again and can be listed for sale."
          actionLabel="Mark as held"
          pendingLabel="Saving…"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            const id = dialog.item.id;
            startTransition(async () => {
              const { restoreItemAction } = await import("@/app/actions/items");
              const result = await restoreItemAction(id);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete copy"
          message="This permanently removes this physical copy record. This cannot be undone."
          actionLabel="Delete copy"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteItemAction } = await import("@/app/actions/items");
              const result = await deleteItemAction(dialog.item.id);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
