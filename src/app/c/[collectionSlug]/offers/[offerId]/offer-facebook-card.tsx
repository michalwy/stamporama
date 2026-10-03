"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import {
  facebookMoney,
  renderFacebookPostText,
  type FacebookPostLotText,
} from "@/lib/facebook-post-rules";
import { OFFER_STATE_LABEL } from "@/lib/offer-rules";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { DialogPrimaryButton, DialogSecondaryButton } from "@/app/dialog-shell";

// A Facebook auction's kit (#1544; ADR-0061 §2, §3): the group it is in, the post that carries it —
// alone, or as a numbered lot of a post holding several — the post's text and photos, each taken in
// one click, and the post's link, which, pasted once the post is up, activates the offers in it.
//
// Facebook has no API for posting in groups, so the kit is the whole of posting: the collector pastes
// the text and uploads the photos by hand. The text is rendered **here**, in the browser, because the
// closing time it states is a local time and this is the one place the collector's zone is known —
// the same reason the closing time is typed in the browser (#490).
//
// Rendered only for an offer naming a group: `OfferDetail.facebook` is null everywhere else.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem",
};

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const SECTION_LABEL: React.CSSProperties = {
  ...MUTED,
  margin: "0 0 0.25rem",
  fontWeight: 600,
};

const POST_TEXT: React.CSSProperties = {
  margin: 0,
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontFamily: "inherit",
  whiteSpace: "pre-wrap",
  maxHeight: "16rem",
  overflowY: "auto",
};

const INPUT: React.CSSProperties = {
  flex: 1,
  padding: "0.4rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minWidth: 0,
};

const LINK_BTN: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

/** `Sun 5 Oct, 20:00` in the collector's own locale and zone. */
function formatClosesAt(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function OfferFacebookCard({
  collectionSlug,
  offerId,
  kit,
  onChanged,
}: {
  collectionSlug: string;
  offerId: string;
  kit: FacebookOfferKit;
  /** The offer screen re-reads itself after a write; the card holds no copy of its own. */
  onChanged: () => void;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const self = kit.lots.find((l) => l.offerId === offerId) ?? kit.lots[0];
  const multiLot = kit.post !== null;

  const postText = useMemo(() => {
    const lots: FacebookPostLotText[] = kit.lots.map((lot) => ({
      lotNo: lot.lotNo,
      description: lot.description,
      catalog: lot.catalog,
      startingPrice: facebookMoney(lot.startingPrice, lot.currency),
      increment: facebookMoney(lot.bidIncrement, lot.currency),
      closesAt: formatClosesAt(lot.endsAt),
    }));
    return renderFacebookPostText(kit.group.postTemplate, kit.group.standingNote, lots);
  }, [kit]);

  // Posted: a multi-lot post once its link is recorded, an offer posted alone once it is up.
  const postedUrl = multiLot ? kit.post!.url : self.state === "active" || self.state === "paused" ? self.url : null;
  const posted = multiLot ? kit.post!.url !== null : self.state !== "preparing" && self.state !== "ready";
  // What stands between the post and going up: every lot must be Ready, the gate publishing asks.
  const waiting = kit.lots.filter((l) => l.state !== "ready" && l.state !== "active");

  function run(task: () => Promise<{ status: "success" } | { status: "error"; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.status === "error") setError(result.message);
      else {
        setLink("");
        onChanged();
      }
    });
  }

  function recordLink() {
    run(async () => {
      if (multiLot) {
        const { recordFacebookPostLinkAction } = await import("@/app/actions/facebook");
        const result = await recordFacebookPostLinkAction(kit.post!.id, link);
        return result.status === "success" ? { status: "success" } : result;
      }
      const { publishOfferAction } = await import("@/app/actions/offers");
      return publishOfferAction(offerId, link);
    });
  }

  function leavePost() {
    run(async () => {
      const { removeFacebookLotAction } = await import("@/app/actions/facebook");
      return removeFacebookLotAction(offerId);
    });
  }

  return (
    <section style={CARD} aria-label="Facebook auction">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Facebook
        </h3>
        <span style={MUTED}>
          in{" "}
          <a href={kit.group.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
            {kit.group.name} ↗
          </a>
          {kit.group.archived && " (archived)"}
        </span>
      </div>

      {/* The post: alone, or the lots of a post holding several, in lot order. */}
      <div style={{ marginTop: "0.75rem" }}>
        {multiLot ? (
          <>
            <p style={SECTION_LABEL}>
              Lot {self.lotNo} of a post with {kit.lots.length} lots
            </p>
            <ol style={{ margin: 0, paddingLeft: "1.25rem", ...MUTED }}>
              {kit.lots.map((lot) => (
                <li key={lot.offerId} value={lot.lotNo ?? undefined}>
                  {lot.offerId === offerId ? (
                    <strong style={{ color: "var(--color-text-primary)" }}>{lot.title}</strong>
                  ) : (
                    <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={{ color: "var(--color-accent)" }}>
                      #{lot.offerNo} {lot.title}
                    </Link>
                  )}{" "}
                  · {OFFER_STATE_LABEL[lot.state]}
                  {lot.url && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={lot.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
                        photo ↗
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ol>
            {!posted && (
              <button type="button" style={{ ...LINK_BTN, marginTop: "0.25rem" }} disabled={isPending} onClick={leavePost}>
                Take this lot out of the post
              </button>
            )}
          </>
        ) : (
          <p style={{ ...MUTED, margin: 0 }}>Posted alone — one auction, one post.</p>
        )}
      </div>

      {/* The kit: the post's text and its photos, one click each. */}
      <div style={{ marginTop: "0.875rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
          <p style={{ ...SECTION_LABEL, margin: 0 }}>Post text</p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <CopyButton value={postText} label="post text" />
            <a href={kit.photoZipPath} download style={{ ...MUTED, color: "var(--color-accent)" }}>
              ↓ Photos{multiLot ? ", in lot order" : ""}
            </a>
          </div>
        </div>
        {postText ? (
          <pre style={POST_TEXT}>{postText}</pre>
        ) : (
          <p style={{ ...MUTED, margin: 0 }}>Nothing to post yet — give the offer a description.</p>
        )}
        {!kit.group.postTemplate.trim() && (
          <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
            {kit.group.name} has no post template, so each lot is its description.
          </p>
        )}
      </div>

      {/* The post's link: pasted once it is up, which activates the offers in it. */}
      <div style={{ marginTop: "0.875rem" }}>
        <p style={SECTION_LABEL}>Post link</p>
        {posted && postedUrl ? (
          <a href={postedUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.875rem", color: "var(--color-accent)", wordBreak: "break-all" }}>
            {postedUrl} ↗
          </a>
        ) : posted ? (
          <p style={{ ...MUTED, margin: 0 }}>Up, with no link recorded — add it as the offer&apos;s listing URL.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <TextInput
                type="url"
                placeholder="https://www.facebook.com/groups/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                disabled={isPending || waiting.length > 0}
                style={INPUT}
                aria-label="Post link"
              />
              {waiting.length > 0 ? (
                <DialogSecondaryButton disabled>Record link</DialogSecondaryButton>
              ) : (
                <DialogPrimaryButton type="button" disabled={isPending || !link.trim()} onClick={recordLink}>
                  {isPending ? "Recording…" : "Record link"}
                </DialogPrimaryButton>
              )}
            </div>
            <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
              {waiting.length > 0
                ? multiLot
                  ? `Every lot must be Ready first: ${waiting.map((l) => `lot ${l.lotNo}`).join(", ")}.`
                  : "Mark the offer Ready first."
                : multiLot
                  ? `Recording it activates all ${kit.lots.length} lots.`
                  : "Recording it activates the offer."}
            </p>
          </>
        )}
        {error && (
          <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.8125rem", margin: "0.375rem 0 0" }}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
