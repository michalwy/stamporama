// The collection's own vocabulary, and resolving a name to an id (#708).
//
// **This is the thing most likely to decide whether the agent API works in practice**, which is why
// it is its own module rather than a helper inside each operation. Almost everything an agent wants
// to say about a stamp is expressed in a per-collection, user-configurable vocabulary — conditions,
// formats, subtypes, certificate statuses, areas, locations, catalog vendors and their books — and
// every one of those is cuid-keyed. An agent will never guess a cuid, and a surface that demands one
// is unusable however well it is documented.
//
// So two things live here and they are two halves of one idea: the **shape** an operation answers
// `GET /api/v1/vocabulary` with, and the **decision** that turns `"MNH"` into the id behind it.
//
// **Pure, and that is where the interesting boundary runs** (`agent-api.md`, *The module layout is
// the Prisma-free split*). The resolver's *decision* is a function of a value and a list of entries
// and nothing else — no Prisma, no request, no collection — so `pnpm test:unit` can hold every rule
// it has. Only the **lookup** that fetches those entries needs a database, and that lives beside the
// handler in `operations/vocabulary.ts`. Splitting it that way is not tidiness: the ambiguity rule
// below is the part that will be got wrong later, and it is the part a unit test can pin.

import { ambiguousVocabularyValue, unknownVocabularyValue } from "./errors";

/**
 * One vocabulary row, reduced to what a name-or-id input has to match against.
 *
 * Every vocabulary in the response widens this rather than replacing it, so the resolver takes any
 * of them without knowing which it was handed — a condition, an area and a catalog vendor are the
 * same problem once you are matching a name.
 */
export interface VocabularyEntry {
  readonly id: string;
  /**
   * The canonical name, in the collection's own terms. This is the value the collector configured,
   * not a translation of it, and it is what an agent should send back.
   */
  readonly name: string;
  /** The short form, where the vocabulary has one — `MNH`, `Blk4`, `Mi`. Matched as readily as the
   *  name is: an agent reading a listing sees the abbreviation far more often than the full name. */
  readonly abbreviation?: string;
  /**
   * What this collection actually displays for the row, where that differs from {@link name}.
   * Omitted when there is nothing to say — the common case by a wide margin — so a vocabulary with
   * no translations and no display overrides costs nothing at all for the field.
   */
  readonly label?: string;
}

/** A vocabulary entry that also sits in a tree: areas and locations, and nothing else. */
export interface TreeVocabularyEntry extends VocabularyEntry {
  /** The parent's id, or `null` at the root. */
  readonly parentId: string | null;
  /**
   * Whether the node can itself hold material, or only organise its children (#56, #263). An agent
   * that files a copy under a grouping-only node has made a mistake nothing else here would catch.
   */
  readonly assignable: boolean;
}

/** A subtype carries two flags an agent reasoning about a variant tree cannot do without (#127). */
export interface SubtypeVocabularyEntry extends VocabularyEntry {
  /** A child of an `actsAsVariant` subtype makes its parent an unknown-variant umbrella. */
  readonly actsAsVariant: boolean;
  /** Exactly one row is the default — what a newly created child stamp is given. */
  readonly isDefault: boolean;
}

/**
 * A marketplace an offer can be drafted against (#196).
 *
 * **A `Contact` with `platform: true`, projected down to three fields, and the projection is the
 * point.** That model is shared with buyers, sellers and exchange partners, so it carries `email`,
 * `phone`, `fullName` and `notes` — a trading partner's personal details, which an agent has no
 * business holding for a session. None of them is here, and only rows flagged `platform` are
 * returned at all.
 */
export interface PlatformVocabularyEntry extends VocabularyEntry {
  /**
   * The currency every offer and sale routed here is locked to (#196), or `null` where the collector
   * has not set one yet — which is domain-enforced rather than a database constraint, and is
   * something an agent should know **before** drafting rather than after being refused.
   *
   * This is also why there is no currency vocabulary: an offer never takes a currency, it takes a
   * platform, and the currency follows from this field.
   */
  readonly currency: string | null;
}

/** A catalog book, flat, with its vendor as an id rather than as a nested object. */
export interface CatalogVocabularyEntry extends VocabularyEntry {
  /** The vendor whose book this is — join against `catalogVendors` in the same response. */
  readonly vendorId: string;
  /** The currency this book's prices are stated in. */
  readonly currency: string;
}

/**
 * Everything `GET /api/v1/vocabulary` answers with.
 *
 * **One call, one object, and per-vocabulary shapes.** #708 decided *one call*, and that is intact;
 * what it could not decide in advance is that the nine things it names are not the same kind of
 * thing. Most are flat lists, **areas and locations are trees**, and catalog books hang off vendors.
 * The trees come back as **flat arrays carrying `parentId`** rather than nested — an agent that
 * wants the tree builds it in three lines, and nesting would repeat every parent's fields down
 * every branch, which is precisely what the context-window constraint forbids.
 *
 * **Currencies are deliberately not here, and the reason is that they are not this kind of thing.**
 * #708's Context justifies the whole endpoint with *all of them are cuid-keyed, and an agent will
 * never guess a cuid* — which is true of every vocabulary below and false of `"EUR"`. Currencies are a
 * module-level constant in `src/lib/currencies.ts`, app-wide, not per-collection, not configurable
 * and already known to any model. What the agent actually needs is the **denomination** a figure it
 * reads back is stated in, and that is {@link baseCurrency}: one scalar rather than twenty-five
 * codes it would carry for a whole session and never send. Where an agent might have thought it was
 * *choosing* a currency — drafting an offer — it is choosing a {@link platforms} entry, and the
 * currency is locked from that (#196).
 */
export interface CollectionVocabulary {
  /**
   * The currency every collection-level figure is stated in. Here rather than as a vocabulary
   * because an agent needs to *read* it, never to send one.
   */
  readonly baseCurrency: string;
  /**
   * The language the canonical names above are written in, as an ISO 639-1 code. It is what makes
   * `label` legible: a `label` differing from `name` is this collection displaying the row in its
   * own language, and the agent should quote the label to a person and send the name back here.
   */
  readonly defaultLanguage: string;
  readonly conditions: readonly VocabularyEntry[];
  readonly formats: readonly VocabularyEntry[];
  readonly certificateStatuses: readonly VocabularyEntry[];
  readonly subtypes: readonly SubtypeVocabularyEntry[];
  readonly areas: readonly TreeVocabularyEntry[];
  readonly locations: readonly TreeVocabularyEntry[];
  readonly catalogVendors: readonly VocabularyEntry[];
  readonly catalogs: readonly CatalogVocabularyEntry[];
  /**
   * **Derived from #711's body rather than from #708's list of nine**, and marked as such so that
   * whoever implements #711 can contradict it. #708's Context names nine vocabularies and platforms
   * is not among them — but the binding statement is its *Done when*, *one call returns every
   * vocabulary an operation in #710, #711 or #712 can take as input*, and #711's *draft an offer*
   * cannot be called without naming a platform. That is the same test that admitted areas,
   * conditions, locations, formats, certificate statuses and catalog vendors, and the same test
   * that kept currencies out.
   */
  readonly platforms: readonly PlatformVocabularyEntry[];
}

/** How a vocabulary is named in an error sentence — the agent reads these, so they are English. */
export type VocabularyName =
  | "condition"
  | "format"
  | "certificate status"
  | "subtype"
  | "area"
  | "location"
  | "catalog vendor"
  | "catalog"
  | "platform";

/** Trim and case-fold, so that `"mnh"`, `" MNH "` and `"MNH"` are one value. */
function fold(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Every string an entry answers to, folded. The id is matched **exactly** and separately, above:
 * folding a cuid would be meaningless work, and a cuid can never collide with a name anyway.
 */
function aliases(entry: VocabularyEntry): string[] {
  const values = [entry.name, entry.abbreviation, entry.label];
  return values.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map(fold);
}

/**
 * The id behind `value`, which may be an id or a name.
 *
 * **This is #708's central decision and its three branches are the whole of it.**
 *
 * - An **id** is taken as an id. An agent that read the vocabulary and kept the ids is the cheapest
 *   caller there is, and nothing should discourage it.
 * - A **name that is unambiguous within the collection** resolves. `"MNH"` is as good as its id,
 *   which is the sentence in #708 that decides whether this surface is usable. Names, abbreviations
 *   and display labels all match, case- and whitespace-insensitively, because an agent reading a
 *   listing meets the abbreviation far more often than the full name.
 * - A **name that is ambiguous** is refused, and the id is required. Nothing stops a collector
 *   naming two areas `Poland`, and guessing between them would silently file a copy in the wrong
 *   one — the one failure on this surface that is both invisible and expensive.
 *
 * **The two refusals hand back different lists, and that is the point rather than an inconsistency.**
 * An unknown value gets the accepted **names**, so the agent can pick the right one. An ambiguous
 * value gets the matching **ids**, because handing the names back would hand the ambiguity back with
 * them and the agent would retry the same string for ever.
 */
export function resolveVocabularyValue(
  value: string,
  entries: readonly VocabularyEntry[],
  context: { readonly vocabulary: VocabularyName; readonly parameter: string }
): string {
  const trimmed = value.trim();
  const exactId = entries.find((entry) => entry.id === trimmed);
  if (exactId) return exactId.id;

  const wanted = fold(trimmed);
  const matched = wanted === ""
    ? []
    : entries.filter((entry) => aliases(entry).includes(wanted));

  if (matched.length === 1) return matched[0].id;
  if (matched.length === 0) {
    throw unknownVocabularyValue(trimmed, context.vocabulary, context.parameter, acceptedNames(entries));
  }
  throw ambiguousVocabularyValue(
    trimmed,
    context.vocabulary,
    context.parameter,
    matched.map((entry) => entry.id)
  );
}

/**
 * {@link resolveVocabularyValue} for a parameter that may be absent. `null` and `""` mean *not
 * supplied* and come back as `null` — which for several of these vocabularies is a real value in
 * the domain rather than a gap: a null format **means single** and a null certificate status
 * **means none** (ADR-0006 §2), and neither has a row to name.
 */
export function resolveOptionalVocabularyValue(
  value: string | null | undefined,
  entries: readonly VocabularyEntry[],
  context: { readonly vocabulary: VocabularyName; readonly parameter: string }
): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return resolveVocabularyValue(value, entries, context);
}

/**
 * Resolve a list of names or ids, in order, keeping duplicates out.
 *
 * Every rejection is the first one: an agent that sent four area names of which two are wrong is
 * better served by fixing one and retrying than by a compound sentence naming both, and the
 * `accepted` list is the same either way.
 */
export function resolveVocabularyValues(
  values: readonly string[],
  entries: readonly VocabularyEntry[],
  context: { readonly vocabulary: VocabularyName; readonly parameter: string }
): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) seen.add(resolveVocabularyValue(value, entries, context));
  return [...seen];
}

/**
 * What an agent should be told it may send. The canonical names, because that is what
 * {@link VocabularyEntry.name} says to send back — and the abbreviation beside it where the two
 * differ, because half the time the abbreviation is what the agent already had in hand.
 *
 * Capped, and the cap is the same argument the list conventions make. An area list can run to
 * hundreds of rows, and pasting all of them into an error an agent may hit repeatedly spends the
 * context this whole surface is shaped around. Past the cap the sentence sends it to the vocabulary
 * operation, which is where the full answer lives and is one call it should have made already.
 */
export const MAX_ACCEPTED_VALUES = 40;

export function acceptedNames(entries: readonly VocabularyEntry[]): readonly string[] {
  return entries.slice(0, MAX_ACCEPTED_VALUES).map((entry) =>
    entry.abbreviation && fold(entry.abbreviation) !== fold(entry.name)
      ? `${entry.name} (${entry.abbreviation})`
      : entry.name
  );
}
