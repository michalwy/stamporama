"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import {
  catalogKeysInScope,
  catalogNumberTest,
  catalogScopeFromUnticked,
  catalogScopeLabel,
  parseUntickedCatalogs,
  writeUntickedCatalogs,
  type CatalogScopeVendor,
} from "@/lib/catalog-search-scope";
import type { SearchField } from "@/lib/search-fields";
import { SearchFieldsControl, type SearchFieldsWording } from "./search-fields-control";
import { usePersistedCollectionValue } from "./use-persisted-collection-value";

// The catalogues a catalogue-number search looks in (#2529) — **one choice per collection, shared by
// every list and picker**: unticking Scott in the stamp picker unticks it on the Copies list too.
//
// The collection layout reads the catalogues its areas use and hands them to this provider, so a
// picker deep in a dialog needs no prop to offer them. The choice itself is remembered in the
// browser beside the search boxes' own fields (#2238) — the **unticked** catalogues, so one the
// collection takes up later starts ticked — and is not in any page address: a choice shared by
// every screen cannot be one screen's link, and *Reset filters* leaves it alone, since it decides
// how a number is read rather than which rows are shown.

interface CatalogSearchScopeValue {
  /** The catalogues the control offers. */
  vendors: readonly CatalogScopeVendor[];
  /** What the control draws: every catalogue while nothing is unticked. */
  ticked: string[];
  /** What a search sends: the ticked catalogues, or `undefined` while every one is ticked, so an
   *  unnarrowed search keeps the request it always had. */
  scope: string[] | undefined;
  setTicked: (next: readonly string[]) => void;
}

const CatalogSearchScopeContext = createContext<{
  collectionId: string;
  vendors: readonly CatalogScopeVendor[];
} | null>(null);

export function CatalogSearchScopeProvider({
  collectionId,
  vendors,
  children,
}: {
  collectionId: string;
  vendors: CatalogScopeVendor[];
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ collectionId, vendors }), [collectionId, vendors]);
  return (
    <CatalogSearchScopeContext.Provider value={value}>{children}</CatalogSearchScopeContext.Provider>
  );
}

const NO_VENDORS: readonly CatalogScopeVendor[] = [];

/** The shared choice. Outside a collection there is nothing to narrow: every catalogue, no control. */
export function useCatalogSearchScope(): CatalogSearchScopeValue {
  const ctx = useContext(CatalogSearchScopeContext);
  const vendors = ctx?.vendors ?? NO_VENDORS;
  const [stored, setStored] = usePersistedCollectionValue(
    "catalog-search-unticked",
    ctx?.collectionId ?? ""
  );
  const vendorIds = useMemo(() => vendors.map((v) => v.id), [vendors]);
  const scope = useMemo(
    () => catalogScopeFromUnticked(parseUntickedCatalogs(stored), vendorIds),
    [stored, vendorIds]
  );
  const ticked = useMemo(() => scope ?? [...vendorIds], [scope, vendorIds]);
  const setTicked = useCallback(
    (next: readonly string[]) => setStored(writeUntickedCatalogs(next, vendorIds)),
    [setStored, vendorIds]
  );
  return { vendors, ticked, scope, setTicked };
}

/**
 * For a picker that filters what it holds on the client: the two ways its search reads the shared
 * choice for one query — a test over a number's catalogue, for rows that keep the vendor's id, and
 * a narrowing of printed keys (`mipl200`), for rows that keep only labels. A typed prefix wins.
 */
export function useCatalogNumberScope(query: string): {
  searched: (vendorId: string) => boolean;
  keysInScope: (keys: readonly string[]) => readonly string[];
} {
  const { vendors, scope } = useCatalogSearchScope();
  return useMemo(
    () => ({
      searched: catalogNumberTest(query, vendors, scope),
      keysInScope: (keys) => catalogKeysInScope(keys, query, vendors, scope),
    }),
    [query, vendors, scope]
  );
}

/** Whether a box that asks for the control gets one — never while there is no choice to make. A
 *  search box asks while its *Catalogue number* field is ticked (#2238). */
export function useCatalogScopeShown(wanted: boolean): boolean {
  const { vendors } = useCatalogSearchScope();
  return wanted && vendors.length >= 2;
}

const CATALOG_SCOPE_WORDING_BASE = {
  ariaLabel: "Catalogues a number is searched in",
  heading: "Numbers in",
  all: "All catalogues",
};

/**
 * The control, ticked beside a box that matches catalogue numbers: *Michel (Mi)* for each catalogue
 * the collection's areas use, reading *All catalogues* or the ticked abbreviations (*Mi, Fi*). The
 * search-fields control's look and rules — every one starts ticked, the last cannot be unticked.
 * Draws nothing while the collection has fewer than two catalogues: there is no choice to make.
 */
export function CatalogScopeControl() {
  const { vendors, ticked, setTicked } = useCatalogSearchScope();
  const fields = useMemo<SearchField<string>[]>(
    () => vendors.map((v) => ({ key: v.id, label: `${v.name} (${v.abbreviation})` })),
    [vendors]
  );
  const wording = useMemo<SearchFieldsWording<string>>(
    () => ({
      ...CATALOG_SCOPE_WORDING_BASE,
      label: (on) => catalogScopeLabel(on.length >= vendors.length ? undefined : on, vendors),
    }),
    [vendors]
  );
  if (vendors.length < 2) return null;
  return <SearchFieldsControl fields={fields} ticked={ticked} onChange={setTicked} wording={wording} />;
}
