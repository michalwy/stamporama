"use client";

import { useMemo } from "react";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
} from "./area-helpers";

export interface AreaVendorMaps {
  /** area id → the area's effective primary catalog vendor id (or null). */
  primaryVendorByArea: Map<string, string | null>;
  /** area id → (catalog vendor id → catalog entry) for that area's effective vendors. */
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
}

/**
 * Derives the per-area primary-vendor and vendor-lookup maps used to render catalog
 * numbers on stamp/issue/copy rows. Shared by the stamps, issues, and inventory list
 * panels and the inventory popup so the (identical) derivation lives in one place.
 */
export function useAreaVendorMaps(areas: CollectionAreaData[]): AreaVendorMaps {
  const primaryVendorByArea = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) m.set(a.id, effectivePrimaryVendorId(areas, a.id));
    return m;
  }, [areas]);

  const vendorMapByArea = useMemo(() => {
    const m = new Map<string, Map<string, AreaCatalogEntry>>();
    for (const a of areas) {
      const vendors = effectiveVendorsForArea(areas, a.id);
      m.set(a.id, new Map(vendors.map((v) => [v.catalogVendorId, v])));
    }
    return m;
  }, [areas]);

  return { primaryVendorByArea, vendorMapByArea };
}
