"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  INTAKE_PARTY_PARAMS,
  INTAKE_VIEW_PARAMS,
  intakeViewClearUpdates,
  intakeViewUpdatesFor,
  intakeViewUrlUpdates,
  pruneStoredParties,
  resolveIntakeView,
  type IntakeView,
} from "./intake-view-params";

/**
 * The toolbar over the Intake documents list, kept in the address and remembered per collection
 * (#1392) — `useAuctionSaleView`'s arrangement, for the reasons given there and in
 * `intake-view-params.ts`: the address wins wherever it names a setting, the remembered set fills in
 * the rest, every press writes both, and a restored setting is written back into the address so a
 * reload, the Back button and a copied link agree with what is on screen (#325, #693, #844).
 */
export function useIntakeView(
  collectionId: string,
  basePath: string,
  /** Every platform and supplier id that appears on a document, once loaded — `undefined` while
   * loading, when a stored id cannot yet be told from a stale one. */
  knownParties: ReadonlySet<string> | undefined
): {
  view: IntakeView;
  /** Change one or more settings. Everything not named keeps the value in force. */
  setView: (patch: Partial<IntakeView>) => void;
  /** Back to every document: every narrowing filter off, the sort untouched. */
  clearFilters: () => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();

  const { readParam, remember } = usePersistedFilterParams(
    "intake-documents-view",
    collectionId,
    INTAKE_VIEW_PARAMS,
    searchParams
  );

  // A **stored** party that no longer appears on any document is dropped rather than applied
  // (`pruneStoredParties`); one the address names is taken as written.
  const readView = useCallback(
    (key: string) => {
      const value = readParam(key);
      if (!INTAKE_PARTY_PARAMS.includes(key) || searchParams.has(key) || !knownParties) return value;
      return pruneStoredParties(value, knownParties);
    },
    [readParam, searchParams, knownParties]
  );
  const view = useMemo(() => resolveIntakeView(readView), [readView]);

  /**
   * The one funnel every control writes through, and the reason {@link remember} is called here: a
   * setting cleared to nothing *leaves* the URL, so a stored copy not written in the same breath
   * would be read straight back and re-apply the filter that was just switched off (#693's trap).
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
    (patch: Partial<IntakeView>) => updateParams(intakeViewUpdatesFor(patch)),
    [updateParams]
  );

  const clearFilters = useCallback(() => updateParams(intakeViewClearUpdates()), [updateParams]);

  /** The restore's other half (#844), with `replace` — a restore is not a navigation the Back button
   * should have to walk through — keeping every other parameter as it was. */
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

  const partiesKnown = knownParties !== undefined;
  useEffect(() => {
    // The memory arrives with hydration; mirroring before it would write the defaults over it.
    if (!hydrated) return;
    // A stored party is pruned only once the parties are known, and writing it before then would
    // put a stale id into the address, where it would win over the pruning for good.
    if (!partiesKnown) return;
    const updates = intakeViewUrlUpdates(view, (key) => searchParams.get(key));
    if (!updates) return;
    writeToUrlRef.current(updates);
  }, [hydrated, partiesKnown, view, searchParams]);

  return { view, setView, clearFilters };
}
