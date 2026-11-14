import { parseCatalogSearch, stripCatalogVendor } from "./catalog-number";

// Which catalogues a catalogue-number search looks in (#2529) — the collector's one choice, ticked
// beside every box and picker that finds things by catalogue number, remembered per collection and
// shared by all of them. A collector who works in Michel and Fischer and keeps Scott numbers only
// for reference unticks Scott once, and `200` stops finding the Scott 200 everywhere.
//
// Pure (no React / Prisma): the client stores the choice and sends the catalogues it leaves ticked;
// the server's parser reads them back and every where builder narrows its catalogue-number branch
// through `catalogVendorWhere`. A **typed vendor prefix still wins** (`Sc 200` searches Scott with
// Scott unticked, as the prefix overrode the old dropdown, #146), and the choice narrows the search
// only — chips, sorting and catalogue columns are not its business.

/** The query-string parameter the routes read the ticked catalogues from — sent only when it narrows. */
export const CATALOG_SCOPE_PARAM = "catalogScope";

/** One catalogue the control offers. */
export interface CatalogScopeVendor {
  id: string;
  name: string;
  abbreviation: string;
}

/**
 * The catalogues a search is narrowed to, from what is remembered — the **unticked** ones, so a
 * catalogue the collection takes up later starts ticked like every other — or `undefined` for
 * **every** catalogue. Unticking all of them is not a choice the control allows, and a stale memory
 * that would leave none reads as no narrowing, so a search never looks nowhere.
 */
export function catalogScopeFromUnticked(
  unticked: readonly string[],
  vendorIds: readonly string[]
): string[] | undefined {
  if (unticked.length === 0) return undefined;
  const off = new Set(unticked);
  const scope = vendorIds.filter((id) => !off.has(id));
  return scope.length === 0 || scope.length === vendorIds.length ? undefined : scope;
}

/** The remembered value read back: the unticked catalogue ids, comma-separated. */
export function parseUntickedCatalogs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** What is remembered for a set of ticked catalogues: the ones left out — `""` while every one is ticked. */
export function writeUntickedCatalogs(
  ticked: readonly string[],
  vendorIds: readonly string[]
): string {
  const on = new Set(ticked);
  return vendorIds.filter((id) => !on.has(id)).join(",");
}

/** The ticked catalogues as the routes read them, or `undefined` for every catalogue. */
export function parseCatalogScope(raw: string | null | undefined): string[] | undefined {
  const ids = parseUntickedCatalogs(raw);
  return ids.length > 0 ? ids : undefined;
}

/** How a scope goes on the wire — `undefined` while it narrows nothing, so the default sends nothing. */
export function writeCatalogScope(scope: readonly string[] | undefined): string | undefined {
  return scope && scope.length > 0 ? scope.join(",") : undefined;
}

/**
 * The catalogue a number is matched in, as a Prisma clause on a catalogue-number row: the typed
 * vendor prefix when there was one, else the ticked catalogues, else nothing — every catalogue.
 */
export function catalogVendorWhere(
  prefixVendorId: string | null | undefined,
  scope: readonly string[] | undefined
): { catalogVendorId?: string | { in: string[] } } {
  if (prefixVendorId) return { catalogVendorId: prefixVendorId };
  if (scope && scope.length > 0) return { catalogVendorId: { in: [...scope] } };
  return {};
}

/** Whether a number in this catalogue is searched — the client-side twin of {@link catalogVendorWhere}
 *  for the pickers that filter the copies they hold. */
export function catalogVendorSearched(
  vendorId: string,
  prefixVendorId: string | null | undefined,
  scope: readonly string[] | undefined
): boolean {
  if (prefixVendorId) return vendorId === prefixVendorId;
  return !scope || scope.includes(vendorId);
}

/**
 * The vendor-test a picker filtering what it holds applies to one query: a number is searched when
 * its catalogue is the one the query's typed prefix named, else when it is ticked.
 */
export function catalogNumberTest(
  query: string,
  vendors: readonly { id: string; abbreviation: string }[],
  scope: readonly string[] | undefined
): (vendorId: string) => boolean {
  if (!scope) return () => true;
  const prefixVendorId = parseCatalogSearch(query, vendors).vendorId;
  return (vendorId) => catalogVendorSearched(vendorId, prefixVendorId, scope);
}

/**
 * A picker's **printed** catalogue keys (`mipl200`, built from labels that no longer carry the
 * vendor's id) narrowed to the catalogues a query reads. Each key's catalogue is read off its
 * leading abbreviation exactly as a typed prefix is read — longest first — so `Sc` is never taken
 * for `S`; a key no catalogue's abbreviation leads is in no ticked catalogue.
 */
export function catalogKeysInScope(
  keys: readonly string[],
  query: string,
  vendors: readonly { id: string; abbreviation: string }[],
  scope: readonly string[] | undefined
): readonly string[] {
  if (!scope) return keys;
  const searched = catalogNumberTest(query, vendors, scope);
  return keys.filter((key) => {
    const vendorId = stripCatalogVendor(key, vendors).vendorId;
    return vendorId !== null && searched(vendorId);
  });
}

/** What the control reads: *All catalogues*, or the ticked abbreviations (`Mi, Fi`), so a search
 *  that finds nothing because of it reads at a glance. */
export function catalogScopeLabel(
  scope: readonly string[] | undefined,
  vendors: readonly CatalogScopeVendor[]
): string {
  if (!scope) return "All catalogues";
  const on = new Set(scope);
  const names = vendors.filter((v) => on.has(v.id)).map((v) => v.abbreviation || v.name);
  return names.length > 0 ? names.join(", ") : "All catalogues";
}
