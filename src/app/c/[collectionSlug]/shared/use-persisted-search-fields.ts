"use client";

import { useCallback, useMemo } from "react";
import { parseSearchFields, writeSearchFields } from "@/lib/search-fields";
import { usePersistedCollectionValue } from "./use-persisted-collection-value";

/**
 * The fields one list's search box matches (#2238), remembered per collection under `namespace`.
 *
 * Remembered **apart from the list's filters** and outside the page address: it is how the box reads
 * what is typed, not a narrowing of the rows, so *Reset filters* leaves it alone and a link into the
 * list carries none of it. Every field ticked is stored as nothing, so the default needs no entry.
 *
 * `ticked` is what the control draws; `narrowed` is what a query sends — the ticked fields, or
 * `undefined` while every one is ticked, so an unnarrowed search keeps the request it always had.
 */
export function usePersistedSearchFields<K extends string>(
  namespace: string,
  collectionId: string,
  keys: readonly K[]
): { ticked: K[]; narrowed: K[] | undefined; setTicked: (next: readonly K[]) => void } {
  const [stored, setStored] = usePersistedCollectionValue(namespace, collectionId);
  const narrowed = useMemo(() => parseSearchFields(stored, keys), [stored, keys]);
  const ticked = useMemo(() => narrowed ?? [...keys], [narrowed, keys]);
  const setTicked = useCallback(
    (next: readonly K[]) => setStored(writeSearchFields(next, keys)),
    [setStored, keys]
  );
  return { ticked, narrowed, setTicked };
}
