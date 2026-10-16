import { API_REVIEW_LABEL } from "./auction-review";

/**
 * The *to review* marker on sales written through the agent API (#1948) — the pure half: what the
 * marker holds, how a write accumulates into it, and how it is put into words. The sale-side twin
 * of `auction-review.ts` (#1626).
 *
 * A sale an agent records — read off a marketplace thread, matched to a buyer by name — can be wrong
 * in ways the collector would catch at a glance, so it stays visibly waiting until the collector has
 * looked at it. The marker is set by every API write and cleared only by the collector's *Confirm* —
 * never by an API call, and **never by editing the sale in the app**: reviewing is a deliberate act,
 * and a figure corrected by hand is not the sale reviewed (settled with the collector on 2026-10-16,
 * as #1626 settled it for auctions). Both halves are held in `sales.ts` and in
 * `tests/unit/agent-api-operation-boundary.test.ts`; nothing here writes.
 *
 * Unlike an auction's, which names the **fields** the API changed, a sale's marker names what the API
 * **did**, worded by the writer (*added offer #2680 at 15 PLN*): a sale is mostly written by adding
 * lines to it, and "changed: lines" would say nothing the collector could check at a glance.
 */

/** The marker as a read model carries it. Absent (null) when there is nothing to review. */
export interface SaleApiReviewMark {
  /** The latest API write since the last confirm, as an ISO instant. */
  at: string;
  /** The API recorded the sale, rather than only adding to one the collector had. */
  created: boolean;
  /** What the API did, in the order it did it. Empty for a sale the API recorded with nothing worth
   * naming beyond that. */
  actions: string[];
}

/** The three stored columns on `Sale`. */
export interface StoredSaleApiReview {
  apiReviewAt: Date | null;
  apiReviewCreated: boolean;
  apiReviewActions: string[];
}

/** One API write, as the marker records it: whether it recorded the sale, and what it did, each
 * action already worded (`saleLineAddedAction`). */
export interface SaleApiReviewWrite {
  kind: "created" | "changed";
  actions: readonly string[];
}

/** The stored columns read as a marker, or null when there is none. */
export function readSaleApiReviewMark(row: StoredSaleApiReview): SaleApiReviewMark | null {
  if (row.apiReviewAt === null) return null;
  return {
    at: row.apiReviewAt.toISOString(),
    created: row.apiReviewCreated,
    actions: [...row.apiReviewActions],
  };
}

/**
 * The columns after one more API write.
 *
 * A write **adds to** an unconfirmed marker and never replaces it — a second line must not hide the
 * first from the review it is waiting for: `created` stays once set, and actions are appended in the
 * order done, an action already named not repeated. On a sale with no marker — never marked, or
 * confirmed since — the write starts afresh, so a confirmed *recorded* is not resurrected by a later
 * line.
 */
export function nextSaleApiReview(
  current: StoredSaleApiReview,
  write: SaleApiReviewWrite,
  at: Date
): StoredSaleApiReview {
  const marked = current.apiReviewAt !== null;
  const created = (marked && current.apiReviewCreated) || write.kind === "created";
  const actions = marked ? [...current.apiReviewActions] : [];
  for (const action of write.actions) if (!actions.includes(action)) actions.push(action);
  return { apiReviewAt: at, apiReviewCreated: created, apiReviewActions: actions };
}

/** The columns a confirm writes: no marker. */
export const CONFIRMED_SALE_API_REVIEW: StoredSaleApiReview = {
  apiReviewAt: null,
  apiReviewCreated: false,
  apiReviewActions: [],
};

/** The chip's label — the auctions' own, so the marker reads the same wherever it stands. */
export const SALE_API_REVIEW_LABEL = API_REVIEW_LABEL;

/**
 * What adding one line says (#1948's own example): *added offer #2680 at 15 PLN*, with the set
 * named when the offer has more than one. The price is written as the writer stored it.
 */
export function saleLineAddedAction(line: {
  offerNo: number;
  setLabel?: string | null;
  price: string;
  currency: string;
}): string {
  const set = line.setLabel ? ` (${line.setLabel})` : "";
  return `added offer #${line.offerNo}${set} at ${line.price} ${line.currency}`;
}

/**
 * The chip's hint: what the API did, and when it last wrote. `formatAt` is the screen's own instant
 * formatter, so the hint reads the time the way every other time there does.
 */
export function describeSaleApiReview(
  mark: SaleApiReviewMark,
  formatAt: (iso: string) => string
): string {
  const when = formatAt(mark.at);
  const actions = mark.actions.join("; ");
  if (mark.created && actions) return `Recorded through the agent API: ${actions} — last on ${when}.`;
  if (mark.created) return `Recorded through the agent API on ${when}.`;
  if (actions) return `Changed through the agent API: ${actions} — last on ${when}.`;
  return `Written through the agent API on ${when}.`;
}
