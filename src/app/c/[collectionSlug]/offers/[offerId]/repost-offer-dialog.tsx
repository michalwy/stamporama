"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";
import { isFacebookPendingPostUrl } from "@/lib/facebook-post-rules";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { RenderedHtml } from "@/app/c/[collectionSlug]/shared/rendered-description";
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
//
// A repost is a new publication (#1800): on Facebook the dialog shows the post as it goes up **now** —
// the current template and figures, not the text frozen when it was first posted — and recording it
// freezes that text in place of the old.

const CHECK_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  margin: "0 0 1rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const POST_TEXT: React.CSSProperties = {
  margin: 0,
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  maxHeight: "14rem",
  overflowY: "auto",
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
  post,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  offerLabel: string;
  platformName: string;
  /** How many quick-buy lots of a Facebook post take the link — 1 for an offer posted alone. */
  lots: number;
  /** A Facebook offer's post as it goes up again (#1800), formatted, with its plain text; absent
   *  everywhere else. A captioned post (#1841) carries each lot's caption too. */
  post?: { html: string; plain: string; captions?: { lotNo: number | null; html: string; plain: string }[] };
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
        {post && (
          <div style={{ margin: "0 0 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-muted)" }}>
                Post text, from the current template
              </span>
              <CopyButton value={post.plain} html={post.html} label="post text" />
            </div>
            {post.html ? (
              <RenderedHtml html={post.html} style={POST_TEXT} />
            ) : (
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>The post is empty.</p>
            )}
            {post.captions?.map((caption) => (
              <div key={caption.lotNo ?? 0} style={{ marginTop: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-muted)" }}>
                    Lot {caption.lotNo} caption
                  </span>
                  <CopyButton value={caption.plain} html={caption.html} label="caption" />
                </div>
                {caption.html ? (
                  <RenderedHtml html={caption.html} style={POST_TEXT} />
                ) : (
                  <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>The caption is empty.</p>
                )}
              </div>
            ))}
          </div>
        )}
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
