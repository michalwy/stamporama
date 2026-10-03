// What the area operations answer with, how an agent spells an area's catalogues, and their refusals
// (#1539).
//
// An area (#66, #263, #675) is a node of the collection's tree that issues and stamps are filed
// under, and it carries the catalogue configuration they inherit: the catalogues their numbers are
// in, the prefix each number carries, the catalogue that leads numbering and the book that values a
// copy. What an area *is*, and how that configuration resolves down the tree, belong to
// `src/lib/areas.ts`, `area-vendor.ts` and `area-inheritance.ts`; this module only states one to an
// agent and reads what an agent sends back.
//
// **An area's catalogues are spelled the same way going out and coming in**, so an agent can read an
// area and send its configuration back changed: `"Mi"` records Michel numbers and lets the prefix
// inherit, `"Mi: PL"` gives Michel its own prefix here, and `"Mi: -"` states *no prefix for Michel
// here*, which stops both the area's own prefix and any ancestor's — the three states of the column
// (`CollectionAreaVendor.areaPrefix`, #675).
//
// Pure: no Prisma. `CollectionAreaData` is imported as a type only, because the resolvers this module
// reuses are typed against it; the import is erased before it runs.

import { buildAreaPath } from "../area-path";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "../area-vendor";
import { resolveEffectivePrimaryCatalogNameId } from "../area-inheritance";
import type { CollectionAreaData } from "../areas";
import { compact } from "./collection-reads";
import { invalidRequest, type ApiError } from "./errors";

/** The catalogue and book names an area's configuration is stated in. */
export interface AreaNames {
  /** Catalogue (vendor) id → its abbreviation, `Mi`. */
  readonly catalogues: ReadonlyMap<string, string>;
  /** Book (catalog name) id → its name. */
  readonly books: ReadonlyMap<string, string>;
}

/** The catalogue configuration as the area itself sets it — what `create_area`/`update_area` write. */
export interface AgentAreaOwnCatalogues {
  /** The area's prefix for every catalogue; absent when it says nothing and the parent's applies. */
  readonly prefix?: string;
  /** Its numbering catalogues, `"Mi"`, `"Mi: PL"` or `"Mi: -"` — the spelling `catalogues` takes. */
  readonly catalogues: readonly string[];
  /** The catalogue that leads numbering here; absent when the parent's leads. */
  readonly leadingCatalogue?: string;
  /** The books that price this area. */
  readonly priceBooks: readonly string[];
  /** The book that gives a copy here its catalogue value; absent when the parent's does. */
  readonly valuingBook?: string;
}

/** The catalogue configuration the area's issues actually get, after walking up the tree. */
export interface AgentAreaResolvedCatalogues {
  readonly leadingCatalogue?: string;
  /** Every catalogue its stamps carry numbers in, with the prefix each resolves to — `Mi·PL`. */
  readonly catalogues: readonly string[];
  readonly valuingBook?: string;
}

/** One area, whole: a `list_areas` row. */
export interface AgentArea {
  readonly areaId: string;
  readonly name: string;
  /** From the root, `Europe › Poland › General Government`. */
  readonly areaPath: string;
  /** Absent on a top-level area. */
  readonly parentId?: string;
  /** Where it stands among its siblings; 1 is first. */
  readonly position: number;
  /** False on a grouping-only area, which holds areas and no issues. */
  readonly assignable: boolean;
  readonly description?: string;
  /** The name listing titles use; absent when it falls back to the parent's. */
  readonly titleName?: string;
  readonly translatedTitleNames?: Readonly<Record<string, string>>;
  /** Issues filed directly under it, not under its sub-areas. */
  readonly issueCount: number;
  /** Stamps filed directly under it. */
  readonly stampCount: number;
  readonly childCount: number;
  readonly own: AgentAreaOwnCatalogues;
  readonly resolved: AgentAreaResolvedCatalogues;
  readonly path: string;
}

/** The areas in the order the Areas screen reads them: depth first, each sibling group in its order. */
export function areaTreeOrder(areas: readonly CollectionAreaData[]): CollectionAreaData[] {
  const children = siblingGroups(areas);
  const out: CollectionAreaData[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 50) return;
    for (const area of children.get(parentId) ?? []) {
      out.push(area);
      walk(area.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Each parent's children in their order: `sortOrder`, then name (#78) — `readCollectionAreas`' order. */
export function siblingGroups(
  areas: readonly CollectionAreaData[]
): Map<string | null, CollectionAreaData[]> {
  const groups = new Map<string | null, CollectionAreaData[]>();
  for (const area of areas) groups.set(area.parentId, [...(groups.get(area.parentId) ?? []), area]);
  for (const group of groups.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  return groups;
}

/** The area and every area under it. */
export function areaSubtree(areas: readonly CollectionAreaData[], rootId: string): Set<string> {
  const groups = siblingGroups(areas);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of groups.get(id) ?? []) stack.push(child.id);
  }
  return out;
}

function catalogueEntry(abbreviation: string, areaPrefix: string | null): string {
  if (areaPrefix === null) return abbreviation;
  return `${abbreviation}: ${areaPrefix === "" ? NO_PREFIX : areaPrefix}`;
}

/** What the area sets itself, in the spelling the writes take. */
export function ownCatalogues(area: CollectionAreaData, names: AreaNames): AgentAreaOwnCatalogues {
  const abbreviation = (id: string) => names.catalogues.get(id) ?? id;
  return compact({
    prefix: area.catalogPrefix ?? undefined,
    catalogues: area.vendorEntries.map((entry) =>
      catalogueEntry(abbreviation(entry.catalogVendorId), entry.areaPrefix)
    ),
    leadingCatalogue: area.primaryCatalogVendorId ? abbreviation(area.primaryCatalogVendorId) : undefined,
    priceBooks: area.catalogEntries.flatMap((entry) =>
      entry.catalogNameId ? [names.books.get(entry.catalogNameId) ?? entry.catalogName ?? entry.catalogNameId] : []
    ),
    valuingBook: area.primaryCatalogNameId
      ? (names.books.get(area.primaryCatalogNameId) ?? area.primaryCatalogNameId)
      : undefined,
  });
}

/**
 * What an issue under `areaId` gets: the catalogues `effectiveVendorsForArea` resolves, each with the
 * prefix it walks up to, the leading catalogue and the valuing book — the same three walks the issue
 * and stamp forms make. `issuePrefixes` is an issue's own prefix per catalogue (#377), which replaces
 * the area's for that issue alone and moves with it.
 */
export function resolvedCatalogues(
  areas: CollectionAreaData[],
  areaId: string,
  names: AreaNames,
  issuePrefixes?: ReadonlyMap<string, string>
): AgentAreaResolvedCatalogues {
  const leading = effectivePrimaryVendorId(areas, areaId);
  const valuing = resolveEffectivePrimaryCatalogNameId(areas, areaId);
  const catalogues = effectiveVendorsForArea(areas, areaId)
    .map((entry) => {
      const abbreviation = names.catalogues.get(entry.catalogVendorId) ?? entry.vendorAbbreviation;
      const prefix = issuePrefixes?.get(entry.catalogVendorId) ?? entry.prefix;
      return prefix ? `${abbreviation}·${prefix}` : abbreviation;
    })
    .sort((a, b) => a.localeCompare(b));
  return compact({
    leadingCatalogue: leading ? (names.catalogues.get(leading) ?? leading) : undefined,
    catalogues,
    valuingBook: valuing ? (names.books.get(valuing) ?? valuing) : undefined,
  });
}

export function sameResolvedCatalogues(a: AgentAreaResolvedCatalogues, b: AgentAreaResolvedCatalogues): boolean {
  return (
    a.leadingCatalogue === b.leadingCatalogue &&
    a.valuingBook === b.valuingBook &&
    a.catalogues.length === b.catalogues.length &&
    a.catalogues.every((label, i) => label === b.catalogues[i])
  );
}

/** Everything a `list_areas` row states but the counts and the link. */
export interface AreaRowExtras {
  readonly issueCount: number;
  readonly path: string;
}

export function agentArea(
  areas: CollectionAreaData[],
  area: CollectionAreaData,
  names: AreaNames,
  extras: AreaRowExtras
): AgentArea {
  const siblings = siblingGroups(areas).get(area.parentId) ?? [];
  return compact({
    areaId: area.id,
    name: area.name,
    areaPath: buildAreaPath(areas, area.id) ?? area.name,
    parentId: area.parentId ?? undefined,
    position: siblings.findIndex((sibling) => sibling.id === area.id) + 1,
    assignable: area.assignable,
    description: area.description ?? undefined,
    titleName: area.titleName ?? undefined,
    translatedTitleNames:
      Object.keys(area.titleNameByLanguage).length > 0 ? { ...area.titleNameByLanguage } : undefined,
    issueCount: extras.issueCount,
    stampCount: area.stampCount,
    childCount: area.childCount,
    own: ownCatalogues(area, names),
    resolved: resolvedCatalogues(areas, area.id, names),
    path: extras.path,
  });
}

/** How an agent writes *no prefix for this catalogue here*. */
export const NO_PREFIX = "-";

/** One numbering catalogue as sent: its key and the column's three-state prefix. */
export interface CatalogueEntryInput {
  readonly key: string;
  /** null inherits, `""` is the stated *no prefix*, anything else is the prefix. */
  readonly areaPrefix: string | null;
}

/** Read `"Mi"`, `"Mi: PL"` and `"Mi: -"`, refusing a catalogue named twice or an entry with nothing in it. */
export function parseCatalogueEntries(entries: readonly string[], parameter: string): CatalogueEntryInput[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    const colon = entry.indexOf(":");
    const key = (colon < 0 ? entry : entry.slice(0, colon)).trim();
    const value = colon < 0 ? null : entry.slice(colon + 1).trim();
    if (!key || value === "") {
      throw invalidRequest(
        `"${parameter}" entry "${entry}" cannot be read. Write "Mi" to record a catalogue's numbers with the prefix inherited, "Mi: PL" for a prefix of its own here, or "Mi: ${NO_PREFIX}" for no prefix here.`
      );
    }
    const folded = key.toLocaleLowerCase();
    if (seen.has(folded)) {
      throw invalidRequest(`"${parameter}" names the catalogue "${key}" twice. Send one entry per catalogue.`);
    }
    seen.add(folded);
    return { key, areaPrefix: value === null ? null : value === NO_PREFIX ? "" : value };
  });
}

// ── Refusals ────────────────────────────────────────────────────────────────

/** The Areas screen's rule: an area cannot be put under itself or under one of its own sub-areas. */
export function areaUnderItself(areaName: string, parentName: string, isSelf: boolean): ApiError {
  return invalidRequest(
    isSelf
      ? `"${areaName}" cannot be put under itself. Nothing was moved. Name another area as "parent", or send "top_level": true.`
      : `"${parentName}" is under "${areaName}", so "${areaName}" cannot be put under it — an area cannot sit inside its own sub-area. Nothing was moved. Move "${parentName}" out first, or name another parent.`
  );
}

/** The Areas screen's rule: an area holding issues or stamps cannot become grouping-only (#263). */
export function groupingOnlyHoldsMaterial(areaName: string, issues: number, stamps: number): ApiError {
  const held = [issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"}` : null, stamps > 0 ? `${stamps} stamp${stamps === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" and ");
  return invalidRequest(
    `"${areaName}" holds ${held} directly, and a grouping-only area holds none. Nothing was changed. Move its issues to another area with \`move_issue_to_area\` first.`
  );
}

/**
 * The Areas screen's rule (#69, #263): an area that holds issues needs a book valuing its copies, set
 * on it or on an area above it. A grouping-only area is exempt.
 */
export function noValuingBook(areaName: string, underName: string | null): ApiError {
  const where = underName ? `on it or on an area above it — "${underName}" and its ancestors set none` : "on it, as it has no area above it";
  return invalidRequest(
    `"${areaName}" holds issues, so it needs a valuing book — the catalogue volume that gives a copy its catalogue value — set ${where}. Nothing was written. Send "valuing_book" (one of its "price_books"), or "assignable": false for a grouping-only area.`
  );
}

/** The valuing book is chosen among the area's own price books, as on the area form. */
export function valuingBookNotAttached(book: string, priceBooks: readonly string[]): ApiError {
  return invalidRequest(
    `"${book}" is not one of this area's price books, and the valuing book is chosen among them. Nothing was written. Add it to "price_books" as well, or name one of them.`,
    priceBooks
  );
}

/** The leading catalogue is chosen among the area's own catalogues, as on the area form. */
export function leadingNotKept(catalogue: string, catalogues: readonly string[]): ApiError {
  return invalidRequest(
    `"${catalogue}" is not one of this area's own catalogues, and the leading catalogue is chosen among them. Nothing was written. Add it to "catalogues" as well, or name one of them.`,
    catalogues
  );
}

/** Reordering is within one sibling group, as the screen's drag is. */
export function notSiblings(groups: readonly string[]): ApiError {
  return invalidRequest(
    `The areas sent sit under different parents (${groups.join("; ")}), and areas are ordered among their siblings only. Nothing was reordered. Send the areas of one parent; \`move_area\` changes an area's parent.`
  );
}
