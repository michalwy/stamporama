import type { ItemListFiltersPaginated } from "@/lib/items";
import { isDeliveryState } from "@/lib/delivery-state";

/** Only an explicit "true" narrows to that disposition; absence / any other value means the filter
 * is off (show all), matching the default "show all copies". */
export function boolParam(value: string | null): boolean | undefined {
  return value === "true" ? true : undefined;
}

/**
 * The Copies list's filter set, read off a query string. Shared by the flat list and the duplicate
 * groups (#372) so the two can never disagree about which copies are in scope — grouping narrows
 * the *same* set the list shows, it just collapses it.
 */
export function readItemFilters(sp: URLSearchParams): ItemListFiltersPaginated {
  const areaIdsParam = sp.get("areaIds");
  const yearParam = sp.get("year");
  // Delivery state (#272): an unrecognised value turns the filter off rather than being passed
  // through, so a stale link shows the list instead of an empty screen.
  const deliveryStateParam = sp.get("deliveryState");
  return {
    conditionId: sp.get("conditionId") || undefined,
    certificateStatusId: sp.get("certificateStatusId") || undefined,
    formatId: sp.get("formatId") || undefined,
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
    deliveryState: isDeliveryState(deliveryStateParam) ? deliveryStateParam : undefined,
    // Sold copies are hidden from the inventory list by default (#207); an explicit
    // `includeSold=true` shows them again.
    excludeSold: boolParam(sp.get("includeSold")) ? undefined : true,
    // Copies no longer held are hidden the same way (#395) — the list answers "what do I have".
    includeDisposed: boolParam(sp.get("includeDisposed")),
  };
}
