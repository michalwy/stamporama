import type { CollectionAreaData, AreaCatalogEntry } from "./areas";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "./area-vendor";

/**
 * Everything a new or edited area resolves off its ancestors, so the area dialog can show each
 * field's inherited value as a placeholder rather than copying it in (#377's idiom, #675).
 *
 * Pulled out of the areas panel for #776: the same dialog now opens from the area filter facet,
 * where there is no management tree to read the values off. Pure, so both openers derive them the
 * one way — a quick-add that resolved inheritance differently would create areas that look
 * identical in the tree and number their stamps differently.
 */
export interface AreaInheritedValues {
  inheritedPrimaryId: string | null;
  inheritedPrimaryVendorId: string | null;
  inheritedCatalogPrefix: string | null;
  inheritedPrefixes: AreaCatalogEntry[];
}

/** The nearest ancestor-or-self value of the area-level prefix. `''` at any level is a stated
 * *no prefix* and reads as none. */
export function resolveEffectiveCatalogPrefix(
  areas: CollectionAreaData[],
  areaId: string
): string | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current: CollectionAreaData | undefined = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.catalogPrefix !== null) return current.catalogPrefix || null;
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return null;
}

/** The nearest ancestor-or-self area that names a valuing volume (#675). */
export function resolveEffectivePrimaryCatalogNameId(
  areas: CollectionAreaData[],
  areaId: string
): string | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current: CollectionAreaData | undefined = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.primaryCatalogNameId) return current.primaryCatalogNameId;
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return null;
}

/**
 * What an area created under `parentId` would inherit. A null/absent parent is a top-level area and
 * inherits nothing — which is not the same as "unknown": the dialog then states that a valuing
 * volume is required here, and that prompt is only correct when nothing rolls down.
 *
 * An id naming no area — a parent deleted underneath an open dialog — resolves to the same empty
 * answer, because each walk below starts by looking the id up and finds nothing.
 */
export function resolveInheritedAreaValues(
  areas: CollectionAreaData[],
  parentId: string | null | undefined
): AreaInheritedValues {
  if (!parentId) {
    return {
      inheritedPrimaryId: null,
      inheritedPrimaryVendorId: null,
      inheritedCatalogPrefix: null,
      inheritedPrefixes: [],
    };
  }
  return {
    inheritedPrimaryId: resolveEffectivePrimaryCatalogNameId(areas, parentId),
    inheritedPrimaryVendorId: effectivePrimaryVendorId(areas, parentId),
    inheritedCatalogPrefix: resolveEffectiveCatalogPrefix(areas, parentId),
    inheritedPrefixes: effectiveVendorsForArea(areas, parentId),
  };
}
