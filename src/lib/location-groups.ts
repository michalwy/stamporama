// Grouping the Copies list by where its copies are **filed** (#421) — the pure half. No React, no
// Prisma, so the server read, the client panel and the unit tests share one derivation.
//
// Two modes, one question apart. **By location** collapses the list to one row per storage location
// (#56); **by ref** splits each of those by the copy's own in-location reference (`A234`), which is
// what is actually written on the shelf. They are separate modes rather than one axis toggle because
// a collector browsing "what is in Klaser A" and one walking the refs in order are doing different
// things — and because a ref only means anything inside its location (`A234` in two klasers is two
// places, not one).
//
// A location groups **exactly**, never rolled up from its children: a nested location is its own
// group, and its row states the full path. A roll-up would report one copy under every ancestor,
// and the sidebar's own subtree scope (#385) is already how one asks for "this and everything
// under it".

import { compareLocationRef } from "./location-ref";

/** Which of the two filing groupings is in effect. */
export type LocationGroupBy = "location" | "ref";

/** The `locationId` filter value standing for the copies filed **nowhere**. Null is a value on this
 * axis exactly as it is for format and certificate, and an absent filter means "any location", which
 * is the opposite of what the unfiled group asks for. Lives here rather than in `items.ts` so the
 * client rows that address a group's members can name it without importing a server module. */
export const NO_LOCATION = "none";

/** The `locationRef` filter value standing for the copies carrying **no ref** — null and the empty
 * string a cleared field can leave behind alike. */
export const NO_LOCATION_REF = "none";

/** The minimum a group needs to be ordered: where it is, and (in `ref` mode) what is written on it.
 * `locationPath` is the resolved breadcrumb — `null` is the copies filed nowhere. */
export interface SortableLocationGroup {
  locationPath: string | null;
  locationRef: string | null;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A stable key for one group — the React key, and what tells two rows apart. Built rather than
 * parsed: the members of a group are addressed by the row's own fields, so nothing ever reads this
 * back and it needs no escaping scheme a free-text ref could break. */
export function locationGroupKey(
  group: { locationId: string | null; locationRef: string | null },
  by: LocationGroupBy
): string {
  return JSON.stringify([by, group.locationId, by === "ref" ? group.locationRef : null]);
}

/**
 * Reading order for filing groups: by location path, then — in `ref` mode — by the ref itself
 * through {@link compareLocationRef}'s prefix-then-number rule (#330), which is how a shelf is
 * actually walked. Copies filed **nowhere** sort last, the same way a blank ref does: an unfiled
 * piece has no place in the walk.
 *
 * Total (ties fall through to the raw path text), so paging over a sorted list can neither repeat
 * nor skip a group — which is the whole reason the ordering is applied server-side.
 */
export function compareLocationGroups(
  a: SortableLocationGroup,
  b: SortableLocationGroup
): number {
  const pa = a.locationPath?.trim() ?? "";
  const pb = b.locationPath?.trim() ?? "";
  if (!pa || !pb) {
    if (pa !== pb) return pa ? -1 : 1;
  } else {
    const byPath = COLLATOR.compare(pa, pb);
    if (byPath !== 0) return byPath;
  }
  return compareLocationRef(a.locationRef, b.locationRef);
}
