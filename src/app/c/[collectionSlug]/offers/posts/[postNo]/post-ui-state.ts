"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  MAX_POST_BYTES,
  MAX_POST_ENTRIES,
  parseFacebookPostUiState,
  serializeFacebookPostUiState,
} from "@/lib/facebook-post-ui-state";

import { lsGet, notifyLotPref, subscribeLotPref } from "../../../shared/lot-view-prefs";
import { createRecordUiStore } from "../../../shared/record-ui-store";

/** The `localStorage` half of a post's remembered *Still for sale* chip (#2081); the shape and the
 * caps are in `@/lib/facebook-post-ui-state`. Read with a null server snapshot, as every stored
 * preference a server-rendered screen reads is, and on `lot-view-prefs`' event. */

const ENTRY_PREFIX = "stamporama:fbpost:ui:";
const INDEX_KEY = "stamporama:fbpost:ui:index";

const store = createRecordUiStore(INDEX_KEY, {
  maxEntries: MAX_POST_ENTRIES,
  maxBytes: MAX_POST_BYTES,
});

/** Whether this post's screen lists only the lots still for sale, and the way to change it. */
export function useFacebookPostStillForSale(
  collectionId: string,
  postId: string
): [boolean, (on: boolean) => void] {
  const key = `${ENTRY_PREFIX}${collectionId}:${postId}`;
  const raw = useSyncExternalStore(
    subscribeLotPref,
    () => lsGet(key),
    () => null
  );
  const stillForSale = useMemo(() => parseFacebookPostUiState(raw).stillForSale, [raw]);
  const set = useCallback(
    (on: boolean) => {
      store.write(key, serializeFacebookPostUiState({ stillForSale: on }));
      notifyLotPref();
    },
    [key]
  );
  return [stillForSale, set];
}
