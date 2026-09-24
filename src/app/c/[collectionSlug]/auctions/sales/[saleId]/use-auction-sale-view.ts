"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  AUCTION_SALE_VIEW_PARAMS,
  auctionSaleViewClearUpdates,
  auctionSaleViewUpdatesFor,
  auctionSaleViewUrlUpdates,
  resolveAuctionSaleView,
  type AuctionSaleView,
} from "./sale-view-params";

/**
 * The toolbar over a sale's lots, kept in the address and remembered across sales (#1353).
 *
 * **Why the address and not just storage.** Grouping and the sort already survived a reload — they
 * were four `localStorage` keys of their own — while the status chips and the *Only* filters were
 * plain `useState` and did not, so the screen came back half as it was left, which is worse than
 * either whole answer. The settled rule is the one every list here follows: the settings live in
 * the URL, so a reload, the Back button and a copied link all show the same view, with the
 * remembered set filling in whatever the address does not name (#325's precedence, through
 * `usePersistedFilterParams`).
 *
 * **Remembered across sales, not per sale** — the flat lots list's rule (#1018), read one level
 * down: how the collector looks at a parcel is a way of working he carries to the next parcel, not
 * a property of this one. So the storage key is the collection's, and opening another sale starts
 * from the same settings.
 *
 * The four old `stamporama:auctionSale:*` keys are **not** migrated. Their defaults are this
 * hook's defaults, so the only collector who notices is one who had changed a grouping or a sort,
 * and only once — against a running conversion path that would have to stay for ever.
 */
export function useAuctionSaleView(
  collectionId: string,
  /** Where the mirror writes — this sale's own path, so no other screen's address is touched. */
  basePath: string,
  /** `?lot=` is in the address and the panel is about to consume it — or cannot tell yet, because
   * the parcel has not loaded. False for a param the sale cannot answer (#1015), which stays. */
  arrivalPending: boolean
): {
  view: AuctionSaleView;
  /** Change one or more settings. Everything not named keeps the value in force. */
  setView: (patch: Partial<AuctionSaleView>) => void;
  /** Back to the whole parcel: every narrowing filter off, grouping and sort untouched. */
  clearFilters: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();

  const { readParam, remember } = usePersistedFilterParams(
    "auction-sale-view",
    collectionId,
    AUCTION_SALE_VIEW_PARAMS,
    searchParams
  );
  const view = useMemo(() => resolveAuctionSaleView(readParam), [readParam]);

  /**
   * The one funnel every control writes through, and the reason {@link remember} is called here
   * rather than beside each press: a setting cleared to nothing *leaves* the URL, so a stored copy
   * not written in the same breath would be read straight back on the next render and re-apply the
   * filter that was just switched off (#693's trap).
   */
  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      remember(updates);
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath);
    },
    [remember, searchParams, router, basePath]
  );

  const setView = useCallback(
    (patch: Partial<AuctionSaleView>) => updateParams(auctionSaleViewUpdatesFor(patch)),
    [updateParams]
  );

  const clearFilters = useCallback(
    () => updateParams(auctionSaleViewClearUpdates()),
    [updateParams]
  );

  /** The restore's other half (#844): what the screen is showing, written into the address with
   * `replace` — a restore is not a navigation the Back button should have to walk through — and
   * keeping every other parameter exactly as it was. */
  const writeToUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) params.set(key, value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const writeToUrlRef = useRef(writeToUrl);
  useEffect(() => {
    writeToUrlRef.current = writeToUrl;
  });

  useEffect(() => {
    // The memory is read through `useSyncExternalStore` with a null server snapshot, so the first
    // render of a freshly loaded page sees no stored settings whether or not any exist; mirroring
    // *that* would write the defaults over what is about to arrive.
    if (!hydrated) return;
    // `?lot=` is consumed on arrival by a `router.replace` of the panel's own (#850). Both writes
    // build on the same `searchParams` snapshot, so running them in one commit would have each
    // drop the other's edit and need a second pass to converge. Standing aside for one render
    // costs nothing — the panel's effect fires immediately, and this one runs again straight after.
    //
    // Only while the param is going to be consumed, though (#1015). One naming a lot the sale does
    // not hold is left in the address on purpose, and standing aside for it would leave the view
    // unwritten for as long as it sits there; `writeToUrl` keeps every param it does not name, so
    // the mirror can write round it.
    if (arrivalPending) return;
    const updates = auctionSaleViewUrlUpdates(view, (key) => searchParams.get(key));
    if (!updates) return;
    writeToUrlRef.current(updates);
  }, [hydrated, arrivalPending, view, searchParams]);

  return { view, setView, clearFilters };
}
