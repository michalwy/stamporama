"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  SUPPLIES_SUPPLY_PARAM,
  SUPPLIES_VIEW_PARAMS,
  pruneStoredSupplies,
  registerClearUpdates,
  resolveSuppliesView,
  suppliesTabOf,
  suppliesViewUpdatesFor,
  suppliesViewUrlUpdates,
  type SuppliesTab,
  type SuppliesView,
} from "./supplies-view-params";

/**
 * The Packing supplies screen's two toolbars, kept in the address and remembered per collection
 * (#2195, #2196) — `usePostsView`'s arrangement: the address wins wherever it names a setting, the
 * remembered set fills in the rest, every press writes both, and a restored setting is written back
 * into the address (#325, #693, #844). The tab is the address's alone.
 */
export function useSuppliesView(
  collectionId: string,
  basePath: string,
  /** The collection's supplies — what a remembered supply id is checked against. */
  knownSupplies: ReadonlySet<string>
): {
  tab: SuppliesTab;
  setTab: (tab: SuppliesTab) => void;
  view: SuppliesView;
  /** Change one or more settings. Everything not named keeps the value in force. */
  setView: (patch: Partial<SuppliesView>) => void;
  /** Back to every movement of the register. */
  clearRegister: () => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();

  const { readParam, remember } = usePersistedFilterParams(
    "packing-supplies-view",
    collectionId,
    SUPPLIES_VIEW_PARAMS,
    searchParams
  );

  // A **stored** supply that no longer exists is dropped rather than applied; one the address names
  // is taken as written.
  const readView = useCallback(
    (key: string) => {
      const value = readParam(key);
      if (key !== SUPPLIES_SUPPLY_PARAM || searchParams.has(key)) return value;
      return pruneStoredSupplies(value, knownSupplies);
    },
    [readParam, searchParams, knownSupplies]
  );
  const view = useMemo(() => resolveSuppliesView(readView), [readView]);
  const tab = suppliesTabOf(searchParams.get("tab"));

  const pushParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    },
    [searchParams, router, basePath]
  );

  /** The one funnel every filter writes through, and the reason {@link remember} is called here: a
   *  setting cleared to nothing leaves the URL, so a stored copy not written in the same breath would
   *  be read straight back (#693's trap). */
  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      remember(updates);
      pushParams(updates);
    },
    [remember, pushParams]
  );

  const setView = useCallback(
    (patch: Partial<SuppliesView>) => updateParams(suppliesViewUpdatesFor(patch)),
    [updateParams]
  );
  const clearRegister = useCallback(() => updateParams(registerClearUpdates()), [updateParams]);
  const setTab = useCallback(
    (next: SuppliesTab) => pushParams({ tab: next === "summary" ? "" : next }),
    [pushParams]
  );

  /** The restore's other half (#844), with `replace` — a restore is not a navigation the Back button
   *  should have to walk through. */
  const writeToUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };
  const writeToUrlRef = useRef(writeToUrl);
  useEffect(() => {
    writeToUrlRef.current = writeToUrl;
  });

  useEffect(() => {
    // The memory arrives with hydration; mirroring before it would write the defaults over it.
    if (!hydrated) return;
    const updates = suppliesViewUrlUpdates(view, (key) => searchParams.get(key));
    if (!updates) return;
    writeToUrlRef.current(updates);
  }, [hydrated, view, searchParams]);

  return { tab, setTab, view, setView, clearRegister };
}
