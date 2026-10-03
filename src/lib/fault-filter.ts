// Narrowing the Copies list to the copies carrying a fault (#1557).
//
// Pure — no Prisma, no React, no `server-only` — for `tag-filter.ts`'s reason: the panel writes the
// query string, the route reads it back and the domain module builds the `where` from it, and a
// client component cannot import a `server-only` module to find out how the three agree.
//
// **One reading: any of the chosen faults**, plus *no faults* as a tickable value. Unlike the tag
// filter there is no *all of them* switch — the collector asked for *copies with any of these* and
// *copies with none*, and a fault list is short enough that the narrower question is one tick away.
// *No faults* is a value rather than the absence of the filter, the way *No certificate* is on that
// axis, and ticked beside real faults it is ORed with them.

/** The URL parameter, comma-separated as every other multi-value filter on the list is. */
export const FAULT_FILTER_PARAM = "faultIds";

/** The tickable value for the copies carrying no fault at all. */
export const NO_FAULTS = "none";

export interface FaultFilterOpts {
  faultIds?: string[];
}

/** The filter as the link carries it. An absent or all-blank value is no filter. */
export function faultFilterFromParams(
  sp: URLSearchParams | { get(key: string): string | null }
): FaultFilterOpts {
  const ids = (sp.get(FAULT_FILTER_PARAM) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? { faultIds: ids } : {};
}

/** Write the filter onto a query string; nothing at all when it is off. */
export function appendFaultFilterParams(params: URLSearchParams, filter: FaultFilterOpts): void {
  const ids = filter.faultIds ?? [];
  if (ids.length > 0) params.set(FAULT_FILTER_PARAM, ids.join(","));
}

interface FaultSomeWhere {
  faults: { some: { faultId: string | { in: string[] } } };
}

interface FaultNoneWhere {
  faults: { none: Record<string, never> };
}

export type FaultFilterWhere = FaultSomeWhere | FaultNoneWhere | { OR: [FaultNoneWhere, FaultSomeWhere] };

/**
 * The `where` fragment over a copy's own faults, or null when the filter is off. It goes into the
 * caller's **AND list**, where the search's own `OR` already is, so the *no faults* branch's `OR`
 * cannot collide with it.
 */
export function faultFilterWhere(opts: FaultFilterOpts): FaultFilterWhere | null {
  const unique = [...new Set(opts.faultIds ?? [])];
  if (unique.length === 0) return null;
  const ids = unique.filter((id) => id !== NO_FAULTS);
  const faultless: FaultNoneWhere = { faults: { none: {} } };
  const some: FaultSomeWhere | null =
    ids.length === 0
      ? null
      : { faults: { some: { faultId: ids.length === 1 ? ids[0] : { in: ids } } } };
  if (ids.length < unique.length) return some ? { OR: [faultless, some] } : faultless;
  return some;
}
