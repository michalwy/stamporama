/**
 * *Which area and which year a list is narrowed to* (#143, #844) — the pure half of the shared
 * filter rail's selection: where the two values come from when the address bar and the remembered
 * choice disagree, and what the address then has to say for a reload to reproduce the screen.
 *
 * The selection is **one thing shown in two places**, and that is the whole of the difficulty. It
 * rides in the URL so a list can be linked, bookmarked and walked back through; it is remembered
 * per collection so switching from the Copies list to Issues keeps the collector on the same
 * country and year rather than dropping them back at *everything*. Two homes for one value need a
 * stated precedence and a stated way back, and before #844 only the first half existed.
 *
 * **The address bar wins, and then carries it.** The parameter is read first, so a link somebody
 * pasted means exactly what it says, and the remembered choice is the fallback for a plain visit —
 * which is #325's rule, already applied key by key to every other remembered filter here
 * (`use-persisted-filter-params.ts`). Whichever one answered is then written *back* into the
 * address, so the two never disagree: that mirror is what #844 was missing, and its absence broke
 * a reload, the back button and copying the address to another window all at once.
 *
 * **`all` is a value, not an absence** (#143). An absent parameter means *nothing has been said*
 * and falls back to what is remembered; `areaId=all` means *this list is showing every area*, which
 * is how the collector switches a remembered filter off and how a mirrored selection records "no
 * area" without the memory re-supplying one on the next load.
 */

/** The address-bar names for the two halves of the selection. */
export const AREA_FILTER_PARAM = "areaId";
export const YEAR_FILTER_PARAM = "year";

/** An explicit *everything*, as distinct from an absent parameter that falls back to memory. */
export const ALL_SENTINEL = "all";

/** A selection as the screen holds it: `null` on either half is "not narrowed by this". */
export interface AreaYearFilter {
  /** Area id, or null for every area. */
  areaId: string | null;
  /** A year (`"none"` is the no-year bucket), or null for every year. */
  year: string | null;
}

export interface AreaYearSources {
  /** The `areaId` parameter as the URL states it, or null when it states nothing. */
  urlAreaId: string | null;
  /** The `year` parameter as the URL states it, or null when it states nothing. */
  urlYear: string | null;
  storedAreaId: string | null;
  storedYear: string | null;
  /**
   * Every area the collection has, when the caller has the tree to hand.
   *
   * An area id names something that either exists or does not, and a list screen is handed the
   * whole tree as a server-rendered prop — so an id outside it can be recognised as naming nothing,
   * and is dropped rather than passed to the query. Otherwise a link to an area that has since been
   * deleted, or a deleted area still sitting in the remembered choice, pins every list to an empty
   * result with no control on screen showing why: the rail cannot mark a row that is not there.
   *
   * **The year is deliberately not treated this way.** Its facets arrive asynchronously and are
   * themselves narrowed by the area in force, so an empty list of years is *nothing here right now*
   * rather than *this year does not exist* — dropping the year on it would silently widen the list
   * the moment an area selection emptied the facets, and again on every load before they arrive.
   */
  knownAreaIds?: ReadonlySet<string> | null;
}

/**
 * The selection actually in force: the URL where it names a value, the remembered choice otherwise,
 * with an area nothing can match dropped.
 */
export function resolveAreaYearFilter({
  urlAreaId,
  urlYear,
  storedAreaId,
  storedYear,
  knownAreaIds,
}: AreaYearSources): AreaYearFilter {
  const areaChoice =
    urlAreaId !== null ? (urlAreaId === ALL_SENTINEL ? null : urlAreaId) : storedAreaId;
  const areaId =
    areaChoice !== null && knownAreaIds != null && !knownAreaIds.has(areaChoice) ? null : areaChoice;
  const year = urlYear !== null ? (urlYear === ALL_SENTINEL ? null : urlYear) : storedYear;
  return { areaId, year: year || null };
}

/**
 * Whether anything has been said about this selection at all — by the address bar, or by whatever
 * is in force on screen.
 *
 * **A list nobody has narrowed, at an address that says nothing, is left entirely alone**: there is
 * nothing to record, and writing anyway would put a filter in the address of every list the
 * collector merely opened, and a row in the memory for a choice they never made.
 *
 * It is the guard on *both* mirrors, which is not a coincidence — a screen that has been told
 * nothing has nothing to tell either place.
 */
function statedAreaYear(
  selection: AreaYearFilter,
  urlAreaId: string | null,
  urlYear: string | null
): boolean {
  const inForce = selection.areaId !== null || selection.year !== null;
  const urlSpeaks = urlAreaId !== null || urlYear !== null;
  return inForce || urlSpeaks;
}

/**
 * What the address bar has to be changed to say, or null when it needs no change.
 *
 * Once anything has been said, **both halves are stated**, including one that is "all". The pair is
 * one selection: naming only the year would leave the area to fall back to memory on the next load,
 * which is the divergence this whole module exists to close.
 *
 * It answers a **retirement** as well as a restore, for the same reason and with the same write: an
 * area id the collection no longer has is dropped from the selection, and the parameter that named
 * it has to go with it, or the address would keep offering a filter the screen has already left —
 * which is what makes the guard above *stated*, not merely *in force*.
 */
export function areaYearUrlUpdates(
  selection: AreaYearFilter,
  urlAreaId: string | null,
  urlYear: string | null
): Record<string, string> | null {
  if (!statedAreaYear(selection, urlAreaId, urlYear)) return null;
  const areaId = selection.areaId ?? ALL_SENTINEL;
  const year = selection.year ?? ALL_SENTINEL;
  if (urlAreaId === areaId && urlYear === year) return null;
  return { [AREA_FILTER_PARAM]: areaId, [YEAR_FILTER_PARAM]: year };
}

/**
 * Whether the selection may be written to the remembered choice.
 *
 * **A screen that has been told nothing must not overwrite what another screen remembered.** The
 * memory is read through `useSyncExternalStore` with an empty server snapshot (the house rule for a
 * client preference on a server-rendered screen), so the first render of a freshly loaded list sees
 * *no* remembered filter whether or not one exists — and a mirror that wrote on that render would
 * erase the collector's filter on every reload, which is the reset #844 reports and the reason the
 * URL was not the only thing missing.
 *
 * An explicit `all` still counts as something said: that is how a filter is switched off, and the
 * memory has to hear it or it would hand the filter straight back.
 */
export function shouldRememberAreaYear(
  selection: AreaYearFilter,
  urlAreaId: string | null,
  urlYear: string | null
): boolean {
  return statedAreaYear(selection, urlAreaId, urlYear);
}
