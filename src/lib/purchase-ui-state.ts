/**
 * The purchase-order screen's remembered UI state, and the cap that keeps it from growing forever.
 *
 * The order screen is worked through over several sittings — lots opened, issue groups collapsed as
 * they are filed, filters set to whatever the current pass is about. None of it survived a reload,
 * so resuming a part-finished intake meant clicking the screen back into shape. It is remembered
 * here, **per order**.
 *
 * **No TTL.** An order untouched for a year keeps its state as long as it is within the cap. A stale
 * expansion state costs nothing — the ids that no longer exist are simply not on screen — whereas a
 * wrongly-expired one costs exactly the clicks this exists to remove.
 *
 * **An LRU cap instead**, on two axes at once:
 *
 *  - `MAX_ENTRIES` — orders worked on recently. Fifty is well past what any pass reaches back to.
 *  - `MAX_BYTES` — a budget inside the ~5 MB origin quota, which is shared with every other stored
 *    preference and must not be spent down to the edge.
 *
 * Both are needed. A `cuid()` is 25 chars, so one id in JSON is ~28, and `localStorage` counts
 * UTF-16 — 2 bytes per char. That puts a typical order (8 lots × 20 collapsed groups) near 10 KB and
 * a heavy one (15 × 60) near 51 KB: a **fifty-fold spread**, so a count cap alone cannot bound the
 * bytes, while a byte cap alone would hold hundreds of ancient entries for no reason.
 *
 * This module is pure so it can be tested without a DOM; the `localStorage` and React halves live in
 * `app/c/[collectionSlug]/shared/purchase-ui-state.ts`.
 */

/** Orders kept before the least-recently-used is dropped. */
export const MAX_ENTRIES = 50;

/** Byte budget for all entries together, against a ~5 MB origin quota shared with everything else. */
export const MAX_BYTES = 1_500_000;

/** What the order screen remembers. Every field is a *view* choice — nothing here is data, so a
 * stored entry that has drifted from the order can always be dropped rather than reconciled. */
export interface PurchaseUiState {
  /** Expanded lot cards (#382). */
  lots: string[];
  /** Collapsed issue groups, keyed by lot id — or by `ORDER_GROUP_SCOPE` for the order-level view. */
  groups: Record<string, string[]>;
  /** The header chip filter (`LotCopyFilter`); null when off. Held per **order** since #743 — it
   * governs every view of the order's copies, not one lot card. */
  filter: string | null;
  /** The order-level disposition filter (#622); null when off. */
  disposition: string | null;
  /** The scans card (#566): whether it is open, its tile filter, whether set-aside batches show,
   * and the per-batch expansion choices keyed by batch number. */
  scans: {
    open: boolean;
    filter: string;
    showDone: boolean;
    batches: Record<string, boolean>;
  };
}

/** The `groups` key for the order-level copies view, which is not any one lot. */
export const ORDER_GROUP_SCOPE = "order";

export const EMPTY_PURCHASE_UI_STATE: PurchaseUiState = Object.freeze({
  lots: [],
  groups: {},
  filter: null,
  disposition: null,
  scans: Object.freeze({ open: false, filter: "all", showDone: false, batches: {} }),
}) as PurchaseUiState;

/** An entry in the most-recently-used index: which order, when it was last written, how big it is.
 * The sizes are held here so eviction never has to read and parse every entry to weigh them. */
export interface UiStateIndexEntry {
  key: string;
  at: number;
  bytes: number;
}

export interface Caps {
  maxEntries: number;
  maxBytes: number;
}

const DEFAULT_CAPS: Caps = { maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES };

/**
 * Record a write to `key` and evict whatever no longer fits.
 *
 * The index is held **most-recently-used first**, so eviction is a pop from the tail and the caller
 * never sorts. The entry just written is moved to the front, which is what makes "least recently
 * used" mean *by the collector*, not by creation date: an order reopened after months is as safe as
 * one created today.
 *
 * The entry being written is never evicted, even when it alone exceeds the byte budget — dropping
 * what the collector is looking at right now to satisfy a cap is worse than briefly exceeding it,
 * and the next write from a different order will clear it.
 */
export function touchAndEvict(
  index: readonly UiStateIndexEntry[],
  key: string,
  at: number,
  bytes: number,
  caps: Caps = DEFAULT_CAPS
): { index: UiStateIndexEntry[]; evicted: string[] } {
  const next: UiStateIndexEntry[] = [
    { key, at, bytes },
    ...index.filter((e) => e.key !== key),
  ];
  const evicted: string[] = [];
  let total = next.reduce((sum, e) => sum + e.bytes, 0);
  // Stop at one: the head is the entry just written, which is not a candidate.
  while (next.length > 1 && (next.length > caps.maxEntries || total > caps.maxBytes)) {
    const dropped = next.pop() as UiStateIndexEntry;
    total -= dropped.bytes;
    evicted.push(dropped.key);
  }
  return { index: next, evicted };
}

/** Drop `key` from the index — the other half of eviction, for an entry removed directly. */
export function forgetEntry(
  index: readonly UiStateIndexEntry[],
  key: string
): UiStateIndexEntry[] {
  return index.filter((e) => e.key !== key);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function stringArrayMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const ids = stringArray(v);
    if (ids.length > 0) out[k] = ids;
  }
  return out;
}

function scalarMap<T>(value: unknown, keep: (v: unknown) => v is T): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keep(v)) out[k] = v;
  }
  return out;
}

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Read a stored entry, tolerating anything. A malformed or half-written entry reads as *no stored
 * state* rather than throwing: this is view state, and the honest fallback is the screen's defaults.
 * That is also why there is no schema version — a shape change simply loses the fields it no longer
 * recognises, which costs a few clicks once.
 */
export function parsePurchaseUiState(raw: string | null): PurchaseUiState {
  if (!raw) return EMPTY_PURCHASE_UI_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PURCHASE_UI_STATE;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_PURCHASE_UI_STATE;
  const o = parsed as Record<string, unknown>;
  const scans = (o.scans ?? {}) as Record<string, unknown>;
  return {
    lots: stringArray(o.lots),
    groups: stringArrayMap(o.groups),
    filter: typeof o.filter === "string" ? o.filter : null,
    disposition: typeof o.disposition === "string" ? o.disposition : null,
    scans: {
      open: scans.open === true,
      filter: typeof scans.filter === "string" ? scans.filter : "all",
      showDone: scans.showDone === true,
      batches: scalarMap(scans.batches, isBoolean),
    },
  };
}

/** True when an entry holds nothing worth a slot — the screen at its defaults. Such an entry is
 * removed rather than stored, so merely opening an order never consumes one of the fifty. */
export function isEmptyPurchaseUiState(state: PurchaseUiState): boolean {
  return (
    state.lots.length === 0 &&
    Object.keys(state.groups).length === 0 &&
    state.filter === null &&
    state.disposition === null &&
    !state.scans.open &&
    !state.scans.showDone &&
    state.scans.filter === "all" &&
    Object.keys(state.scans.batches).length === 0
  );
}

/** `localStorage` counts UTF-16 code units, so a stored string costs two bytes per character. */
export function storedBytes(raw: string): number {
  return raw.length * 2;
}
