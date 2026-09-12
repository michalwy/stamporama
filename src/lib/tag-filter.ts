// Narrowing a list to the collector's own labels (#1182). A tag nobody can search by is a
// decoration: #152 gave the vocabulary and hung it on issues and stamps, #1181 on copies, and this
// is the one module all three lists ask *show me the ones tagged like this* through.
//
// Pure — no Prisma, no React, no `server-only` — for the reason `stamp-attribute-kinds.ts` is: the
// URL is where this filter lives, so the panel that writes the query string, the route that reads it
// back and the `where` the domain module builds from it must agree about one spelling, and a client
// component cannot import a `server-only` module to find it out. {@link tagFilterWhere} returns
// plain objects that happen to be a Prisma `where` fragment; nothing here touches a client.
//
// **Two readings, and neither is the default one would guess.** Every other multi-select filter in
// this app is an OR over one axis, because a copy is in exactly one condition and a stamp on one
// paper. A tag is not an axis: a thing carries any number at once, so *birds* and *to check* is a
// perfectly good question asked two ways — *either of these*, and *both of these at once*. #152
// proposed defaulting to *any* and leaving it there; both readings are wanted, so the filter carries
// the choice and the mode is URL state like the ids beside it.
//
// **No inheritance**, which is the whole feature's rule (`tags.ts`): the filter matches the rows
// stored against the row's own thing. An issue tagged *birds* does not make its stamps match, a
// parent stamp's tag does not make its variants match, and a stamp's tag does not reach the copies
// of it. So there is no walk here and no resolution — one `some` over the thing's own join table.

/** *Any of the ticked tags* or *all of them*. There is no third reading — *none of these* would be a
 *  negation rather than a mode, and nothing has asked for it. */
export const TAG_FILTER_MODES = ["any", "all"] as const;

export type TagFilterMode = (typeof TAG_FILTER_MODES)[number];

/** *Any* is the default, which is what every other multi-select on these bars means and therefore
 *  what an untouched control has to mean. A link that names no mode carries this one. */
export const DEFAULT_TAG_FILTER_MODE: TagFilterMode = "any";

export function isTagFilterMode(value: unknown): value is TagFilterMode {
  return typeof value === "string" && (TAG_FILTER_MODES as readonly string[]).includes(value);
}

/** The tag filter as the three lists' filter options carry it. Absent or empty `tagIds` is *every
 *  tag* — the absence of the filter, never "the things carrying no tag", which is the reading every
 *  `MultiSelectFilter` in this app already has. */
export interface TagFilterOpts {
  tagIds?: string[];
  /** Meaningless with fewer than two ids, and absent means {@link DEFAULT_TAG_FILTER_MODE}. */
  tagMode?: TagFilterMode;
}

/** The URL keys, named once so the panel, the query hook and the route cannot spell them three
 *  ways. */
export const TAG_FILTER_PARAM = "tagIds";
export const TAG_MODE_PARAM = "tagMode";

/** The filter off a query string — the ids comma-joined as `areaIds` already is, the mode as its own
 *  word. An unrecognised mode reads as the default rather than as an error: a hand-edited or stale
 *  link should show a list, not a failure. */
export function tagFilterFromParams(
  sp: URLSearchParams | { get(key: string): string | null }
): TagFilterOpts {
  const ids = (sp.get(TAG_FILTER_PARAM) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return {};
  const rawMode = sp.get(TAG_MODE_PARAM);
  return {
    tagIds: ids,
    tagMode: isTagFilterMode(rawMode) ? rawMode : DEFAULT_TAG_FILTER_MODE,
  };
}

/**
 * Write the filter onto a request's query string, in the shape {@link tagFilterFromParams} reads
 * back. The mirror of that parser and next to it on purpose: three query hooks send this filter and
 * a fourth caller will, and the round trip is the thing that silently stops working when one of them
 * spells a key its own way.
 *
 * Nothing is written when no tag is ticked, and **the mode rides only with the ids** — a request
 * carries what is narrowing and nothing else, so the cache key of an untouched filter is the same
 * whichever mode was last set.
 */
export function appendTagFilterParams(params: URLSearchParams, filter: TagFilterOpts): void {
  const ids = filter.tagIds ?? [];
  if (ids.length === 0) return;
  params.set(TAG_FILTER_PARAM, ids.join(","));
  if (filter.tagMode && filter.tagMode !== DEFAULT_TAG_FILTER_MODE) {
    params.set(TAG_MODE_PARAM, filter.tagMode);
  }
}

/** One `some` over a thing's own tag join table. The relation is called `tags` on `Issue`, `Stamp`
 *  and `Item` alike, and the join row's column is `tagId` on all three, which is what lets one
 *  builder serve the three lists. */
interface TagSomeWhere {
  tags: { some: { tagId: string | { in: string[] } } };
}

/** What {@link tagFilterWhere} answers with: one clause for *any*, an `AND` of one clause per tag
 *  for *all*. */
export type TagFilterWhere = TagSomeWhere | { AND: TagSomeWhere[] };

/**
 * The `where` fragment for a tag filter, or **null when the filter is off** — which is how a caller
 * tells *narrow by these* from *no opinion* without inspecting the ids itself.
 *
 * *Any* is a single `some` with an `in`, one join and one index seek on `tagId`. *All* cannot be: a
 * single `some` asks whether **one** row satisfies every condition, and one join row carries exactly
 * one `tagId`, so `some: { tagId: { in: [a, b] } }` is *any* however it is written. Each ticked tag
 * therefore gets its own `some`, `AND`ed — *this thing has a row for a, and a row for b* — which is
 * the standard relational division and the only honest spelling of the question.
 *
 * Duplicates are collapsed, so a link repeating an id does not pay for a second join; ids are not
 * checked against the collection's dictionary here, because this module is pure and every read that
 * uses it is already scoped by `collectionId` — a foreign id simply matches nothing, which is the
 * same answer a tag nobody used gives.
 */
export function tagFilterWhere(opts: TagFilterOpts): TagFilterWhere | null {
  const ids = [...new Set(opts.tagIds ?? [])];
  if (ids.length === 0) return null;
  const mode = opts.tagMode ?? DEFAULT_TAG_FILTER_MODE;
  if (mode === "all" && ids.length > 1) {
    return { AND: ids.map((tagId) => ({ tags: { some: { tagId } } })) };
  }
  // One tag is one `some` whichever mode is set: *any of it* and *all of it* are the same question,
  // and the narrower shape is the one the planner reads best.
  return ids.length === 1
    ? { tags: { some: { tagId: ids[0] } } }
    : { tags: { some: { tagId: { in: ids } } } };
}

/**
 * What the filter's closed control reads (#868's rule: a trigger whose panel carries a sub-control
 * has more to say than the selection's own count).
 *
 * The **mode is named on the trigger** rather than only inside the panel, because it is the half a
 * reader cannot infer from the list: two tags ticked and eleven rows showing looks identical under
 * either reading unless you already know which one is in force. With one tag ticked the mode has no
 * say, so the tag simply names itself — saying *any of 1 tag* would invite a question that has no
 * answer.
 */
export function tagFilterTriggerLabel(
  selectedNames: readonly string[],
  mode: TagFilterMode
): string {
  if (selectedNames.length === 0) return "All tags";
  if (selectedNames.length === 1) return selectedNames[0];
  const count = `${selectedNames.length} tags`;
  return mode === "all" ? `All of ${count}` : `Any of ${count}`;
}
