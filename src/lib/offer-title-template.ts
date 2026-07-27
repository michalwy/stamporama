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
// `{#conditionLegend}…{/conditionLegend}` / `{#certificateLegend}…{/certificateLegend}` (#318) are the
// same mechanism over the *distinct dictionary entries* the copies use, which is how a description
// appends a legend of the abbreviations it just printed — the collector writes the entry's format
// inside the block.

import { parseCatalogNumberParts } from "./catalog-number";
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
  /** The stamp's subtype (#339) — `Error`, `Overprint`… — or null. Null for a base stamp, which has
   * no subtype, **and** for the collection's default subtype: the default is the unmarked case, so
   * `{subtype}` renders empty rather than stamping a redundant "Variant" on every listing. */
  subtype: string | null;
  /** Name of the issue the stamp belongs to (its first membership), or null. */
  issueName: string | null;
  /** Year of that issue, or null. */
  issueYear: number | null;
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
 * one copy flattens five entities: `{condition}` and `{conditionAbbr}` are both the condition's
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
 * `{issueYear}`, `{location}` and `{ref}` are not translatable and never flag. */
const FALLBACK_FIELD_BY_TOKEN: Readonly<Record<string, string>> = {
  name: "name",
  condition: "condition",
  conditionabbr: "conditionAbbr",
  certificate: "certificate",
  certificateabbr: "certificateAbbr",
  area: "area",
  issuename: "issueName",
  subtype: "subtype",
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
  { token: "{issueName}", label: "Issue name", example: "1850 First Issue" },
  { token: "{issueYear}", label: "Issue year", example: "1850" },
  { token: "{subtype}", label: "Subtype", example: "Overprint" },
];

/** The tokens a **multi-line listing text** may contain (#266/#267) — the title's tokens plus
 * `{setTitle}`, which only names something inside a `{#set}` block (or when the template renders one
 * set's own title). */
export const AVAILABLE_LISTING_TOKENS: readonly TitleToken[] = [
  ...AVAILABLE_TITLE_TOKENS,
  { token: "{setTitle}", label: "Set title", example: "Complete series" },
];

/** The repeating blocks a listing text may use (#266), for the builder's chips: each renders its
 * body once per set / per copy in scope. */
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

/** Compact a group's catalog numbers into a range list (#210, #286). Numbers are bucketed by their
 * **numbering family** — the constant prefix + suffix around the digits, as `parseCatalogNumberParts`
 * splits them — and within each family the base numbers are sorted and consecutive runs collapse to
 * `from-to`. So `1,2,4,6,7,8` reads `1-2,4,6-8`, and `BL31,BL32,BL33` reads `BL31-33`: the shared
 * prefix and suffix are written **once**, around the collapsed span. Families are emitted in
 * first-seen order, and a number without a digit run at all (e.g. `Ark.`) is kept verbatim at the
 * end. All comma-joined; duplicates dropped. */
function compactCatalogNumbers(numbers: readonly string[]): string {
  interface Family {
    prefix: string;
    suffix: string;
    bases: number[];
    seen: Set<number>;
  }
  const families = new Map<string, Family>();
  const order: string[] = [];
  const others: string[] = [];
  const seenOther = new Set<string>();
  for (const n of numbers) {
    const parts = parseCatalogNumberParts(n);
    if (!parts) {
      const t = n.trim();
      if (t && !seenOther.has(t)) {
        seenOther.add(t);
        others.push(t);
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

  const ranges: string[] = [];
  for (const key of order) {
    const f = families.get(key)!;
    f.bases.sort((a, b) => a - b);
    for (let i = 0; i < f.bases.length; ) {
      let j = i;
      while (j + 1 < f.bases.length && f.bases[j + 1] === f.bases[j] + 1) j++;
      const span = i === j ? String(f.bases[i]) : `${f.bases[i]}-${f.bases[j]}`;
      ranges.push(`${f.prefix}${span}${f.suffix}`);
      i = j + 1;
    }
  }
  return [...ranges, ...others].join(",");
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

  // Group every selected number by its vendor (+ area prefix), preserving first-seen group order.
  const groups = new Map<string, { vendorAbbr: string; areaPrefix: string | null; numbers: string[] }>();
  const order: string[] = [];
  for (const copy of copies) {
    for (const cn of selectCatalogNumbers(copy, vendorsArg)) {
      const key = `${cn.vendorId}\u0000${cn.areaPrefix ?? ""}`;
      let g = groups.get(key);
      if (!g) {
        g = { vendorAbbr: cn.vendorAbbr, areaPrefix: cn.areaPrefix, numbers: [] };
        groups.set(key, g);
        order.push(key);
      }
      g.numbers.push(cn.number);
    }
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

/** Resolve one token spec (without braces), e.g. `name` or `catalog:Mi,Sc:vendor`. Returns the
 * rendered value (possibly `""` when absent), or `null` when the token name is not known.
 * `setTitle` is the enclosing set's title, which only `{setTitle}` reads (null outside a set). */
function resolveTokenValue(
  spec: string,
  copies: readonly TitleTemplateCopy[],
  setTitle: string | null
): string | null {
  const segments = spec.split(":");
  const name = segments[0].trim().toLowerCase();
  switch (name) {
    case "settitle":
      return setTitle?.trim() ?? "";
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
    case "issuename":
      return distinct(copies.map((c) => c.issueName)).join(" / ");
    case "subtype":
      return distinct(copies.map((c) => c.subtype)).join(" / ");
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
  setTitle: string | null = null
): ResolvedPlaceholder {
  const parts = inner.split("|").map((p) => p.trim());
  const resolved = (value: string, spec: string): ResolvedPlaceholder => {
    const fallbacks = value ? tokenFallbacks(spec, copies) : [];
    return { value, spec, fellBack: fallbacks.length > 0, fallbacks };
  };
  if (parts.length === 1) {
    const v = resolveTokenValue(parts[0], copies, setTitle);
    // unknown → literal (no token produced it); known → value (maybe "")
    if (v === null) return { value: `{${parts[0]}}`, spec: null, fellBack: false, fallbacks: [] };
    return resolved(v, parts[0]);
  }
  for (const p of parts) {
    const v = resolveTokenValue(p, copies, setTitle);
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
    .replace(/(\s*[-–·/,:;=]\s*) \s*[-–·/,:;=]\s*/g, "$1")
    // Otherwise drop a separator immediately before an empty slot, then one immediately after it.
    .replace(/\s*[-–·/,:;=]\s* /g, EMPTY_MARK)
    .replace(/ \s*[-–·/,:;=]\s*/g, EMPTY_MARK)
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
 * set's title (read only by `{setTitle}`). */
interface TemplateScope {
  sets: readonly TemplateSet[];
  copies: readonly TitleTemplateCopy[];
  setTitle: string | null;
}

/** What a repeating block iterates: the offer's sets, the copies in scope, or — for a legend of
 * abbreviations (#318) — the distinct conditions / certificate statuses those copies use. The legend
 * blocks are named `…Legend` rather than after the dictionary itself so `{#conditionLegend}` cannot
 * be misread as the `{condition}` token it is normally wrapped around. */
type BlockOver = "set" | "copy" | "conditionLegend" | "certificateLegend";

/** The two legend blocks, and which pair of {@link TitleTemplateCopy} fields each iterates. */
type LegendOver = "conditionLegend" | "certificateLegend";

/** A parsed template: literal runs (still carrying `{token}` placeholders) and repeating blocks. */
type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "block"; over: BlockOver; body: TemplateNode[] };

const BLOCK_TAGS: readonly BlockOver[] = ["set", "copy", "conditionLegend", "certificateLegend"];

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
    const { value, spec, fellBack } = resolvePlaceholder(inner, scope.copies, scope.setTitle);
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

/** The dictionary entry one copy contributes to a `{#conditionLegend}` / `{#certificateLegend}` block
 * (#318): the (full name, abbreviation) pair, as a key that de-duplicates the copies using it. Null
 * when the copy records neither — it has nothing to explain and is left out of the legend. */
function legendKey(copy: TitleTemplateCopy, over: LegendOver): string | null {
  const isCondition = over === "conditionLegend";
  const name = (isCondition ? copy.condition : copy.certificate)?.trim() ?? "";
  const abbr = (isCondition ? copy.conditionAbbr : copy.certificateAbbr)?.trim() ?? "";
  return name || abbr ? `${name} ${abbr}` : null;
}

/** One scope per distinct condition / certificate status used by the copies in `scope` (#318), in
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
    return { sets, copies: sets.flatMap((s) => [...s.copies]), setTitle: scope.setTitle };
  });
}

/** Render parsed nodes against `scope`. A `{#set}` block re-renders its body once per set in scope,
 * with tokens narrowed to that set's copies; a `{#copy}` block once per copy in scope — nested in a
 * set block that means that set's copies, at the top level every copy of the offer. The legend blocks
 * `{#conditionLegend}` / `{#certificateLegend}` (#318) repeat once per distinct dictionary entry the
 * copies use, narrowed to the copies using it. */
function renderNodes(nodes: readonly TemplateNode[], scope: TemplateScope): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += renderTextRun(node.text, scope);
      continue;
    }
    const iterations: TemplateScope[] =
      node.over === "set"
        ? scope.sets.map((s) => ({ sets: [s], copies: s.copies, setTitle: s.title }))
        : node.over === "conditionLegend" || node.over === "certificateLegend"
          ? legendScopes(scope, node.over)
          : scope.copies.map((c) => ({
              sets: [{ title: scope.setTitle, copies: [c] }],
              copies: [c],
              setTitle: scope.setTitle,
            }));
    for (const iteration of iterations) {
      const body = renderNodes(node.body, iteration);
      if (!isBlankRender(body)) out += body;
    }
  }
  return out;
}

/** The top-level scope for a render: plain tokens aggregate over every copy of every set. */
function rootScope(sets: readonly TemplateSet[]): TemplateScope {
  return {
    sets,
    copies: sets.flatMap((s) => [...s.copies]),
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
  opts: { multiline?: boolean; fallbackTemplate?: string | null } = {}
): TitleSegment[] {
  const tpl = template?.trim() || opts.fallbackTemplate?.trim() || "";
  if (!tpl) return [];
  const nodes: TemplateNode[] = parseTemplateNodes(tpl) ?? [{ kind: "text", text: tpl }];
  const rendered = renderNodes(nodes, rootScope(sets));
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
 */
export function renderListingTemplate(
  template: string | null | undefined,
  sets: readonly TemplateSet[]
): string {
  return renderListingTemplateSegments(template, sets)
    .map((s) => s.text)
    .join("");
}

/** {@link renderListingTemplate}, split into fallback-flagged segments for the preview (#298). */
export function renderListingTemplateSegments(
  template: string | null | undefined,
  sets: readonly TemplateSet[]
): TitleSegment[] {
  return renderSegments(template, sets, { multiline: true });
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
