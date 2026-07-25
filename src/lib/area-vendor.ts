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

export interface AreaVendorMaps {
  /** area id → the area's effective primary catalog vendor id (or null). */
  primaryVendorByArea: Map<string, string | null>;
  /** area id → (catalog vendor id → catalog entry) for that area's effective vendors. */
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
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
    while (current && depth < 50) {
      const t = language ? current.titleNameByLanguage[language]?.trim() : undefined;
      const value = t || current.titleName?.trim();
      if (value) {
        resolved = value;
        translated = !!t;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    out.set(area.id, { title: resolved ?? area.name, fellBack: !!language && !translated });
  }
  return out;
}

/** Build the per-area primary-vendor and vendor-lookup maps used to render catalog numbers on
 * stamp/issue/copy rows. Pure so the client hook ({@link ../app/.../use-area-vendor-maps}) and
 * the server lot-intake reads share one derivation. */
export function buildAreaVendorMaps(areas: CollectionAreaData[]): AreaVendorMaps {
  const primaryVendorByArea = new Map<string, string | null>();
  const vendorMapByArea = new Map<string, Map<string, AreaCatalogEntry>>();
  for (const a of areas) {
    primaryVendorByArea.set(a.id, effectivePrimaryVendorId(areas, a.id));
    const vendors = effectiveVendorsForArea(areas, a.id);
    vendorMapByArea.set(a.id, new Map(vendors.map((v) => [v.catalogVendorId, v])));
  }
  return { primaryVendorByArea, vendorMapByArea };
}

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();

/** The catalog-number label shown for a copy: its primary-vendor number (with vendor prefix)
 * when the area has one, else the first recorded number; the stamp name when it carries none.
 * Mirrors the inventory/lot row so a derived lot label reads like its copies. */
export function copyCatalogLabel(item: ItemListItem, maps: AreaVendorMaps): string {
  const primaryVendorId = item.areaId
    ? (maps.primaryVendorByArea.get(item.areaId) ?? null)
    : null;
  const vendorMap = (item.areaId ? maps.vendorMapByArea.get(item.areaId) : undefined) ?? EMPTY_VENDOR_MAP;
  const cn =
    item.catalogNumbers.find((c) => c.catalogVendorId === primaryVendorId) ??
    item.catalogNumbers[0] ??
    null;
  if (cn) return formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId));
  return item.stampName || "(stamp)";
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
