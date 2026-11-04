import { yearSelects } from "./list-area-year-filter";

// The filters of *Add free extras* (#2423): area, year of issue, condition, certificate and format —
// the Copies list's own facets, with the same values (`"none"` for no certificate, `"single"` for no
// format, `NO_CONDITION` for a piece), so a choice means here what it means there.
//
// They are applied where the candidates are read (`listFreeExtraCandidates`), not in the dialog: the
// dialog is sent the 500 cheapest, and a buyer's area may hold none of them. Whether a copy is above
// its complete sets is still counted over the whole pool — narrowing the list must not make a set
// look broken or whole — so a filter only chooses among candidates the unfiltered read would offer.
//
// Not remembered, per contact or between openings (settled with the collector on 2026-11-04): the
// dialog opens on every candidate.

export interface FreeExtraFilters {
  /** The selected area with its descendants as the rail resolves them; null is every area. */
  areaIds: string[] | null;
  /** The rail's year value — one year, `none`, or a range (#2258); null is every year. */
  year: string | null;
  conditionIds: string[];
  certificateStatusIds: string[];
  formatIds: string[];
}

export const NO_FREE_EXTRA_FILTERS: FreeExtraFilters = {
  areaIds: null,
  year: null,
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
};

/** Whether any filter narrows the candidates. */
export function freeExtraFiltersNarrow(filters: FreeExtraFilters): boolean {
  return (
    filters.areaIds !== null ||
    filters.year !== null ||
    filters.conditionIds.length > 0 ||
    filters.certificateStatusIds.length > 0 ||
    filters.formatIds.length > 0
  );
}

/** The filters as the route's query string. */
export function writeFreeExtraFilterQuery(filters: FreeExtraFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const id of filters.areaIds ?? []) params.append("areaId", id);
  if (filters.year !== null) params.set("year", filters.year);
  if (filters.conditionIds.length > 0) params.set("conditionIds", filters.conditionIds.join(","));
  if (filters.certificateStatusIds.length > 0) {
    params.set("certificateStatusIds", filters.certificateStatusIds.join(","));
  }
  if (filters.formatIds.length > 0) params.set("formatIds", filters.formatIds.join(","));
  return params;
}

function list(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/** The filters read back off the route's query string; anything absent is not narrowed. */
export function readFreeExtraFilterQuery(params: URLSearchParams): FreeExtraFilters {
  const areaIds = params.getAll("areaId").filter(Boolean);
  const year = params.get("year");
  return {
    areaIds: areaIds.length > 0 ? areaIds : null,
    year: year ? year : null,
    conditionIds: list(params.get("conditionIds")),
    certificateStatusIds: list(params.get("certificateStatusIds")),
    formatIds: list(params.get("formatIds")),
  };
}

/** A year facet of the rail: how many candidates were issued in it (`null` is no year). */
export interface FreeExtraYearFacet {
  year: number | null;
  count: number;
}

/** The rail's year facets over the candidates the other filters leave — oldest first, *No year* last,
 *  as the Copies list's are — so a year says what choosing it would list. */
export function freeExtraYearFacets(years: readonly (number | null)[]): FreeExtraYearFacet[] {
  const counts = new Map<number | null, number>();
  for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : a.year - b.year));
}

/** Whether a copy issued in `issuedYear` is in the year filter — the rail's own reading. */
export function freeExtraYearSelects(filters: FreeExtraFilters, issuedYear: number | null): boolean {
  return yearSelects(filters.year, issuedYear);
}
