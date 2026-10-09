"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";

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

export function ActivateOfferDialog({
  offerLabel,
  platformName,
  initialUrl,
  facebookLots,
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
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const lots = facebookLots ?? 0;

  return (
    <DialogShell title="Publish offer" onClose={onClose}>
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
              Mark all {lots} lots of this post live on {platformName}. Today becomes their listing date.
            </>
          ) : (
            <>
              Mark <strong>{offerLabel}</strong> live on {platformName}. Today becomes its listing date.
            </>
          )}
        </p>
        <LabelWithError htmlFor="f-listing-url">
          {lots > 0 ? "Listing URL — the post's link (optional)" : "Listing URL (optional)"}
        </LabelWithError>
        <TextInput
          id="f-listing-url"
          data-autofocus-select
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          disabled={isPending}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isPending) onConfirm(url);
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
          {lots > 1
            ? "Every lot without a link of its own gets this one. Leave it blank if you have none yet."
            : "Paste the link the platform gave you. Leave it blank if there is none yet — you can add it from the offer later."}
        </p>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Publishing…" : "Publish"}
        onCancel={onClose}
        onAction={() => onConfirm(url)}
        disabled={isPending}
        error={error}
      />
    </DialogShell>
  );
}
