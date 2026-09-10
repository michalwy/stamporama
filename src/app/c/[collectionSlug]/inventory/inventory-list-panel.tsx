"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { ItemListItem, ItemSortBy } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import {
  type CopyGroupMode,
  COPY_GROUP_MODES,
  COPY_GROUP_MODE_LABEL,
  asCopyGroupMode,
  copyGroupingSortReason,
  describeCopyGrouping,
} from "@/lib/copy-grouping";
import type { LocationGroupBy } from "@/lib/location-groups";
import { isDelivered } from "@/lib/delivery-state";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { ConfirmDialog } from "@/app/dialog-shell";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useListAreaYearFilter } from "@/app/c/[collectionSlug]/shared/use-list-area-year-filter";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { SubtreeScopeToggle, useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import {
  LIST_BANNER_STYLE,
  ListToolbar,
  type SortOption,
} from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { SingleSelectFilter } from "@/app/c/[collectionSlug]/shared/single-select-filter";
import { FilterFooterToggle } from "@/app/c/[collectionSlug]/shared/filter-popover";
import { parseCatalogSearch } from "@/lib/catalog-number";
import { DELIVERY_STATES, DELIVERY_STATE_META } from "@/lib/delivery-state";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
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
  useItemCount,
  useItemYears,
  useItemAreaFacets,
  useInvalidateInventory,
  useCollectionItemNoPad,
  type InventoryItemFilters,
  type InventoryYearFacetFilters,
  type InventoryAreaFacetFilters,
} from "./use-inventory-query";
import { useRowsInView } from "./use-rows-in-view";
import { rowsInView, selectionInView } from "@/lib/rows-in-view";
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
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
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

/**
 * The four switches that share one control (#846). They were four chips and between them the width
 * of a third of the filter bar, for questions asked once in a while: *has this copy a photo yet*,
 * *does its condition have a catalog price*, and the two that reach for copies the list hides.
 *
 * They are grouped rather than merely gathered, because **two of them pull the other way**. The
 * `Show only` pair narrows — each ticked one is a further `AND` a copy must satisfy — while the
 * `Also include` pair widens the set those narrowings are applied to. One list of four labels
 * would have made that unguessable; the headings are the whole reason the control is legible with
 * two ticked. The labels keep the word *Include* so a single tick still reads correctly on the
 * trigger, where the heading is not on screen.
 */
const SPARE_FILTERS = [
  { key: "noPhotos", label: "No photos", group: "Show only" },
  { key: "missingCatalogValue", label: "Missing catalog value", group: "Show only" },
  { key: "includeGone", label: "Include sold & traded", group: "Also include" },
  { key: "includeDisposed", label: "Include no longer held", group: "Also include" },
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
 * The fixed widths this bar's dropdowns are drawn in (#868).
 *
 * **A control sized to its own label is a control that moves the bar when it is used.** Every one
 * of these reads differently once something is picked — `All conditions` becomes `Mint` becomes
 * `3 conditions` — and each of those is a different width, so a tick shifts everything to its
 * right at the moment the collector is working the row. Counting several values instead of listing
 * them (#425) bounds that growth; it does not stop it.
 *
 * Each is sized for the widest thing the control normally shows — the `All …` label it wears by
 * default is usually it — and anything longer (a collection's own condition or format names are
 * the collector's text, and unbounded) is ellipsised inside the box rather than allowed to stretch
 * it. The bar is therefore a little wider at rest than it was and **exactly as wide whatever is
 * picked**, which is the trade #868 asks for: the third cost it names is a bar whose width cannot
 * be predicted from what is on it.
 *
 * The location dropdown was already spelled this way by #846; the rest followed here.
 */
const FILTER_WIDTH = {
  deliveryStates: "10.5rem",
  dispositions: "9.5rem",
  conditions: "10rem",
  certificates: "10.5rem",
  formats: "9rem",
  /** The widest of the six, and not because its default label is: its options are whole sentences
   *  (*Include no longer held*, *Include sold & traded*) that differ only at the end, so a trigger
   *  that ellipsised one would read the same as the other. */
  spareFilters: "12.5rem",
  location: "12rem",
  /** Wider than the rest: it holds `Group by location ref` and the summary of the two splits it
   *  carries inside (`COPY_GROUPING_LABEL_BUDGET`, pinned by a unit test). */
  grouping: "14rem",
} as const;

/** What a `Tooltip` around a bar control needs to stop being the loose link: it renders an
 *  `inline-flex` span, and **that span** is the row's flex child rather than the fixed-width slot
 *  inside it, so without this the width holds only until the row runs out of room. */
const NO_SHRINK: React.CSSProperties = { flexShrink: 0 };

/** One fixed-width slot on the filter bar — see {@link FILTER_WIDTH}. `flexShrink: 0` is half of
 *  what makes it fixed: without it the row shrinks its controls before it wraps, so their widths
 *  would still depend on what else is on the bar. */
function FilterSlot({ width, children }: { width: string; children: React.ReactNode }) {
  return <div style={{ width, flexShrink: 0 }}>{children}</div>;
}

/** The heading over the grouping panel's split switches (#868), saying **when** they apply. It is
 *  what keeps a pair of controls that are disabled four times out of five from reading as
 *  decoration: they are not settings of grouping, they are settings of one grouping, and a reader
 *  who has never used that grouping learns here that it has them. */
const GROUPING_FOOTER_HEADING_STYLE: React.CSSProperties = {
  padding: "0.4rem 0.55rem 0.15rem",
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
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
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();

  const { data: contacts = [] } = useContacts(collectionId);
  const offerPlatforms = useMemo(() => contacts.filter((c) => c.platform), [contacts]);
  const [lastPlatformId, rememberPlatform] = useLastUsedPlatform(collectionId);

  // Area + year, the one selection every list rail shares (#143, #844): the address bar wins where
  // it names one, the per-collection memory fills in otherwise, and whichever answered is mirrored
  // back into both — the precedence and the two mirrors are `use-list-area-year-filter.ts`.
  const { filterAreaId, year } = useListAreaYearFilter(collectionId, areas);

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
  const [storedGroupMode, setGroupMode] = usePersistentString(
    `stamporama:inventory:groupMode:${collectionId}`,
    "none"
  );
  // Narrowed on the way out of storage: everything below reads a mode rather than a string, and a
  // value the product no longer has reads as no grouping rather than as a list whose rows never
  // arrive (`copy-grouping.ts`).
  const groupMode = asCopyGroupMode(storedGroupMode);
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
  /** The grouping actually in force, which is not always the one in storage: a filing grouping
   *  remembered from before the last location was deleted falls back to the flat list above. The
   *  **control** reads this rather than the stored value (#868), so it cannot sit there saying
   *  *Group by location* over a list that is not grouped — and neither can the sort control beside
   *  it grey itself out over a list whose order the collector really can set. */
  const effectiveGroupMode: CopyGroupMode = flatList ? "none" : groupMode;
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
  /** Which of the four spare filters (#846) are on — the selection the one control they share
   * reads from. Their individual booleans stay above, because that is what the query takes. */
  const spareFilters = useMemo(() => {
    const set = new Set<string>();
    for (const { key } of SPARE_FILTERS) {
      if (readFilterParam(key) === "true") set.add(key);
    }
    return set;
  }, [readFilterParam]);

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
    [filterAreaIds, search, parsedCatalog, conditionIds, certificateStatusIds, formatIds, locationId, includeSubLocations, year, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, excludedPlatformId, deliveryStates, includeGone, includeDisposed, sortBy, sortDir]
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
    [filterAreaIds, search, parsedCatalog, conditionIds, certificateStatusIds, formatIds, locationId, includeSubLocations, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, excludedPlatformId, deliveryStates, includeGone, includeDisposed]
  );

  const { data: yearFacets, isLoading: yearsLoading } = useItemYears(
    collectionId,
    yearFacetFilters
  );

  // The area rail's counts (#843): the year facets' filter set one axis over — the year stays in,
  // the area selection drops out, so a row says what selecting it would list. Spread from the year
  // filters rather than restated, so a filter added to one rail cannot be forgotten on the other.
  const areaFacetFilters: InventoryAreaFacetFilters = useMemo(() => {
    const rest: InventoryYearFacetFilters = { ...yearFacetFilters };
    delete rest.areaIds;
    return { ...rest, year: year || undefined };
  }, [yearFacetFilters, year]);

  const { data: areaFacets } = useItemAreaFacets(collectionId, areaFacetFilters);

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

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
  // How many copies the filter holds (#845) — the figure the summary bar states and the
  // cursor-paginated list can never know about itself.
  const { data: itemCount } = useItemCount(collectionId, filters);

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

  /*
   * Multi-select (#373).
   *
   * **A filter change no longer throws the selection away** (#1021). Until then the selection was
   * keyed on the filter set and reset during render, and the reason was written down beside it:
   *
   * > *"The selection is keyed on the filter set and reset when it changes (adjusted during render,
   * > never a `setState` in an effect): a selection surviving a filter change would act on copies
   * > no longer on screen."*
   *
   * **That reasoning is superseded rather than overruled, and the distinction is the whole of this
   * change (2026-09-10).** Its fear was precise and it was right at the time — a surviving
   * selection *would* have acted on copies no longer on screen. Under the rule the user chose that
   * day it cannot: the bar counts and acts on the ticked rows **in view**, so the hazard the reset
   * existed to prevent is gone, and what the reset was still costing was the whole selection every
   * time a chip was pressed. The rule and what it rejects are in
   * [`ui-patterns.md`](../../../../../docs/agents/ui-patterns.md); it is the same rule the
   * card-scans strip took in #1020. **A later reader finding a selection that survives a filter
   * change is meant to find this paragraph** — the hazard was known, and it is handled by the
   * narrowing below and not by ignoring it.
   *
   * It holds the **copies themselves**, not their ids: grouping (#398) ticks copies loaded by a
   * group's own member query, and there is no flat page here to resolve those ids against.
   */
  const filterSignature = JSON.stringify(filters);
  const [selection, setSelection] = useState<Map<string, ItemListItem>>(() => new Map());
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection]);
  /** Every ticked copy, filter or no filter — what the bar counts *from*, and never what an action
   * is handed. */
  const selectedCopies = useMemo(() => [...selection.values()], [selection]);
  const toggleSelected = useCallback((item: ItemListItem) => {
    setSelection((prev) => {
      const items = new Map(prev);
      if (items.has(item.id)) items.delete(item.id);
      else items.set(item.id, item);
      return items;
    });
  }, []);
  const setManySelected = useCallback((batch: ItemListItem[], selected: boolean) => {
    setSelection((prev) => {
      const items = new Map(prev);
      for (const item of batch) {
        if (selected) items.set(item.id, item);
        else items.delete(item.id);
      }
      return items;
    });
  }, []);
  /** Clearing is the collector's own act and clears **everything**, rows the filter is hiding
   * included — unticking only what is on screen would empty the bar and leave ticks standing that
   * nothing on screen could then reach. The bar's hint says so while any are hidden. */
  const clearSelection = useCallback(() => setSelection(new Map()), []);

  /**
   * The ticked copies **in view** — what the bar counts, labels and acts on (#1021).
   *
   * *In view* cannot be a predicate here the way it is on the scans strip: these filters are
   * resolved server-side, so nothing on the client can ask whether a copy ticked ten minutes ago
   * still matches a search or an area subtree. What the screen can say is which rows it holds, and
   * that is the same answer from the other end — the flat pages it has loaded, plus the members
   * each group row has fetched. `use-rows-in-view.ts` carries what that includes, what it
   * deliberately does not (a fold is not a filter), and the one thing it cannot see.
   */
  const { inView: reportedRows, register: registerRowsInView } = useRowsInView(filterSignature);
  const copiesInView = useMemo(
    // The flat list needs no reporter — its pages are right here. In a grouped mode the flat query
    // is disabled and this is empty, so the two halves never double-count.
    () => rowsInView([allCopies.map((c) => c.id), [...reportedRows]]),
    [allCopies, reportedRows]
  );
  const selectedInView = useMemo(
    () => selectionInView(selectedCopies, copiesInView),
    [selectedCopies, copiesInView]
  );
  /** Ticked, and hidden by the filter. The figure the bar's second line is about. */
  const hiddenSelectedCount = selectedCopies.length - selectedInView.length;

  // The part of the selection an **offer** can be made of — for sale, in hand, still held (the
  // composition picker's own eligibility, #164/#188/#394). Since #682 the checkbox no longer asks
  // that question, so the listing actions ask it here instead: they act on this subset and are not
  // offered at all when it is empty. Narrowing beats disabling, because the same selection is a
  // perfectly good target for the location and disposition actions beside them.
  //
  // **Over the copies in view, so the two narrowings compose rather than compete** (#1021): a copy
  // has to be on screen *and* qualify. They are different questions and the labels say so
  // separately — *in view* is what the bar's headline carries, *qualifies* is what these buttons
  // carry — because blurring them into one number would leave the collector unable to tell which
  // of the two took a copy out.
  const listableCopies = useMemo(() => selectedInView.filter(isListableCopy), [selectedInView]);
  /** Said on the listing buttons themselves, never in the bar's count: the bar counts what is in
   * view, and only those buttons ask the second question. Empty while everything in view
   * qualifies. */
  const partialListingHint =
    listableCopies.length < selectedInView.length
      ? ` Applies to the ${listableCopies.length} of the ${selectedInView.length} copies in view that are for sale and in hand.`
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
    selectedInView.length > 0 &&
    selectedInView.every((c) => c.excludedPlatformIds.includes(scopedPlatform.id));

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
    // The stamp edit reached from a row lands here, and a copy write moves the copies-held badge
    // the Stamps list draws — both stale the catalogue side (#918).
    void invalidateStampsAndIssues(collectionId);
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
      // What a group is putting on screen (#1021), so the bar can count and act on the ticked rows
      // in view. Rides on the selection because that is the prop already reaching all three
      // grouped branches; the flat list needs none.
      onRowsInView: registerRowsInView,
    }),
    [selectedIds, toggleSelected, setManySelected, registerRowsInView]
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

  // Everything this screen's own reset can put back (#733) — deliberately *not* the area or the
  // year, which `use-collection-filter-store` shares with the Stamps and Wants lists (#143): a reset
  // here that silently re-shaped two other screens would be a bigger act than the button says.
  const hasResettableFilters =
    !!search ||
    conditionIds.length > 0 ||
    certificateStatusIds.length > 0 ||
    formatIds.length > 0 ||
    !!locationId ||
    noPhotos ||
    missingCatalogValue ||
    !!notOfferedPlatformId ||
    !!excludedPlatformId ||
    deliveryStates.length > 0 ||
    includeGone ||
    includeDisposed ||
    activeDispositions.size > 0;

  // The empty state asks a wider question — "is anything narrowing this list" — and the year is
  // narrowing it whoever set it.
  const hasActiveFilters = hasResettableFilters || !!year;

  // One write through the single `updateParams` funnel (#693): naming every key with `""` is what
  // clears the *remembered* set too, since a filter cleared to nothing leaves the URL and a key not
  // named in the update would be read straight back out of storage. The platform worklist keeps its
  // own stored value (#275), so it is cleared beside them.
  const resetFilters = useCallback(() => {
    rememberNotOfferedPlatform("");
    updateParams({
      ...Object.fromEntries(REMEMBERED_FILTER_KEYS.map((key) => [key, ""])),
      search: "",
      notOfferedPlatform: "",
      excludedPlatform: "",
    });
  }, [updateParams, rememberNotOfferedPlatform]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Header: the holdings summary, alone. The screen's three actions used to sit beside it and
          are in the filter bar now (#847), where the Offers screen has kept its own — the controls
          were spread across the width, and using two of them in a row was a trip across the
          window. */}
      <HoldingsSummaryBar
        total={holdingsTotal}
        storageKey={`stamporama:inventory:summaryExpanded:${collectionId}`}
        itemCount={itemCount?.count}
      />

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
          areaFacets={areaFacets}
          quickAddCollectionId={collectionId}
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
            /* Not removed under a grouping, greyed with the reason on it (#868) — every grouping
               brings its own total order, and a control that disappears on a pick takes its width
               off the bar and its explanation with it. */
            sortDisabledReason={copyGroupingSortReason(effectiveGroupMode)}
            /* The bar's order is the user's (#846) and it ends *grouping, sorting* — so the sort
               control follows the filters rather than sitting between the search box and the first
               of them, where it read as one more way of narrowing the list. */
            sortLast
            /* Shorter than the 20rem default (#846). This box is a lookup one finishes, not a way
               of working — it is the one control here that is never left set — and on a row
               carrying eleven others its width was the cheapest to give back. */
            searchMaxWidth="13rem"
            /* The screen's three actions, trailing the filters as they do on Offers (#847) — the
               arrangement is followed rather than re-invented, and the primary one is filled for
               the same reason it is there. They are what the screen *does*, so they are one group
               apart from the eleven controls that narrow it, and the row's answer to running out
               of width is the Offers one too: the filter half shrinks and wraps within itself
               first, and only once that is exhausted does this group drop to a line of its own,
               still right-aligned. */
            actions={
              <>
                {/* Quick offer mode (#537). Offered only where there is a platform to list on.
                    Switching it on seeds the platform from the same signal the create dialog uses:
                    the worklist filter, else the last platform listed on. */}
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
                        // Weight and border width are held constant across the two states: this is
                        // a button one presses and unpresses, and a label that thickens on click
                        // re-lays the whole row out under the cursor. Only the colours say which
                        // state it is in.
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
                    identified piece by piece. A **link** and not a dialog — the pass runs over
                    days, so it has its own screen — and it sits beside *Add copy* because the two
                    answer the same question: one stamp in the tweezers, or forty on a card. */}
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
              </>
            }
            /* Both of the list's banners, as rows of the pinned block, so they stay put while the
               rows scroll under them. Quick offer mode's parameters go **first** (#537/#848) — the
               only thing on screen saying a click will now list something without asking — because
               quick offer is the mode you are in and the selection is what you are doing inside
               it.

               Each pushes the list down when it arrives, and for the selection bar that is a
               deliberate step back (#885): it had a mechanism that held the rows still, it worked
               only on a list long enough to scroll, and a screen that jumps or not depending on how
               many rows are on it is worse to work with than one that always jumps. The reasoning
               and both rejected mechanisms are on `ListToolbar`'s `footer` prop; the redesign that
               is expected to settle it properly is #849. */
            footer={
              <>
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
                {/* **The bar counts and acts on the ticked copies in view** (#1021), and it is up
                    while *anything* is ticked rather than while anything is in view — with all of
                    them hidden it reads `0 of 5`, which is the only place those five are visible
                    and the only way left to clear them. A bar that vanished would leave a selection
                    nothing on screen could reach, reappearing later with nothing to explain it. */}
                {selectedCopies.length > 0 ? (
                  <div style={LIST_BANNER_STYLE}>
                    <span
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        color: "var(--color-accent)",
                      }}
                    >
                      {hiddenSelectedCount > 0
                        ? // The noun follows the **total**, not the number in view: `0 of 1 ticked
                          // copies` is the reachable case, and it reads as a template rather than
                          // as a sentence.
                          `${selectedInView.length} of ${selectedCopies.length} ticked cop${
                            selectedCopies.length === 1 ? "y" : "ies"
                          } in view`
                        : `${selectedCopies.length} cop${selectedCopies.length === 1 ? "y" : "ies"} selected`}
                    </span>
                    {/* What became of the rest, in the two terms that stop the number reading as a
                        lost selection — still ticked, and back when the filter is released. Drawn
                        only while any are hidden, so a resting bar reads exactly as it always
                        did. */}
                    {hiddenSelectedCount > 0 && (
                      <span
                        style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}
                      >
                        {hiddenSelectedCount === 1
                          ? "The other one is still ticked and comes back when the filter is released."
                          : `The other ${hiddenSelectedCount} are still ticked and come back when the filter is released.`}
                      </span>
                    )}
                    {/* Clearing is the collector's own act and reaches the hidden rows too, so the
                        hint says so while there are any. Empty content draws no bubble, which is
                        what keeps this one code path rather than two. */}
                    <Tooltip
                      content={
                        hiddenSelectedCount > 0
                          ? `Untick all ${selectedCopies.length}, including the ${hiddenSelectedCount} the filter is hiding`
                          : ""
                      }
                    >
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
                    </Tooltip>
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
                    {/* The bulk actions, in one group pushed to the right of the bar — and every
                        one of them acts on the copies **in view**, which is why the whole group is
                        absent when none of the ticked copies are. There is nothing here that could
                        honestly be offered over a selection the collector cannot see, and a row of
                        buttons acting on nothing is worse than no row (#1021). */}
                    {selectedInView.length > 0 && (
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
                          onClick={() => setDialog({ kind: "bulkEdit", items: selectedInView })}
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
                                selectedInView,
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
                              {listableCopies.length < selectedInView.length
                                ? `Add ${listableCopies.length} to offer`
                                : "Add selected to offer"}
                            </button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                    )}
                  </div>
                ) : null}
              </>
            }
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                flex: "1 1 auto",
                minWidth: 0,
              }}
            >
              {/* The order of this bar is the user's, set in #846: search, the platform worklist,
                  delivery, disposition, condition, certificate, format, location, the spare
                  filters, grouping, sorting. It reads outward from *which copies* to *how they are
                  shown*, and the two controls that are not filters at all — the spare-filter
                  bundle and grouping — sit at the end where they cannot be mistaken for one. */}

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
                    /* A native `<select>` takes its width from its **widest option**, so picking
                       one does not resize it — but bolding the text does, since every option is
                       then measured in bold. Colour and border say this filter is on; the weight
                       is held constant (#868), the same call #847 already made on the quick offer
                       button one group along, and for the same reason: a label that thickens on
                       click re-lays the row out under the cursor. */
                    style={{
                      ...CONTROL_STYLE,
                      ...(notOfferedPlatformId || excludedPlatformId
                        ? {
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

              {/* Delivery state filter (#272): the axis the row chip shows, so "what is still in
                  transit?" is one click from seeing it flagged. A multi-select (#427) because the
                  states worth asking about come in groups — *Ordered*, *In transit* and *To sort*
                  together are "what is still on its way". */}
              <FilterSlot width={FILTER_WIDTH.deliveryStates}>
                <MultiSelectFilter
                  fullWidth
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
              </FilterSlot>

              {/* Disposition (#846), one control where there were three chips. The three flags are
                  **independent booleans on a copy**, not values of one axis, so ticking two asks for
                  copies carrying **both** — the same predicate the three chips had, since each was
                  its own `AND`ed term (`buildItemWhere`). That is the one place this control could
                  mislead, a multi-select usually reading as *any of these*, so the hint says it. */}
              <Tooltip
                style={NO_SHRINK}
                content="For sale, For trade and In collection are three marks a copy can carry at once, not three kinds of copy. Tick two and you get the copies carrying both."
              >
                <FilterSlot width={FILTER_WIDTH.dispositions}>
                  <MultiSelectFilter
                    fullWidth
                    options={DISPOSITION_FILTERS.map((f) => ({ id: f.key, label: f.label }))}
                    selected={DISPOSITION_FILTERS.map((f) => f.key).filter((key) =>
                      activeDispositions.has(key)
                    )}
                    onChange={(ids) =>
                      updateParams(
                        Object.fromEntries(
                          DISPOSITION_FILTERS.map((f) => [f.key, ids.includes(f.key) ? "true" : ""])
                        )
                      )
                    }
                    allLabel="Any disposition"
                    itemNoun="dispositions"
                    ariaLabel="Filter by disposition"
                  />
                </FilterSlot>
              </Tooltip>

              {/* Several conditions at once (#425): a copy is in exactly one condition, but the
                  question asked of the list is routinely a group of them ("the mint grades"). */}
              <FilterSlot width={FILTER_WIDTH.conditions}>
                <MultiSelectFilter
                  fullWidth
                  options={conditions.map((c) => ({ id: c.id, label: c.name }))}
                  selected={conditionIds}
                  onChange={(ids) => updateParams({ conditionIds: ids.join(",") })}
                  allLabel="All conditions"
                  itemNoun="conditions"
                  ariaLabel="Filter by condition"
                />
              </FilterSlot>

              {/* Certificate filter (#428), built like the format one: absent when the collection
                  defines no statuses, and "No certificate" is a tickable value rather than the
                  absence of the filter — null *is* a value on this axis (ADR-0006 §2), so the
                  server ORs the two branches exactly as it does for Single. */}
              {certificateStatuses.length > 0 && (
                <FilterSlot width={FILTER_WIDTH.certificates}>
                  <MultiSelectFilter
                    fullWidth
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
                </FilterSlot>
              )}

              {/* Format filter (#343), a multi-select like the condition one (#427). Absent
                  entirely when the collection defines no formats — most never do. "Single" is a
                  tickable choice because it is a real answer (no format set), not the absence of a
                  filter, and it can be ticked *alongside* a format: null is never a member of an
                  `in`, so the server ORs the two branches. */}
              {formats.length > 0 && (
                <FilterSlot width={FILTER_WIDTH.formats}>
                  <MultiSelectFilter
                    fullWidth
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
                </FilterSlot>
              )}

              {locations.length > 0 && (
                <FilterSlot width={FILTER_WIDTH.location}>
                  <LocationTreeSelect
                    locations={locations}
                    locationTree={locationTree}
                    name="location-filter"
                    selectedId={locationId}
                    onSelectedIdChange={(id) => updateParams({ locationId: id })}
                    noneOptionLabel="All locations"
                    /* A filter's dropdown stays open on a pick (#846): the list behind it is what
                       says what the pick did, so there is nothing to go back to, and the switch
                       below has to survive the pick it qualifies. Escape and a click outside still
                       close it — and the other filters on this bar already work this way, a
                       `MultiSelectFilter` applying each tick and staying open. */
                    closeOnSelect={false}
                    /* Scope of the location filter (#385), inside the dropdown rather than beside
                       it (#846): it says nothing on its own and only ever qualifies the node just
                       picked, so as a sibling control it was a second thing to find and a second
                       thing to read past on every visit.

                       **Always drawn, even with nothing picked or a leaf picked**, which is the
                       opposite of what this control's own rule says elsewhere — and deliberately.
                       Hiding it until a branch node is chosen made it appear only *after* the
                       interaction that used to dismiss the panel, so it could not be discovered at
                       all: you had to already know it was there to go looking. Its own rule is
                       about a control competing for room on the filter bar; in here it competes
                       with nothing, and it is a *reading of the tree* rather than a narrowing, so
                       it is legible before a pick and applies to the next one. */
                    panelFooter={
                      <SubtreeScopeToggle
                        axis="location"
                        includeDescendants={includeSubLocations}
                        onChange={setIncludeSubLocations}
                      />
                    }
                  />
                </FilterSlot>
              )}

              {/* The four switches that were four chips (#846) — between them the width of a third
                  of this bar, for questions asked occasionally. They are **not one axis**, and the
                  menu says so with two headings rather than by stacking four labels: the *Show
                  only* pair narrows the list and every one ticked must hold, the *Also include*
                  pair widens the pool those narrowings are applied to. The option labels keep
                  saying "Include", so the trigger still reads unambiguously with one ticked, where
                  the heading is not on screen. */}
              <Tooltip
                style={NO_SHRINK}
                content="Two kinds of switch in one control. Show only narrows the list — tick both and a copy must satisfy both. Also include widens what is being narrowed, adding copies the list hides by default."
              >
                <FilterSlot width={FILTER_WIDTH.spareFilters}>
                <MultiSelectFilter
                  fullWidth
                  options={SPARE_FILTERS.map((f) => ({
                    id: f.key,
                    label: f.label,
                    group: f.group,
                  }))}
                  selected={SPARE_FILTERS.map((f) => f.key).filter((key) => spareFilters.has(key))}
                  onChange={(ids) =>
                    updateParams(
                      Object.fromEntries(
                        SPARE_FILTERS.map((f) => [f.key, ids.includes(f.key) ? "true" : ""])
                      )
                    )
                  }
                  allLabel="More filters"
                  clearLabel="No extra filters"
                  itemNoun="extra filters"
                  ariaLabel="Photo, catalog-value and departed-copy filters"
                />
                </FilterSlot>
              </Tooltip>

              {/* Grouping (#372, #421, #424), as **one dropdown carrying its own sub-controls**
                  (#868). *Duplicates* collapses the list to one row per `stamp × condition` —
                  Colnect's own rule, since it refuses a second offer for the same stamp in the
                  same condition — *Location* and *Ref* collapse it by where the copies are filed,
                  and *Issue* by the series they belong to. Exactly one can be in effect, which is
                  why it is a one-of control rather than a chip each.

                  The two splits join a further axis to the duplicate key; with both on, every
                  group has one unambiguous per-copy catalog value. They were drawn **beside** the
                  select and only once *Group duplicates* was chosen, and that is the defect this
                  issue states in general: *choosing a filter must never change the layout of the
                  filter bar*. A control that appears on a pick cannot be found before the pick, it
                  moves everything to its right at the moment the collector is working the bar, and
                  it makes the bar's width depend on what is selected. Inside the panel they cost
                  the bar nothing, so they are simply always there — the correction #846 made to
                  the location subtree switch one control along, spelled the same way.

                  **Disabled rather than hidden while another grouping is in effect**, under a
                  heading that says when they apply. They are not settings of *grouping*; they are
                  settings of the duplicate key, and there is no honest reading of "split by format"
                  over issue groups — inventing one would be inventing product behaviour. Disabled
                  and labelled is what stops that from being "present but meaningless": a collector
                  who has never grouped duplicates learns from the panel that duplicates has two
                  further settings, which is the discoverability the old arrangement could not
                  offer at all. They also keep showing their stored state, so a split left on last
                  week is visibly waiting rather than silently applied.

                  The trigger **summarises** them (`describeCopyGrouping`), which is worth more
                  than a wider panel on a row this dense; it is a fixed 14rem box, so the summary
                  cannot push the bar around either. The ▦ that stood beside the select is gone
                  (#846): the label says *Group …* in every state it can be in. */}
              <Tooltip
                style={NO_SHRINK}
                content="Collapse the list into groups: interchangeable duplicates, the copies filed in one place, or what you hold of one issue. Grouping never changes which copies are shown — the filters decide that."
              >
                <SingleSelectFilter
                  ariaLabel="Group rows"
                  width={FILTER_WIDTH.grouping}
                  value={effectiveGroupMode}
                  onChange={setGroupMode}
                  triggerLabel={describeCopyGrouping(effectiveGroupMode, axes)}
                  active={effectiveGroupMode !== "none"}
                  options={COPY_GROUP_MODES.filter(
                    // A filing grouping needs somewhere to file things.
                    (mode) => locations.length > 0 || (mode !== "location" && mode !== "ref")
                  ).map((mode) => ({ id: mode, label: COPY_GROUP_MODE_LABEL[mode] }))}
                  footer={
                    (formats.length > 0 || certificateStatuses.length > 0) && (
                      <>
                        <span style={GROUPING_FOOTER_HEADING_STYLE}>When grouping duplicates</span>
                        {formats.length > 0 && (
                          <FilterFooterToggle
                            label="Split by format"
                            hint="Treat a pair, block or strip as a different item from a single, instead of grouping them together."
                            disabledHint="Applies only while the list is grouped by duplicates."
                            checked={groupByFormat}
                            onChange={setGroupByFormat}
                            disabled={!groupDuplicates}
                          />
                        )}
                        {certificateStatuses.length > 0 && (
                          <FilterFooterToggle
                            label="Split by certificate"
                            hint="Treat a certified copy as a different item from an uncertified one, instead of grouping them together."
                            disabledHint="Applies only while the list is grouped by duplicates."
                            checked={groupByCertificate}
                            onChange={setGroupByCertificate}
                            disabled={!groupDuplicates}
                          />
                        )}
                      </>
                    )
                  }
                />
              </Tooltip>

              {/* Back to an unfiltered list in one click (#733). Drawn as bare accent text rather
                  than one more chip: it is not a filter, and a control that looks like its
                  neighbours reads as one more way of narrowing the list. Same shape as the Allegro
                  worklist's *Clear filters*.

                  #733 rendered it **only while something was on**, which made it the most frequent
                  breach of #868's rule on this bar: the first tick of any filter grew the row by a
                  control, and on a narrow window that is a whole extra line appearing under the
                  pointer. It now always occupies its slot and is merely **invisible** while there
                  is nothing to reset — `visibility: hidden`, which reserves the space and takes the
                  control out of the tab order and the accessibility tree, so nothing is offered
                  that cannot be done.

                  Invisible rather than disabled-but-legible, which is what the sort control beside
                  it got: the two failures the rule names are not the same here. A sort control that
                  vanishes leaves a collector wondering where their ordering went, so it stays and
                  says why. There is nothing to discover about a reset with nothing to reset, and
                  #733's own objection — noise on a row this dense — still stands. */}
              <Tooltip
                style={NO_SHRINK}
                content="Clear every filter on this screen, the search box included. The area and the year are shared with the other lists and are left as they are."
              >
                <button
                  type="button"
                  onClick={resetFilters}
                  aria-hidden={!hasResettableFilters}
                  tabIndex={hasResettableFilters ? undefined : -1}
                  style={{
                    ...CONTROL_STYLE,
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: "var(--color-accent)",
                    whiteSpace: "nowrap",
                    visibility: hasResettableFilters ? "visible" : "hidden",
                  }}
                >
                  Reset filters
                </button>
              </Tooltip>
            </div>
          </ListToolbar>

          {/* A platform-exclusion write that failed (#506) has no dialog to report into, so it
              reports here, directly above the rows it did not change.

              **It is in the flow, so putting it up pushes every row down, and that is the accepted
              behaviour rather than an oversight — the user's call on #864, which settles it as correct as
              it stands.** Do not
              reach for a mechanism that compensates for its height. Everything that appears on this
              screen displaces: the quick-offer bar and the selection bar do it from `ListToolbar`'s
              `footer` slot, whose own documentation carries the full account of the two
              compensations that were built and rejected.

              The short version is that the second of them worked by paying for the strip's height
              out of the scroll position, and `window.scrollBy` clamps at zero — so a list long
              enough to scroll held still and a shorter one shifted anyway (#884), which left the
              screen's behaviour depending on how many rows happened to be on it. The user removed
              it after living with it (#885): **a uniform flaw is easier to work with than an
              unpredictable one.** An alert is likelier than a selection bar to come up on a short
              list, so it is the control that mechanism served worst.

              Compensating for this alert alone would also recreate precisely the inconsistency
              #885 removed — one strip on this screen holding the rows still while its neighbours
              move them — with the control swapped rather than the problem solved. The shape gets
              fixed by the **redesign of the selection bar (#849)**, which is where a strip that
              does not have to be paid for at all belongs; a third compensation is a thing to argue
              for on that issue, not to write here. */}
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
