"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { buildAreaVendorMaps, type AreaVendorMaps } from "@/lib/area-vendor";

export type { AreaVendorMaps };

/**
 * Derives the per-area primary-vendor and vendor-lookup maps used to render catalog
 * numbers on stamp/issue/copy rows. Shared by the stamps, issues, and inventory list
 * panels and the inventory popup so the (identical) derivation lives in one place. The
 * derivation itself lives in `@/lib/area-vendor` so the server lot-intake reads (#172)
 * share it.
 */
export function useAreaVendorMaps(areas: CollectionAreaData[]): AreaVendorMaps {
  return useMemo(() => buildAreaVendorMaps(areas), [areas]);
}
