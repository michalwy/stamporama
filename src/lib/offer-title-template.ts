// Pure, Prisma-free title-template engine (#210). A platform carries a free-text template with
// `{tokens}`; rendering it against the copies of an offer (or one set) produces the default listing
// title (#209) or set/lot title. No side effects, so it is unit-tested without a DB and reused
// verbatim by the server domain (`offers.ts`, offer name generation) and the client (compose-set
// dialog title pre-fill).
//
// A token resolves across *all* the copies in scope: distinct non-empty values in first-seen order,
// joined by `/`. `{year}` collapses a set of years to a `min–max` span. A **fallback group**
// `{a|b|c}` renders the first non-empty of its tokens. Unknown fields render empty, and leftover
// separators from empty tokens are tidied so a partial match still reads cleanly.
//
// The same engine renders the longer **listing texts** an offer carries — its description (#266) and
// its seller-only private note (#267) — from their own per-platform templates. Those are multi-line,
// so rendering scope is grouped by `OfferSet` rather than flat: line breaks are preserved, a line
// whose placeholders all came out empty is dropped whole, and the repeating blocks `{#set}…{/set}` /
// `{#copy}…{/copy}` render their body once per set / copy so a description can enumerate a listing.
// `{#conditionLegend}…{/conditionLegend}` / `{#certificateLegend}…{/certificateLegend}` (#318) and
// `{#formatLegend}…{/formatLegend}` (#345) are the
// same mechanism over the *distinct dictionary entries* the copies use, which is how a description
// appends a legend of the abbreviations it just printed — the collector writes the entry's format
// inside the block.
//
// A listing text can also say that a piece was **not identified down to its variant** (#619):
// `{#unknownVariant}…{/unknownVariant}` is the engine's one *conditional* block — it renders its body
// once, over the copies in scope that are unknown-variant umbrellas, and not at all when there are
// none — and `{listedAs}` / `{variants}` name the variant the listing stands under and the ones it
// might actually be. Both arrive as resolved strings on the copy, so the engine still knows nothing
// about the rollup that derived them.
//
// Those texts also carry the one token that is **not** about the copies at all: `{offerUrl}` (#415),
// the offer's own screen on this instance, which reaches the engine through a
// `ListingTemplateContext` rather than through `TitleTemplateCopy`. Everything here stays pure — the
// URL itself is built by the caller (`src/lib/app-url.ts`), so the engine still knows nothing about
// routes or environment.

import { parseCatalogNumberParts, parseSuffixOrdinal } from "./catalog-number";
import {
  formatNumericCatalogRange,
  parseBareRomanNumber,
  CATALOG_RANGE_SEPARATOR,
} from "./catalog-range";
import { formatItemNoDigits, parseItemNoPad } from "./item-number";
import type { TranslatableEntity } from "./translations";

/** One of a copy's catalog numbers, with the parts needed to render it under `{catalog}` options
 * (#210): the vendor's abbreviation (the "catalog prefix", e.g. `Mi`), the per-area prefix (e.g.
 * `PL`), the raw number, and whether this vendor is the copy's area primary. */
export interface TitleCatalogNumber {
  vendorId: string;
  vendorAbbr: string;
  areaPrefix: string | null;
  number: string;
  isPrimary: boolean;
}

/** One copy's title-relevant fields, already normalised from whatever source (server Prisma row or
 * client `ItemListItem`) into plain strings. `null` marks an absent value (skipped in the token). */
export interface TitleTemplateCopy {
  name: string | null;
  /** Every catalog number recorded for the copy, primary vendor first (drives `{catalog[:…]}`). */
  catalogNumbers: TitleCatalogNumber[];
  year: number | null;
  condition: string | null;
  /** Condition abbreviation (e.g. `MNH`). */
  conditionAbbr: string | null;
  certificate: string | null;
  /** Certificate-status abbreviation, or null. */
  certificateAbbr: string | null;
  area: string | null;
  /** Name of the copy's assignable storage location (#56), or null. */
  location: string | null;
  /** Free-text identifier within that location (e.g. `A234`), or null. */
  ref: string | null;
  /** The copy's internal number (#268), or null when the source has none (a sample copy). Carried
   *  as the bare integer so `{itemNo:N}` can re-pad it. */
  itemNo: number | null;
  /** The owning collection's configured display width for `itemNo` — what a bare `{itemNo}` pads
   *  to. It is collection-level rather than per-copy data, but `TitleTemplateCopy` is the engine's
   *  only channel: every copy in a render scope belongs to one collection, so every copy carries
   *  the same value. */
  itemNoPad: number;
  /** The stamp's subtype (#339) — `Error`, `Overprint`… — or null. Null for a base stamp, which has
   * no subtype, **and** for the collection's default subtype: the default is the unmarked case, so
   * `{subtype}` renders empty rather than stamping a redundant "Variant" on every listing. */
  subtype: string | null;
  /** The copy's physical format (#345) — `Block of 4`, `Horizontal pair`… — or **null for a
   * single**, which is most copies (ADR-0020: a null `Item.formatId` *is* the single). The token
   * therefore resolves empty far more often than it resolves, which the existing tidy pass already
   * handles: a line whose placeholders all came out empty is dropped whole, and a separator glued
   * to an emptied slot goes with it. */
  format: string | null;
  /** Format abbreviation (e.g. `Blk4`), or null for a single. */
  formatAbbr: string | null;
  /** What the catalogue states the stamp **is** (#71/#738): its denomination and perforation as
   * printed, and its colour, watermark, paper and printing method as the collection's own
   * dictionaries name them. Six facts about the stamp rather than about the copy, so a second copy
   * of one stamp resolves them identically and `distinct` collapses the pair to one value.
   *
   * Null is the ordinary value on every one of them — most stamps state none — which is why they are
   * safe to put in a template at all: an unstated attribute renders empty and the tidy pass takes
   * the separator that was gluing it in, exactly as `{format}` does for a single. */
  denomination: string | null;
  perforation: string | null;
  /** The four dictionary attributes, resolved in the listing's language like `{subtype}` — a Polish
   * listing says `karminowy` where the collection's own row reads `Carmine`, and an untranslated one
   * is reported as a gap to fill (#298/#299) rather than silently printed in the default language. */
  color: string | null;
  watermark: string | null;
  paper: string | null;
  printing: string | null;
  /** Name of the issue the stamp belongs to (its first membership), or null. */
  issueName: string | null;
  /** Year of that issue, or null. */
  issueYear: number | null;
  /** True when the copy's stamp is an **unknown-variant umbrella** (#238/#239, ADR-0010 §3): it has
   * variant children and which of them this piece is was never identified. A fact about the *goods*,
   * so it holds whatever platform the offer is on — it is what `{#unknownVariant}` tests (#619). */
  unknownVariant: boolean;
  /** What the piece might be: the umbrella's **direct** variant children, already prefixed and
   * collapsed into a range (`Mi·PL 865a-c`) by the caller. Null on anything that is not an umbrella.
   * Direct children rather than every descendant leaf, because *which of these is it* is the question
   * the collector could not answer, and a flattened deep tree names variants nobody was choosing
   * between. */
  variants: string | null;
  /** What the piece is being **sold as**: the variant this listing resolved to (#616's
   * `sourceStampId`), named by its own catalog number with the same prefixes (`Mi·PL 865a`). Null
   * wherever nothing was rolled up — an umbrella matched by hand, a platform that lists against no
   * catalogue at all, a tree that cannot be resolved — which renders the token empty and takes its
   * glue separator with it. */
  listedAs: string | null;
  /** Which of the translatable fields above rendered **untranslated** text for the language the copy
   * was resolved in (#298), and which entity row each one came from (#299). Absent / empty when
   * nothing fell back, which is also the case for a copy resolved without a language. */
  fallbacks?: readonly TitleFallback[];
}

/** One translatable field of one copy that rendered the default language's text (#298), named down
 * to the entity row that would fix it (#299).
 *
 * `field` is the {@link TitleTemplateCopy} key the token renders from (`conditionAbbr`);
 * `entityField` is the translation column on the entity itself (`abbreviation`). They differ because
 * one copy flattens six entities: `{condition}` and `{conditionAbbr}` are both the condition's
 * `name` / `abbreviation`, and `{area}` is a `titleName` possibly inherited from an ancestor area —
 * `entityId` is then that ancestor, the row a translation must actually be written on. */
export interface TitleFallback {
  /** The {@link TitleTemplateCopy} field whose token rendered untranslated text. */
  field: string;
  entityType: TranslatableEntity;
  entityId: string;
  /** The entity's own translatable column, e.g. `name`, `abbreviation`, `titleName`. */
  entityField: string;
  /** The default-language text that rendered — what the missing translation would replace. */
  defaultValue: string;
}

/** The translatable fields of a {@link TitleTemplateCopy} — the ones that can appear in
 * `fallbacks`, keyed by the lower-cased token name that renders them. `{catalog}`, `{year}`,
 * `{issueYear}`, `{location}`, `{ref}`, `{itemNo}`, `{listedAs}` and `{variants}` are not
 * translatable and never flag — the last two are catalog numbers, which no language rewrites. */
const FALLBACK_FIELD_BY_TOKEN: Readonly<Record<string, string>> = {
  name: "name",
  condition: "condition",
  conditionabbr: "conditionAbbr",
  certificate: "certificate",
  certificateabbr: "certificateAbbr",
  area: "area",
  issuename: "issueName",
  subtype: "subtype",
  format: "format",
  formatabbr: "formatAbbr",
  // The four dictionary attributes (#738). `{denomination}` and `{perforation}` are absent on
  // purpose: they are printed as printed and no language rewrites `11½` (#72).
  color: "color",
  watermark: "watermark",
  paper: "paper",
  printing: "printing",
};

/** A token usable in a template, with the label + example the config UI shows as a legend. */
export interface TitleToken {
  token: string;
  label: string;
  example: string;
}

/** The tokens a template may contain (#210). Order is the legend's display order. */
export const AVAILABLE_TITLE_TOKENS: readonly TitleToken[] = [
  { token: "{name}", label: "Stamp name", example: "Mercury" },
  { token: "{catalog}", label: "Catalog number", example: "Mi·PL 200" },
  { token: "{year}", label: "Year", example: "1850" },
  { token: "{condition}", label: "Condition", example: "Mint never hinged" },
  { token: "{conditionAbbr}", label: "Condition (abbr.)", example: "MNH" },
  { token: "{certificate}", label: "Certificate", example: "Photo certificate" },
  { token: "{certificateAbbr}", label: "Certificate (abbr.)", example: "cert." },
  { token: "{area}", label: "Area", example: "Austria" },
  { token: "{location}", label: "Location", example: "Stockbook A" },
  { token: "{ref}", label: "Location ref", example: "A234" },
  { token: "{itemNo}", label: "Copy number", example: "00042" },
  { token: "{issueName}", label: "Issue name", example: "1850 First Issue" },
  { token: "{issueYear}", label: "Issue year", example: "1850" },
  { token: "{subtype}", label: "Subtype", example: "Overprint" },
  { token: "{format}", label: "Format", example: "Block of 4" },
  { token: "{formatAbbr}", label: "Format (abbr.)", example: "Blk4" },
  // What the catalogue says the stamp is (#738). Last in the legend because they are the detail a
  // title reaches for after it has said which stamp this is — and because a template that names all
  // six is a description rather than a title.
  { token: "{denomination}", label: "Denomination", example: "10 gr" },
  { token: "{perforation}", label: "Perforation", example: "11½" },
  { token: "{color}", label: "Colour", example: "Carmine" },
  { token: "{watermark}", label: "Watermark", example: "Lozenges" },
  { token: "{paper}", label: "Paper", example: "Thin paper" },
  { token: "{printing}", label: "Printing method", example: "Photogravure" },
];

/** What a `{offerUrl}` renders as in a template *preview* (#415) and in the token legend: the real
 * URL depends on the instance's own base address and on an offer that does not exist while a
 * template is being written, so the example stands in for both. Shaped exactly like the real thing,
 * so the preview shows how much room a link takes in a description. */
export const EXAMPLE_OFFER_URL = "https://stamporama.example/o/my-collection/42";

/** What a listing text can resolve that is a fact about the **offer** rather than about its copies
 * (#415). Absent — a template preview, or an offer whose row does not exist yet — makes every token
 * in it render empty, which the tidy passes already handle: the glue separator goes with it and a
 * line that said nothing else is dropped whole. */
export interface ListingTemplateContext {
  /** Absolute URL of the offer's own screen on this instance, for `{offerUrl}`. */
  offerUrl?: string | null;
}

/** No offer in hand — the default for every render that is not an offer's own listing text. */
const NO_CONTEXT: ListingTemplateContext = {};

/** Whether `template` actually asks for something only an offer can answer (#415). Lets a caller
 * skip the work of resolving that context — a slug lookup — for the templates that never use it. */
export function templateUsesOfferContext(template: string | null | undefined): boolean {
  return /\{[^{}]*\bofferUrl\b[^{}]*\}/i.test(template ?? "");
}

/** Whether `template` asks which variant the listing resolved to (#619). The same guard
 * {@link templateUsesOfferContext} is: `{listedAs}` is the only one of the three unknown-variant
 * additions whose value is not a fact about the stamp, so it costs a valuation pass (#616's rollup)
 * to answer — and a template that never names it must not pay for one. `{#unknownVariant}` and
 * `{variants}` need no guard: they read the copy's own variant children, which the normalisation
 * already carries. */
export function templateUsesListedAs(template: string | null | undefined): boolean {
  return /\{[^{}]*\blistedAs\b[^{}]*\}/i.test(template ?? "");
}

/** The tokens a **multi-line listing text** may contain (#266/#267) — the title's tokens plus
 * `{setTitle}`, which only names something inside a `{#set}` block (or when the template renders one
 * set's own title); `{listedAs}` / `{variants}` (#619), which say which catalogue entry a piece that
 * was not identified down to its variant is being sold under and which ones it might be; and
 * `{offerUrl}` (#415), which is a fact about the offer rather than its copies: a link on a
 * marketplace page back to the listing's own screen here. None of the four is a title token — a URL
 * is nothing a buyer wants to read in a title, and the variant caveat wants a sentence rather than a
 * fragment of one — so each resolves empty there rather than showing literal braces, exactly as in a
 * preview. */
export const AVAILABLE_LISTING_TOKENS: readonly TitleToken[] = [
  ...AVAILABLE_TITLE_TOKENS,
  { token: "{setTitle}", label: "Set title", example: "Complete series" },
  { token: "{listedAs}", label: "Listed as (variant)", example: "Mi·PL 865a" },
  { token: "{variants}", label: "Possible variants", example: "Mi·PL 865a-c" },
  { token: "{offerUrl}", label: "Offer link", example: EXAMPLE_OFFER_URL },
];

/** The blocks a listing text may use (#266), for the builder's chips: each renders its body once per
 * set / per copy / per distinct dictionary entry in scope — except the last, which repeats nothing
 * and is simply skipped when nothing in scope is an unknown-variant umbrella (#619). */
export const AVAILABLE_LISTING_BLOCKS: readonly { open: string; close: string; label: string }[] = [
  { open: "{#set}", close: "{/set}", label: "Repeat once per set in the offer" },
  { open: "{#copy}", close: "{/copy}", label: "Repeat once per copy (of the enclosing set)" },
  {
    open: "{#conditionLegend}",
    close: "{/conditionLegend}",
    label: "Repeat once per distinct condition used — a legend of abbreviations",
  },
  {
    open: "{#certificateLegend}",
    close: "{/certificateLegend}",
    label: "Repeat once per distinct certificate status used — a legend of abbreviations",
  },
  {
    open: "{#formatLegend}",
    close: "{/formatLegend}",
    label: "Repeat once per distinct format used — singles are not listed",
  },
  {
    open: "{#unknownVariant}",
    close: "{/unknownVariant}",
    label: "Only when a copy's variant was not identified — narrowed to those copies",
  },
];

/** The fallback template when a platform has none set: catalog, name, year, condition. */
export const DEFAULT_TITLE_TEMPLATE = "{catalog} {name} {year} {condition}";

/** Distinct non-empty strings in first-seen order. */
function distinct(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** A set of years across the copies as a compact span: a single year, or `min–max` (en dash) when
 * several. `pick` selects which year field (stamp year vs issue year). */
function yearSpan(
  copies: readonly TitleTemplateCopy[],
  pick: (c: TitleTemplateCopy) => number | null
): string {
  const years = copies.map(pick).filter((y): y is number => typeof y === "number");
  if (years.length === 0) return "";
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

/** Select which of a copy's catalog numbers a `{catalog:VENDORS}` argument asks for: `*` → all;
 * empty → the area primary only (else the first recorded); otherwise the vendors whose abbreviation
 * matches one of the comma-listed ones, in the order listed. */
function selectCatalogNumbers(copy: TitleTemplateCopy, vendorsArg: string): TitleCatalogNumber[] {
  const arg = vendorsArg.trim();
  if (arg === "*") return copy.catalogNumbers;
  if (arg === "") {
    const primary = copy.catalogNumbers.find((c) => c.isPrimary) ?? copy.catalogNumbers[0];
    return primary ? [primary] : [];
  }
  const wanted = arg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: TitleCatalogNumber[] = [];
  for (const w of wanted) {
    for (const cn of copy.catalogNumbers) {
      if (cn.vendorAbbr.toLowerCase() === w) out.push(cn);
    }
  }
  return out;
}

/** The prefix "head" a catalog number renders under the flags: `vendor` prepends the vendor
 * abbreviation, `area` the per-area prefix (joined `Mi·PL`), matching the app's catalog identity.
 * With neither flag (or an absent area prefix) the corresponding part is dropped; `""` = bare. */
function catalogHead(vendorAbbr: string, areaPrefix: string | null, flags: ReadonlySet<string>): string {
  const showVendor = flags.has("vendor");
  const showArea = flags.has("area") && !!areaPrefix;
  if (showVendor && showArea) return `${vendorAbbr}·${areaPrefix}`;
  if (showVendor) return vendorAbbr;
  if (showArea) return areaPrefix!;
  return "";
}

/** Compact a group's catalog numbers into a range list (#210, #286, #364). Both axes of #150's
 * numbering collapse, in that order:
 *
 * 1. **Base** — numbers are bucketed by their numbering family (the constant prefix + suffix around
 *    the digits, as `parseCatalogNumberParts` splits them) and within each family consecutive base
 *    numbers collapse to `from-to`. So `1,2,4,6,7,8` reads `1-2,4,6-8`, and `BL31,BL32,BL33` reads
 *    `BL31-33`: the shared prefix and suffix are written **once**, around the collapsed span. The
 *    span itself is written by the shared range formatter (`formatNumericCatalogRange`, #400), so the
 *    end drops the digits it shares with the start — `1298,…,1302` reads `1298-302`.
 * 2. **Suffix** — what is left standing alone after (1) then folds the other way: same prefix and
 *    same base, consecutive suffixes in one sequence, and only the suffix is written twice —
 *    `BL92a,BL92b` reads `BL92a-b`. The sequences are the ones an auto-generate range enumerates
 *    (`parseSuffixOrdinal`: letters `a`–`z`, Roman numerals), so `1294CKB,1296KB` still cannot fold.
 *
 * 3. **Roman numerals** (#384, #426) — a number numbered with a numeral (`I`, `II`, `III`; #383)
 *    carries no digit run, so it never reaches (1) and would list one by one. The numeral stands
 *    where the base does and folds on the **same two axes**, keyed on the constant text in front of
 *    it (`Mi·PL I`–`Mi·PL III` → `Mi·PL I-III`), which is what keeps two catalogues from merging
 *    where the caller passes prefixed numbers (#353): the numeral itself first — a constant letter
 *    suffix riding along and written at both ends, `IA,IIA,IIIA` → `IA-IIIA` — and then the suffix
 *    on one numeral, `IA,IB,IC` → `IA-C`.
 *
 * Entries are emitted in first-seen order, and a number without a digit run at all (e.g. `Ark.`) is
 * kept verbatim at the end, after the numeric families. All comma-joined; duplicates dropped.
 *
 * Exported for the derived **auction lot** name (#353): a house lot is "Mi 1-12" whether it is being
 * listed or bid on, and two implementations of #150's collapsing would drift. */
export function compactCatalogNumbers(numbers: readonly string[]): string {
  interface Family {
    prefix: string;
    suffix: string;
    bases: number[];
    seen: Set<number>;
  }
  const families = new Map<string, Family>();
  const order: string[] = [];
  /** Digit-less numbers, in first-seen order — a bare Roman numeral carries what pass 3 folds on. */
  const others: { text: string; roman: ReturnType<typeof parseBareRomanNumber> }[] = [];
  const seenOther = new Set<string>();
  for (const n of numbers) {
    const parts = parseCatalogNumberParts(n);
    if (!parts) {
      const t = n.trim();
      if (t && !seenOther.has(t)) {
        seenOther.add(t);
        others.push({ text: t, roman: parseBareRomanNumber(t) });
      }
      continue;
    }
    const key = `${parts.prefix} ${parts.suffix}`;
    let f = families.get(key);
    if (!f) {
      f = { prefix: parts.prefix, suffix: parts.suffix, bases: [], seen: new Set() };
      families.set(key, f);
      order.push(key);
    }
    const v = parseInt(parts.base, 10);
    if (!f.seen.has(v)) {
      f.seen.add(v);
      f.bases.push(v);
    }
  }

  // Pass 1 — consecutive base runs within each family, in the order the families were first seen.
  interface Span {
    prefix: string;
    suffix: string;
    from: number;
    to: number;
    /** Emit position, so the suffix pass below can fold entries together without reordering them. */
    order: number;
  }
  const spans: Span[] = [];
  for (const key of order) {
    const f = families.get(key)!;
    f.bases.sort((a, b) => a - b);
    for (let i = 0; i < f.bases.length; ) {
      let j = i;
      while (j + 1 < f.bases.length && f.bases[j + 1] === f.bases[j] + 1) j++;
      spans.push({
        prefix: f.prefix,
        suffix: f.suffix,
        from: f.bases[i],
        to: f.bases[j],
        order: spans.length,
      });
      i = j + 1;
    }
  }

  // Pass 2 — fold what stayed single the other way (#364): one base, one prefix, a suffix that is
  // part of a sequence. A span that already collapsed a base run is left alone: `BL31-33a` and
  // `BL31-33b` describe two runs, not one, and folding them would claim a span nothing in the offer
  // covers.
  const foldable = new Map<string, Span[]>();
  const emitted: { order: number; text: string }[] = [];
  for (const s of spans) {
    const ordinal = s.from === s.to ? parseSuffixOrdinal(s.suffix) : null;
    if (!ordinal) {
      // The span's own notation is the shared range formatter's (#400), so a collapsed run reads
      // `1298-302` here exactly as it does on an issue's catalog chip.
      emitted.push({
        order: s.order,
        text: formatNumericCatalogRange(s.prefix, String(s.from), String(s.to), s.suffix),
      });
      continue;
    }
    const key = `${s.prefix}\u0000${s.from}\u0000${ordinal.kind}`;
    const group = foldable.get(key);
    if (group) group.push(s);
    else foldable.set(key, [s]);
  }
  for (const group of foldable.values()) {
    const byOrdinal = group
      .map((s) => ({ span: s, ordinal: parseSuffixOrdinal(s.suffix)!.value }))
      .sort((a, b) => a.ordinal - b.ordinal);
    for (let i = 0; i < byOrdinal.length; ) {
      let j = i;
      while (j + 1 < byOrdinal.length && byOrdinal[j + 1].ordinal === byOrdinal[j].ordinal + 1) j++;
      const first = byOrdinal[i].span;
      const last = byOrdinal[j].span;
      const suffix =
        i === j ? first.suffix : `${first.suffix}${CATALOG_RANGE_SEPARATOR}${last.suffix}`;
      emitted.push({
        // Where the run's earliest member stood — the fold never moves a number past another.
        order: Math.min(...byOrdinal.slice(i, j + 1).map((e) => e.span.order)),
        text: `${first.prefix}${first.from}${suffix}`,
      });
      i = j + 1;
    }
  }
  emitted.sort((a, b) => a.order - b.order);

  // Pass 3 — fold Roman numerals (#384, #426). A number whose numbering is a numeral carries no
  // digit run, so it never reaches (1) or (2) and would list one by one. It folds on the **same two
  // axes in the same order**, with the numeral standing where the base does: first consecutive
  // numerals under a constant prefix + constant suffix (`IA,IIA,IIIA` → `IA-IIIA`), then — over what
  // stayed single — a suffix sequence on one numeral (`IA,IB,IC` → `IA-C`). A run is written from the
  // numerals as recorded and emitted where its earliest member stood, so the digit-less tail keeps
  // its order and anything that isn't a numeral passes through untouched.
  interface RomanEntry {
    index: number;
    prefix: string;
    numeral: string;
    value: number;
    suffix: string;
  }
  const runs = new Map<number, string>();
  const folded = new Set<number>();
  const emitRun = (members: RomanEntry[], text: string) => {
    const at = Math.min(...members.map((m) => m.index));
    runs.set(at, text);
    for (const m of members) if (m.index !== at) folded.add(m.index);
  };

  // 3a — the numeral axis. A constant suffix rides along untouched, and is written at **both** ends
  // (`IA-IIIA`) rather than once: a numeral and a letter suffix are both letters, so `I-IIIA` would
  // read as a bare-numeral span with a stray letter hung off it.
  const romanSingles: RomanEntry[] = [];
  const byNumbering = new Map<string, RomanEntry[]>();
  others.forEach((o, index) => {
    if (!o.roman) return;
    const entry: RomanEntry = { index, ...o.roman };
    const key = `${entry.prefix}\u0000${entry.suffix}`;
    const group = byNumbering.get(key);
    if (group) group.push(entry);
    else byNumbering.set(key, [entry]);
  });
  for (const group of byNumbering.values()) {
    group.sort((a, b) => a.value - b.value);
    for (let i = 0; i < group.length; ) {
      let j = i;
      while (j + 1 < group.length && group[j + 1].value === group[j].value + 1) j++;
      if (i === j) {
        romanSingles.push(group[i]);
      } else {
        const { prefix, suffix } = group[i];
        emitRun(
          group.slice(i, j + 1),
          `${prefix}${group[i].numeral}${suffix}${CATALOG_RANGE_SEPARATOR}${group[j].numeral}${suffix}`
        );
      }
      i = j + 1;
    }
  }

  // 3b — the suffix axis over what stayed single, keyed on one numeral. A suffix that is part of no
  // sequence (an empty one above all, which is every bare numeral) has nothing to fold on and is left
  // for the tail to write out as recorded.
  const bySuffixFamily = new Map<string, { entry: RomanEntry; ordinal: number }[]>();
  for (const single of romanSingles) {
    const ordinal = parseSuffixOrdinal(single.suffix);
    if (!ordinal) continue;
    const key = `${single.prefix}\u0000${single.numeral}\u0000${ordinal.kind}`;
    const group = bySuffixFamily.get(key);
    if (group) group.push({ entry: single, ordinal: ordinal.value });
    else bySuffixFamily.set(key, [{ entry: single, ordinal: ordinal.value }]);
  }
  for (const group of bySuffixFamily.values()) {
    group.sort((a, b) => a.ordinal - b.ordinal);
    for (let i = 0; i < group.length; ) {
      let j = i;
      while (j + 1 < group.length && group[j + 1].ordinal === group[j].ordinal + 1) j++;
      if (i === j) {
        i = j + 1;
        continue;
      }
      const first = group[i].entry;
      emitRun(
        group.slice(i, j + 1).map((e) => e.entry),
        `${first.prefix}${first.numeral}${first.suffix}${CATALOG_RANGE_SEPARATOR}${group[j].entry.suffix}`
      );
      i = j + 1;
    }
  }
  const tail = others.flatMap((o, index) =>
    folded.has(index) ? [] : [runs.get(index) ?? o.text]
  );

  return [...emitted.map((e) => e.text), ...tail].join(",");
}

/** One catalog number as {@link compactCatalogNumberGroups} groups it: which vendor recorded it,
 * how that vendor's numbers are prefixed in the stamp's area, and the number itself. */
export interface CatalogNumberGroupEntry {
  vendorId: string;
  vendorAbbr: string;
  areaPrefix: string | null;
  number: string;
}

/**
 * Group catalog numbers by vendor (+ area prefix), compact each group into ranges and write the
 * prefix once around it — `Mi·DR 1-2,4,6-10 / Fi 3-5`. Groups keep first-seen order.
 *
 * Exported for the derived **offer set** label (#379), which is the same question `{catalog}` asks:
 * a set of bare numbers joined by `+` names no catalogue at all, and two implementations of the
 * prefix-and-collapse rule would drift the way #353's did. `flags` picks which prefixes show, as
 * {@link catalogHead} defines them; omitted means both.
 */
export function compactCatalogNumberGroups(
  entries: readonly CatalogNumberGroupEntry[],
  flags: ReadonlySet<string> = new Set(["vendor", "area"])
): string {
  const groups = new Map<string, { vendorAbbr: string; areaPrefix: string | null; numbers: string[] }>();
  const order: string[] = [];
  for (const cn of entries) {
    const key = `${cn.vendorId}\u0000${cn.areaPrefix ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { vendorAbbr: cn.vendorAbbr, areaPrefix: cn.areaPrefix, numbers: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.numbers.push(cn.number);
  }

  const parts: string[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    const nums = compactCatalogNumbers(g.numbers);
    if (!nums) continue;
    const head = catalogHead(g.vendorAbbr, g.areaPrefix, flags);
    parts.push(head ? `${head} ${nums}` : nums);
  }
  return parts.join(" / ");
}

/** Normalise one prefix flag to its canonical name, accepting short forms: `v` → `vendor`,
 * `a` → `area`. Anything else is passed through (an unknown flag simply matches nothing). */
function canonicalFlag(flag: string): string {
  if (flag === "v") return "vendor";
  if (flag === "a") return "area";
  return flag;
}

/** Resolve `{catalog[:VENDORS[:FLAGS]]}` across the copies. VENDORS picks which vendors' numbers
 * appear (see {@link selectCatalogNumbers}); FLAGS (`vendor`/`v`, `area`/`a`) pick which prefixes
 * show. When the FLAGS segment is **omitted**, both prefixes are shown (the configured default); an
 * **empty** FLAGS segment (`{catalog:Mi:}`) means the bare number. Numbers of the same vendor (+area
 * prefix) are grouped and **compacted into ranges** (`Mi·DR 1-2,4,6-10`); groups join with ` / `. */
function resolveCatalog(copies: readonly TitleTemplateCopy[], params: string[]): string {
  const vendorsArg = params[0] ?? "";
  const flags =
    params.length >= 2
      ? new Set(params[1].split(",").map((s) => canonicalFlag(s.trim().toLowerCase())).filter(Boolean))
      : new Set(["vendor", "area"]); // FLAGS omitted → both prefixes (the default)

  return compactCatalogNumberGroups(
    copies.flatMap((copy) => selectCatalogNumbers(copy, vendorsArg)),
    flags
  );
}

/** Resolve `{itemNo[:WIDTH]}` across the copies: each copy's own number, zero-padded to WIDTH when
 * given and usable, else to the collection's configured width. Distinct values joined like every
 * other per-copy token, so inside a `{#copy}` block it is one number and across a whole offer it
 * lists them. */
function resolveItemNo(copies: readonly TitleTemplateCopy[], widthArg: string | undefined): string {
  const override = widthArg === undefined ? null : parseItemNoPad(widthArg);
  return distinct(
    copies.map((c) =>
      c.itemNo === null ? null : formatItemNoDigits(c.itemNo, override ?? c.itemNoPad)
    )
  ).join(" / ");
}

/** Resolve one token spec (without braces), e.g. `name` or `catalog:Mi,Sc:vendor`. Returns the
 * rendered value (possibly `""` when absent), or `null` when the token name is not known.
 * `setTitle` is the enclosing set's title, which only `{setTitle}` reads (null outside a set);
 * `context` carries the offer-level facts (#415), which no copy can answer. */
function resolveTokenValue(
  spec: string,
  copies: readonly TitleTemplateCopy[],
  setTitle: string | null,
  context: ListingTemplateContext,
  listingText: boolean
): string | null {
  const segments = spec.split(":");
  const name = segments[0].trim().toLowerCase();
  switch (name) {
    case "settitle":
      return setTitle?.trim() ?? "";
    // Known everywhere so a `{offerUrl}` never shows up as literal braces in a title or a preview —
    // it simply has nothing to render there, like a certificate token on a copy without one.
    case "offerurl":
      return context.offerUrl?.trim() ?? "";
    // Known everywhere for the same reason (#619), and **blank outside a listing text**: unlike
    // `{offerUrl}`, whose value simply is not there in a title, theirs rides on the copy and would
    // otherwise render — see {@link TemplateScope.listingText} for why a title must not print it.
    // Both are catalog numbers already prefixed and collapsed by the caller, so they join across
    // copies exactly as `{catalog}`'s groups do: two umbrellas in one offer name two ranges, and two
    // copies of one umbrella name it once.
    case "listedas":
      return listingText ? distinct(copies.map((c) => c.listedAs)).join(" / ") : "";
    case "variants":
      return listingText ? distinct(copies.map((c) => c.variants)).join(" / ") : "";
    case "name":
      return distinct(copies.map((c) => c.name)).join(" / ");
    case "catalog":
      return resolveCatalog(copies, segments.slice(1));
    case "year":
      return yearSpan(copies, (c) => c.year);
    case "condition":
      return distinct(copies.map((c) => c.condition)).join(" / ");
    case "conditionabbr":
      return distinct(copies.map((c) => c.conditionAbbr)).join(" / ");
    case "certificate":
      return distinct(copies.map((c) => c.certificate)).join(" / ");
    case "certificateabbr":
      return distinct(copies.map((c) => c.certificateAbbr)).join(" / ");
    case "area":
      return distinct(copies.map((c) => c.area)).join(" / ");
    case "location":
      return distinct(copies.map((c) => c.location)).join(" / ");
    case "ref":
      return distinct(copies.map((c) => c.ref)).join(" / ");
    // `{itemNo}` pads to the collection's configured width, `{itemNo:N}` to N — a listing that
    // wants `42` rather than `00042` says so in the template. No `#`: a template is literal text,
    // so a collector who wants one types it. An unusable argument falls back to the collection
    // width rather than rendering nothing, like every other unrecognised token argument.
    case "itemno":
      return resolveItemNo(copies, segments[1]);
    case "issuename":
      return distinct(copies.map((c) => c.issueName)).join(" / ");
    case "subtype":
      return distinct(copies.map((c) => c.subtype)).join(" / ");
    // A batch mixing a pair and two singles renders just "Horizontal pair" — `distinct` drops the
    // singles' nulls, exactly as `{certificate}` handles copies without a certificate. Two
    // different multiples join with `/`, like every other per-copy token.
    case "format":
      return distinct(copies.map((c) => c.format)).join(" / ");
    case "formatabbr":
      return distinct(copies.map((c) => c.formatAbbr)).join(" / ");
    // The six catalogue attributes (#738), each the plain per-copy token every other stamp fact is:
    // one value for one stamp, joined by `/` across a mixed offer, and empty for the stamps that
    // state nothing — which is most of them, and which the tidy pass is already there for.
    case "denomination":
      return distinct(copies.map((c) => c.denomination)).join(" / ");
    case "perforation":
      return distinct(copies.map((c) => c.perforation)).join(" / ");
    case "color":
      return distinct(copies.map((c) => c.color)).join(" / ");
    case "watermark":
      return distinct(copies.map((c) => c.watermark)).join(" / ");
    case "paper":
      return distinct(copies.map((c) => c.paper)).join(" / ");
    case "printing":
      return distinct(copies.map((c) => c.printing)).join(" / ");
    case "issueyear":
      return yearSpan(copies, (c) => c.issueYear);
    default:
      return null;
  }
}

/** The {@link TitleTemplateCopy} field a token spec renders from, or null when the token is not
 * translatable (`{catalog}`, `{year}`, …) and so can never flag. */
function tokenField(spec: string): string | null {
  return FALLBACK_FIELD_BY_TOKEN[spec.split(":")[0].trim().toLowerCase()] ?? null;
}

/** The fallbacks the token `spec` renders across the copies in scope (#298) — empty when the token
 * is untranslatable or every copy's value really is translated. */
function tokenFallbacks(spec: string, copies: readonly TitleTemplateCopy[]): TitleFallback[] {
  const field = tokenField(spec);
  if (!field) return [];
  return copies.flatMap((c) => (c.fallbacks ?? []).filter((f) => f.field === field));
}

/** A resolved placeholder: its rendered text, which token produced it (the winning alternative of a
 * fallback group), and the untranslated entity text it rendered, if any. */
interface ResolvedPlaceholder {
  value: string;
  /** The token spec that produced `value`, or null for an empty / unknown placeholder. */
  spec: string | null;
  fellBack: boolean;
  /** The entity fields behind `fellBack` (#299) — empty whenever `fellBack` is false. */
  fallbacks: readonly TitleFallback[];
}

/**
 * Resolve the contents of one `{...}` placeholder. A plain `{token}` renders that token (an unknown
 * key keeps its literal `{token}` so a typo stays visible). A **fallback group** `{a|b|c}` renders
 * the **first non-empty** of its tokens — e.g. `{issueName|name|catalog}` — and empty when every
 * alternative is empty. Unknown keys inside a group are simply skipped.
 */
function resolvePlaceholder(
  inner: string,
  copies: readonly TitleTemplateCopy[],
  setTitle: string | null = null,
  context: ListingTemplateContext = NO_CONTEXT,
  listingText = false
): ResolvedPlaceholder {
  const parts = inner.split("|").map((p) => p.trim());
  const resolved = (value: string, spec: string): ResolvedPlaceholder => {
    const fallbacks = value ? tokenFallbacks(spec, copies) : [];
    return { value, spec, fellBack: fallbacks.length > 0, fallbacks };
  };
  if (parts.length === 1) {
    const v = resolveTokenValue(parts[0], copies, setTitle, context, listingText);
    // unknown → literal (no token produced it); known → value (maybe "")
    if (v === null) return { value: `{${parts[0]}}`, spec: null, fellBack: false, fallbacks: [] };
    return resolved(v, parts[0]);
  }
  for (const p of parts) {
    const v = resolveTokenValue(p, copies, setTitle, context, listingText);
    // first non-empty (skips unknown → null and empty → "")
    if (v) return resolved(v, p);
  }
  return { value: "", spec: null, fellBack: false, fallbacks: [] };
}

/** Markers left in the rendered string before it is tidied. {@link EMPTY_MARK} stands in for a
 * placeholder that resolved to nothing, so {@link tidyLine} strips only the separators that were
 * gluing *that* empty slot to its neighbour — never a literal separator the user put between two
 * values that are present. {@link VALUE_MARK} prefixes every value that *did* resolve, which is how
 * {@link tidyMultiline} tells a line whose placeholders all came out empty (scaffolding, dropped)
 * from a purely literal line (kept). Both are control characters that never occur in real data. */
const EMPTY_MARK = "\u0000";
const VALUE_MARK = "\u0003";

/** Collapse whitespace, trim, and remove only the dangling glue an **empty** placeholder left
 * behind: a separator (`- – · / , : ; =`) that sat directly next to the emptied slot, and any now-empty
 * `()` / `[]`. A separator between two present values carries no marker, so it is kept verbatim.
 * Runs over the whole render for a one-line title, and line by line for a multi-line text. */
function tidyLine(rendered: string): string {
  return rendered
    // An empty slot *between* two separators keeps the first one (with its original spacing) and
    // loses the second — `{name} - {certificate} - {year}` must not collapse to `Mercury1850`.
    .replace(/(\s*[-–·/,:;=]\s*)\u0000\s*[-–·/,:;=]\s*/g, "$1")
    // Otherwise drop a separator immediately before an empty slot, then one immediately after it.
    .replace(/\s*[-–·/,:;=]\s*\u0000/g, EMPTY_MARK)
    .replace(/\u0000\s*[-–·/,:;=]\s*/g, EMPTY_MARK)
    .replace(/[\u0000\u0003]/g, "") // remove the markers themselves
    .replace(/\(\s*\)/g, "") // empty parens left by an emptied token
    .replace(/\[\s*\]/g, "") // empty brackets
    .replace(/\s+([)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** {@link tidyLine} per line, for a multi-line listing text (#266/#267). Newlines the collector
 * wrote are structure, so two extra rules keep a paragraph reading well when tokens come out empty:
 *
 * - a line carrying placeholders that **all** resolved empty is dropped whole, taking its literal
 *   scaffolding with it — `Condition: {condition}` leaves no bare `Condition:` behind;
 * - a line with no placeholders at all, including a deliberately blank paragraph separator, is kept
 *   as written, and a kept line's leading indentation survives the per-line trim (list markers).
 */
function tidyMultiline(rendered: string): string {
  const out: string[] = [];
  for (const line of rendered.split("\n")) {
    if (line.includes(EMPTY_MARK) && !line.includes(VALUE_MARK)) continue;
    const indent = /^[ \t]*/.exec(line)![0];
    const tidied = tidyLine(line);
    out.push(tidied ? indent + tidied : "");
  }
  return out.join("\n").trim();
}

// ── Scope + repeating blocks (#266) ──────────────────────────────────────────

/** One atomic sellable unit in template scope: a set's own title plus the copies it holds (an
 * `OfferSet`, ADR-0013). Title generation renders over a single anonymous set; an offer description
 * renders over all of them and a `{#set}` block iterates them. */
export interface TemplateSet {
  title: string | null;
  copies: readonly TitleTemplateCopy[];
}

/** What tokens resolve against at one point in the template: the sets a `{#set}` block would
 * iterate, every copy currently in scope (what a plain token aggregates over), and the enclosing
 * set's title (read only by `{setTitle}`). The offer-level `context` (#415) is the one part that
 * never narrows — a block iterates copies, and which offer this is does not change inside one. */
interface TemplateScope {
  sets: readonly TemplateSet[];
  copies: readonly TitleTemplateCopy[];
  setTitle: string | null;
  context: ListingTemplateContext;
  /** Whether this render is a **multi-line listing text** (#266/#267) rather than a one-line title.
   * Only the unknown-variant tokens read it (#619): unlike `{offerUrl}`, whose value simply is not
   * there in a title, theirs rides on the copy and would otherwise render — and a variant caveat
   * belongs in a sentence, not in the line a buyer scans. A range in a title would be worse than
   * noise: `Mi 865a-c` there reads as a span the listing holds. So a title renders them empty, and
   * they are absent from {@link AVAILABLE_TITLE_TOKENS} for the same reason. */
  listingText: boolean;
}

/** What a block iterates: the offer's sets, the copies in scope, or — for a legend of
 * abbreviations (#318) — the distinct conditions / certificate statuses those copies use. The legend
 * blocks are named `…Legend` rather than after the dictionary itself so `{#conditionLegend}` cannot
 * be misread as the `{condition}` token it is normally wrapped around.
 *
 * `unknownVariant` (#619) is the one that iterates nothing: it renders **once or not at all**, which
 * is what makes it the engine's only conditional. It is named after the state the rest of the app
 * calls by that name (#238/#239) rather than after what it does, so a collector reading a template
 * meets one word for one thing. */
type BlockOver =
  | "set"
  | "copy"
  | "conditionLegend"
  | "certificateLegend"
  | "formatLegend"
  | "unknownVariant";

/** The legend blocks, and which pair of {@link TitleTemplateCopy} fields each iterates. */
type LegendOver = "conditionLegend" | "certificateLegend" | "formatLegend";

/** A parsed template: literal runs (still carrying `{token}` placeholders) and repeating blocks. */
type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "block"; over: BlockOver; body: TemplateNode[] };

const BLOCK_TAGS: readonly BlockOver[] = [
  "set",
  "copy",
  "conditionLegend",
  "certificateLegend",
  "formatLegend",
  "unknownVariant",
];

const BLOCK_TAG_RE = new RegExp(`\\{(${BLOCK_TAGS.map((t) => `#${t}|/${t}`).join("|")})\\}`, "g");

/**
 * Split the repeating blocks `{#set}…{/set}` / `{#copy}…{/copy}` (#266) out of a template, leaving
 * everything else as text runs. Returns null when the tags are unbalanced or mismatched — the caller
 * then renders the template as one plain text run, so a stray `{#set}` shows up literally exactly as
 * an unknown `{token}` does, keeping the typo visible instead of silently eating the body.
 */
function parseTemplateNodes(template: string): TemplateNode[] | null {
  const root: TemplateNode[] = [];
  const stack: { over: BlockOver; body: TemplateNode[] }[] = [];
  const push = (node: TemplateNode) => (stack.length > 0 ? stack[stack.length - 1].body : root).push(node);
  let last = 0;
  for (const m of template.matchAll(BLOCK_TAG_RE)) {
    const text = template.slice(last, m.index);
    if (text) push({ kind: "text", text });
    last = m.index + m[0].length;
    const tag = m[1];
    const over = tag.slice(1) as BlockOver;
    if (tag.startsWith("#")) {
      stack.push({ over, body: [] });
    } else {
      const open = stack.pop();
      if (!open || open.over !== over) return null;
      // After the pop, `push` targets the parent — which is where the finished block belongs.
      push({ kind: "block", over: open.over, body: open.body });
    }
  }
  if (stack.length > 0) return null;
  const tail = template.slice(last);
  if (tail) push({ kind: "text", text: tail });
  return root;
}

/** Substitute the `{...}` placeholders of one text run against `scope`, marking each result so the
 * tidy passes can tell empty from present (see {@link EMPTY_MARK} / {@link VALUE_MARK}) and
 * fallen-back text from translated ({@link FB_OPEN}). An unknown token keeps its literal braces and
 * stays unmarked — it is authoring feedback, not a value. */
function renderTextRun(text: string, scope: TemplateScope): string {
  return text.replace(/\{([^{}]+)\}/g, (_m, inner: string) => {
    const { value, spec, fellBack } = resolvePlaceholder(
      inner,
      scope.copies,
      scope.setTitle,
      scope.context,
      scope.listingText
    );
    if (value === "") return EMPTY_MARK;
    if (spec === null) return value; // unknown token → literal
    // A fallen-back value carries the copy field that produced it, so the preview can offer to fix
    // that very token (#300) — see {@link FB_FIELD}.
    const field = fellBack ? tokenField(spec) : null;
    return VALUE_MARK + (field ? `${FB_OPEN}${field}${FB_FIELD}${value}${FB_CLOSE}` : value);
  });
}

/** Whether a rendered fragment carries no actual text — only markers and whitespace. An iteration of
 * a repeating block that renders blank contributes nothing, so a set with nothing to say leaves no
 * stray line behind. */
function isBlankRender(rendered: string): boolean {
  return rendered.replace(/[\u0000-\u0004]/g, "").trim() === "";
}

/** The (full name, abbreviation) pair of {@link TitleTemplateCopy} fields each legend block reads
 * off a copy. */
const LEGEND_FIELDS: Readonly<Record<LegendOver, readonly [string, string]>> = {
  conditionLegend: ["condition", "conditionAbbr"],
  certificateLegend: ["certificate", "certificateAbbr"],
  formatLegend: ["format", "formatAbbr"],
};

/** The dictionary entry one copy contributes to a legend block (#318, #345): the (full name,
 * abbreviation) pair, as a key that de-duplicates the copies using it. Null when the copy records
 * neither — it has nothing to explain and is left out of the legend. That is exactly what keeps
 * **singles** out of `{#formatLegend}`: a single carries no format, the way a copy without a
 * certificate carries no certificate entry. */
function legendKey(copy: TitleTemplateCopy, over: LegendOver): string | null {
  const [nameField, abbrField] = LEGEND_FIELDS[over];
  const fields = copy as unknown as Record<string, string | null | undefined>;
  const name = fields[nameField]?.trim() ?? "";
  const abbr = fields[abbrField]?.trim() ?? "";
  return name || abbr ? `${name}\u0000${abbr}` : null;
}

/** One scope per distinct condition / certificate status / format used by the copies in `scope`
 * (#318, #345), in
 * first-seen order. Each narrows the scope to exactly the copies carrying that entry, so inside the
 * block `{condition}` / `{conditionAbbr}` name that one entry — and every other token (`{catalog}`,
 * `{year}`, a nested `{#copy}`) describes the copies it applies to, which is what makes the block a
 * legend the collector formats themselves rather than a fixed `ABBR = Name` string. */
function legendScopes(scope: TemplateScope, over: LegendOver): TemplateScope[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const c of scope.copies) {
    const key = legendKey(c, over);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys.map((key) => {
    const sets = scope.sets
      .map((s) => ({ title: s.title, copies: s.copies.filter((c) => legendKey(c, over) === key) }))
      .filter((s) => s.copies.length > 0);
    return {
      sets,
      copies: sets.flatMap((s) => [...s.copies]),
      setTitle: scope.setTitle,
      context: scope.context,
      listingText: scope.listingText,
    };
  });
}

/** Narrow `scope` to the copies whose variant was never identified (#619), as the **one** iteration
 * `{#unknownVariant}` renders — or none at all, which is how the block comes out as a conditional
 * rather than a repeat.
 *
 * One rule covers both places a template puts it. At description level the scope is every copy of the
 * offer, so the body renders once for all the umbrellas together and `{variants}` lists each of their
 * ranges. Inside `{#copy}` the scope is already a single copy, so the same rule renders the body once
 * for a copy that qualifies and skips it for one that does not — which is the per-copy caveat, without
 * a second kind of block to explain it.
 *
 * Narrowing rather than merely testing is what makes the body worth writing: `{catalog}`, `{listedAs}`
 * and `{variants}` inside it describe exactly the pieces the caveat is about, never the identified
 * ones standing beside them in the same listing. That is `legendScopes`' rule, for the same reason.
 *
 * Outside a listing text it renders nothing at all, its tokens' rule exactly: the caveat is a
 * sentence, and there is no room for one in a title. */
function unknownVariantScopes(scope: TemplateScope): TemplateScope[] {
  if (!scope.listingText) return [];
  const sets = scope.sets
    .map((s) => ({ title: s.title, copies: s.copies.filter((c) => c.unknownVariant) }))
    .filter((s) => s.copies.length > 0);
  if (sets.length === 0) return [];
  return [
    {
      sets,
      copies: sets.flatMap((s) => [...s.copies]),
      setTitle: scope.setTitle,
      context: scope.context,
      listingText: scope.listingText,
    },
  ];
}

/** Render parsed nodes against `scope`. A `{#set}` block re-renders its body once per set in scope,
 * with tokens narrowed to that set's copies; a `{#copy}` block once per copy in scope — nested in a
 * set block that means that set's copies, at the top level every copy of the offer. The legend blocks
 * `{#conditionLegend}` / `{#certificateLegend}` (#318) / `{#formatLegend}` (#345) repeat once per
 * distinct dictionary entry the copies use, narrowed to the copies using it; `{#unknownVariant}`
 * (#619) renders once, narrowed to the copies whose variant was never identified, or not at all. */
function renderNodes(nodes: readonly TemplateNode[], scope: TemplateScope): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += renderTextRun(node.text, scope);
      continue;
    }
    const iterations: TemplateScope[] =
      node.over === "set"
        ? scope.sets.map((s) => ({
            sets: [s],
            copies: s.copies,
            setTitle: s.title,
            context: scope.context,
            listingText: scope.listingText,
          }))
        : node.over === "unknownVariant"
          ? unknownVariantScopes(scope)
          : node.over in LEGEND_FIELDS
          ? legendScopes(scope, node.over as LegendOver)
          : scope.copies.map((c) => ({
              sets: [{ title: scope.setTitle, copies: [c] }],
              copies: [c],
              setTitle: scope.setTitle,
              context: scope.context,
              listingText: scope.listingText,
            }));
    for (const iteration of iterations) {
      const body = renderNodes(node.body, iteration);
      if (!isBlankRender(body)) out += body;
    }
  }
  return out;
}

/** The top-level scope for a render: plain tokens aggregate over every copy of every set. */
function rootScope(
  sets: readonly TemplateSet[],
  context: ListingTemplateContext = NO_CONTEXT,
  listingText = false
): TemplateScope {
  return {
    sets,
    copies: sets.flatMap((s) => [...s.copies]),
    context,
    listingText,
    // `{setTitle}` outside a block only names something when the render *is* one set (generating a
    // set's own title); across several sets there is no single title to use.
    setTitle: sets.length === 1 ? sets[0].title : null,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** One run of a rendered text: `fellBack` marks text that came from a token resolved in the
 * default language because the asked-for language has no translation for it (#298). */
export interface TitleSegment {
  text: string;
  fellBack: boolean;
  /** The {@link TitleTemplateCopy} field the token rendered from, on a fallen-back run only (#300) —
   * what lets the preview open the right translation editor for the run that was clicked. */
  field?: string;
}

/** Sentinels wrapping a fallen-back placeholder's value while the tidy passes run, so the segments
 * and the plain string can never disagree about the final text. Like {@link EMPTY_MARK} these are
 * control characters that never occur in real data; unlike it they survive tidying untouched (they
 * are not whitespace and no rule matches them) and are split out afterwards. `FB_FIELD` separates
 * the copy field name a sentinel carries (#300) from the value itself. */
const FB_OPEN = "\u0001";
const FB_CLOSE = "\u0002";
const FB_FIELD = "\u0004";

/** Shared renderer behind every public entry point: parse, render against the set-grouped scope,
 * tidy (one line or many), then split the fallback sentinels out into segments. `fallbackTemplate`
 * is used when the template is blank — the title has a built-in default, the description and private
 * note deliberately do not (blank there means "generate nothing"). */
function renderSegments(
  template: string | null | undefined,
  sets: readonly TemplateSet[],
  opts: {
    multiline?: boolean;
    fallbackTemplate?: string | null;
    context?: ListingTemplateContext;
  } = {}
): TitleSegment[] {
  const tpl = template?.trim() || opts.fallbackTemplate?.trim() || "";
  if (!tpl) return [];
  const nodes: TemplateNode[] = parseTemplateNodes(tpl) ?? [{ kind: "text", text: tpl }];
  const rendered = renderNodes(nodes, rootScope(sets, opts.context, opts.multiline ?? false));
  const tidied = opts.multiline ? tidyMultiline(rendered) : tidyLine(rendered);
  if (!tidied.includes(FB_OPEN)) return tidied ? [{ text: tidied, fellBack: false }] : [];
  return tidied
    .split(new RegExp(`[${FB_OPEN}${FB_CLOSE}]`))
    // A split on the sentinels alternates outside / inside runs, starting outside. An inside run
    // still carries `field${FB_FIELD}` in front of its text (#300).
    .map((run, i) => {
      if (i % 2 === 0) return { text: run, fellBack: false };
      const at = run.indexOf(FB_FIELD);
      return at < 0
        ? { text: run, fellBack: true }
        : { text: run.slice(at + 1), fellBack: true, field: run.slice(0, at) };
    })
    .filter((s) => s.text !== "");
}

/**
 * Render a title template against the copies in scope (#210). Placeholders `{token}` (`{name}`,
 * `{catalog}`, `{year}`, `{condition}`, `{certificate}`, `{area}`, `{issueName}`, `{issueYear}`,
 * `{subtype}`)
 * resolve to distinct values across the copies; a **fallback group** `{a|b|c}` resolves to the first
 * non-empty of its tokens. Everything else — including literal separators like `-` — is kept
 * verbatim; a placeholder that resolves to nothing takes its adjacent glue separator with it, but a
 * separator between two present values stays. An empty / whitespace template falls back to
 * {@link DEFAULT_TITLE_TEMPLATE}. Returns "" when nothing resolves (e.g. no copies) — the caller then
 * falls back to its own derived label.
 */
export function renderTitleTemplate(
  template: string | null | undefined,
  copies: readonly TitleTemplateCopy[]
): string {
  return renderTitleTemplateSegments(template, copies)
    .map((s) => s.text)
    .join("");
}

/**
 * {@link renderTitleTemplate}, split into segments so a preview can mark the parts whose text is not
 * actually translated (#298). Concatenating the segments' `text` yields exactly what
 * `renderTitleTemplate` returns. Generation is never affected — this only reports.
 */
export function renderTitleTemplateSegments(
  template: string | null | undefined,
  copies: readonly TitleTemplateCopy[]
): TitleSegment[] {
  return renderSegments(template, [{ title: null, copies }], {
    fallbackTemplate: DEFAULT_TITLE_TEMPLATE,
  });
}

/**
 * Render a **multi-line listing text** — an offer's description (#266) or private note (#267) — from
 * a platform's template over the offer's sets. Same tokens, fallback groups and language resolution
 * as the title, plus what a longer text needs: the collector's line breaks are preserved, a line
 * whose placeholders all came out empty is dropped whole, and the repeating blocks `{#set}…{/set}` /
 * `{#copy}…{/copy}` render their body once per set / copy so a description can enumerate a listing.
 * A blank template renders "" — unlike the title there is no built-in default, because "no
 * description template" means the offer simply gets none.
 *
 * This is also the only mode that renders the unknown-variant caveat (#619) — `{#unknownVariant}` and
 * its `{listedAs}` / `{variants}` tokens — since a title has no room for it.
 *
 * `context` carries what the copies cannot answer (#415) — the offer's own link. Omitted, its tokens
 * render empty rather than literal, which is what a preview and a not-yet-created offer both want.
 */
export function renderListingTemplate(
  template: string | null | undefined,
  sets: readonly TemplateSet[],
  context?: ListingTemplateContext
): string {
  return renderListingTemplateSegments(template, sets, context)
    .map((s) => s.text)
    .join("");
}

/** {@link renderListingTemplate}, split into fallback-flagged segments for the preview (#298). */
export function renderListingTemplateSegments(
  template: string | null | undefined,
  sets: readonly TemplateSet[],
  context?: ListingTemplateContext
): TitleSegment[] {
  return renderSegments(template, sets, { multiline: true, context });
}

/**
 * The tokens of `template` whose text fell back to the default language for these sets (#298), as
 * they read in the token legend (`{condition}`), first-seen order, de-duplicated. Drives a preview's
 * summary line. Empty when nothing fell back — including whenever the copies were resolved without a
 * language. Tokens inside a repeating block report against every copy in scope: the summary answers
 * "which tokens are not really translated here", not "in which iteration".
 */
export function templateFallbackTokens(
  template: string | null | undefined,
  sets: readonly TemplateSet[],
  fallbackTemplate: string | null = null
): string[] {
  const tpl = template?.trim() || fallbackTemplate?.trim() || "";
  if (!tpl) return [];
  const scope = rootScope(sets);
  const out: string[] = [];
  for (const m of tpl.matchAll(/\{([^{}]+)\}/g)) {
    const { value, spec, fellBack } = resolvePlaceholder(m[1], scope.copies, scope.setTitle);
    if (!value || !spec || !fellBack) continue;
    const token = `{${spec.split(":")[0].trim()}}`;
    const canonical = AVAILABLE_LISTING_TOKENS.find((t) => t.token.toLowerCase() === token.toLowerCase());
    const label = canonical?.token ?? token;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** {@link templateFallbackTokens} for a one-line title over a flat copy list (#298). */
export function titleFallbackTokens(
  template: string | null | undefined,
  copies: readonly TitleTemplateCopy[]
): string[] {
  return templateFallbackTokens(template, [{ title: null, copies }], DEFAULT_TITLE_TEMPLATE);
}

/** {@link templateFallbackTokens} for a multi-line listing text over an offer's sets (#266/#267). */
export function listingFallbackTokens(
  template: string | null | undefined,
  sets: readonly TemplateSet[]
): string[] {
  return templateFallbackTokens(template, sets);
}

/**
 * The **entity fields** behind a template's fallbacks (#299) — one entry per (entity, field) whose
 * untranslated text this template actually renders for these sets, de-duplicated across the copies
 * that share it (a condition used by ten copies is one gap) and in first-seen order.
 *
 * The same walk as {@link templateFallbackTokens}, kept beside it deliberately: a gap the panel
 * offers to fill and a token the summary line names are the same thing seen from two ends, so they
 * can never disagree about what counts. A template that renders none of an entity's translatable
 * tokens yields nothing for it, however untranslated that entity is.
 */
export function templateFallbacks(
  template: string | null | undefined,
  sets: readonly TemplateSet[],
  fallbackTemplate: string | null = null
): TitleFallback[] {
  const tpl = template?.trim() || fallbackTemplate?.trim() || "";
  if (!tpl) return [];
  const scope = rootScope(sets);
  const out: TitleFallback[] = [];
  const seen = new Set<string>();
  for (const m of tpl.matchAll(/\{([^{}]+)\}/g)) {
    const { fallbacks } = resolvePlaceholder(m[1], scope.copies, scope.setTitle);
    for (const f of fallbacks) {
      const key = `${f.entityType}:${f.entityId}:${f.entityField}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

/** {@link templateFallbacks} for a one-line title over a flat copy list (#299). */
export function titleFallbacks(
  template: string | null | undefined,
  copies: readonly TitleTemplateCopy[]
): TitleFallback[] {
  return templateFallbacks(template, [{ title: null, copies }], DEFAULT_TITLE_TEMPLATE);
}

/** {@link templateFallbacks} for a multi-line listing text over an offer's sets (#299). */
export function listingFallbacks(
  template: string | null | undefined,
  sets: readonly TemplateSet[]
): TitleFallback[] {
  return templateFallbacks(template, sets);
}
