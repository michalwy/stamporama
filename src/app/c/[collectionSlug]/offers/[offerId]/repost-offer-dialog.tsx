"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";

// Posting a quick buy again (#1718): the collector has deleted the stale post and put it up afresh,
// and the platform handed back a new link. That link is what is asked here — required, since it is
// the whole record of the repost. The offer stays the same offer: its number, its copies and its
// texts; the earlier link goes into its history with the dates it was up.
//
// A lot of a Facebook post reposts the whole post: every active quick-buy lot of it takes the link.

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
  onConfirm: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const blank = url.trim() === "";

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
              keep their offer numbers; today becomes their last posted date.
            </>
          ) : (
            <>
              Record that <strong>{offerLabel}</strong> is posted again on {platformName}. It keeps its
              offer number; today becomes its last posted date.
            </>
          )}
        </p>
        <LabelWithError htmlFor="f-repost-url">New listing link</LabelWithError>
        <TextInput
          id="f-repost-url"
          data-autofocus-select
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          disabled={isPending}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isPending && !blank) onConfirm(url);
          }}
          style={INPUT}
        />
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          The earlier link is kept in the offer&apos;s history.
        </p>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Recording…" : "Repost"}
        onCancel={onClose}
        onAction={() => onConfirm(url)}
        disabled={isPending || blank}
        error={error}
      />
    </DialogShell>
  );
}
