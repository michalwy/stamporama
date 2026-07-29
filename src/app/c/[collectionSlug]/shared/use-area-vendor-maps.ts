"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CollectionAreaData } from "@/lib/areas";
import {
  buildAreaVendorMaps,
  groupIssuePrefixRows,
  type AreaVendorMaps,
  type IssuePrefixMap,
  type IssuePrefixRow,
} from "@/lib/area-vendor";

export type { AreaVendorMaps };

const EMPTY_PREFIXES: IssuePrefixMap = new Map();

/**
 * The collection's per-issue catalog prefix overrides (#377). Fetched as one whole map rather than
 * per row: a stamp's prefix depends on its issue as well as its area, every list screen needs the
 * answer before it can draw a single catalog chip, and the table only holds rows for issues that
 * override something. Cached per collection, so the sixteen screens calling
 * {@link useAreaVendorMaps} share one request.
 */
function useIssuePrefixMap(collectionId: string | undefined): IssuePrefixMap {
  const { data } = useQuery<IssuePrefixRow[]>({
    // Deliberately inside the `["issues", collectionId]` namespace: saving an issue is the only
    // thing that changes these, and every such flow already calls `invalidateList`, which prefix-
    // matches this key. A namespace of its own would need every issue mutation to remember it.
    queryKey: ["issues", collectionId, "catalog-prefixes"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/issues/catalog-prefixes`);
      if (!res.ok) throw new Error("Failed to load issue catalog prefixes");
      const json = await res.json();
      return json.prefixes as IssuePrefixRow[];
    },
    enabled: !!collectionId,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => (data ? groupIssuePrefixRows(data) : EMPTY_PREFIXES), [data]);
}

/**
 * Derives the per-area primary-vendor and vendor-lookup maps used to render catalog
 * numbers on stamp/issue/copy rows. Shared by the stamps, issues, and inventory list
 * panels and the inventory popup so the (identical) derivation lives in one place. The
 * derivation itself lives in `@/lib/area-vendor` so the server lot-intake reads (#172)
 * share it.
 *
 * Pass `collectionId` to fold in the per-issue prefix overrides (#377) — resolve a row's catalog
 * numbers through `vendorMapFor(areaId, issueId)` and they follow. Omitting it keeps the
 * area-only behaviour, which is right only where no issue is in play.
 */
export function useAreaVendorMaps(
  areas: CollectionAreaData[],
  collectionId?: string
): AreaVendorMaps {
  const prefixByIssue = useIssuePrefixMap(collectionId);
  return useMemo(
    () => buildAreaVendorMaps(areas, prefixByIssue),
    [areas, prefixByIssue]
  );
}
