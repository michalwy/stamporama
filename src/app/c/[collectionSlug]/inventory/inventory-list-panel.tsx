"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
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
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
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
import {
  useStampConditionCollisions,
  useInvalidateOffers,
} from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { OFFER_STATE_LABEL, type OfferState } from "@/lib/offer-rules";
import { QuickOfferBar } from "./quick-offer-bar";
import {
  useInventoryItemsInfinite,
  useCopyGroupsInfinite,
  useLocationGroupsInfinite,
  useIssueGroupsInfinite,
  useIssueGroupCompleteness,
  useHoldingsValuation,
  useItemYears,
  useInvalidateInventory,
  useCollectionItemNoPad,
  type InventoryItemFilters,
  type InventoryYearFacetFilters,
} from "./use-inventory-query";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { useGroupExpansion } from "@/app/c/[collectionSlug]/shared/use-group-expansion";
import { usePersistentString } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { HoldingsSummaryBar } from "@/app/c/[collectionSlug]/shared/holdings-summary-bar";
import { InventoryCopyList, type CopyRowActions } from "./inventory-copy-list";
import { DuplicateGroupList } from "./duplicate-group-list";
import { LocationGroupList } from "./location-group-list";
import { IssueGroupList } from "./issue-group-list";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import { useToast } from "@/app/toast-provider";
import { DisposeCopyDialog } from "./dispose-copy-dialog";
import { IdentifyVariantDialog } from "./identify-variant-dialog";
import { VariantHistoryDialog } from "./variant-history-dialog";
import { AddToOfferDialog } from "./add-to-offer-dialog";
import { BulkEditCopiesDialog } from "./bulk-edit-copies-dialog";
import {
  appendBulkChanges,
  type BulkCopyChanges,
} from "@/app/c/[collectionSlug]/shared/bulk-copy-changes";
import { OffersPopupDialog } from "@/app/c/[collectionSlug]/offers/offers-popup-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { useContacts } from "@/app/c/[collectionSlug]/contacts/use-contacts-query";
import { useLastUsedPlatform } from "@/app/c/[collectionSlug]/offers/use-last-used-platform";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { WantReviewDialog } from "@/app/c/[collectionSlug]/wants/want-review-dialog";
import type { ArrivingCopy } from "@/lib/want-rules";
import type { WantMatchForCopy } from "@/lib/wants";

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
  | { kind: "quickPrice"; item: ItemListItem }
  // Location and disposition over the whole selection (#682) — the bulk bar's own dialog, and the
  // only one here that acts on copies rather than on a copy.
  | { kind: "bulkEdit"; items: ItemListItem[] };


/** Can this copy go into an offer? For sale, in hand and still held — the offer composition
 * picker's own eligibility (#164/#188/#394), asked of the selection rather than of the checkbox
 * since #682 widened who gets one. */
function isListableCopy(item: ItemListItem): boolean {
  return item.forSale && isDelivered(item.deliveryState) && item.disposedAt == null;
}

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

/** The filters this list remembers per collection (#693) — every one of them except the search box,
 * which is a lookup one finishes rather than a way of working (a list silently narrowed to a phrase
 * typed last week is the failure that rule avoids). The area and the year are absent because
 * `use-collection-filter-store` already carries them across every list screen (#143), the sort
 * because `usePersistedSort` does (#325), and the platform worklist because #275 remembers it on its
 * own — and its *review* half (#506) is deliberately never remembered, so it is not here either.
 * Grouping mode and its axes are a client preference of their own and never travel in the URL. */
const REMEMBERED_FILTER_KEYS = [
  "conditionIds",
  "formatIds",
  "certificateStatusIds",
  "deliveryStates",
  "locationId",
  "issueId",
  "noPhotos",
  "missingCatalogValue",
  "includeGone",
  "includeDisposed",
  ...DISPOSITION_FILTERS.map((f) => f.key),
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

/**
 * The listing buttons while the selection **collides** with a live offer (#660).
 *
 * The banner beside them already says so, and per real use it is still possible to read past it and
 * create the duplicate anyway — so the warning is repeated on the two controls that would create it,
 * in the same amber the banner and the rest of the app mark work-to-do with. Nothing else changes:
 * both buttons still do exactly what they say, because the collector may know precisely what they
 * are doing (#513's rule — a warning beside the buttons, never a disabled button).
 *
 * Two of them, because the pair is not one shape: the ＋ New offer shortcuts are outlined and the
 * Add-to-offer button is filled, and a single override would flatten one into the other.
 */
const COLLIDING_OUTLINE: React.CSSProperties = {
  color: "var(--color-warning)",
  borderColor: "var(--color-warning)",
  background: "var(--color-warning-soft)",
};

const COLLIDING_FILLED: React.CSSProperties = {
  color: "#fff",
  background: "var(--color-warning)",
};

/** A comma-separated multi-select filter (#425, #427), memoised so the filter objects it feeds stay
 * referentially stable and do not refetch every render. Takes the value *in force* — which since
 * #693 is the URL's or the remembered one — rather than reading the URL itself. An absent or
 * all-blank value is the empty list: the absence of the filter, never an empty set. */
function useCsvValue(raw: string | null): string[] {
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

  // Every filter below is remembered per collection (#693): the URL wins where it names one, the
  // stored set fills in otherwise, and `updateParams` — the one funnel every filter control writes
  // through — stores the set as it stands after each change.
  const { readParam: readFilterParam, remember: rememberFilters } = usePersistedFilterParams(
    "inventory-filters",
    collectionId,
    REMEMBERED_FILTER_KEYS,
    searchParams
  );

  // The search box is the one filter *not* remembered: it is a lookup one finishes, and a fresh
  // visit narrowed to a phrase nobody remembers typing reads as a broken list rather than a
  // remembered one.
  const search = searchParams.get("search") ?? "";
  // Condition, format and delivery state are **multi-selects** (#425, #427): a copy is in exactly
  // one of each, but the question asked of the list is routinely a group of them — "the mint
  // grades", "everything still on its way to me" — and asking it three times over is not the same as
  // asking it once. Comma-separated in the URL exactly as `areaIds` is; an empty list is the absence
  // of the filter.
  const conditionIds = useCsvValue(readFilterParam("conditionIds"));
  // Format is a *filter* here, not a price switcher (#343): a copy's format is a fact it carries,
  // so the list narrows to it exactly the way it narrows to a condition. `"single"` is a real
  // choice — the copies with no format — which an absent value could not express.
  const formatIds = useCsvValue(readFilterParam("formatIds"));
  // Certificate is the fourth fact a copy carries that this list reasons about — it is a
  // duplicate-grouping axis, a valuation axis and a listing axis — and until #428 it was the one with
  // no filter at all. `"none"` is a tickable value, not the absence of the filter: null *is* a value
  // here (ADR-0006 §2), exactly as `"single"` is for format.
  const certificateStatusIds = useCsvValue(readFilterParam("certificateStatusIds"));
  const locationId = readFilterParam("locationId") ?? "";
  // Whether a picked location brings the boxes filed under it (#385). Server-side, unlike the
  // area axis — the location subtree is resolved in `resolveLocationScope`.
  const [includeSubLocations, setIncludeSubLocations] = useSubtreeScope("location");
  const issueId = readFilterParam("issueId") ?? "";
  const noPhotos = readFilterParam("noPhotos") === "true";
  const missingCatalogValue = readFilterParam("missingCatalogValue") === "true";
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
  const deliveryStates = useCsvValue(readFilterParam("deliveryStates"));
  // Sold copies are hidden by default (#207); this toggle brings them back into the list.
  const includeGone = readFilterParam("includeGone") === "true";
  // Copies no longer held are hidden the same way (#394/#395): the list answers "what do I have".
  const includeDisposed = readFilterParam("includeDisposed") === "true";
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
      if (readFilterParam(key) === "true") set.add(key);
    }
    return set;
  }, [readFilterParam]);

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
      includeGone: includeGone || undefined,
      includeDisposed: includeDisposed || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, parsedCatalog, conditionIds, certificateStatusIds, formatIds, locationId, includeSubLocations, issueId, year, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, excludedPlatformId, deliveryStates, includeGone, includeDisposed, sortBy, sortDir]
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
      includeGone: includeGone || undefined,
      includeDisposed: includeDisposed || undefined,
    }),
    [filterAreaIds, search, parsedCatalog, conditionIds, certificateStatusIds, formatIds, locationId, includeSubLocations, issueId, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, excludedPlatformId, deliveryStates, includeGone, includeDisposed]
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

  // The open wants a freshly added copy could satisfy (#532; ADR-0032 §7). Raised after the add
  // dialog has closed, and never on an edit — an edit is not a copy arriving.
  const [wantReview, setWantReview] = useState<{
    copies: ArrivingCopy[];
    matches: WantMatchForCopy[];
  } | null>(null);

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
      // Both, in the same breath (#325/#693). A cleared filter leaves the URL, so remembering it
      // here — with the update's own `""` winning over what is stored — is what makes switching a
      // filter off stick rather than being read straight back on the next render.
      rememberFilters(updates);
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/inventory${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams, rememberFilters]
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
  // The holdings bar counts exactly what the list is showing (#151), and since #692 that is the
  // filtered set whatever the grouping mode: no mode narrows the copies on its own any more, so
  // there is nothing left here to re-narrow with.
  const { data: holdingsTotal } = useHoldingsValuation(collectionId, filters);

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
  // The issues on screen, asked for in one go (#594). The issue-less group is left out: it is a
  // bucket of copies, not a set that can be complete.
  const issueGroupIds = useMemo(
    () => allIssueGroups.map((g) => g.issueId).filter((id): id is string => id !== null),
    [allIssueGroups]
  );
  const { data: issueGroupCompleteness } = useIssueGroupCompleteness(
    collectionId,
    filters,
    issueGroupIds,
    groupIssues
  );

  // Which group rows are open (#538). One state for all three groupings — exactly one is ever on
  // screen, and keying it on `groupMode` is what drops it when the list becomes a different list.
  // Held at the panel so the Expand all / Collapse all control can speak for the whole list, the
  // call `useCardExpansion` (#382) makes for the lot / set cards on the detail screens.
  const groupKeys = useMemo(
    () =>
      (groupDuplicates
        ? allGroups
        : locationGroupBy
          ? allLocationGroups
          : groupIssues
            ? allIssueGroups
            : []
      ).map((g) => g.key),
    [groupDuplicates, locationGroupBy, groupIssues, allGroups, allLocationGroups, allIssueGroups]
  );
  const groupExpansion = useGroupExpansion(groupKeys, groupMode);

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
  // The part of the selection an **offer** can be made of — for sale, in hand, still held (the
  // composition picker's own eligibility, #164/#188/#394). Since #682 the checkbox no longer asks
  // that question, so the listing actions ask it here instead: they act on this subset and are not
  // offered at all when it is empty. Narrowing beats disabling, because the same selection is a
  // perfectly good target for the location and disposition actions beside them.
  const listableCopies = useMemo(() => selectedCopies.filter(isListableCopy), [selectedCopies]);
  /** Said on the listing buttons themselves, never in the bar's count: the bar counts what is
   * ticked, and only those buttons act on part of it. Empty while the whole selection qualifies. */
  const partialListingHint =
    listableCopies.length < selectedCopies.length
      ? ` Applies to the ${listableCopies.length} of ${selectedCopies.length} selected copies that are for sale and in hand.`
      : "";

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
  /* ── Quick offer mode (#537) ───────────────────────────────────────────────────────────────────
   * A listing pass over many near-identical copies: the platform and the starting status are set
   * once in the bar, and every "Add to new offer" from then on creates the offer without the create
   * dialog. Not persisted, deliberately — see `QuickOfferBar`: a mode that skips a confirmation must
   * never be in force on a screen the collector has just opened.
   */
  const [quickOffer, setQuickOffer] = useState(false);
  const [quickPlatformId, setQuickPlatformId] = useState("");
  const [quickState, setQuickState] = useState<OfferState>("preparing");
  const [quickCreated, setQuickCreated] = useState(0);
  const [quickError, setQuickError] = useState<string | undefined>();
  const { invalidateAll: invalidateOffers } = useInvalidateOffers();
  const quickPlatform = useMemo(
    () => offerPlatforms.find((p) => p.id === quickPlatformId) ?? null,
    [offerPlatforms, quickPlatformId]
  );
  // Armed only once the bar carries a platform that can actually take an offer: its currency is
  // fixed at the platform (#196) and choosing one belongs in the create form, so a platform without
  // one falls back to the ordinary dialog rather than failing per click.
  const quickOfferActive = quickOffer && !!quickPlatform?.platformCurrency;

  /** Create one offer from `items`, seeded with them, using the bar's platform and status (#537).
   * `perCopy` splits several copies into one single-copy set each — the same packaging choice the
   * dialog's footer carries, made here by which button was pressed (#497). No price and no URL: the
   * pass is about getting the listings *made*, and both land on the offer's own screen afterwards. */
  const createQuickOffer = useCallback(
    (items: ItemListItem[], perCopy: boolean) => {
      if (!quickPlatform) return;
      setQuickError(undefined);
      startTransition(async () => {
        const formData = new FormData();
        formData.set("platformId", quickPlatform.id);
        formData.set("state", quickState);
        const { createOfferAction } = await import("@/app/actions/offers");
        const created = await createOfferAction(
          collectionId,
          formData,
          items.map((i) => i.id),
          perCopy && items.length > 1
        );
        if (created.status !== "success") {
          setQuickError(created.message);
          return;
        }
        rememberPlatform(quickPlatform.id);
        setQuickCreated((n) => n + 1);
        invalidateOffers(collectionId);
        invalidateList(collectionId);
        // Same rule as every other bulk act on this list: what has been dealt with is unticked, so
        // the next press of the same button cannot list it twice.
        clearSelection();
      });
    },
    [
      quickPlatform,
      quickState,
      collectionId,
      rememberPlatform,
      invalidateOffers,
      invalidateList,
      clearSelection,
    ]
  );

  // The stamp × condition conflict for the selection (#513, narrowed by #732): live offers on the
  // platform in scope that already list a set of exactly these stamps in exactly these conditions
  // — the entry Colnect refuses a second of. A partial overlap is not one: listing one stamp out
  // of a listed series is its own entry on the marketplace, and warning about it would fire on an
  // ordinary, correct action.
  // Only asked while a platform *is* in scope (#506's shared reading of the platform filter): a
  // collision is always a collision on some platform, and with none named there is no listing being
  // planned to warn about.
  // Asked of the **listable** copies only (#682): a copy that is not for sale or not in hand is
  // going nowhere near an offer, so it can collide with none.
  const listableIdList = useMemo(() => listableCopies.map((c) => c.id), [listableCopies]);
  const { data: selectionCollisions = [] } = useStampConditionCollisions(
    collectionId,
    listableIdList,
    scopedPlatform?.id ?? null,
    listableIdList.length > 0
  );
  // The offer the bar's shortcut points at: the one accounting for the most of the selection, which
  // is how `findStampConditionCollisions` already orders them.
  const collisionOffer = selectionCollisions[0];

  // Whether the whole selection is already set aside from the platform in scope — which is what the
  // bulk button offers to undo. "All of them", not "any": with a mixed selection the useful action
  // is still to set the rest aside, and the excluded ones absorb it as a no-op.
  const selectionExcluded =
    !!scopedPlatform &&
    selectedCopies.length > 0 &&
    selectedCopies.every((c) => c.excludedPlatformIds.includes(scopedPlatform.id));

  /**
   * Ask the want list what a copy that has just **arrived** could satisfy, and put the review up if
   * anything does (#532; ADR-0032 §7).
   *
   * The action only hands a copy over when it reached the collector's hands — added already
   * delivered, or edited into `delivered` from a state that was not — so this needs no test of its
   * own for *when*. Only raised when something matches: a review with nothing in it is a dialog
   * that says "no news".
   */
  async function raiseWantReview(copy: ArrivingCopy | undefined) {
    if (!copy) return;
    const { findWantsSatisfiedByAction } = await import("@/app/actions/wants");
    const matches = await findWantsSatisfiedByAction(collectionId, [copy]);
    if (matches.length > 0) setWantReview({ copies: [copy], matches });
  }

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

  // Confirmation toasts (#541). This list groups, filters and hides in more ways than any other —
  // by area, by location, by duplicate group, by delivery state — so a saved copy routinely lands
  // somewhere the collector is not looking, and a disposed one leaves the view entirely.
  const { toast } = useToast();

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

  // **Every copy still held is selectable** (#682). It used to be the offer picker's own
  // eligibility — for sale and in hand (#164/#188) — because listing was the only thing a selection
  // was for; filing a batch into a location and re-flagging one are about exactly the copies that
  // test excludes, and a checkbox that appears only on stock would have put the collection's own
  // copies out of reach of the two actions written for them. A **disposed** copy still gets none
  // (#394): it is not there to be moved or re-flagged, and its row says so.
  const copySelection = useMemo(
    () => ({
      selected: selectedIds,
      onToggle: toggleSelected,
      onSetMany: setManySelected,
      isEligible: (item: ItemListItem) => item.disposedAt == null,
    }),
    [selectedIds, toggleSelected, setManySelected]
  );

  // The row `⋮` menu (#125), built once and given to **every** branch below — the flat list and all
  // three groupings alike (#516). A grouping decides what a copy is listed under; it has never been
  // a reason for the copy to offer fewer actions, and the grouped branches passing `readOnly` is
  // exactly how the menu went missing the moment one was switched on.
  const rowActions: CopyRowActions = useMemo(
    () => ({
      onEdit: (it) => setDialog({ kind: "edit", item: it }),
      onEditStamp: (it) => setDialog({ kind: "editStamp", item: it }),
      onIdentify: (it) => setDialog({ kind: "identify", item: it }),
      onViewHistory: (it) => setDialog({ kind: "history", item: it }),
      onDelete: (it) => setDialog({ kind: "delete", item: it }),
      onAddToOffer: (it) => setDialog({ kind: "addToOffer", items: [it] }),
      // In quick offer mode (#537) this is the whole act: one click, one offer, no dialog.
      onAddToNewOffer: (it) =>
        quickOfferActive
          ? createQuickOffer([it], false)
          : setDialog({ kind: "addToNewOffer", items: [it] }),
      // …and the entry says so, since a menu that reads the same in both modes would be the only
      // thing on screen not admitting which one is in force.
      quickOffer:
        quickOfferActive && quickPlatform
          ? { platformName: quickPlatform.name, stateLabel: OFFER_STATE_LABEL[quickState] }
          : undefined,
      onViewOffers: (it) => setDialog({ kind: "viewOffers", item: it }),
      purchaseHref: (it) =>
        it.purchase ? `/c/${collectionSlug}/purchases/${it.purchase.id}?lot=${it.lotId}` : null,
      onDispose: (it) => setDialog({ kind: "dispose", item: it }),
      onRestore: (it) => setDialog({ kind: "restore", item: it }),
      exclusionPlatform: scopedPlatform,
      onSetPlatformExclusion: (it, platformId, excluded) =>
        applyPlatformExclusion([it], platformId, excluded, false),
      onSetCatalogPrice: (it) => setDialog({ kind: "quickPrice", item: it }),
    }),
    [
      collectionSlug,
      scopedPlatform,
      applyPlatformExclusion,
      quickOfferActive,
      quickPlatform,
      quickState,
      createQuickOffer,
    ]
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
    includeGone ||
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
        {/* The header's actions, as **one** right-aligned group. Two siblings each carrying their
            own `marginLeft: auto` is not that — auto margins consume the free space *before*
            `space-between` does and share it equally, which left Quick offer mode adrift in the
            middle of the header instead of beside Add copy. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          {/* Quick offer mode (#537). Offered only where there is a platform to list on, and armed
              from here rather than from the filter toolbar: it is a way of *working through* the
              list, not a way of narrowing it — so it belongs beside Add copy, with the screen's
              other actions. Switching it on seeds the platform from the same signal the create
              dialog uses: the worklist filter, else the last platform listed on. */}
          {offerPlatforms.length > 0 && (
            <Tooltip content="Set the platform and status once, then every “Add to new offer” creates the offer on the spot — for listing many copies in one pass.">
              <button
                type="button"
                onClick={() => {
                  if (quickOffer) {
                    setQuickOffer(false);
                    return;
                  }
                  setQuickPlatformId(
                    (prev) => prev || preferredPlatform?.id || offerPlatforms[0]?.id || ""
                  );
                  setQuickCreated(0);
                  setQuickError(undefined);
                  setQuickOffer(true);
                }}
                style={{
                  ...CONTROL_STYLE,
                  cursor: "pointer",
                  flexShrink: 0,
                  // Weight and border width are held constant across the two states: this is a
                  // button one presses and unpresses, and a label that thickens on click re-lays the
                  // whole header out under the cursor. Only the colours say which state it is in.
                  fontWeight: 600,
                  color: quickOffer ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: quickOffer ? "var(--color-accent)" : "var(--color-border-strong)",
                  background: quickOffer ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                }}
              >
                <Icon name="newOffer" size="sm" /> Quick offer mode
              </button>
            </Tooltip>
          )}
          {/* The other way copies are added (#725): a whole stockbook card scanned, cut and
              identified piece by piece. A **link** and not a dialog — the pass runs over days, so it
              has its own screen — and it sits beside *Add copy* because the two answer the same
              question: one stamp in the tweezers, or forty on a card. */}
          <Tooltip content="Scan a whole stockbook card and identify its stamps into the collection — for cataloguing what is already owned.">
            <Link
              href={`/c/${collectionSlug}/inventory/scans`}
              style={{
                ...CONTROL_STYLE,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                textDecoration: "none",
                cursor: "pointer",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                flexShrink: 0,
              }}
            >
              <Icon name="scan" size="sm" /> Scan a card
            </Link>
          </Tooltip>
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
              flexShrink: 0,
            }}
          >
            Add copy
          </button>
        </div>
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
                  {/* The conflict this selection would create on the platform in scope (#513,
                      #732): another live offer already lists exactly these stamps in exactly these
                      conditions, and Colnect refuses a second of that entry. Stated where the
                      listing actions are, with the shortcut that resolves it — adding to that offer
                      instead of making a new one. No count of copies: the rule is all-or-nothing on
                      the whole composition, so it is always the whole selection. A warning beside
                      the buttons, never a disabled button: the collector may know exactly what they
                      are doing. */}
                  {collisionOffer && (
                    <Tooltip
                      content={selectionCollisions
                        .map((c) => `${formatEntityNo(c.offerNo)} ${c.offerLabel}`)
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
                        This is already offered on {collisionOffer.platformName} in this condition
                      </span>
                    </Tooltip>
                  )}
                  {collisionOffer && (
                    <Tooltip
                      content={`Add the selection to ${formatEntityNo(collisionOffer.offerNo)} ${collisionOffer.offerLabel} instead of making a second listing of the same thing.`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setDialog({
                            kind: "addToOffer",
                            items: listableCopies,
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
                  {/* The bulk actions, in one group pushed to the right of the bar. */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}
                  >
                    {/* Where these copies are kept, what they are kept for (#682) and what they
                        are (#723). One dialog for all of it, and the only bar action that acts on
                        the *whole* selection: the listing ones beside it can only speak for the
                        copies that are for sale and in hand. */}
                    <Tooltip content="Move the selected copies to a storage location, turn any of their disposition flags on or off, and restate their condition, certificate or format — all in one pass.">
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "bulkEdit", items: selectedCopies })}
                        style={{
                          ...CONTROL_STYLE,
                          cursor: "pointer",
                          fontWeight: 600,
                          color: "var(--color-text-secondary)",
                          borderColor: "var(--color-border-strong)",
                          background: "var(--color-bg-elevated)",
                          padding: "0.375rem 0.75rem",
                        }}
                      >
                        <Icon name="edit" size="sm" /> Bulk edit…
                      </button>
                    </Tooltip>
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
                    {/* The listing half of the bar: the picker flow, and beside it the shortcuts
                        that skip it (#497) — a new offer is the common quick start, so the only
                        decision left, one set or one each, is made by which button is pressed.
                        Secondary next to the primary, since they are narrower paths through the
                        same flow; with a single copy there is no packaging to choose, so the pair
                        collapses into one ＋ New offer button. All of it acts on the copies that
                        can actually be listed (#682) — absent rather than disabled when the
                        selection holds none, a selection of album copies being a perfectly good
                        target for the actions beside these, and a dead button among live ones
                        reading as a fault. Where only some qualify, the labels carry the number: a
                        count that differs from the bar's own is the plainest way to say which
                        copies are meant. */}
                    {listableCopies.length > 0 && (
                      <>
                        {newOfferShortcuts(listableCopies.length).map(({ packaging, label, hint }) => (
                          <Tooltip
                            key={packaging}
                            content={
                              (quickOfferActive && quickPlatform
                                ? `${hint} Created straight away on ${quickPlatform.name} as ${OFFER_STATE_LABEL[quickState]}, with no dialog.`
                                : hint) + partialListingHint
                            }
                          >
                            <button
                              type="button"
                              onClick={() =>
                                quickOfferActive
                                  ? createQuickOffer(listableCopies, packaging === "per-copy")
                                  : setDialog({
                                      kind: "addToNewOffer",
                                      items: listableCopies,
                                      packaging,
                                    })
                              }
                              style={{
                                ...CONTROL_STYLE,
                                cursor: "pointer",
                                fontWeight: 600,
                                color: "var(--color-accent)",
                                borderColor: "var(--color-accent)",
                                background: "var(--color-bg-elevated)",
                                padding: "0.375rem 0.75rem",
                                // Amber while this selection already has a live offer (#660).
                                ...(collisionOffer ? COLLIDING_OUTLINE : {}),
                              }}
                            >
                              <Icon name="add" size="sm" /> {label}
                            </button>
                          </Tooltip>
                        ))}
                        <Tooltip
                          content={
                            "Put these copies into an offer — an existing one, or a new one." +
                            partialListingHint
                          }
                        >
                          <button
                            type="button"
                            onClick={() => setDialog({ kind: "addToOffer", items: listableCopies })}
                            style={{
                              ...CONTROL_STYLE,
                              cursor: "pointer",
                              fontWeight: 600,
                              color: "#fff",
                              background: "var(--color-action-primary)",
                              border: "none",
                              padding: "0.375rem 0.875rem",
                              // Amber while this selection already has a live offer (#660).
                              ...(collisionOffer ? COLLIDING_FILLED : {}),
                            }}
                          >
                            <Icon name="addToOffer" size="sm" />{" "}
                            {listableCopies.length < selectedCopies.length
                              ? `Add ${listableCopies.length} to offer`
                              : "Add selected to offer"}
                          </button>
                        </Tooltip>
                      </>
                    )}
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
                <Tooltip content="Also show copies that have left — sold, or given to a partner in a closed trade (hidden by default)">
                  <button
                    type="button"
                    onClick={() => updateParams({ includeGone: includeGone ? "" : "true" })}
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      fontWeight: includeGone ? 600 : 400,
                      color: includeGone ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: includeGone ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: includeGone ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Include sold &amp; traded
                  </button>
                </Tooltip>
                {/* Copies no longer held (#394/#395), beside the one above: between them these are
                    the ways a copy leaves the shelf — sold, given to a partner (#644), or lost.
                    Hidden by default for the same reason — the list answers "what do I have". */}
                <Tooltip content="Also show copies you no longer hold — lost, damaged in storage, discarded (hidden by default)">
                  <button
                    type="button"
                    onClick={() =>
                      updateParams({ includeDisposed: includeDisposed ? "" : "true" })
                    }
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
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
                <Tooltip content="Collapse the list into groups: interchangeable duplicates, the copies filed in one place, or what you hold of one issue. Grouping never changes which copies are shown — the filters decide that.">
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
              />

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

          {/* The mode's parameters, and the only thing on screen that says a click will now list
              something without asking (#537). Directly above the rows it acts on. */}
          {quickOffer && (
            <QuickOfferBar
              platforms={offerPlatforms}
              platformId={quickPlatformId}
              onPlatformIdChange={setQuickPlatformId}
              state={quickState}
              onStateChange={setQuickState}
              created={quickCreated}
              error={quickError}
              isPending={isPending}
              onExit={() => setQuickOffer(false)}
            />
          )}

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
                ? "No copies match these filters, so there is nothing to group as duplicates."
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

          {/* Expand all / Collapse all (#538), mirroring the control the detail screens' lot and
              set cards carry (#202/#382) — and placed as they place it: on its own line directly
              above the rows it operates, right-aligned. It is not a filter and does not belong among
              them; in the toolbar it read as one more way of narrowing the list. Absent without
              grouping, the flat list having nothing to open. Opening a group fetches its copies, so
              this is a real request rather than a display toggle, and the label says which way it
              goes next. */}
          {!flatList && groupKeys.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "0.5rem 1.25rem 0.25rem",
              }}
            >
              <Tooltip
                content={
                  groupExpansion.allExpanded
                    ? "Close every group, back to one line each."
                    : "Open every group and load the copies under it."
                }
              >
                <button
                  type="button"
                  onClick={groupExpansion.toggleAll}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {groupExpansion.allExpanded ? "Collapse all" : "Expand all"}
                </button>
              </Tooltip>
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
                expansion={groupExpansion}
                selection={copySelection}
                rowActions={rowActions}
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
                expansion={groupExpansion}
                selection={copySelection}
                rowActions={rowActions}
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
                expansion={groupExpansion}
                selection={copySelection}
                rowActions={rowActions}
                completeness={issueGroupCompleteness}
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
                {...rowActions}
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
                if (result.status === "success") {
                  handleSuccess();
                  // The copy's own number is only known where it has *arrived* (#532) — an ordered
                  // one is not enriched — so the link is offered where there is one to offer and the
                  // confirmation stands alone otherwise.
                  toast(
                    result.copy
                      ? {
                          message: `Copy #${result.copy.itemNo} added`,
                          href: `/c/${collectionSlug}/inventory/${result.copy.itemId}`,
                          linkLabel: "Open copy",
                        }
                      : { message: "Copy added" }
                  );
                  await raiseWantReview(result.copy);
                } else if (result.status === "error") setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateItemAction } = await import("@/app/actions/items");
                const itemId = dialog.item.id;
                const itemNo = dialog.item.itemNo;
                const result = await updateItemAction(itemId, fd);
                if (result.status === "success") {
                  handleSuccess();
                  toast({
                    message: `Copy #${itemNo} saved`,
                    href: `/c/${collectionSlug}/inventory/${itemId}`,
                    linkLabel: "Open copy",
                  });
                  // An edit raises the review too, but only the one that turned the copy
                  // `delivered` — which is how a copy bought at auction and settled into a purchase
                  // finally reaches this question (#532; ADR-0032 §7).
                  await raiseWantReview(result.copy);
                } else if (result.status === "error") setActionError(result.message);
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

      {/* Where the selection is kept, what it is kept for (#682) and what it is (#723). The intake
          screen's own bulk write (#121/#565) over an id list: one action for both screens, so a copy
          filed from here and one filed while its purchase was being sorted are written the same
          way. */}
      {dialog.kind === "bulkEdit" && (
        <BulkEditCopiesDialog
          copies={dialog.items}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          formats={formats}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(changes: BulkCopyChanges) => {
            const items = dialog.items;
            setActionError(undefined);
            startTransition(async () => {
              const fd = new FormData();
              fd.set("itemIds", items.map((i) => i.id).join(","));
              appendBulkChanges(fd, changes);
              const { bulkUpdateLotItemsAction } = await import("@/app/actions/purchases");
              const result = await bulkUpdateLotItemsAction(fd);
              if (result.status === "success") {
                handleSuccess();
                // #541: this list groups, filters and hides in more ways than any other, so a
                // filed or re-flagged copy routinely lands somewhere the collector is not looking.
                toast({
                  message: `${items.length} cop${items.length === 1 ? "y" : "ies"} updated`,
                });
              } else if (result.status === "error") setActionError(result.message);
            });
          }}
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
              const itemNo = dialog.item.itemNo;
              const result = await disposeItemAction(id, fd);
              if (result.status === "success") {
                handleSuccess();
                toast({
                  message: `Copy #${itemNo} marked as no longer held`,
                  href: `/c/${collectionSlug}/inventory/${id}`,
                  linkLabel: "Open copy",
                });
              } else if (result.status === "error") setActionError(result.message);
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
              const itemNo = dialog.item.itemNo;
              const result = await restoreItemAction(id);
              if (result.status === "success") {
                handleSuccess();
                toast({
                  message: `Copy #${itemNo} is held again`,
                  href: `/c/${collectionSlug}/inventory/${id}`,
                  linkLabel: "Open copy",
                });
              } else if (result.status === "error") setActionError(result.message);
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
              const itemNo = dialog.item.itemNo;
              const result = await deleteItemAction(dialog.item.id);
              if (result.status === "success") {
                handleSuccess();
                toast({ message: `Copy #${itemNo} deleted` });
              } else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* The open wants the copy just added could satisfy (#532). Closes nothing on its own. */}
      {wantReview && (
        <WantReviewDialog
          collectionId={collectionId}
          copies={wantReview.copies}
          matches={wantReview.matches}
          onClose={() => setWantReview(null)}
        />
      )}
    </div>
  );
}
