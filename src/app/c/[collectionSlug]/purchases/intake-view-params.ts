// **How the Intake documents list is being looked at** (#1392) — the vocabulary, the precedence and
// the narrowing rule, kept pure and out of the panel so a test can read them.
//
// `auctions/sales/[saleId]/sale-view-params.ts` is the same shape one screen over, and the two are
// deliberately alike: the toolbar's state is a value with names, defaults and a stated answer to
// *does this narrow what I am looking at*, not a scattering of `searchParams.get`s. Every setting is
// kept in the address and remembered per collection, so the list comes back as the collector left
// it however it is reached — the sidebar, Quick jump, a purchase's screen — and a reload, the Back
// button and a copied link all agree with what is on screen (#844).
//
// **One setting constrains another.** A delivery status is a purchase's own (#1323): while only
// opening balances are listed there is nothing for it to filter, so the status toggles are not
// drawn. A remembered status must not survive that silently — it would be a filter in force with
// no control on screen to show it or switch it off. So {@link resolveIntakeView} drops it on the
// way in, whatever the address or the memory says, and {@link intakeViewUpdatesFor} clears it on
// the way out when *Opening balances* is picked, so it does not come back when the type is
// switched off again. The collector's rule, restated for a restore rather than invented for it.

import {
  INTAKE_PARTY_NONE,
  isIntakeDocumentType,
  parseIntakePartyIds,
  type IntakeDocumentType,
} from "@/lib/purchase-kind";
import type { PurchaseSortBy, PurchaseStatus } from "@/lib/purchases";

/** Everything the toolbar over the Intake documents list decides. */
export interface IntakeView {
  /** One document type, or every type. */
  type?: IntakeDocumentType;
  /** One delivery status, or every status. Never set while `type` is `opening_balance`. */
  status?: PurchaseStatus;
  /** Platform ids, {@link INTAKE_PARTY_NONE} among them for *No platform*. Empty is every platform. */
  platforms: string[];
  /** Supplier ids, on the same terms as {@link platforms}. */
  suppliers: string[];
  sortBy: PurchaseSortBy;
  sortDir: "asc" | "desc";
}

export const INTAKE_STATUSES: readonly PurchaseStatus[] = ["preparing", "in_transit", "arrived"];
export const INTAKE_SORTS: readonly PurchaseSortBy[] = ["purchasedAt", "createdAt"];

/**
 * What the list shows with nothing said. **A default is never written** — to the address or to the
 * memory — so a list nobody has narrowed keeps a clean URL and an empty stored set.
 */
export const INTAKE_VIEW_DEFAULTS: IntakeView = {
  type: undefined,
  status: undefined,
  platforms: [],
  suppliers: [],
  sortBy: "purchasedAt",
  sortDir: "desc",
};

/**
 * The search param each setting travels as. The four this list had before #1392 keep their names,
 * so an address bookmarked before it still means what it meant.
 *
 * Typed over **every** key of {@link IntakeView}, `sale-view-params.ts`' reason: a control added to
 * the toolbar fails to compile until somebody has said what it is called in the address, which is
 * what stands between "remembered" and "remembered except for the one nobody wired up".
 */
const VIEW_PARAM: { [K in keyof Required<IntakeView>]-?: string } = {
  type: "type",
  status: "status",
  platforms: "platform",
  suppliers: "supplier",
  sortBy: "sortBy",
  sortDir: "sortDir",
};

/** The params this screen tracks, for `usePersistedFilterParams` and for the address mirror. */
export const INTAKE_VIEW_PARAMS: readonly string[] = Object.values(VIEW_PARAM);

/** The two params that carry party ids, which a remembered set can hold stale ones of. */
export const INTAKE_PARTY_PARAMS: readonly string[] = [VIEW_PARAM.platforms, VIEW_PARAM.suppliers];

const VIEW_KEYS = Object.keys(VIEW_PARAM) as (keyof IntakeView)[];

/**
 * The view in force, from whatever answers for a param — the URL where it names one, the remembered
 * set otherwise (`usePersistedFilterParams`' reader decides that precedence; this only validates).
 *
 * **Every value is checked against what exists**, because both homes can hold a stale one: an
 * unrecognised type, status or sort falls back to the default rather than narrowing to nothing.
 * Party ids are not checked here — which ids exist is the server's answer, and a stale *stored* one
 * is pruned before it reaches this ({@link pruneStoredParties}).
 */
export function resolveIntakeView(readParam: (key: string) => string | null): IntakeView {
  const typeRaw = readParam(VIEW_PARAM.type);
  const type = isIntakeDocumentType(typeRaw) ? typeRaw : undefined;
  const statusRaw = readParam(VIEW_PARAM.status) ?? "";
  const sortRaw = readParam(VIEW_PARAM.sortBy) ?? "";
  return {
    type,
    // A purchase's field, and there are no purchases on screen — the note at the top.
    status:
      type !== "opening_balance" && INTAKE_STATUSES.includes(statusRaw as PurchaseStatus)
        ? (statusRaw as PurchaseStatus)
        : undefined,
    platforms: parseIntakePartyIds(readParam(VIEW_PARAM.platforms)),
    suppliers: parseIntakePartyIds(readParam(VIEW_PARAM.suppliers)),
    sortBy: INTAKE_SORTS.includes(sortRaw as PurchaseSortBy)
      ? (sortRaw as PurchaseSortBy)
      : INTAKE_VIEW_DEFAULTS.sortBy,
    sortDir: readParam(VIEW_PARAM.sortDir) === "asc" ? "asc" : "desc",
  };
}

/** Whether the status toggles are offered, and a status can be in force, for this type. */
export function intakeViewOffersStatus(type: IntakeDocumentType | undefined): boolean {
  return type !== "opening_balance";
}

/**
 * A remembered party list with the ids that no longer appear on any document taken out —
 * `{@link INTAKE_PARTY_NONE}` always stays. `null` where nothing is left.
 *
 * Applied to the **stored** value only, the auction lots list's rule (#1018): a supplier whose
 * documents have all been deleted would otherwise narrow the list to nothing on every visit, from a
 * choice the collector can no longer even see in the menu. A link that names one is left alone — it
 * says what it said when it was copied, and the band says what it is narrowing by.
 */
export function pruneStoredParties(
  stored: string | null,
  known: ReadonlySet<string>
): string | null {
  const kept = parseIntakePartyIds(stored).filter((id) => id === INTAKE_PARTY_NONE || known.has(id));
  return kept.length > 0 ? kept.join(",") : null;
}

/** One setting as the address carries it, or `""` where it is at its default and is not written. */
function serialize(key: keyof IntakeView, view: Partial<IntakeView>): string {
  const value = view[key];
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(",");
  if (value === INTAKE_VIEW_DEFAULTS[key]) return "";
  return String(value);
}

/**
 * The param updates one change to the toolbar amounts to — the shape the panel's single
 * `updateParams` funnel takes, where `""` deletes.
 *
 * **Only the keys named are written**, so a press says what it changed and nothing else. The one
 * addition is the rule at the top of this file: picking *Opening balances* takes the status with it,
 * in the same write.
 */
export function intakeViewUpdatesFor(patch: Partial<IntakeView>): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    if (!(key in patch)) continue;
    updates[VIEW_PARAM[key]] = serialize(key, patch);
  }
  if ("type" in patch && !intakeViewOffersStatus(patch.type)) updates[VIEW_PARAM.status] = "";
  return updates;
}

/**
 * One setting **narrowing** the list, as the band under the toolbar reports it (#1018's shape): the
 * setting, and its value. The wording is the panel's, in the words of the control that set it, so the
 * band points at something the collector can find and switch off.
 */
export type IntakeNarrowing =
  | { key: "type"; value: IntakeDocumentType }
  | { key: "status"; value: PurchaseStatus }
  | { key: "platforms" | "suppliers"; value: string[] };

/**
 * Every setting currently narrowing the list, in the order the toolbar reads. The sort is not one —
 * an order hides nothing — so it is neither announced nor cleared.
 */
export function intakeViewNarrowings(view: IntakeView): IntakeNarrowing[] {
  const out: IntakeNarrowing[] = [];
  if (view.type) out.push({ key: "type", value: view.type });
  if (view.status) out.push({ key: "status", value: view.status });
  if (view.platforms.length > 0) out.push({ key: "platforms", value: view.platforms });
  if (view.suppliers.length > 0) out.push({ key: "suppliers", value: view.suppliers });
  return out;
}

/**
 * Back to every document in one press — `""` for each setting that narrows, and nothing for the
 * sort. Kept beside {@link intakeViewNarrowings} so the band and its button cannot disagree: a filter
 * the band announces and the button misses is a *Clear filters* that leaves the band up.
 */
export function intakeViewClearUpdates(): Record<string, string> {
  return {
    [VIEW_PARAM.type]: "",
    [VIEW_PARAM.status]: "",
    [VIEW_PARAM.platforms]: "",
    [VIEW_PARAM.suppliers]: "",
  };
}

/**
 * The view in force, written **back into the address** — #844's missing half.
 *
 * A setting restored from memory and applied to the list but never written to the URL leaves a
 * reload, a Back press and a copied link with nothing to read. One rule makes it safe to run on every
 * render: **only a value that differs from both the default and the address is written**. So it
 * returns `null` where the address already says what the list shows, and a list nobody has narrowed
 * keeps a clean address.
 *
 * The one deletion it makes is a status the address names while it cannot be in force (the note at
 * the top): left there, a copied link would carry a filter the screen is not applying.
 */
export function intakeViewUrlUpdates(
  view: IntakeView,
  urlValue: (key: string) => string | null
): Record<string, string> | null {
  const updates: Record<string, string> = {};
  for (const key of VIEW_KEYS) {
    const param = VIEW_PARAM[key];
    const value = serialize(key, view);
    if (value && (urlValue(param) ?? "") !== value) updates[param] = value;
  }
  if (!intakeViewOffersStatus(view.type) && urlValue(VIEW_PARAM.status) !== null) {
    updates[VIEW_PARAM.status] = "";
  }
  return Object.keys(updates).length > 0 ? updates : null;
}
