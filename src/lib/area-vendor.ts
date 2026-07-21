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
