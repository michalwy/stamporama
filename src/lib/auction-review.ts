/**
 * The *to review* marker on auction lots and sales written through the agent API (#1626) — the pure
 * half: what the marker holds, how a write accumulates into it, and how it is put into words.
 *
 * The collector accepts an assistant writing lots only if everything it created or changed is
 * visibly waiting for review, and that has to be **enforced** rather than left to a tag the
 * assistant could forget. So the marker is set by every API write and cleared only by the
 * collector's *Confirm* — never by an API call, and never by editing the record in the app, because
 * reviewing is a deliberate act. Both halves of that are held in `auctions.ts` and in
 * `tests/unit/agent-api-operation-boundary.test.ts`; nothing here writes.
 *
 * It says **what the API did**: created the record, or which fields it changed, and when it last
 * wrote. Writes made before a confirm accumulate — a lot created and then given a ceiling reads as
 * both — because a second write must not hide the first from the review it is waiting for.
 */

/** The marker as a read model carries it. Absent (null) when there is nothing to review. */
export interface ApiReviewMark {
  /** The latest API write since the last confirm, as an ISO instant. */
  at: string;
  /** The API created the record, rather than only changing one the collector had. */
  created: boolean;
  /** What the API changed, in the order first changed, without repeats. Empty for a record the API
   * created and has not touched since. */
  fields: string[];
}

/** The three stored columns, as both `AuctionLot` and `AuctionSale` carry them. */
export interface StoredApiReview {
  apiReviewAt: Date | null;
  apiReviewCreated: boolean;
  apiReviewFields: string[];
}

/** One API write, as the marker records it. */
export type ApiReviewWrite = { kind: "created" } | { kind: "changed"; fields: readonly string[] };

/**
 * What a lot's fields are called in the marker's hint. A key the API writes and this map does not
 * name is shown as it is, so a write added later still says *something* rather than nothing.
 */
export const AUCTION_LOT_REVIEW_FIELD_LABEL: Record<string, string> = {
  title: "title",
  lotNo: "lot number",
  url: "listing address",
  endsAt: "closing time",
  startingPrice: "starting price",
  currentBid: "current bid",
  lines: "contents",
  ceiling: "ceiling",
  tags: "tags",
  notStamps: "not-stamps mark",
  outcome: "outcome",
  notes: "notes",
};

/** The same for a sale's terms. */
export const AUCTION_SALE_REVIEW_FIELD_LABEL: Record<string, string> = {
  name: "name",
  url: "address",
  endsAt: "closing time",
  currency: "currency",
  premium: "premium",
  shipping: "shipping",
};

/** The stored columns read as a marker, or null when there is none. */
export function readApiReviewMark(row: StoredApiReview): ApiReviewMark | null {
  if (row.apiReviewAt === null) return null;
  return {
    at: row.apiReviewAt.toISOString(),
    created: row.apiReviewCreated,
    fields: [...row.apiReviewFields],
  };
}

/**
 * The columns after one more API write.
 *
 * A write **adds to** an unconfirmed marker and never replaces it: `created` stays once set, and
 * changed fields are a union in the order first changed. On a record with no marker — never marked,
 * or confirmed since — the write starts afresh, so a confirmed *created* is not resurrected by a
 * later change.
 */
export function nextApiReview(
  current: StoredApiReview,
  write: ApiReviewWrite,
  at: Date
): StoredApiReview {
  const marked = current.apiReviewAt !== null;
  const created = (marked && current.apiReviewCreated) || write.kind === "created";
  const fields = marked ? [...current.apiReviewFields] : [];
  if (write.kind === "changed") {
    for (const field of write.fields) if (!fields.includes(field)) fields.push(field);
  }
  return { apiReviewAt: at, apiReviewCreated: created, apiReviewFields: fields };
}

/** The columns a confirm writes: no marker. */
export const CONFIRMED_API_REVIEW: StoredApiReview = {
  apiReviewAt: null,
  apiReviewCreated: false,
  apiReviewFields: [],
};

/** The chip's label, on a lot, a sale and a sale's lots alike. */
export const API_REVIEW_LABEL = "To review · API";

/**
 * The chip's hint: what the API did, and when it last wrote. `formatAt` is the screen's own instant
 * formatter, so the hint reads the time the way every other time on the row does.
 */
export function describeApiReview(
  mark: ApiReviewMark,
  labels: Record<string, string>,
  formatAt: (iso: string) => string
): string {
  const when = formatAt(mark.at);
  const fields = mark.fields.map((field) => labels[field] ?? field).join(", ");
  if (mark.created && fields) return `Added through the agent API, then changed: ${fields} — last on ${when}.`;
  if (mark.created) return `Added through the agent API on ${when}.`;
  if (fields) return `Changed through the agent API: ${fields} — last on ${when}.`;
  return `Written through the agent API on ${when}.`;
}

/**
 * The sale chip's hint: the sale's own marker, then how many of its lots wait. A sale shows the
 * chip when **either** holds — the collector settled that a sale shows when any of its lots has the
 * marker — so the hint says which of the two put it there.
 */
export function describeSaleApiReview(
  own: ApiReviewMark | null,
  lotsToReview: number,
  formatAt: (iso: string) => string
): string {
  const parts: string[] = [];
  if (own) parts.push(describeApiReview(own, AUCTION_SALE_REVIEW_FIELD_LABEL, formatAt));
  if (lotsToReview > 0) {
    parts.push(
      lotsToReview === 1
        ? "1 lot in this sale was written through the agent API and waits for you to confirm it."
        : `${lotsToReview} lots in this sale were written through the agent API and wait for you to confirm them.`
    );
  }
  return parts.join(" ");
}
