import type { ItemListFiltersPaginated } from "@/lib/items";
import { isDeliveryState } from "@/lib/delivery-state";
import { tagFilterFromParams } from "@/lib/tag-filter";
import { faultFilterFromParams } from "@/lib/fault-filter";
import { asMultiStampFilter } from "@/lib/multi-stamp";
import { readSearchParam } from "@/lib/text-input";
import { readYearFilter } from "@/lib/list-area-year-filter";

/** Only an explicit "true" narrows to that disposition; absence / any other value means the filter
 * is off (show all), matching the default "show all copies". */
export function boolParam(value: string | null): boolean | undefined {
  return value === "true" ? true : undefined;
}

/**
 * A multi-value filter (#425, #427), comma-separated as `areaIds` already is — a list because the
 * control is a multi-select, and a group addressing its own members simply sends the one value it
 * grouped on. An all-blank value is no filter rather than an unmatchable empty set, so a link
 * carrying a cleared parameter shows the list instead of an empty screen.
 */
export function readCsvParam(sp: URLSearchParams, key: string): string[] | undefined {
  const raw = sp.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/** The conditions in scope (#425). */
export function readConditionIds(sp: URLSearchParams): string[] | undefined {
  return readCsvParam(sp, "conditionIds");
}

/**
 * The delivery states in scope (#272, #427). Unrecognised values are **dropped** rather than passed
 * through, so a stale link narrows to the states it does name — or, once nothing is left, shows the
 * whole list rather than an empty screen.
 */
export function readDeliveryStates(sp: URLSearchParams): string[] | undefined {
  const values = readCsvParam(sp, "deliveryStates")?.filter(isDeliveryState);
  return values && values.length > 0 ? values : undefined;
}

/**
 * The Copies list's filter set, read off a query string. Shared by the flat list and the duplicate
 * groups (#372) so the two can never disagree about which copies are in scope — grouping narrows
 * the *same* set the list shows, it just collapses it.
 */
export function readItemFilters(sp: URLSearchParams): ItemListFiltersPaginated {
  const areaIdsParam = sp.get("areaIds");
  return {
    // The collector's own labels (#1182), with the mode the link carries. Read through the one
    // parser the panel and the other two lists' routes use, so *any* and *all* cannot come to mean
    // different things on different screens.
    ...tagFilterFromParams(sp),
    // The copy's faults (#1557): any of the ticked ones, `none` for the copies with no fault.
    ...faultFilterFromParams(sp),
    conditionIds: readConditionIds(sp),
    certificateStatusIds: readCsvParam(sp, "certificateStatusIds"),
    formatIds: readCsvParam(sp, "formatIds"),
    subtypeIds: readCsvParam(sp, "subtypeIds"),
    deliveryStates: readDeliveryStates(sp),
    areaIds: areaIdsParam ? areaIdsParam.split(",") : undefined,
    search: readSearchParam(sp),
    catalogVendorId: sp.get("catalogVendorId") || undefined,
    catalogNumber: sp.get("catalogNumber") || undefined,
    stampId: sp.get("stampId") || undefined,
    issueId: sp.get("issueId") || undefined,
    checklistId: sp.get("checklistId") || undefined,
    locationId: sp.get("locationId") || undefined,
    // "This location only" (#385) — absent means #56's subtree, the default.
    locationExact: boolParam(sp.get("locationExact")),
    // The exact in-location ref a filing group addresses (#421); `"none"` is the unlabelled bucket.
    locationRef: sp.get("locationRef") || undefined,
    // One year, the no-year bucket, or a decade as a span (#1401) — the one parser every Copies route
    // reads the year with.
    ...readYearFilter(sp.get("year")),
    inCollection: boolParam(sp.get("inCollection")),
    forSale: boolParam(sp.get("forSale")),
    forTrade: boolParam(sp.get("forTrade")),
    noPhotos: boolParam(sp.get("noPhotos")),
    missingCatalogValue: boolParam(sp.get("missingCatalogValue")),
    // An umbrella copy or one with a candidate set (#1651).
    variantToSettle: boolParam(sp.get("variantToSettle")),
    // The copies that might be this stamp, or have a candidate in this issue (#1651).
    possibleStampId: sp.get("possibleStampId") || undefined,
    possibleIssueId: sp.get("possibleIssueId") || undefined,
    notOfferedPlatformId: sp.get("notOfferedPlatformId") || undefined,
    // The review read (#506): the copies set aside on this platform.
    excludedPlatformId: sp.get("excludedPlatformId") || undefined,
    // Copies that have **left** are hidden from the inventory list by default — sold (#207), and
    // given to a partner in a closed trade (#644) — and one `includeGone=true` shows both again:
    // two toggles for one question would be a second thing to remember to press.
    excludeGone: boolParam(sp.get("includeGone")) ? undefined : true,
    // Copies no longer held are hidden the same way (#395) — the list answers "what do I have".
    includeDisposed: boolParam(sp.get("includeDisposed")),
    // For or against the multi-stamp copies (#748). An unrecognised value is no filter, so a stale
    // link shows the list rather than an empty screen.
    multiStamp: asMultiStampFilter(sp.get("multiStamp")),
  };
}

/**
 * The area rail's filter set (#843): the list's own, less the area selection, so each area's count
 * is what selecting it would list. Read through {@link readItemFilters} rather than beside it — the
 * route had its own copy of the parser, which never learned the tag filter (#1182) or *this location
 * only* (#385), so a tagged list's rail counted every tag's copies (#1404).
 */
export function readAreaFacetFilters(sp: URLSearchParams): Omit<ItemListFiltersPaginated, "areaIds"> {
  const filters = readItemFilters(sp);
  delete filters.areaIds;
  return filters;
}

/** The year rail's filter set (#142): the list's own, less the year — one year, the no-year bucket
 *  or a decade's span alike — for the reason {@link readAreaFacetFilters} gives. */
export function readYearFacetFilters(
  sp: URLSearchParams
): Omit<ItemListFiltersPaginated, "year" | "yearFrom" | "yearTo"> {
  const filters = readItemFilters(sp);
  delete filters.year;
  delete filters.yearFrom;
  delete filters.yearTo;
  return filters;
}
