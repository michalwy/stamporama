/**
 * The *to review* marker on copies the agent API adds to a purchase lot or corrects there (#2551) —
 * the pure half. It is #1626's marker on one more record: the same three columns as an auction lot's,
 * accumulated by the same `nextApiReview` and put into words by the same `describeApiReview`, so a
 * copy, a lot and a sale written by the assistant all read alike. Nothing here writes.
 *
 * Set by `lot-copies-api.ts` in the write's own transaction; cleared only by the collector's
 * *Confirm* on the purchase's screen (`confirmCopyApiReviews`). Editing the copy in the app does not
 * clear it — reviewing is a deliberate act, as on every other marked record.
 */
import {
  describeApiReview,
  readApiReviewMark,
  type ApiReviewMark,
  type StoredApiReview,
} from "./auction-review";

/** What a copy's corrected fields are called in the marker's hint. */
export const COPY_REVIEW_FIELD_LABEL: Record<string, string> = {
  stamp: "stamp",
  condition: "condition",
  format: "format",
};

/** The fields an API correction of a copy can change, in the order the hint names them. */
export const COPY_REVIEW_FIELDS = ["stamp", "condition", "format"] as const;
export type CopyReviewField = (typeof COPY_REVIEW_FIELDS)[number];

/** The stored columns as a copy's read model carries them: null when there is nothing to review. */
export function readCopyApiReview(row: StoredApiReview): ApiReviewMark | null {
  return readApiReviewMark(row);
}

/** The chip's hint on a copy: what the API did, when it last wrote, and where it is confirmed. */
export function describeCopyApiReview(mark: ApiReviewMark, formatAt: (iso: string) => string): string {
  return `${describeApiReview(mark, COPY_REVIEW_FIELD_LABEL, formatAt)} Confirm it on its purchase's screen.`;
}

/** The lot header's count chip hint. */
export function describeLotCopiesToReview(count: number): string {
  return `${count === 1 ? "1 copy of this lot was" : `${count} copies of this lot were`} added or corrected through the agent API and not yet confirmed.`;
}
