import type { CollectionAreaData, AreaCatalogEntry } from "./areas";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "./area-vendor";

/**
 * Everything a new or edited area resolves off its ancestors, so the area dialog can show each
 * field's inherited value as a placeholder rather than copying it in (#377's idiom, #675).
 *
 * Pulled out of the areas panel for #776: the same dialog now opens from the area filter facet,
 * where there is no management tree to read the values off. Pure, so every opener derives them the
 * one way — a quick-add that resolved inheritance differently would create areas that look
 * identical in the tree and number their stamps differently. Since #954 the form itself resolves
 * them, off the parent currently chosen in its picker, so no opener passes them in at all.
 */
export interface AreaInheritedValues {
  inheritedPrimaryId: string | null;
  inheritedPrimaryVendorId: string | null;
  inheritedCatalogPrefix: string | null;
  inheritedPrefixes: AreaCatalogEntry[];
  /** The nearest ancestor's anchoring markets (#1634); empty when no ancestor names any, and the
   * area then anchors on the collection's home market. */
  inheritedAnchorMarkets: string[];
  /** Whether the parent chain says its stamps may carry forbidden symbols (#1891) — what *Same as
   * parent* resolves to. False for a top-level area, as for a chain that says nothing. */
  inheritedCoverSymbols: boolean;
}

/** The fields the forbidden-symbols walk reads (#1891), so the server can resolve it off a light read
 * of the tree rather than the whole of {@link CollectionAreaData}. */
export type CoverSymbolsArea = Pick<CollectionAreaData, "id" | "parentId" | "coverSymbols">;

/** Whether an area's stamps may carry forbidden symbols (#1891): the nearest ancestor-or-self that
 * says either way, and off when none does. */
export function resolveEffectiveCoverSymbols(
  areas: readonly CoverSymbolsArea[],
  areaId: string
): boolean {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current: CoverSymbolsArea | undefined = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.coverSymbols !== null) return current.coverSymbols;
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return false;
}

/** Every area whose stamps may carry forbidden symbols (#1891), the flag resolved down the tree. */
export function coverSymbolAreaIds(areas: readonly CoverSymbolsArea[]): Set<string> {
  return new Set(areas.filter((a) => resolveEffectiveCoverSymbols(areas, a.id)).map((a) => a.id));
}

/** The nearest ancestor-or-self area's anchoring markets (#1634) — the whole list, as the server's
 * `resolveAnchoringMarkets` inherits it. Empty when the chain names none. */
export function resolveEffectiveAnchorMarkets(
  areas: CollectionAreaData[],
  areaId: string
): string[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current: CollectionAreaData | undefined = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.anchorMarkets.length > 0) return current.anchorMarkets;
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return [];
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
      inheritedAnchorMarkets: [],
      inheritedCoverSymbols: false,
    };
  }
  return {
    inheritedPrimaryId: resolveEffectivePrimaryCatalogNameId(areas, parentId),
    inheritedPrimaryVendorId: effectivePrimaryVendorId(areas, parentId),
    inheritedCatalogPrefix: resolveEffectiveCatalogPrefix(areas, parentId),
    inheritedPrefixes: effectiveVendorsForArea(areas, parentId),
    inheritedAnchorMarkets: resolveEffectiveAnchorMarkets(areas, parentId),
    inheritedCoverSymbols: resolveEffectiveCoverSymbols(areas, parentId),
  };
}
