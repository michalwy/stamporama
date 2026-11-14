import { catalogKeyMatches } from "./catalog-number";
import { composeSetCatalogKeys, composeSetSearchText } from "./offer-compose-search";

// What an offer picker's row shows of the offer it offers (#2309) — *Add offers to the proposal* and a
// post's *Add lots…* — and how its search box reaches it. Pure: the parts are read on the server
// (`offer-picker-contents.ts`), the match runs on the client on every keystroke. The two halves are
// here together for the reason `offer-compose-search.ts` gives for its own: a builder that stopped
// agreeing with its matcher would fail nowhere, the search would only stop finding things.

/** How many of an offer's sets a picker row spells out before it counts the rest. */
export const OFFER_PICKER_SET_LINES = 3;

/** One set of the offer as its picker row reads it: what the offer list's rows call its stamps. */
export interface OfferPickerSetLine {
  /** The set's catalogue numbers, compacted as its derived label is (`Mi·PL 15-19`). */
  catalog: string;
  /** Its copies' conditions, each once, in copy order. */
  conditions: { id: string; abbreviation: string }[];
  /** Its copies' issues with their years, each once — `Birds (1960)` — or null when none is in one. */
  issue: string | null;
}

export interface OfferPickerContents {
  /** The offer's own title — never the *Offer #N* stand-in, which the number beside it already says. */
  ownTitle: string | null;
  /** The front photo of its first copy that has one, or null when none has. */
  photoId: string | null;
  /** The first {@link OFFER_PICKER_SET_LINES} sets. */
  sets: OfferPickerSetLine[];
  /** How many sets are past those — the row's *+N more*. */
  moreSets: number;
  /** Its own title, its stamps' names and its issues' names, lowercased for a substring match. */
  searchText: string;
  /** Every copy's catalogue numbers as match keys (`composeSetCatalogKeys`). */
  catalogKeys: string[];
}

/** One copy of a set, as the server hands it over. */
export interface OfferPickerCopy {
  /** Null for a piece, which has no condition (#2383) and adds none to the set's list. */
  condition: { id: string; abbreviation: string } | null;
  issue: { name: string | null; year: number | null } | null;
  stampName: string | null;
  /** Every number the stamp carries, printed with its vendor and area prefix. */
  catalogNumbers: string[];
}

/** An issue as a picker row names it: `Birds (1960)`, the year only when known. */
export function offerPickerIssueLabel(name: string | null, year: number | null): string | null {
  const parts = [name?.trim() || null, year ? `(${year})` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function distinctBy<T>(values: readonly T[], key: (v: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = key(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One set's line: its derived catalogue label (from the labeller) and its copies in set order. */
export function offerPickerSetLine(catalog: string, copies: readonly OfferPickerCopy[]): OfferPickerSetLine {
  const issues = distinctBy(
    copies.flatMap((c) => {
      const label = c.issue ? offerPickerIssueLabel(c.issue.name, c.issue.year) : null;
      return label ? [label] : [];
    }),
    (l) => l
  );
  return {
    catalog,
    conditions: distinctBy(
      copies.flatMap((c) => (c.condition ? [c.condition] : [])),
      (c) => c.id
    ),
    issue: issues.length > 0 ? issues.join(", ") : null,
  };
}

/** The row's whole contents, from the offer's own title and its sets in order. */
export function offerPickerContents(
  ownTitle: string | null,
  photoId: string | null,
  sets: readonly { catalog: string; copies: readonly OfferPickerCopy[] }[]
): OfferPickerContents {
  const title = ownTitle?.trim() || null;
  const copies = sets.flatMap((s) => s.copies);
  return {
    ownTitle: title,
    photoId,
    sets: sets.slice(0, OFFER_PICKER_SET_LINES).map((s) => offerPickerSetLine(s.catalog, s.copies)),
    moreSets: Math.max(0, sets.length - OFFER_PICKER_SET_LINES),
    searchText: composeSetSearchText([
      title,
      ...copies.map((c) => c.stampName),
      ...copies.map((c) => c.issue?.name),
    ]),
    catalogKeys: composeSetCatalogKeys(copies.flatMap((c) => c.catalogNumbers)),
  };
}

/**
 * Does the offer match what was typed? Its number (with or without `#`), its own title, its stamps'
 * and issues' names, and every catalogue number it holds — `200`, `Mi PL 200` and `Mi·PL 200` alike.
 */
export function offerPickerMatches(
  offer: { offerNo: number; contents: Pick<OfferPickerContents, "searchText" | "catalogKeys"> },
  query: string,
  /** Narrows the catalogue keys to the catalogues the search reads (#2529); every key without it. */
  keysInScope: (keys: readonly string[]) => readonly string[] = (keys) => keys
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (String(offer.offerNo) === q.replace(/^#/, "")) return true;
  if (offer.contents.searchText.includes(q)) return true;
  return catalogKeyMatches(q, keysInScope(offer.contents.catalogKeys));
}
