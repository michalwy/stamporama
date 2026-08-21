import type { ItemListFiltersPaginated } from "@/lib/items";
import { isDeliveryState } from "@/lib/delivery-state";

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
  const yearParam = sp.get("year");
  return {
    conditionIds: readConditionIds(sp),
    certificateStatusIds: readCsvParam(sp, "certificateStatusIds"),
    formatIds: readCsvParam(sp, "formatIds"),
    deliveryStates: readDeliveryStates(sp),
    areaIds: areaIdsParam ? areaIdsParam.split(",") : undefined,
    search: sp.get("search") || undefined,
    catalogVendorId: sp.get("catalogVendorId") || undefined,
    catalogNumber: sp.get("catalogNumber") || undefined,
    stampId: sp.get("stampId") || undefined,
    issueId: sp.get("issueId") || undefined,
    locationId: sp.get("locationId") || undefined,
    // "This location only" (#385) — absent means #56's subtree, the default.
    locationExact: boolParam(sp.get("locationExact")),
    // The exact in-location ref a filing group addresses (#421); `"none"` is the unlabelled bucket.
    locationRef: sp.get("locationRef") || undefined,
    year:
      yearParam === "none"
        ? ("none" as const)
        : yearParam && /^\d+$/.test(yearParam)
          ? parseInt(yearParam, 10)
          : undefined,
    inCollection: boolParam(sp.get("inCollection")),
    forSale: boolParam(sp.get("forSale")),
    forTrade: boolParam(sp.get("forTrade")),
    noPhotos: boolParam(sp.get("noPhotos")),
    missingCatalogValue: boolParam(sp.get("missingCatalogValue")),
    notOfferedPlatformId: sp.get("notOfferedPlatformId") || undefined,
    // The review read (#506): the copies set aside on this platform.
    excludedPlatformId: sp.get("excludedPlatformId") || undefined,
    // Copies that have **left** are hidden from the inventory list by default — sold (#207), and
    // given to a partner in a closed trade (#644) — and one `includeGone=true` shows both again:
    // two toggles for one question would be a second thing to remember to press.
    excludeGone: boolParam(sp.get("includeGone")) ? undefined : true,
    // Copies no longer held are hidden the same way (#395) — the list answers "what do I have".
    includeDisposed: boolParam(sp.get("includeDisposed")),
  };
}
