// **How the Packing supplies screen is being looked at** (#2195, #2196) — the vocabulary, the
// precedence and the narrowing rules, kept pure and out of the panel so a test can read them.
//
// The Facebook posts list's arrangement (`offers/posts/posts-view-params.ts`): every filter of both
// tabs is kept in the address and remembered per collection, so the screen comes back as the
// collector left it, and a reload, the Back button and a copied link agree with what is on screen
// (#844). Which tab is open travels in the address only (`tab`), as Settings' tabs do.

import { isSupplyMovementKind, type SupplyMovementKind } from "@/lib/supply-register-rules";

export type SuppliesTab = "summary" | "register";

export function suppliesTabOf(raw: string | null): SuppliesTab {
  return raw === "register" ? "register" : "summary";
}

/** Everything the two toolbars decide. */
export interface SuppliesView {
  /** Summary: supplies whose name holds this. */
  name: string;
  /** Summary: only the supplies with something on hand. */
  onHand: boolean;
  /** Register: supply ids; empty is every supply. */
  supplies: string[];
  /** Register: movement types; empty is every type. */
  kinds: SupplyMovementKind[];
  /** Register: yyyy-mm-dd, inclusive; empty is open. */
  from: string;
  to: string;
  /** Register: the text search over documents, suppliers, buyers and notes. */
  q: string;
  /** Register: rows grouped by month, each month with its totals. */
  byMonth: boolean;
}

/** What the screen shows with nothing said. A default is never written, to the address or the memory. */
export const SUPPLIES_VIEW_DEFAULTS: SuppliesView = {
  name: "",
  onHand: false,
  supplies: [],
  kinds: [],
  from: "",
  to: "",
  q: "",
  byMonth: false,
};

/** The search param each setting travels as — typed over every key of {@link SuppliesView}, so a new
 *  control fails to compile until somebody has said what it is called in the address. */
const VIEW_PARAM: { [K in keyof SuppliesView]-?: string } = {
  name: "name",
  onHand: "onhand",
  supplies: "supply",
  kinds: "type",
  from: "from",
  to: "to",
  q: "q",
  byMonth: "month",
};

/** The params this screen tracks, for `usePersistedFilterParams` and for the address mirror. */
export const SUPPLIES_VIEW_PARAMS: readonly string[] = Object.values(VIEW_PARAM);

/** The param that carries supply ids, which a remembered set can hold stale ones of. */
export const SUPPLIES_SUPPLY_PARAM = VIEW_PARAM.supplies;

const VIEW_KEYS = Object.keys(VIEW_PARAM) as (keyof SuppliesView)[];

/** The params the register's own controls write — what its *Clear filters* resets. */
const REGISTER_KEYS: (keyof SuppliesView)[] = ["supplies", "kinds", "from", "to", "q"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseList(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * The view in force, from whatever answers for a param — the URL where it names one, the remembered
 * set otherwise (`usePersistedFilterParams` decides that; this only validates). An unrecognised type
 * or a malformed date narrows nothing rather than everything.
 */
export function resolveSuppliesView(readParam: (key: string) => string | null): SuppliesView {
  const date = (key: keyof SuppliesView) => {
    const raw = readParam(VIEW_PARAM[key]) ?? "";
    return DATE.test(raw) ? raw : "";
  };
  return {
    name: readParam(VIEW_PARAM.name) ?? "",
    onHand: readParam(VIEW_PARAM.onHand) === "1",
    supplies: parseList(readParam(VIEW_PARAM.supplies)),
    kinds: parseList(readParam(VIEW_PARAM.kinds)).filter(isSupplyMovementKind),
    from: date("from"),
    to: date("to"),
    q: readParam(VIEW_PARAM.q) ?? "",
    byMonth: readParam(VIEW_PARAM.byMonth) === "1",
  };
}

/** A remembered supply list with the supplies that no longer exist taken out — `null` where nothing
 *  is left (the posts list's rule for its groups, #2108). A link that names one is left alone. */
export function pruneStoredSupplies(stored: string | null, known: ReadonlySet<string>): string | null {
  const kept = parseList(stored).filter((id) => known.has(id));
  return kept.length > 0 ? kept.join(",") : null;
}

/** One setting as the address carries it, or `""` where it is at its default and is not written. */
function serialize(key: keyof SuppliesView, view: Partial<SuppliesView>): string {
  switch (key) {
    case "onHand":
    case "byMonth":
      return view[key] ? "1" : "";
    case "supplies":
    case "kinds":
      return (view[key] ?? []).join(",");
    case "name":
    case "from":
    case "to":
    case "q":
      return view[key] ?? "";
  }
}

/** The param updates one change amounts to, where `""` deletes. Only the keys named are written. */
export function suppliesViewUpdatesFor(patch: Partial<SuppliesView>): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    if (key in patch) updates[VIEW_PARAM[key]] = serialize(key, patch);
  }
  return updates;
}

/** One register setting narrowing the rows, as the band under its toolbar reports it. */
export type RegisterNarrowing =
  | { key: "supplies"; value: string[] }
  | { key: "kinds"; value: SupplyMovementKind[] }
  | { key: "dates"; from: string; to: string }
  | { key: "q"; value: string };

/** Every register setting currently narrowing the rows, in the order the toolbar reads. *By month*
 *  groups rather than narrows, so it is not one. */
export function registerNarrowings(view: SuppliesView): RegisterNarrowing[] {
  const out: RegisterNarrowing[] = [];
  if (view.supplies.length > 0) out.push({ key: "supplies", value: view.supplies });
  if (view.kinds.length > 0) out.push({ key: "kinds", value: view.kinds });
  if (view.from || view.to) out.push({ key: "dates", from: view.from, to: view.to });
  if (view.q.trim()) out.push({ key: "q", value: view.q.trim() });
  return out;
}

/** Back to every movement in one press, leaving the summary's filters and the grouping alone. */
export function registerClearUpdates(): Record<string, string> {
  return Object.fromEntries(REGISTER_KEYS.map((key) => [VIEW_PARAM[key], ""]));
}

/** The view in force, written back into the address (#844): only a value that differs from both the
 *  default and the address, so a screen nobody has narrowed keeps a clean address. */
export function suppliesViewUrlUpdates(
  view: SuppliesView,
  urlValue: (key: string) => string | null
): Record<string, string> | null {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    const param = VIEW_PARAM[key];
    const value = serialize(key, view);
    if (value && (urlValue(param) ?? "") !== value) updates[param] = value;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

/** The summary's rows: by name (as read), narrowed by the name filter and, when asked, to the
 *  supplies with something on hand. */
export function filterSupplySummary<T extends { name: string; onHand: number }>(
  supplies: readonly T[],
  view: Pick<SuppliesView, "name" | "onHand">
): T[] {
  const needle = view.name.trim().toLowerCase();
  return supplies.filter(
    (s) => (!needle || s.name.toLowerCase().includes(needle)) && (!view.onHand || s.onHand > 0)
  );
}
