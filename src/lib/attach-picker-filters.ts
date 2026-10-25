/**
 * The **Attach existing copies…** picker's own filters (#2121): disposition (#2180), condition,
 * certificate, format, whether a copy is on a purchase, and whether it is still held (#2120). Pure,
 * so the dialog, its route and the unit suite read one definition.
 *
 * Condition, certificate and format are the Copies list's multi-selects, with its two sentinels
 * (`"none"` for no certificate, `"single"` for no format — null *is* a value on both axes,
 * ADR-0006 §2, ADR-0020). The purchase and state filters are chips: a set of independent toggles
 * where **none lit means every value**, so the picker never opens on an empty list because of a
 * chip nobody can see the meaning of.
 *
 * The disposition is the Copies list's multi-select too (#846), and reads as it does there: the three
 * are independent marks a copy carries, not values of one axis, so ticking two asks for the copies
 * carrying **both** — and none ticked is every copy.
 *
 * **Every filter is resolved on the server** (#2179), with the year, the search and the sort: the
 * dialog sends them on the query string ({@link writeAttachQuery}, {@link readAttachQuery}) and
 * receives one page of the narrowed, ordered list at a time, rather than every copy in the area to
 * narrow in the browser.
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

/** The disposition marks (#2180), named by the copy's own flags as the Copies list's URL names
 *  them. */
export const ATTACH_DISPOSITIONS = ["inCollection", "forSale", "forTrade"] as const;
export type AttachDisposition = (typeof ATTACH_DISPOSITIONS)[number];

export const ATTACH_DISPOSITION_LABEL: Record<AttachDisposition, string> = {
  inCollection: "In collection",
  forSale: "For sale",
  forTrade: "For trade",
};

/** Whether a copy is on a purchase: `none` the copies on no lot, `on` those on one. */
export const ATTACH_PURCHASE_VALUES = ["none", "on"] as const;
export type AttachPurchaseValue = (typeof ATTACH_PURCHASE_VALUES)[number];

export const ATTACH_PURCHASE_LABEL: Record<AttachPurchaseValue, string> = {
  none: "Not on a purchase",
  on: "On a purchase",
};

export interface AttachPickerFilters {
  /** The marks a copy must carry, every one of them (#2180); empty is every copy. */
  dispositions: AttachDisposition[];
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
  dispositions: [],
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
    dispositions: oneOf(o.dispositions, ATTACH_DISPOSITIONS),
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

/** The year facet's value: one year, `"none"` for the copies of no year, or null for every year. */
export type AttachYear = number | "none" | null;

/** Everything the picker narrows and orders its list by, beside the area rail and the state. */
export interface AttachReadQuery {
  dispositions: AttachDisposition[];
  conditionIds: string[];
  certificateStatusIds: string[];
  formatIds: string[];
  purchase: AttachPurchaseValue[];
  sortBy: AttachSortKey;
  sortDir: AttachSortDir;
  year: AttachYear;
  search: string;
}

/** The year as the facet stores it (`"1950"`, `"none"`, or null) read as a filter value. */
export function parseAttachYear(raw: string | null | undefined): AttachYear {
  if (raw === "none") return "none";
  return raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
}

/** Put the picker's filters, year, search and sort on a query string (#2179). The state and the
 *  area go on beside them, as they always have. */
export function writeAttachQuery(
  params: URLSearchParams,
  filters: AttachPickerFilters,
  year: string | null,
  search: string
): void {
  for (const d of filters.dispositions) params.append("disposition", d);
  for (const id of filters.conditionIds) params.append("condition", id);
  for (const id of filters.certificateStatusIds) params.append("certificate", id);
  for (const id of filters.formatIds) params.append("format", id);
  for (const value of filters.purchase) params.append("purchase", value);
  params.set("sort", filters.sortBy);
  params.set("dir", filters.sortDir);
  const y = parseAttachYear(year);
  if (y !== null) params.set("year", String(y));
  if (search.trim()) params.set("search", search);
}

/** {@link writeAttachQuery} read back. An unrecognised sort is catalogue order, ascending; the
 *  search is the caller's to trim (the route reads it through `readSearchParam`). */
export function readAttachQuery(sp: URLSearchParams, search: string | undefined): AttachReadQuery {
  const sortBy = sp.get("sort");
  return {
    dispositions: oneOf(sp.getAll("disposition"), ATTACH_DISPOSITIONS),
    conditionIds: sp.getAll("condition").filter(Boolean),
    certificateStatusIds: sp.getAll("certificate").filter(Boolean),
    formatIds: sp.getAll("format").filter(Boolean),
    purchase: oneOf(sp.getAll("purchase"), ATTACH_PURCHASE_VALUES),
    sortBy: isAttachSortKey(sortBy) ? sortBy : DEFAULT_ATTACH_FILTERS.sortBy,
    sortDir: sp.get("dir") === "desc" ? "desc" : "asc",
    year: parseAttachYear(sp.get("year")),
    search: search ?? "",
  };
}

/** The purchase chips as a narrowing: true for the copies on a purchase, false for those on none,
 *  null when both or neither chip is lit. */
export function attachOnPurchase(purchase: readonly AttachPurchaseValue[]): boolean | null {
  return purchase.length === 1 ? purchase[0] === "on" : null;
}
