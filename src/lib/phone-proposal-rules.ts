// Proposals on the phone (#2625, ADR-0072) — pure, no Prisma, so the unit suite holds it.
//
// The phone lists proposals and hands one to its buyer through the phone's own share menu. What is a
// proposal's rule stays in `proposal-rules.ts`; what is here is only what the phone decides: which
// proposals its list shows, what one share carries, and when a share marks the proposal Sent.

import { OPEN_PROPOSAL_STATUSES, proposalMoveRefusal, type ProposalStatus } from "./proposal-rules";

/** The list's one narrowing, kept in the URL as `show`: the open proposals (the default) or every one. */
export type PhoneProposalShow = "open" | "all";

export const PHONE_PROPOSAL_SHOW_LABEL: Record<PhoneProposalShow, string> = {
  open: "Open — preparing and sent",
  all: "Every proposal",
};

/** What the address's `show` asks for: `all`, else the open ones — an unknown value is the default. */
export function parsePhoneProposalShow(raw: string | null | undefined): PhoneProposalShow {
  return raw === "all" ? "all" : "open";
}

/** The statuses the list reads under a choice; empty is every one, as the desk's list reads it. */
export function phoneProposalStatuses(show: PhoneProposalShow): readonly ProposalStatus[] {
  return show === "all" ? [] : OPEN_PROPOSAL_STATUSES;
}

/** *3 lots* on a row. */
export function phoneLotCountText(count: number): string {
  return count === 1 ? "1 lot" : `${count} lots`;
}

/**
 * What one share hands the chat app: the message, a blank line and the live link — the two things the
 * desk's card copies apart, together, since a chat app takes one text. The message is the Direct
 * platform's template and nothing else (#1692): with no template there is no message, and the link goes
 * alone rather than under words made up for it.
 */
export function phoneProposalShareText(message: string | null, link: string): string {
  return message ? `${message}\n\n${link}` : link;
}

/**
 * Whether handing the proposal over through the share menu marks it Sent (#2625, settled with the
 * collector on 2026-11-21): a share that went through does, exactly when the desk's *Mark sent* could
 * — a Preparing proposal with a lot. Copying the message or the link changes nothing, as at the desk
 * (#2329), and a Sent proposal is shared again as it is.
 */
export function phoneShareMarksSent(status: ProposalStatus, lotCount: number): boolean {
  return status === "preparing" && proposalMoveRefusal(status, "send", lotCount) === null;
}

/**
 * Whether a share that did not go through was the collector closing the menu — nothing to report —
 * rather than a failure to say. The share menu rejects with `AbortError` when dismissed.
 */
export function isShareDismissed(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/**
 * A lot's picture on the phone: the first of the photos the buyer is sent — what a buyer sees first,
 * as an offer's phone screen pictures it (#2008) — else its first copy's front photo, else none.
 */
export function phoneProposalLotPicture(
  images: readonly { photoId: string }[] | undefined,
  copyPhotoId: string | null
): { photoId: string; copy: boolean } | null {
  const first = images?.[0];
  if (first) return { photoId: first.photoId, copy: false };
  return copyPhotoId ? { photoId: copyPhotoId, copy: true } : null;
}
