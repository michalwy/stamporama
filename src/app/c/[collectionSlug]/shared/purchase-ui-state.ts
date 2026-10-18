"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  EMPTY_PURCHASE_UI_STATE,
  isEmptyPurchaseUiState,
  MAX_BYTES,
  MAX_ENTRIES,
  parsePurchaseUiState,
  type PurchaseUiState,
} from "@/lib/purchase-ui-state";

import { lsGet, notifyLotPref, subscribeLotPref } from "./lot-view-prefs";
import { createRecordUiStore } from "./record-ui-store";
import type { CardExpansionStore } from "./use-card-expansion";

/**
 * The `localStorage` half of the order screen's remembered UI state — the caps and the shape of an
 * entry are in `@/lib/purchase-ui-state`, which is pure and carries the reasoning.
 *
 * Two kinds of key. One **entry per order**, and one small **index** listing every entry
 * most-recently-used first with its size, so eviction never has to read and parse the entries to
 * decide what to drop. The index is the reason the cap can be enforced at all: a key naming only a
 * lot — which is what the collapsed-group state used to be — cannot be traced back to the order it
 * belongs to, and so can never be evicted.
 *
 * Reads go through `useSyncExternalStore` with a **null server snapshot**, the rule for any stored
 * preference a server-rendered screen reads: reading `localStorage` in render makes the
 * pre-hydration pass disagree with the server's and React throws the tree away. Pair it with
 * `useHydrated()` where the value must not flash its default first.
 */

const ENTRY_PREFIX = "stamporama:po:ui:";
const INDEX_KEY = "stamporama:po:ui:index";

/** Where the collapsed issue groups lived before this store (#121). Deleted rather than migrated:
 * the key names a lot and not an order, so these entries could never be evicted, and a collector
 * who loses them re-collapses a few groups once. */
const LEGACY_GROUP_PREFIX = "stamporama:lot:collapsedGroups:";

export function purchaseUiKey(collectionId: string, purchaseId: string): string {
  return `${ENTRY_PREFIX}${collectionId}:${purchaseId}`;
}

const store = createRecordUiStore(INDEX_KEY, { maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES });

function writeEntry(key: string, state: PurchaseUiState): void {
  // A screen sitting at its defaults is not worth one of the fifty slots, and storing it would let
  // orders merely opened in passing push out ones actually being worked on.
  store.write(key, isEmptyPurchaseUiState(state) ? null : JSON.stringify(state));
}

/** Clear the pre-store per-lot keys, once per page load. Runs at subscription time (an effect)
 * rather than in render, and is a plain delete — see `LEGACY_GROUP_PREFIX`. */
let legacyPruned = false;
function pruneLegacyKeys(): void {
  if (legacyPruned || typeof window === "undefined") return;
  legacyPruned = true;
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LEGACY_GROUP_PREFIX)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    /* ignore disabled storage */
  }
}

// One shared parse of the raw entry. Every slice of the order screen reads the same key, so without
// this a heavy order is parsed once per reading component on every render.
let cachedRaw: string | null = null;
let cachedKey = "";
let cachedState: PurchaseUiState = EMPTY_PURCHASE_UI_STATE;

function readState(key: string, raw: string | null): PurchaseUiState {
  if (raw === cachedRaw && key === cachedKey) return cachedState;
  cachedRaw = raw;
  cachedKey = key;
  cachedState = parsePurchaseUiState(raw);
  return cachedState;
}

export type PurchaseUiUpdater = (updater: (prev: PurchaseUiState) => PurchaseUiState) => void;

/**
 * The remembered UI state for one order, and the way to change it.
 *
 * The updater **re-reads the stored entry at write time** rather than closing over the rendered
 * value: the order screen has several independent slices writing into one entry (lot expansion, the
 * filter chips, the scans card), and a stale closure would have one of them undo another.
 */
export function usePurchaseUiState(
  collectionId: string,
  purchaseId: string
): [PurchaseUiState, PurchaseUiUpdater] {
  const key = purchaseUiKey(collectionId, purchaseId);
  const raw = useSyncExternalStore(
    subscribe,
    () => lsGet(key),
    () => null
  );
  const state = readState(key, raw);
  const update = useCallback<PurchaseUiUpdater>(
    (updater) => {
      writeEntry(key, updater(parsePurchaseUiState(lsGet(key))));
      notifyLotPref();
    },
    [key]
  );
  return [state, update];
}

function subscribe(callback: () => void): () => void {
  pruneLegacyKeys();
  return subscribeLotPref(callback);
}

// The slices below exist so the order screen's call sites stay the shape they already were — a
// value and a setter — rather than each one reaching into the whole entry. They all read the same
// key, which is what lets a lot card several levels down write into the same entry as the panel
// without any of it being threaded through props.

/** Which lot cards are open, in the shape `useCardExpansion` takes as its store (#382). */
export function usePurchaseLotExpansion(
  collectionId: string,
  purchaseId: string
): CardExpansionStore {
  const [state, update] = usePurchaseUiState(collectionId, purchaseId);
  const setExpanded = useCallback(
    (updater: (prev: Set<string>) => Set<string>) =>
      update((prev) => ({ ...prev, lots: [...updater(new Set(prev.lots))] })),
    [update]
  );
  return useMemo(() => ({ expanded: state.lots, setExpanded }), [state.lots, setExpanded]);
}

/** The collapsed issue groups of one lot, or of the order-level copies view (#121). Mirrors
 * `usePersistentStringSet`, which is what this replaced. */
export function usePurchaseCollapsedGroups(
  collectionId: string,
  purchaseId: string,
  scope: string
): [Set<string>, (updater: (prev: Set<string>) => Set<string>) => void] {
  const [state, update] = usePurchaseUiState(collectionId, purchaseId);
  const stored = state.groups[scope];
  const value = useMemo(() => new Set(stored ?? []), [stored]);
  const set = useCallback(
    (updater: (prev: Set<string>) => Set<string>) =>
      update((prev) => {
        const next = [...updater(new Set(prev.groups[scope] ?? []))];
        const groups = { ...prev.groups };
        // An empty set is the default, so it is dropped rather than stored — otherwise every lot
        // ever expanded would leave a key behind.
        if (next.length > 0) groups[scope] = next;
        else delete groups[scope];
        return { ...prev, groups };
      }),
    [update, scope]
  );
  return [value, set];
}

/** The order's header chip filter (#121/#177), order-level since #743. `null` is the "none" the
 * call sites already use. */
export function usePurchaseFilter(
  collectionId: string,
  purchaseId: string
): [string | null, (value: string | null) => void] {
  const [state, update] = usePurchaseUiState(collectionId, purchaseId);
  const set = useCallback(
    (value: string | null) => update((prev) => ({ ...prev, filter: value })),
    [update]
  );
  return [state.filter, set];
}

/** The order-level disposition filter (#622). */
export function usePurchaseDispositionFilter(
  collectionId: string,
  purchaseId: string
): [string | null, (value: string | null) => void] {
  const [state, update] = usePurchaseUiState(collectionId, purchaseId);
  const set = useCallback(
    (value: string | null) => update((prev) => ({ ...prev, disposition: value })),
    [update]
  );
  return [state.disposition, set];
}

/** The order-level lot-state filter (#1394): `open`, `closed`, or null for both. */
export function usePurchaseLotStateFilter(
  collectionId: string,
  purchaseId: string
): [string | null, (value: string | null) => void] {
  const [state, update] = usePurchaseUiState(collectionId, purchaseId);
  const set = useCallback(
    (value: string | null) => update((prev) => ({ ...prev, lotState: value })),
    [update]
  );
  return [state.lotState, set];
}

/** The scans card's own state (#566): open, tile filter, set-aside batches shown, and the
 * per-batch expansion choices. */
export function usePurchaseScansUi(
  collectionId: string,
  purchaseId: string
): [PurchaseUiState["scans"], (patch: Partial<PurchaseUiState["scans"]>) => void] {
  const [state, update] = usePurchaseUiState(collectionId, purchaseId);
  const patch = useCallback(
    (values: Partial<PurchaseUiState["scans"]>) =>
      update((prev) => ({ ...prev, scans: { ...prev.scans, ...values } })),
    [update]
  );
  return [state.scans, patch];
}
