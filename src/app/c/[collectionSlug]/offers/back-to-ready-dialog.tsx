"use client";

import type { FacebookKitLot } from "@/lib/facebook-auctions";
import { facebookBackToReadyPlan } from "@/lib/facebook-post-rules";
import { ConfirmDialog } from "@/app/dialog-shell";

// *Back to Ready…* on a Facebook post that is up (#1998) — asked from the post's screen and from any
// lot's Facebook card, since the post moves as one. The confirmation names what the move does not do
// to every lot: the lots that stay where they are (sold, withdrawn) and so split the post, and the
// auctions whose recorded bids are cleared.

function lotName(lot: FacebookKitLot): string {
  return lot.lotNo === null ? `offer #${lot.offerNo}` : `lot ${lot.lotNo} (offer #${lot.offerNo})`;
}

function joinNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function BackToReadyDialog({
  postNo,
  lots,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  postNo: number | null;
  lots: readonly FacebookKitLot[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { staying, bidsCleared } = facebookBackToReadyPlan(lots);
  const post = postNo === null ? "the post" : `post #${postNo}`;
  const alone = lots.length < 2;
  const message = [
    alone
      ? "The offer goes back to Ready, as if it had never been published: its listing link is cleared, its post text follows the template again, and its days up stop until it is published again."
      : "Every lot still for sale goes back to Ready, as if it had never been published: its listing link is cleared, its text follows the template again, and its days up stop until the post is published again.",
    staying.length > 0
      ? `${joinNames(staying.map((l) => `${lotName(l)}, ${l.state}`))} ${staying.length === 1 ? "stays" : "stay"} in ${post} as it went up; the others move into a new Ready post in the same group, with the same title, layout and lot order.`
      : null,
    bidsCleared.length > 0
      ? `The ${bidsCleared.length === 1 ? "bid" : "bids"} recorded on ${joinNames(bidsCleared.map((l) => `${lotName(l)} (${l.price} ${l.currency})`))} ${bidsCleared.length === 1 ? "is" : "are"} cleared.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <ConfirmDialog
      title={alone ? "Back to Ready" : `Post #${postNo} back to Ready`}
      message={message}
      actionLabel="Back to Ready"
      pendingLabel="Saving…"
      variant="primary"
      isPending={isPending}
      error={error}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

/** What the toast says once the move is done: the post the lots are Ready in, and the one they left
 *  when it split. */
export function backToReadyDone(moved: { postNo: number; keptPostNo: number | null }): string {
  return moved.keptPostNo === null
    ? `Post #${moved.postNo} is back to Ready`
    : `Back to Ready in new post #${moved.postNo} — post #${moved.keptPostNo} keeps the lots sold or withdrawn`;
}
