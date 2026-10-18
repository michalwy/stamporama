"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  MAX_SALE_BYTES,
  MAX_SALE_ENTRIES,
  parseSaleUiState,
  serializeSaleUiState,
} from "@/lib/sale-ui-state";

import { lsGet, notifyLotPref, subscribeLotPref } from "../../shared/lot-view-prefs";
import { createRecordUiStore } from "../../shared/record-ui-store";
import type { CardExpansionStore } from "../../shared/use-card-expansion";

/** The `localStorage` half of a sale's remembered expanded sets (#2034); the shape and the caps are
 * in `@/lib/sale-ui-state`. Read with a null server snapshot, as every stored preference a
 * server-rendered screen reads is, and on `lot-view-prefs`' event so the screen updates as one. */

const ENTRY_PREFIX = "stamporama:sale:ui:";
const INDEX_KEY = "stamporama:sale:ui:index";

const store = createRecordUiStore(INDEX_KEY, {
  maxEntries: MAX_SALE_ENTRIES,
  maxBytes: MAX_SALE_BYTES,
});

/** Which of a sale's sold sets are open, in the shape `useCardExpansion` takes as its store. */
export function useSaleLineExpansion(collectionId: string, saleId: string): CardExpansionStore {
  const key = `${ENTRY_PREFIX}${collectionId}:${saleId}`;
  const raw = useSyncExternalStore(
    subscribeLotPref,
    () => lsGet(key),
    () => null
  );
  // Parsed once per stored value: the hook reads `expanded` on every render and needs it stable.
  const expanded = useMemo(() => parseSaleUiState(raw).lines, [raw]);
  const setExpanded = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      // Re-read at write time rather than closing over the rendered value, so two writes in one
      // render (a fresh set opening as Collapse all lands) do not undo each other.
      const prev = new Set(parseSaleUiState(lsGet(key)).lines);
      store.write(key, serializeSaleUiState({ lines: [...updater(prev)] }));
      notifyLotPref();
    },
    [key]
  );
  return useMemo(() => ({ expanded, setExpanded }), [expanded, setExpanded]);
}
