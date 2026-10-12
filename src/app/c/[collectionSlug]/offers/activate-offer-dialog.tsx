"use client";

import { useEffect, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";
import {
  facebookDefaultEndsAt,
  isFacebookPendingPostUrl,
  type FacebookApprovalClosing,
} from "@/lib/facebook-post-rules";
import {
  formatInstant,
  fromLocalInputValue,
  toLocalInputValue,
} from "@/app/c/[collectionSlug]/auctions/auction-format";

// The publish step of the bulk listing workspace (#322): the collector has just pasted this listing
// into the platform's own form, and the platform handed back a URL. That URL is the one thing the app
// cannot derive, so publishing asks for it here rather than leaving it to a later edit — a live
// listing with no link is the record that goes stale first.
//
// It stays optional: some platforms only mint the URL once the listing is approved. Publishing
// without one is a normal outcome, and the offer's header form takes it later.
//
// Activating from an **offer's own screen** (#399) asks the same question through the same dialog —
// `ready → active` is one transition however it is reached, and having only the bulk workspace prompt
// meant the URL was silently skipped on the surface a single listing is posted from. It is asked
// **only when the offer has no URL yet**: with one already recorded there is nothing to hand over,
// and the header's own field is right there for a correction.
//
// A Facebook auction asks the same question (#1668): its listing URL is the post's link. A lot of a
// post holding several asks it for the whole post — every lot goes live, and the link is written into
// each lot that has none of its own.
//
// A listing that has to **wait for approval** (#1778) is published through the same dialog, twice.
// Posting it, the collector ticks *Waiting for approval* and the link is the pending post's — the
// offer goes Pending rather than Active. Once it is approved, the dialog opens in its approving form,
// prefilled with that pending link, and asks for the final one.
//
// On Facebook (#1779) a link in the pending-post shape (`…/pending_posts/…`) ticks *Waiting for
// approval* as it is pasted — a proposal the collector can untick. Approving a Facebook **auction**
// also asks for its closing time: it was worked out when the post was written, so an approval days
// later would shorten the auction. The dialog shows it beside a proposal counted from today with the
// group's length and time of day, and the field holds whichever the collector settles on — written
// to every auction of the post. A quick buy closes at no time and is not asked.

const INPUT: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const CHECK_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  margin: "0 0 1rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

/** Where publishing takes the offer: live at once, or submitted and waiting for approval. */
export type PublishTarget = "active" | "pending";

export function ActivateOfferDialog({
  offerLabel,
  platformName,
  initialUrl,
  facebookLots,
  initialTarget = "active",
  canWait = true,
  approving = false,
  offerId,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  offerLabel: string;
  platformName: string;
  /** A URL already on the offer — a re-listing starts from what is there, not from blank. */
  initialUrl: string | null;
  /** On a Facebook auction, how many lots its post holds — 1 when it is posted alone. Null elsewhere. */
  facebookLots?: number | null;
  /** Whether *Waiting for approval* starts ticked — the ⋮ *Submit for approval…* entry opens it so
   *  (off Facebook; on Facebook the one *Publish…* starts it unticked, #1847). */
  initialTarget?: PublishTarget;
  /** Whether going to approval is open at all — a post half up already (#1842) can only go live. */
  canWait?: boolean;
  /** The offer is pending and this records its approval (#1778): the URL asked for is the final one. */
  approving?: boolean;
  /** Approving, the offer whose Facebook auctions may be asked for a closing time (#1779). */
  offerId?: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  /** `endsAt` is sent only when the closing time was asked: an ISO instant, or "" for none. */
  onConfirm: (url: string, target: PublishTarget, endsAt?: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [target, setTarget] = useState<PublishTarget>(
    approving || !canWait
      ? "active"
      : initialUrl && isFacebookPendingPostUrl(initialUrl)
        ? "pending"
        : initialTarget
  );
  const closing = useApprovalClosing(approving ? offerId : undefined);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  // The field starts on the proposal, else on the closing time as written, once both are known.
  const proposal =
    closing.value && closing.value.auctionDays !== null
      ? toLocalInputValue(
          facebookDefaultEndsAt(new Date(), closing.value.auctionDays, closing.value.closingTime)
        )
      : "";
  const written = toLocalInputValue(closing.value?.endsAt ?? null);
  const endsAtValue = endsAt ?? (proposal || written);
  const confirm = () =>
    onConfirm(url, target, closing.value ? fromLocalInputValue(endsAtValue) : undefined);
  const busy = isPending || closing.loading;
  const lots = facebookLots ?? 0;
  const pending = target === "pending";
  const subject =
    lots > 1 ? <>all {lots} lots of this post</> : <strong>{offerLabel}</strong>;

  let lead: React.ReactNode;
  if (approving) {
    lead = (
      <>
        Mark {subject} approved and live on {platformName}. Today becomes{" "}
        {lots > 1 ? "their" : "its"} listing date.
      </>
    );
  } else if (pending) {
    lead = (
      <>
        Mark {subject} submitted to {platformName} and waiting for approval. {lots > 1 ? "Their" : "Its"}{" "}
        copies count as listed from now on.
      </>
    );
  } else {
    lead = (
      <>
        Mark {subject} live on {platformName}. Today becomes {lots > 1 ? "their" : "its"} listing date.
      </>
    );
  }

  let label: string;
  if (pending) label = lots > 0 ? "Pending post link — the post's link (optional)" : "Pending post link (optional)";
  else if (approving) label = lots > 0 ? "Final link — the post's link (optional)" : "Final listing URL (optional)";
  else label = lots > 0 ? "Listing URL — the post's link (optional)" : "Listing URL (optional)";

  let hint: string;
  if (approving) {
    hint = "Starts from the pending post's link — replace it if the approved listing has another.";
  } else if (pending) {
    hint = "The link to the post waiting for approval. Approving the offer later asks for the final one.";
  } else if (lots > 1) {
    hint = "Every lot without a link of its own gets this one. Leave it blank if you have none yet.";
  } else {
    hint = "Paste the link the platform gave you. Leave it blank if there is none yet — you can add it from the offer later.";
  }

  let action: string;
  if (approving) action = isPending ? "Approving…" : "Approve";
  else if (pending) action = isPending ? "Submitting…" : "Submit";
  else action = isPending ? "Publishing…" : "Publish";

  return (
    <DialogShell title={approving ? "Approve offer" : "Publish offer"} onClose={onClose}>
      <DialogBody>
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.9375rem",
            lineHeight: 1.6,
            color: "var(--color-text-primary)",
          }}
        >
          {lead}
        </p>
        {!approving && canWait && (
          <label style={CHECK_ROW}>
            <input
              type="checkbox"
              checked={pending}
              disabled={isPending}
              onChange={(e) => setTarget(e.target.checked ? "pending" : "active")}
            />
            Waiting for approval — the platform or group has to accept it first
          </label>
        )}
        <LabelWithError htmlFor="f-listing-url">{label}</LabelWithError>
        <TextInput
          id="f-listing-url"
          data-autofocus-select
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          disabled={isPending}
          onChange={(e) => {
            const next = e.target.value;
            // A pending post's link proposes *Waiting for approval* the moment it arrives (#1779).
            if (!approving && canWait && isFacebookPendingPostUrl(next) && !isFacebookPendingPostUrl(url)) {
              setTarget("pending");
            }
            setUrl(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) confirm();
          }}
          style={INPUT}
        />
        <p
          style={{
            margin: "0.5rem 0 0",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          {hint}
        </p>
        {closing.value && (
          <div style={{ marginTop: "1rem" }}>
            <LabelWithError htmlFor="f-approval-ends-at">
              {lots > 1 ? "The auctions close" : "The auction closes"}
            </LabelWithError>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                id="f-approval-ends-at"
                type="datetime-local"
                value={endsAtValue}
                disabled={isPending}
                onChange={(e) => setEndsAt(e.target.value)}
                style={{ ...INPUT, flex: 1 }}
              />
              {proposal && (
                <DialogSecondaryButton
                  disabled={isPending || endsAtValue === proposal}
                  onClick={() => setEndsAt(proposal)}
                >
                  Proposed
                </DialogSecondaryButton>
              )}
              {written && written !== proposal && (
                <DialogSecondaryButton
                  disabled={isPending || endsAtValue === written}
                  onClick={() => setEndsAt(written)}
                >
                  As posted
                </DialogSecondaryButton>
              )}
            </div>
            <p
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              {closingHint(closing.value)}
            </p>
          </div>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={action}
        onCancel={onClose}
        onAction={confirm}
        disabled={busy}
        error={error ?? closing.error}
      />
    </DialogShell>
  );
}

/** One line under the closing time: what the post said, and what today's proposal is counted from. */
function closingHint(closing: FacebookApprovalClosing): string {
  const posted = closing.endsAt ? `Posted to close ${formatInstant(closing.endsAt)}.` : "Posted with no closing time.";
  if (closing.auctionDays === null) return `${posted} The group states no auction length, so nothing is proposed.`;
  const days = `${closing.auctionDays} ${closing.auctionDays === 1 ? "day" : "days"}`;
  const at = closing.closingTime ? ` at ${closing.closingTime}` : "";
  return `${posted} Proposed: the group's ${days} from today${at}.`;
}

/**
 * What approving asks about a Facebook auction's closing time (#1779), read when the dialog opens —
 * null where nothing is asked (off Facebook, a quick buy). The group's settings are read **now**,
 * the ones a new auction there would get.
 */
function useApprovalClosing(offerId: string | undefined): {
  value: FacebookApprovalClosing | null;
  loading: boolean;
  error?: string;
} {
  const [state, setState] = useState<{ value: FacebookApprovalClosing | null; loading: boolean; error?: string }>(
    { value: null, loading: offerId !== undefined }
  );
  useEffect(() => {
    if (offerId === undefined) return;
    let live = true;
    import("@/app/actions/offers")
      .then(({ readFacebookApprovalClosingAction }) => readFacebookApprovalClosingAction(offerId))
      .then(
        (value) => {
          if (live) setState({ value, loading: false });
        },
        () => {
          if (live) setState({ value: null, loading: false, error: "Could not read the auction's closing time." });
        }
      );
    return () => {
      live = false;
    };
  }, [offerId]);
  return state;
}
