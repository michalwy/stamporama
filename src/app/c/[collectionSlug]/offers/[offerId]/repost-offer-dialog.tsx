"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";
import { isFacebookPendingPostUrl } from "@/lib/facebook-post-rules";
import type { PublishTarget } from "../activate-offer-dialog";

// Posting a quick buy again (#1718): the collector has deleted the stale post and put it up afresh,
// and the platform handed back a new link. That link is what is asked here — required, since it is
// the whole record of the repost. The offer stays the same offer: its number, its copies and its
// texts; the earlier link goes into its history with the dates it was up.
//
// A lot of a Facebook post reposts the whole post: every active quick-buy lot of it takes the link.
//
// A new post can wait for the group's administrator as the first one did (#1779): *Waiting for
// approval* — ticked by itself when the link is a pending post's — takes the listings back to
// Pending, and approving them later restarts the count of days up.

const CHECK_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  margin: "0 0 1rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

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

export function RepostOfferDialog({
  offerLabel,
  platformName,
  lots,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  offerLabel: string;
  platformName: string;
  /** How many quick-buy lots of a Facebook post take the link — 1 for an offer posted alone. */
  lots: number;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (url: string, target: PublishTarget) => void;
}) {
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<PublishTarget>("active");
  const blank = url.trim() === "";
  const pending = target === "pending";
  const when = pending
    ? "the day the post is approved becomes"
    : "today becomes";

  return (
    <DialogShell title="Repost offer" onClose={onClose}>
      <DialogBody>
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.9375rem",
            lineHeight: 1.6,
            color: "var(--color-text-primary)",
          }}
        >
          {lots > 1 ? (
            <>
              Record that all {lots} quick buys of this post are posted again on {platformName}. They
              keep their offer numbers; {when} their last posted date.
            </>
          ) : (
            <>
              Record that <strong>{offerLabel}</strong> is posted again on {platformName}. It keeps its
              offer number; {when} its last posted date.
            </>
          )}
        </p>
        <label style={CHECK_ROW}>
          <input
            type="checkbox"
            checked={pending}
            disabled={isPending}
            onChange={(e) => setTarget(e.target.checked ? "pending" : "active")}
          />
          Waiting for approval — the group has to accept the new post first
        </label>
        <LabelWithError htmlFor="f-repost-url">
          {pending ? "Pending post link" : "New listing link"}
        </LabelWithError>
        <TextInput
          id="f-repost-url"
          data-autofocus-select
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          disabled={isPending}
          onChange={(e) => {
            const next = e.target.value;
            if (isFacebookPendingPostUrl(next) && !isFacebookPendingPostUrl(url)) setTarget("pending");
            setUrl(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isPending && !blank) onConfirm(url, target);
          }}
          style={INPUT}
        />
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {pending
            ? "The earlier link is kept in the offer's history. Approving it later asks for the final link."
            : "The earlier link is kept in the offer's history."}
        </p>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Recording…" : pending ? "Submit" : "Repost"}
        onCancel={onClose}
        onAction={() => onConfirm(url, target)}
        disabled={isPending || blank}
        error={error}
      />
    </DialogShell>
  );
}
