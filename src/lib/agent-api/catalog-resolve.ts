// Turning a **foreign** catalog string into the stamp this collection holds (#1037).
//
// The agent has read an auction listing and is holding `"Mi 123a"`, `"Michel 123"`, `"Fi 456"` or a
// bare `"123"`. The collector's own screens meet the same problem and `src/lib/catalog-number.ts`
// already solved it for them — the normalization, the vendor strip, the key an identity is compared
// by. **Nothing here re-derives any of that**; every key below is built by that module's own
// functions, which is #1037's *no matching rule is duplicated* stated as an import list.
//
// What this module adds is the half a search box never needed: **an answer about confidence**. A
// person typing into a search box sees the results and picks, so recall may be generous and
// containment is the right comparison — `catalogKeyMatches` matches `"200"` inside `"mipl2000"` on
// purpose, and the person ignores the rows they did not mean. An agent cannot ignore anything: it
// has to be told *this is the stamp*, *these several are* or *none is*, and it must never be handed
// one row out of a plausible set. So the comparison here is **equality over the same keys** rather
// than containment over them, and the verdict is the operation's whole product.
//
// **Pure, and deliberately** (`agent-api.md`, *The module layout is the Prisma-free split*). Every
// decision this issue makes — what a string parses to, which keys a stamp answers to, and which of
// the four verdicts follows — is a function of strings and nothing else, so `pnpm test:unit` holds
// all of it. Only the lookup that fetches candidate rows needs a database, and that lives beside
// the handler in `operations/catalog.ts`.

import {
  catalogMatchKey,
  normalizeCatalogKey,
  parseCatalogNumberParts,
  stripCatalogVendor,
} from "../catalog-number";

/**
 * How far one string got.
 *
 * **Four outcomes and not three**, which is the distinction #1037 exists for. *No match* and *the
 * catalogue this number is written in is not one this collection keeps* are different facts about
 * different mistakes: the first is a number the collection does not hold, the second is a question
 * asked in a book the collector does not own, and an agent that conflates them files a wrong report
 * every morning. The first is answered by buying the stamp; the second by stating a vendor the
 * collection does have, or by the collector adding one.
 */
export type CatalogVerdict = "resolved" | "ambiguous" | "unknown_vendor" | "no_match";

/**
 * What one string parsed to, before anything was looked up.
 *
 * Every field here is derived by `catalog-number.ts` except {@link unknownVendorToken}, which is a
 * statement about the **shape** of what the agent wrote rather than a second way of matching it.
 */
export interface ParsedForeignNumber {
  /** The string as it was sent, so a row can be read back against the batch that produced it. */
  readonly input: string;
  /** The vendor the string itself named, by abbreviation or by the name that starts with it. */
  readonly vendorId: string | null;
  /**
   * A leading word that reads like a catalogue's name and answers to none in this collection —
   * `"Fi"` where no Fischer vendor is configured. Its presence is the whole of the
   * `unknown_vendor` verdict, and it is deliberately **conservative**: see
   * {@link leadingCatalogueWord} for the four things it refuses to treat as one.
   */
  readonly unknownVendorToken: string | null;
  /**
   * The normalized remainder after any vendor the string named, area prefix and all — `"Mi·PL 200"`
   * leaves `"pl200"`. This is the key that can still tell `Mi·SP 1` from `Mi·PL 1`.
   */
  readonly restKey: string;
  /**
   * The same remainder with its leading letters dropped, which is what lets `"Michel 123a"` —
   * `"chel123a"` after the vendor strip — reach the same stamp as `"Mi 123a"`.
   *
   * **Null when the letters dropped are a prefix this collection actually uses**, and that is the
   * guard rather than an edge case: an area prefix is part of a stamp's catalog identity (#66/#377),
   * so falling back past a stated `SP` would quietly answer about `Mi·PL 1`. Null also when the
   * remainder carries no digit run to split on at all.
   */
  readonly numberKey: string | null;
  /** The bare number the remainder reads as, for the row to state back. Null when there is none. */
  readonly number: string | null;
}

/** One stamp a string reached, with enough beside it to tell two candidates apart. */
export interface AgentCatalogStamp {
  readonly stampId: string;
  /** The stamp's own catalog number that answered, as the collector reads it — `"Mi·PL 123a"`. This
   *  is #1037's *with what it matched on*: an ambiguous pair is told apart by their labels first. */
  readonly matchedNumber: string;
  /** Every number this stamp carries, the area's primary catalog first. */
  readonly catalogNumbers: readonly string[];
  readonly name?: string;
  readonly issue?: string;
  readonly issueYear?: number;
  readonly area?: string;
  /** Where the record lives in the app, relative to this instance. */
  readonly path: string;
}

/** What one string in the batch is answered with. */
export interface AgentCatalogResolution {
  readonly input: string;
  readonly verdict: CatalogVerdict;
  /** The catalogue the string was resolved against — named in it, or stated by the caller. */
  readonly vendor?: string;
  /** The bare number the string parsed to. */
  readonly number?: string;
  /** On `unknown_vendor` only: the word that was read as a catalogue's name. */
  readonly vendorToken?: string;
  /** On `unknown_vendor` only: the catalogues this collection does keep, so the agent can restate
   *  the question instead of retrying the same string. `errors.ts`'s `accepted` convention, carried
   *  **in the row** rather than thrown — one unresolvable entry must not refuse the other nineteen. */
  readonly acceptedVendors?: readonly string[];
  /**
   * The stamps reached: one on `resolved`, several on `ambiguous`, and **empty rather than absent**
   * otherwise. `match_wants` fixed that spelling first and for the same reason — *no* is an answer,
   * not a dropped field.
   */
  readonly stamps: readonly AgentCatalogStamp[];
}

/** A vendor name is a word, not a sentence; past this many letters a leading word is prose. */
const MAX_VENDOR_WORD_LETTERS = 12;

/**
 * The leading word of a raw catalog string where it reads like a catalogue's name, or null.
 *
 * **This is the only judgement in the module that is not a comparison**, so it is written to be
 * wrong in the cheap direction: a word it misses costs a `no_match` where an `unknown_vendor` would
 * have been more helpful, while a word it invents blocks a resolution that would have worked. Four
 * things are therefore refused:
 *
 * - a word with **nothing after it** — `"VIII"` is a whole catalog number (#383), not a catalogue;
 * - a word carrying **anything but letters** — `"BL30"`, and `"Ark. 103"`, whose `Ark.` is a real
 *   stored number prefix;
 * - a word **longer than {@link MAX_VENDOR_WORD_LETTERS}**;
 * - a word this collection uses as an **area prefix** — `"PL 200"` names no catalogue at all, and
 *   the prefix set is what the caller passes in.
 *
 * `·` ends the word as a space does, because `Mi·PL 200` is how this app itself writes one.
 */
export function leadingCatalogueWord(
  input: string,
  areaPrefixKeys: ReadonlySet<string>
): string | null {
  const trimmed = input.trim();
  const head = trimmed.split(/\s+/)[0] ?? "";
  // Nothing follows it, so the word is the number.
  if (head === trimmed && !head.includes("·")) return null;
  const word = head.split("·")[0];
  if (!new RegExp(`^\\p{L}{1,${MAX_VENDOR_WORD_LETTERS}}$`, "u").test(word)) return null;
  if (areaPrefixKeys.has(normalizeCatalogKey(word))) return null;
  return word;
}

/**
 * Parse one foreign catalog string against this collection's vendors and prefixes.
 *
 * `areaPrefixKeys` is every prefix the collection actually uses, normalized — the area tree's and
 * the issues' overrides alike (#66/#377). It is consulted twice and for one reason both times: a
 * prefix the collector configured is part of an identity and must never be read as something else,
 * neither as a catalogue's name nor as noise to be dropped.
 */
export function parseForeignCatalogNumber(
  input: string,
  vendors: readonly { id: string; abbreviation: string }[],
  areaPrefixKeys: ReadonlySet<string>
): ParsedForeignNumber {
  const { vendorId, rest } = stripCatalogVendor(input, vendors);
  const unknownVendorToken =
    vendorId === null ? leadingCatalogueWord(input, areaPrefixKeys) : null;

  const parts = parseCatalogNumberParts(rest);
  const number = parts ? `${parts.base}${parts.suffix}` : null;
  const droppedPrefix = parts ? normalizeCatalogKey(parts.prefix) : "";
  const numberKey =
    parts && !areaPrefixKeys.has(droppedPrefix) ? normalizeCatalogKey(number ?? "") : null;

  return { input, vendorId, unknownVendorToken, restKey: rest, numberKey, number };
}

/**
 * Every key one stored catalog number answers to, widest first.
 *
 * All three are `catalog-number.ts`'s own spellings of one identity — the full
 * {@link catalogMatchKey} the stamp picker compares by, the same thing without the vendor, and the
 * bare number. They exist as three because the agent's string may carry any of the three heads and
 * the equality test below is exact: `"Mi·PL 200"`, `"PL 200"` and `"200"` are the same stamp asked
 * for three ways, and nothing but the head differs.
 */
export function stampCatalogKeys(
  vendorAbbreviation: string,
  areaPrefix: string | null | undefined,
  number: string
): readonly string[] {
  const keys = [
    catalogMatchKey(vendorAbbreviation, areaPrefix, number),
    normalizeCatalogKey(`${areaPrefix ?? ""}${number}`),
    normalizeCatalogKey(number),
  ];
  return [...new Set(keys.filter((key) => key !== ""))];
}

/**
 * Does a parsed string name this stored number?
 *
 * **Equality, and that is the whole difference from `catalogKeyMatches`.** Search's containment is
 * right for a person reading a result list and wrong here for one reason: `"200"` is inside
 * `"mipl2000"`, `"mipl1200"` and every other number that happens to carry the run, so a resolver
 * built on it would call almost every input ambiguous and the few it did not would be luck.
 */
export function matchesForeignCatalogNumber(
  parsed: ParsedForeignNumber,
  keys: readonly string[]
): boolean {
  if (parsed.restKey !== "" && keys.includes(parsed.restKey)) return true;
  return parsed.numberKey !== null && parsed.numberKey !== "" && keys.includes(parsed.numberKey);
}

/**
 * A cheap necessary condition on a stored number, for narrowing candidates before their area and
 * issue have been read.
 *
 * Both of a stamp's prefixed keys **end with** its bare number key, so a stored number whose bare
 * key is neither the tail of `restKey` nor equal to `numberKey` cannot match under any prefix. It
 * is a filter and never the answer — {@link matchesForeignCatalogNumber} still decides — which is
 * what keeps it from becoming a second matching rule in its own right.
 */
export function couldMatchForeignCatalogNumber(
  parsed: ParsedForeignNumber,
  number: string
): boolean {
  const bare = normalizeCatalogKey(number);
  if (bare === "") return false;
  if (parsed.restKey.endsWith(bare)) return true;
  return parsed.numberKey === bare;
}

/**
 * The verdict, from what the parse found and how many stamps answered.
 *
 * **An unresolved catalogue word is answered before anything is counted**, and that ordering is the
 * decision rather than an implementation detail: an agent that wrote `Fi 456` said *Fischer*, so
 * handing it a `Mi 456` that happens to exist would be the invisible, expensive mistake — it looks
 * exactly like a right answer. The caller therefore does not even look such an entry up; see
 * `operations/catalog.ts`.
 */
export function catalogVerdict(parsed: ParsedForeignNumber, matches: number): CatalogVerdict {
  if (parsed.unknownVendorToken !== null) return "unknown_vendor";
  if (matches === 1) return "resolved";
  if (matches > 1) return "ambiguous";
  return "no_match";
}
