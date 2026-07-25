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

import { parseCatalogNumberParts } from "./catalog-number";

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
  /** Name of the issue the stamp belongs to (its first membership), or null. */
  issueName: string | null;
  /** Year of that issue, or null. */
  issueYear: number | null;
}

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
      const key = `${cn.vendorId} ${cn.areaPrefix ?? ""}`;
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
 * rendered value (possibly `""` when absent), or `null` when the token name is not known. */
function resolveTokenValue(spec: string, copies: readonly TitleTemplateCopy[]): string | null {
  const segments = spec.split(":");
  const name = segments[0].trim().toLowerCase();
  switch (name) {
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
    case "issueyear":
      return yearSpan(copies, (c) => c.issueYear);
    default:
      return null;
  }
}

/**
 * Resolve the contents of one `{...}` placeholder. A plain `{token}` renders that token (an unknown
 * key keeps its literal `{token}` so a typo stays visible). A **fallback group** `{a|b|c}` renders
 * the **first non-empty** of its tokens — e.g. `{issueName|name|catalog}` — and empty when every
 * alternative is empty. Unknown keys inside a group are simply skipped.
 */
function resolvePlaceholder(inner: string, copies: readonly TitleTemplateCopy[]): string {
  const parts = inner.split("|").map((p) => p.trim());
  if (parts.length === 1) {
    const v = resolveTokenValue(parts[0], copies);
    return v === null ? `{${parts[0]}}` : v; // unknown → literal; known → value (maybe "")
  }
  for (const p of parts) {
    const v = resolveTokenValue(p, copies);
    if (v) return v; // first non-empty (skips unknown → null and empty → "")
  }
  return "";
}

/** Marker left in place of a placeholder that resolved to nothing, so {@link tidy} can strip only
 * the separators that were gluing *that* empty slot to its neighbour — never a literal separator the
 * user put between two values that are present. NUL never appears in real data. */
const EMPTY_MARK = " ";

/** Collapse whitespace, trim, and remove only the dangling glue an **empty** placeholder left
 * behind: a separator (`- – · / ,`) that sat directly next to the emptied slot, and any now-empty
 * `()` / `[]`. A separator between two present values carries no marker, so it is kept verbatim. */
function tidy(rendered: string): string {
  return rendered
    // Drop a separator immediately before an empty slot, then one immediately after it.
    .replace(/\s*[-–·/,]\s* /g, EMPTY_MARK)
    .replace(/ \s*[-–·/,]\s*/g, EMPTY_MARK)
    .replace(/ /g, "") // remove the markers themselves
    .replace(/\(\s*\)/g, "") // empty parens left by an emptied token
    .replace(/\[\s*\]/g, "") // empty brackets
    .replace(/\s+([)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Render a template against the copies in scope (#210). Placeholders `{token}` (`{name}`,
 * `{catalog}`, `{year}`, `{condition}`, `{certificate}`, `{area}`, `{issueName}`, `{issueYear}`)
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
  const tpl = template?.trim() || DEFAULT_TITLE_TEMPLATE;
  const rendered = tpl.replace(/\{([^{}]+)\}/g, (_m, inner: string) => {
    const value = resolvePlaceholder(inner, copies);
    // A placeholder that resolved to nothing becomes a marker so its glue separator is trimmed; a
    // literal (unknown-token) result stays as-is.
    return value === "" ? EMPTY_MARK : value;
  });
  return tidy(rendered);
}
