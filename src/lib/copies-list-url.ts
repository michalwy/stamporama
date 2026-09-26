/**
 * How the Copies list turns **its own address** into the filters it queries with (#1401) — the half
 * of `inventory-list-panel.tsx` a server read needs when it has to count exactly what a link to that
 * list will show.
 *
 * The address carries what the collector chose (`areaId`, `year`, `decade`, the multi-selects under
 * their own names); the query carries what the domain reads (`areaIds` as a resolved subtree, the
 * year or a decade spelling of it, `locationExact`, the catalogue number parsed out of the search
 * box). The panel does the translation in its filter memo; the collection structure screen does it
 * here, over the **same URL names and the same two subtree switches**, so a count on that screen and
 * the list its count opens are the same question. `readItemFilters` then reads the result exactly as
 * every Copies route does.
 *
 * Pure — no Prisma, no React — so the route, the unit suite and the integration suite share it.
 */

import { parseCatalogSearch } from "./catalog-number";
import {
  ALL_SENTINEL,
  AREA_FILTER_PARAM,
  NO_AREA,
  YEAR_FILTER_PARAM,
  decadeValue,
  parseDecade,
} from "./list-area-year-filter";

/** The Copies list's own parameter for a decade (#1401); see `inventory-list-panel.tsx`. */
export const DECADE_FILTER_PARAM = "decade";

/** The URL names the Copies list narrows by and the structure screen keeps, beside the remembered
 *  set (`REMEMBERED_FILTER_KEYS`), which the caller supplies so this module stays below the app. */
export const COPIES_LIST_RAIL_KEYS = [
  AREA_FILTER_PARAM,
  YEAR_FILTER_PARAM,
  DECADE_FILTER_PARAM,
  "search",
] as const;

export interface CopiesListUrlContext {
  /** The collection's area tree, to resolve a picked area into its subtree. */
  areas: readonly { id: string; parentId: string | null }[];
  /** The area rail's *+ sub-areas* switch (#385) — a browser preference the list reads too. */
  includeSubAreas: boolean;
  /** The location filter's *+ sub-locations* switch (#385). */
  includeSubLocations: boolean;
  /** The catalogue vendors the search box recognises as a prefix (#146). */
  catalogVendors: readonly { id: string; abbreviation: string }[];
}

/** The area and every area under it — the subtree a picked area means with *+ sub-areas* on. */
export function areaSubtreeIds(
  areas: readonly { id: string; parentId: string | null }[],
  areaId: string
): string[] {
  const ids = [areaId];
  for (let i = 0; i < ids.length; i++) {
    for (const area of areas) if (area.parentId === ids[i]) ids.push(area.id);
  }
  return ids;
}

/** The area a Copies address narrows to — an area the collection has, {@link NO_AREA}, or null. */
export function copiesListAreaId(
  url: URLSearchParams,
  areas: readonly { id: string }[]
): string | null {
  const raw = url.get(AREA_FILTER_PARAM);
  if (!raw || raw === ALL_SENTINEL) return null;
  if (raw === NO_AREA) return NO_AREA;
  return areas.some((a) => a.id === raw) ? raw : null;
}

/** The year a Copies address narrows to, as the rail reads it: a year, `none`, or null — anything
 *  else is no year, as `readYearFilter` reads it. */
export function copiesListRailYear(url: URLSearchParams): string | null {
  const raw = url.get(YEAR_FILTER_PARAM);
  return raw === "none" || (raw && /^\d+$/.test(raw)) ? raw : null;
}

/** The decade a Copies address narrows to — only while the rail names no single year, as the list
 *  itself reads it. */
export function copiesListDecade(url: URLSearchParams): number | null {
  return copiesListRailYear(url) ? null : parseDecade(url.get(DECADE_FILTER_PARAM));
}

/**
 * The query string a Copies route reads (`readItemFilters`) for a Copies **address**, under the
 * collector's subtree switches. Everything the address names under the route's own spelling passes
 * through untouched; only the rail's selection and the search box are translated.
 */
export function copiesListQueryParams(
  url: URLSearchParams,
  ctx: CopiesListUrlContext
): URLSearchParams {
  const query = new URLSearchParams(url.toString());
  for (const key of [AREA_FILTER_PARAM, YEAR_FILTER_PARAM, DECADE_FILTER_PARAM]) query.delete(key);

  const areaId = copiesListAreaId(url, ctx.areas);
  if (areaId === NO_AREA) query.set("areaIds", NO_AREA);
  else if (areaId) {
    query.set(
      "areaIds",
      (ctx.includeSubAreas ? areaSubtreeIds(ctx.areas, areaId) : [areaId]).join(",")
    );
  }

  const decade = copiesListDecade(url);
  const year = decade !== null ? decadeValue(decade) : copiesListRailYear(url);
  if (year) query.set("year", year);

  if (url.get("locationId") && !ctx.includeSubLocations) query.set("locationExact", "true");
  else query.delete("locationExact");

  const search = url.get("search");
  if (search) {
    const parsed = parseCatalogSearch(search, ctx.catalogVendors);
    if (parsed.vendorId) query.set("catalogVendorId", parsed.vendorId);
    if (parsed.number) query.set("catalogNumber", parsed.number);
  }
  return query;
}
