"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StampSizePresetData } from "@/lib/stamp-size-presets";

/** The one key every preset screen reads and every preset write refreshes. */
export function stampSizePresetsQueryKey(collectionId: string) {
  return ["stamp-size-presets", collectionId] as const;
}

/**
 * The collection's stamp size presets (#805; ADR-0048), in the collector's dragged order, cached for
 * the pickers that offer them — the stamp form's size row, the apply dialog, and the stamp-range
 * dialog after them (#807). `useCollectionStampAttributes`'s shape: a handful of rows every opener
 * wants whole.
 *
 * The Settings panel (#804) reads them server-side and refreshes its own route, so it does not
 * invalidate this key; the 30-second default stale time is what bounds a picker opened straight
 * after an edit there, and a query key is re-read on every fresh mount of a picker past that.
 */
export function useStampSizePresets(collectionId: string) {
  return useQuery<StampSizePresetData[]>({
    queryKey: stampSizePresetsQueryKey(collectionId),
    queryFn: async () => {
      const { getStampSizePresetsAction } = await import("@/app/actions/stamp-size-presets");
      return getStampSizePresetsAction(collectionId);
    },
  });
}

export function useInvalidateStampSizePresets() {
  const queryClient = useQueryClient();
  return (collectionId: string) =>
    queryClient.invalidateQueries({ queryKey: stampSizePresetsQueryKey(collectionId) });
}
