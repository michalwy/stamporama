import { catalogKeyMatches, normalizeCatalogKey } from "./catalog-number";

// How the Add-to-offer picker's search box decides that a set matches (#188, #867).
//
// Pure — no Prisma, no React — because both ends of the question live here now. The **keys** are
// built on the server, where the labeller has already resolved which vendor leads in a stamp's area
// and how that vendor's numbers are prefixed there (#377/#379); the **match** runs on the client,
// on every keystroke, over the sets it was handed. Before #867 the keys were rebuilt on the client
// per copy, out of the fully enriched copy rows the picker was given for every set in the
// collection — which meant loading a copy in full in order to ask one string question of it.
//
// The two halves are here together on purpose: they are one behaviour, and a builder that stopped
// agreeing with its matcher would not fail anywhere — the search would simply, quietly, stop
// finding things. `tests/unit/offer-compose-search.test.ts` runs them as a pair.

/** The part of a compose target set the search reads. Structural, so nothing here has to import the
 *  server-only module that defines the full set. */
export interface ComposeSetSearchable {
  /** The set's own derived or given label (#379). */
  label: string;
  /** Each copy's short label — its leading catalog number, else the stamp's name. */
  itemLabels: string[];
  /** {@link composeSetSearchText}'s output for this set. */
  searchText: string;
  /** {@link composeSetCatalogKeys}' output for this set. */
  catalogKeys: string[];
}

/**
 * The free-text half of a set's search keys: its copies' stamp names, issue names and location refs
 * (#303), run together and lowercased once so the match is a plain substring test.
 *
 * Nulls are dropped rather than rendered — a copy with no location ref must not make the set match
 * the word "null", and an empty part contributes nothing to a substring search anyway.
 */
export function composeSetSearchText(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((v): v is string => !!v)
    .join(" ")
    .toLowerCase();
}

/**
 * The catalog half: each of the set's copies' numbers as a **match key** — vendor abbreviation +
 * area prefix + number, normalized to `[a-z0-9]` (#104) — so `Mi PL 200`, `Mi·PL 200`, `PL200` and
 * bare `200` all reach the same set.
 *
 * Takes the numbers **already printed** (`Mi·PL 200`), which is what `OfferLabeller.catalogNumbers`
 * hands back, rather than the parts: the prefix resolution is the labeller's and doing it twice is
 * how the set's name and the set's search keys would come to disagree about the same stamp.
 * De-duplicated, since a set of forty copies of one stamp has one key.
 */
export function composeSetCatalogKeys(printedNumbers: readonly string[]): string[] {
  return [...new Set(printedNumbers.map(normalizeCatalogKey).filter((k) => k.length > 0))];
}

/**
 * Does this set match what was typed? Its own label, its copies' short labels, the free text, and
 * the catalog keys — in that order, cheapest first.
 *
 * `query` is the raw trimmed input, lowercased here rather than by the caller: the catalog half
 * needs it unnormalized (`catalogKeyMatches` folds spacing and punctuation itself, which a
 * pre-lowercased-and-nothing-else string is still fine for), and a two-argument contract where one
 * argument is "the same thing but lowercased" is one the caller can get wrong silently.
 */
export function composeSetMatches(set: ComposeSetSearchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (set.label.toLowerCase().includes(q)) return true;
  if (set.itemLabels.join(" ").toLowerCase().includes(q)) return true;
  if (set.searchText.includes(q)) return true;
  return catalogKeyMatches(query, set.catalogKeys);
}
