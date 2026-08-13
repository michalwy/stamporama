import type { CollectionAreaData, AreaCatalogEntry } from "./areas";
import type { ItemListItem } from "./items";
import { primaryCatalogNumber } from "./copy-sort";

// Pure per-area catalog-vendor resolution, shared by the UI (stamp/issue/copy rows) and the
// server-side lot-intake reads (#172). An area inherits its ancestors' catalog vendors and
// its nearest ancestor's declared primary vendor. No React / Prisma so it runs on both sides.

/** Every catalog vendor effective for an area — its own plus all inherited from ancestors,
 * nearer areas overriding farther ones. */
export function effectiveVendorsForArea(
  areas: CollectionAreaData[],
  areaId: string
): AreaCatalogEntry[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, AreaCatalogEntry>();
  const ancestors: CollectionAreaData[] = [];
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    ancestors.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  for (const a of ancestors.reverse()) {
    for (const e of a.catalogEntries) {
      result.set(e.catalogVendorId, e);
    }
  }
  return Array.from(result.values());
}

/** The catalog vendor id that is primary for an area (from the nearest ancestor that declares
 * a primary catalog name), or null when none is set. */
export function effectivePrimaryVendorId(
  areas: CollectionAreaData[],
  areaId: string
): string | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.primaryCatalogNameId) {
      const entry = effectiveVendorsForArea(areas, areaId).find(
        (e) => e.catalogNameId === current!.primaryCatalogNameId
      );
      return entry?.catalogVendorId ?? null;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return null;
}

/** Format a catalog number with its vendor abbreviation / prefix (e.g. `Mi·PL 200`), or the
 * bare number when no vendor entry is known. */
export function formatStampCN(number: string, v?: AreaCatalogEntry): string {
  if (!v) return number;
  return v.prefix
    ? `${v.vendorAbbreviation}·${v.prefix} ${number}`
    : `${v.vendorAbbreviation} ${number}`;
}

/**
 * Per-issue overrides of the area-resolved catalog prefix (#377): issue id → (catalog vendor id →
 * the prefix that issue's stamps carry for that vendor). Sparse — only issues that set one appear,
 * and a missing entry means "inherit the area's prefix", which is the ordinary case.
 */
export type IssuePrefixMap = Map<string, Map<string, string>>;

/** One stored override row, as it crosses the wire to the client. */
export interface IssuePrefixRow {
  issueId: string;
  catalogVendorId: string;
  areaPrefix: string;
}

/** Shape override rows into the nested {@link IssuePrefixMap}. Pure, so the server reads and the
 * client's own fetch share one derivation. */
export function groupIssuePrefixRows(rows: readonly IssuePrefixRow[]): IssuePrefixMap {
  const out: IssuePrefixMap = new Map();
  for (const r of rows) {
    let byVendor = out.get(r.issueId);
    if (!byVendor) {
      byVendor = new Map();
      out.set(r.issueId, byVendor);
    }
    byVendor.set(r.catalogVendorId, r.areaPrefix);
  }
  return out;
}

export interface AreaVendorMaps {
  /** area id → the area's effective primary catalog vendor id (or null). */
  primaryVendorByArea: Map<string, string | null>;
  /** area id → (catalog vendor id → catalog entry) for that area's effective vendors. */
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
  /**
   * The vendor lookup to render a stamp's catalog numbers with (#377): the area's own map, or a
   * copy of it with the issue's prefix overrides substituted in. **Prefer this to reaching into
   * {@link vendorMapByArea}** — a stamp's prefix is a question about its issue as much as its
   * area, and the two disagree exactly where this feature exists. Results are memoized per
   * (area, issue) pair, and an issue with no overrides gets the area's own map back unchanged.
   */
  vendorMapFor: (areaId: string | null, issueId: string | null) => Map<string, AreaCatalogEntry>;
}

/**
 * The name each area should show in an auto-generated listing title (#210): its own `titleName`
 * when set, else the nearest ancestor that sets one, else the area's own `name`. So internal
 * grouping levels (blank `titleName`) roll up to a public parent, while a sibling with its own
 * `titleName` keeps it. Returns a map of area id → effective title name.
 *
 * With a `language` (#293), each area on the way up resolves to its translated `titleName` for
 * that language, falling back to its default-language `titleName`. The fallback is **per node**,
 * not per chain: an area that carries a title name but no translation keeps its own text rather
 * than deferring to a translated ancestor — the roll-up decides *which* area names the title, and
 * the language only decides how that area is spelled.
 */
export function buildAreaTitleMap(
  areas: CollectionAreaData[],
  language?: string | null
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, entry] of buildAreaTitleEntries(areas, language)) out.set(id, entry.title);
  return out;
}

/** One area's resolved title name, plus whether it **fell back** to untranslated text (#298): true
 * when a language was asked for and the name that won the roll-up carries no translation for it —
 * whether that is a default-language `titleName` or the area's own `name`. */
export interface AreaTitleEntry {
  title: string;
  fellBack: boolean;
  /** The area the winning name came from — this area, or the ancestor whose `titleName` rolled up to
   * it. That is the row a missing `{area}` translation has to be written on (#299), which is not
   * always the copy's own area. */
  sourceAreaId: string;
}

/** {@link buildAreaTitleMap}, additionally reporting the per-area fallback (#298) so the title
 * preview can mark an `{area}` that is not really translated. */
export function buildAreaTitleEntries(
  areas: CollectionAreaData[],
  language?: string | null
): Map<string, AreaTitleEntry> {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const out = new Map<string, AreaTitleEntry>();
  for (const area of areas) {
    let current: CollectionAreaData | undefined = area;
    let depth = 0;
    let resolved: string | null = null;
    let translated = false;
    // The area the winning name belongs to. Defaults to the leaf: when nothing rolls up, the title
    // *is* the leaf's own `name`, and a `titleName` translation written on the leaf would win.
    let sourceAreaId = area.id;
    while (current && depth < 50) {
      const t = language ? current.titleNameByLanguage[language]?.trim() : undefined;
      const value = t || current.titleName?.trim();
      if (value) {
        resolved = value;
        translated = !!t;
        sourceAreaId = current.id;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    out.set(area.id, {
      title: resolved ?? area.name,
      fellBack: !!language && !translated,
      sourceAreaId,
    });
  }
  return out;
}

/** Build the per-area primary-vendor and vendor-lookup maps used to render catalog numbers on
 * stamp/issue/copy rows. Pure so the client hook ({@link ../app/.../use-area-vendor-maps}) and
 * the server lot-intake reads share one derivation.
 *
 * `prefixByIssue` (#377) carries the collection's per-issue prefix overrides; omitting it is the
 * same as passing an empty map, so a caller with no issue context keeps the area-only behaviour. */
export function buildAreaVendorMaps(
  areas: CollectionAreaData[],
  prefixByIssue: IssuePrefixMap = new Map()
): AreaVendorMaps {
  const primaryVendorByArea = new Map<string, string | null>();
  const vendorMapByArea = new Map<string, Map<string, AreaCatalogEntry>>();
  for (const a of areas) {
    primaryVendorByArea.set(a.id, effectivePrimaryVendorId(areas, a.id));
    const vendors = effectiveVendorsForArea(areas, a.id);
    vendorMapByArea.set(a.id, new Map(vendors.map((v) => [v.catalogVendorId, v])));
  }

  // One override-applied map per (area, issue) pair actually asked for. Rows are rendered in long
  // lists that repeat the same handful of pairs, so this is built lazily and kept.
  const overridden = new Map<string, Map<string, AreaCatalogEntry>>();
  const vendorMapFor = (
    areaId: string | null,
    issueId: string | null
  ): Map<string, AreaCatalogEntry> => {
    const base = (areaId ? vendorMapByArea.get(areaId) : undefined) ?? EMPTY_VENDOR_MAP;
    const overrides = issueId ? prefixByIssue.get(issueId) : undefined;
    if (!overrides || overrides.size === 0) return base;
    const cacheKey = `${areaId ?? ""} ${issueId}`;
    const cached = overridden.get(cacheKey);
    if (cached) return cached;
    const next = new Map(base);
    for (const [catalogVendorId, prefix] of overrides) {
      const entry = base.get(catalogVendorId);
      // Only vendors the area actually carries are overridable: the prefix decorates an existing
      // catalog entry (its abbreviation and name), and an issue cannot introduce a catalog its
      // area does not use.
      if (entry) next.set(catalogVendorId, { ...entry, prefix });
    }
    overridden.set(cacheKey, next);
    return next;
  };

  return { primaryVendorByArea, vendorMapByArea, vendorMapFor };
}

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();

/** What {@link catalogLabel} needs of a stamp: where it sits (for the vendor lookup) and what it is
 * numbered and called. A copy satisfies it through its own stamp's fields, a bare stamp directly. */
export interface CatalogLabelSubject {
  areaId: string | null;
  issueId: string | null;
  catalogNumbers: readonly { catalogVendorId: string; number: string }[];
  name: string | null;
}

/** How a stamp is *called by its number*: the primary-vendor number (with vendor prefix) when its
 * area declares one, else the first recorded number; the stamp's name when it carries none.
 *
 * One rule, because the surfaces that print it sit beside each other — a copy row, the label derived
 * from a lot's copies (#121/#172), and the stamps a for-sale set is still missing (#563), which is
 * read off the very header whose catalog chips are formatted this way. */
export function catalogLabel(subject: CatalogLabelSubject, maps: AreaVendorMaps): string {
  const primaryVendorId = subject.areaId
    ? (maps.primaryVendorByArea.get(subject.areaId) ?? null)
    : null;
  const vendorMap = maps.vendorMapFor(subject.areaId, subject.issueId);
  const cn =
    subject.catalogNumbers.find((c) => c.catalogVendorId === primaryVendorId) ??
    subject.catalogNumbers[0] ??
    null;
  if (cn) return formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId));
  return subject.name || "(stamp)";
}

/** {@link catalogLabel} for a copy — the inventory/lot row's own label, so a derived lot label
 * reads like the copies it was derived from. */
export function copyCatalogLabel(item: ItemListItem, maps: AreaVendorMaps): string {
  return catalogLabel(
    {
      areaId: item.areaId,
      issueId: item.issueId,
      catalogNumbers: item.catalogNumbers,
      name: item.stampName,
    },
    maps
  );
}

/** Derive a lot's display label from its copies' catalog numbers (with vendor prefixes),
 * de-duplicated, showing up to three plus a "+N more" tail. Null for an empty lot. Mirrors the
 * client `deriveLotLabel` (#121) so the paginated lot header reads identically (#172). */
export function deriveLotLabel(items: ItemListItem[], maps: AreaVendorMaps): string | null {
  if (items.length === 0) return null;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const label = copyCatalogLabel(it, maps);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  const shown = labels.slice(0, 3).join(", ");
  const extra = labels.length - Math.min(3, labels.length);
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

/** Re-export so `copy-sort`'s catalog-number helper is reachable from this module's consumers. */
export { primaryCatalogNumber };
