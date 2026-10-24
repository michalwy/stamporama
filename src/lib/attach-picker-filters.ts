/**
 * The **Attach existing copies…** picker's own filters (#2121): condition, certificate, format,
 * whether a copy is on a purchase, and whether it is still held (#2120). Pure, so the dialog, its
 * route and the unit suite read one definition.
 *
 * Condition, certificate and format are the Copies list's multi-selects, with its two sentinels
 * (`"none"` for no certificate, `"single"` for no format — null *is* a value on both axes,
 * ADR-0006 §2, ADR-0020). The purchase and state filters are chips: a set of independent toggles
 * where **none lit means every value**, so the picker never opens on an empty list because of a
 * chip nobody can see the meaning of.
 *
 * The state is the one filter resolved on the **server**: it decides which rows are fetched at all,
 * and a picker that fetched every sold and written-off copy to show the held ones would spend its
 * page on rows it hides. The other four narrow the fetched rows client-side, as the year facet and
 * the search already do.
 *
 * The sort (#2147, `attach-picker-sort.ts`) is stored in the same value, so the picker reopens in
 * the order it was left in, as it does with the filters it was left with.
 */

import { isAttachSortKey, type AttachSortDir, type AttachSortKey } from "./attach-picker-sort";

/** Where a copy stands: still held, gone on a sale or a closed trade, or written off (#394).
 *  *Gone* is one value for a sale and a trade because the Copies list asks it as one question
 *  (*Include sold & traded*, #644): to a collector gone is gone. */
export const ATTACH_STATES = ["held", "gone", "disposed"] as const;
export type AttachState = (typeof ATTACH_STATES)[number];

export const ATTACH_STATE_LABEL: Record<AttachState, string> = {
  held: "Held",
  gone: "Sold & traded",
  disposed: "No longer held",
};

/** Whether a copy is on a purchase: `none` the copies on no lot, `on` those on one. */
export const ATTACH_PURCHASE_VALUES = ["none", "on"] as const;
export type AttachPurchaseValue = (typeof ATTACH_PURCHASE_VALUES)[number];

export const ATTACH_PURCHASE_LABEL: Record<AttachPurchaseValue, string> = {
  none: "Not on a purchase",
  on: "On a purchase",
};

export interface AttachPickerFilters {
  conditionIds: string[];
  /** Certificate status ids, `"none"` among them for the copies with no certificate. */
  certificateStatusIds: string[];
  /** Format ids, `"single"` among them for the copies with no format. */
  formatIds: string[];
  purchase: AttachPurchaseValue[];
  states: AttachState[];
  sortBy: AttachSortKey;
  sortDir: AttachSortDir;
}

/** What the picker opens on the first time: everything held, which is what #388 offered, in
 *  catalogue order. */
export const DEFAULT_ATTACH_FILTERS: AttachPickerFilters = {
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
  purchase: [],
  states: ["held"],
  sortBy: "catalogue",
  sortDir: "asc",
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  return [...new Set(stringList(value).filter((v): v is T => (allowed as readonly string[]).includes(v)))];
}

/**
 * The remembered filters, read back from storage. Anything unreadable falls back to the default
 * rather than to an empty filter set: a stored value from an older build must not open the picker
 * on every sold copy the collection ever had.
 */
export function parseAttachFilters(raw: string | null): AttachPickerFilters {
  if (!raw) return DEFAULT_ATTACH_FILTERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_ATTACH_FILTERS;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_ATTACH_FILTERS;
  const o = parsed as Record<string, unknown>;
  return {
    conditionIds: stringList(o.conditionIds),
    certificateStatusIds: stringList(o.certificateStatusIds),
    formatIds: stringList(o.formatIds),
    purchase: oneOf(o.purchase, ATTACH_PURCHASE_VALUES),
    // A stored list with no recognised state is the default, not *every state*: only a list the
    // collector emptied themselves means that, and it is stored as `[]`.
    states: readStoredStates(o.states),
    sortBy: isAttachSortKey(o.sortBy) ? o.sortBy : DEFAULT_ATTACH_FILTERS.sortBy,
    sortDir: o.sortDir === "desc" ? "desc" : "asc",
  };
}

function readStoredStates(value: unknown): AttachState[] {
  if (!Array.isArray(value)) return DEFAULT_ATTACH_FILTERS.states;
  if (value.length === 0) return [];
  const states = oneOf(value, ATTACH_STATES);
  return states.length > 0 ? states : DEFAULT_ATTACH_FILTERS.states;
}

export function serializeAttachFilters(filters: AttachPickerFilters): string {
  return JSON.stringify(filters);
}

/** The states a fetch asks for: the lit chips, or every state when none is lit. */
export function effectiveAttachStates(states: readonly AttachState[]): AttachState[] {
  return states.length === 0 ? [...ATTACH_STATES] : ATTACH_STATES.filter((s) => states.includes(s));
}

/** The states named on the route's query string; unrecognised values are dropped, and a request
 *  naming none is #388's held-only read. */
export function readAttachStates(values: readonly string[]): AttachState[] {
  const states = ATTACH_STATES.filter((s) => values.includes(s));
  return states.length > 0 ? states : ["held"];
}

/** Toggle one value of a chip set. */
export function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** One multi-select axis whose null is a value under `sentinel`. Empty is no filter. */
function matchesNullable(id: string | null, ids: readonly string[], sentinel: string): boolean {
  if (ids.length === 0) return true;
  return ids.includes(id ?? sentinel);
}

/** The fields of a copy the client-side filters read. */
export interface AttachFilterCopy {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  purchase: { id: string } | null;
}

/** Whether a fetched copy passes the client-side filters — every axis but the state, which the
 *  server has already applied. */
export function matchesAttachFilters(copy: AttachFilterCopy, filters: AttachPickerFilters): boolean {
  if (filters.conditionIds.length > 0 && !filters.conditionIds.includes(copy.conditionId)) {
    return false;
  }
  if (!matchesNullable(copy.certificateStatusId, filters.certificateStatusIds, "none")) return false;
  if (!matchesNullable(copy.formatId, filters.formatIds, "single")) return false;
  if (filters.purchase.length === 1) {
    const onOne = copy.purchase != null;
    if (filters.purchase[0] === "on" ? !onOne : onOne) return false;
  }
  return true;
}
