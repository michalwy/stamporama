// Grouping and filtering for the bulk listing workspace (#322) — the screen that turns a batch of
// `ready` offers on one platform into a posting session. Pure: no React, no Prisma, so both the
// client panel and the unit tests use the one derivation.
//
// An offer is a bag of copies, and copies need not agree about where they come from. So the screen
// speaks two related but distinct notions:
//
//   * an offer's **group** — the `(area, year)` pair every one of its copies shares, or **Mixed**
//     when they do not agree. This is the header the offer sits under.
//   * whether an offer **matches** the rail's area/year selection — every copy inside the selected
//     area's subtree, and (for a year) every copy on that year.
//
// They differ on purpose: an offer holding Poland/1960 and Poland/1961 copies is Mixed (it has no
// single year to be filed under), yet it is still a Poland offer and appears under the area "Poland".
// Narrowing by year is the stricter question, and such an offer answers no to every year.

/** The area/year coordinates of one offer, as the read model reports them: one entry per distinct
 * pair across its copies. A copy's area is its stamp's primary area link and its year is the stamp's
 * issued year (#142), so an offer of one stamp has exactly one pair. */
export interface OfferAreaYear {
  /** null when the copy's stamp has no area link at all. */
  areaId: string | null;
  /** null for the "No year" bucket. */
  year: number | null;
}

/** The minimum a row must carry to be grouped and filtered. */
export interface GroupableOffer {
  areaYears: OfferAreaYear[];
}

/** The sentinel group for offers whose copies span areas or years. Not an area id — no id collides
 * with it, and the rail carries it as its own entry. */
export const MIXED_GROUP = "mixed";

/** A group's identity: the shared pair, or Mixed. `areaId`/`year` are meaningless when `mixed`. */
export interface GroupKey {
  mixed: boolean;
  areaId: string | null;
  year: number | null;
}

export const MIXED_KEY: GroupKey = { mixed: true, areaId: null, year: null };

/** Stable, sortable string form of a group key — the React key and the map key. */
export function groupKeyId(key: GroupKey): string {
  if (key.mixed) return MIXED_GROUP;
  return `${key.areaId ?? "no-area"}:${key.year ?? "no-year"}`;
}

/**
 * The group an offer belongs to: the `(area, year)` pair shared by every copy it holds, else Mixed.
 * An offer holding nothing at all is Mixed too — it has no coordinates to be filed under, and the
 * workspace should still show it rather than drop it.
 */
export function offerGroupKey(offer: GroupableOffer): GroupKey {
  const first = offer.areaYears[0];
  if (!first || offer.areaYears.length === 0) return MIXED_KEY;
  for (const pair of offer.areaYears) {
    if (pair.areaId !== first.areaId || pair.year !== first.year) return MIXED_KEY;
  }
  return { mixed: false, areaId: first.areaId, year: first.year };
}

/**
 * Whether an offer answers to the rail's selection.
 *
 * `areaIds` is the selected area **with its descendants** (as every other list resolves it), so a
 * parent area matches an offer whose copies sit in its children. Every copy must be inside it: an
 * offer half of which is elsewhere is not an offer for this area's posting session.
 *
 * `year` is exact and, like the area, must hold for every copy. `"none"` selects the no-year bucket.
 *
 * A Mixed selection is a group choice rather than a coordinate, so it is answered by the group key
 * and ignores both other dimensions — asking "which areas is this Mixed offer in" is the question
 * Mixed exists to say has no single answer.
 */
export function offerMatchesFilters(
  offer: GroupableOffer,
  filters: { areaIds?: string[] | null; year?: number | "none" | null; mixedOnly?: boolean }
): boolean {
  if (filters.mixedOnly) return offerGroupKey(offer).mixed;
  if (filters.areaIds && filters.areaIds.length > 0) {
    const allowed = new Set(filters.areaIds);
    if (offer.areaYears.length === 0) return false;
    if (!offer.areaYears.every((p) => p.areaId !== null && allowed.has(p.areaId))) return false;
  }
  if (filters.year !== undefined && filters.year !== null) {
    const wanted = filters.year === "none" ? null : filters.year;
    if (offer.areaYears.length === 0) return false;
    if (!offer.areaYears.every((p) => p.year === wanted)) return false;
  }
  return true;
}

export interface OfferGroup<T> {
  key: GroupKey;
  id: string;
  offers: T[];
}

/**
 * Group offers under their `(area, year)` headers, Mixed last. Non-mixed groups are ordered by the
 * area's position in the tree (`areaOrder`, the flattened rail order, so the list reads down the
 * same tree the rail shows) and then by year ascending with "No year" last — a posting session runs
 * chronologically through an area.
 */
export function buildOfferGroups<T extends GroupableOffer>(
  offers: T[],
  areaOrder: string[]
): OfferGroup<T>[] {
  const rank = new Map(areaOrder.map((id, i) => [id, i]));
  const groups = new Map<string, OfferGroup<T>>();
  for (const offer of offers) {
    const key = offerGroupKey(offer);
    const id = groupKeyId(key);
    const existing = groups.get(id);
    if (existing) existing.offers.push(offer);
    else groups.set(id, { key, id, offers: [offer] });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key.mixed !== b.key.mixed) return a.key.mixed ? 1 : -1;
    if (a.key.mixed) return 0;
    // An area the tree does not know (or a copy with no area at all) sorts after the ones it does.
    const ra = a.key.areaId ? (rank.get(a.key.areaId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const rb = b.key.areaId ? (rank.get(b.key.areaId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    if (a.key.year === b.key.year) return 0;
    if (a.key.year === null) return 1;
    if (b.key.year === null) return -1;
    return a.key.year - b.key.year;
  });
}

/** null represents the "No year" bucket — the same shape the shared year panel reads. */
export interface YearCount {
  year: number | null;
  count: number;
}

/**
 * Year facets for the rail: how many offers each year would show, counted the way the filter counts
 * — an offer contributes to a year only when **all** its copies are on it, so the facets can never
 * promise more than clicking them delivers. Faceted like every other list: the year's own dimension
 * is ignored, the area selection is not. Descending, "No year" last.
 */
export function offerYearFacets(
  offers: GroupableOffer[],
  filters: { areaIds?: string[] | null; mixedOnly?: boolean } = {}
): YearCount[] {
  const counts = new Map<number | null, number>();
  for (const offer of offers) {
    if (!offerMatchesFilters(offer, filters)) continue;
    const key = offerGroupKey(offer);
    // A Mixed offer has no single year, so it belongs to no year facet — exactly as the filter,
    // which asks every copy to agree, would find.
    if (key.mixed) continue;
    counts.set(key.year, (counts.get(key.year) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
}
