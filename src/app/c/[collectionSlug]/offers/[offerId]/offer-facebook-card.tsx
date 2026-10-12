"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import {
  FACEBOOK_POST_STAGE_LABEL,
  facebookPostLabel,
  facebookPostStage,
  isFacebookLotPosted,
} from "@/lib/facebook-post-rules";
import { isAuctionListing } from "@/lib/offer-rules";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { formatInstant, formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { PendingLinkMark } from "../offer-badges";
import { formControl, multiLineFormControl } from "@/app/control-style";
import { FacebookPostTemplateField } from "@/app/c/[collectionSlug]/shared/facebook-post-template-field";
import { renderFacebookKitPost } from "./facebook-kit-post";
import { FacebookPostKit } from "./facebook-post-kit";

// A Facebook offer's card (#1544; ADR-0061 §2, §3): the group it is in and the post that carries it.
// An offer posted alone has its kit here — the post's text and photos, each taken in one click
// (`FacebookPostKit`) — and its listing link, which *Activate* in the header asks for as on every
// platform (#1668). A lot of a post holding several only names its post — *Post #N · lot M of K*, where
// the post stands, and *Open post* — since the post has a screen of its own (#1842) with every lot, the
// kit and the moves the post makes as one; the card used to repeat all of that on every lot.
//
// While an auction is up, the card is also where it is followed (#1545; ADR-0061 §4): nothing reads
// the comments, so the standing bid is typed here, dated, and once the closing time has passed the card
// says so. The result is the offer's own *Sell* — to the winner, found by their Facebook profile — or
// *Withdraw* when nobody bid, as on every platform (#1777); the card records neither. A quick buy
// (#1671) has no bidding, so while it is up the card has nothing of its own to follow.
//
// An offer may carry its own post template (#1780), overriding its group's for this offer only: the
// card shows *Same as group* with the template it follows, or the offer's own once *Custom for this
// offer* is ticked — prefilled with the group's, so it is edited rather than written from scratch —
// the Settings → Facebook pattern (#1661). It is still a template, written for the offer's current
// type; changing the type on the offer form drops it. In a captioned post (#1841) it writes the lot's
// caption.
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


const INPUT: React.CSSProperties = {
  ...formControl,
  flex: 1,
  padding: "0.4rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minWidth: 0,
};




const TEMPLATE_INPUT: React.CSSProperties = {
  ...formControl,
  ...multiLineFormControl,
  width: "100%",
  minHeight: "8rem",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontFamily: "inherit",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  resize: "vertical",
};

const FOLLOWED_TEMPLATE: React.CSSProperties = {
  ...MUTED,
  margin: 0,
  padding: "0.375rem 0.75rem",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
  display: "flex",
  gap: "0.375rem",
  alignItems: "baseline",
  maxHeight: "10rem",
  overflowY: "auto",
};

const LINK_BTN: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};


export function OfferFacebookCard({
  collectionSlug,
  offerId,
  kit,
  onChanged,
  onRepost,
}: {
  collectionSlug: string;
  offerId: string;
  kit: FacebookOfferKit;
  /** The offer screen re-reads itself after a write; the card holds no copy of its own. */
  onChanged: () => void;
  /** Opens the offer screen's *Repost* dialog (#1718) — set only on an active quick buy. */
  onRepost?: () => void;
}) {
  const [bid, setBid] = useState("");
  // The offer's own template being written (#1780) — null while nothing is typed that is not saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const self = kit.lots.find((l) => l.offerId === offerId) ?? kit.lots[0];

  const auction = isAuctionListing(self.listingType);
  // How the post is laid out — as posted once it is up (#1800) — which decides whether this offer's
  // own template writes its lot of the post's text or its photo's caption (#1841).
  const { layout } = useMemo(() => renderFacebookKitPost(kit), [kit]);
  const captioned = layout === "captions";

  // This offer's own template (#1780), and the group's it otherwise follows for its type — its
  // caption's in a captioned post (#1841).
  const groupTemplate = captioned
    ? auction
      ? kit.group.auctionCaptionTemplate
      : kit.group.quickBuyCaptionTemplate
    : auction
      ? kit.group.postTemplate
      : kit.group.quickBuyTemplate;
  const ownTemplate = self.ownTemplate;
  const customTemplate = ownTemplate !== null || draft !== null;
  const templateText = draft ?? ownTemplate ?? "";

  // Posted: once the offer has gone up — anything past Ready.
  const posted = isFacebookLotPosted(self.state);

  // Up in the group: the offer is running — an auction may have closed and wait for its result.
  const up = self.state === "active" || self.state === "paused";
  // Waiting for the group's administrator (#1778): nobody bids on a post nobody can see, so the
  // bidding stays hidden; the link is the pending post's, and says so.
  const pendingApproval = self.state === "pending";
  const now = new Date();
  const closed = auction && up && self.endsAt !== null && new Date(self.endsAt).getTime() <= now.getTime();
  const hasBid = self.price !== "0.00";

  function run(task: () => Promise<{ status: "success" } | { status: "error"; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.status === "error") setError(result.message);
      else {
        setBid("");
        setDraft(null);
        onChanged();
      }
    });
  }

  function recordBid() {
    run(async () => {
      const { patchOfferAction } = await import("@/app/actions/offers");
      return patchOfferAction(offerId, "price", bid);
    });
  }

  // Ticking opens the group's template for editing, saved only by *Save*; unticking hands a saved own
  // template back to the group's at once, and drops one not yet saved.
  function setCustomTemplate(on: boolean) {
    if (on) {
      setDraft(groupTemplate);
      return;
    }
    if (ownTemplate === null) {
      setDraft(null);
      return;
    }
    run(async () => {
      const { setFacebookOfferTemplateAction } = await import("@/app/actions/facebook");
      return setFacebookOfferTemplateAction(offerId, null);
    });
  }

  function saveTemplate() {
    if (draft === null) return;
    run(async () => {
      const { setFacebookOfferTemplateAction } = await import("@/app/actions/facebook");
      return setFacebookOfferTemplateAction(offerId, draft);
    });
  }

  return (
    <section style={CARD} aria-label={auction ? "Facebook auction" : "Facebook quick buy"}>
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

      {/* The post: alone, with its kit here — or a lot of a post holding several, which has a screen
          of its own (#1842) where the lots, the kit and the post's moves are; this card only names it. */}
      <div style={{ marginTop: "0.75rem" }}>
        {kit.post ? (
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
            <p style={{ ...MUTED, margin: 0 }}>
              <strong style={{ color: "var(--color-text-primary)" }}>{facebookPostLabel(kit.post)}</strong> · lot{" "}
              {self.lotNo}{" "}
              of {kit.lots.length} · {FACEBOOK_POST_STAGE_LABEL[facebookPostStage(kit.lots)]}
            </p>
            <Link
              href={`/c/${collectionSlug}/offers/posts/${kit.post.postNo}`}
              style={{ ...MUTED, color: "var(--color-accent)", whiteSpace: "nowrap" }}
            >
              Open post →
            </Link>
          </div>
        ) : (
          <>
            <p style={{ ...MUTED, margin: "0 0 0.875rem" }}>
              Posted alone — one {auction ? "auction" : "quick buy"}, one post.
            </p>
            <FacebookPostKit collectionSlug={collectionSlug} kit={kit} selfOfferId={offerId} onChanged={onChanged} />
          </>
        )}
      </div>

      {/* This offer's own post template (#1780): the group's it follows, or its own. */}
      <div style={{ marginTop: "0.875rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <p style={{ ...SECTION_LABEL, margin: 0 }}>
            {auction ? "Auction" : "Quick-buy"} {captioned ? "caption" : "post"} template
            {kit.post ? " for this lot" : ""}
          </p>
          <label style={{ ...MUTED, display: "inline-flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={customTemplate}
              disabled={isPending}
              onChange={(e) => setCustomTemplate(e.target.checked)}
            />
            Custom for this offer
          </label>
        </div>
        {customTemplate ? (
          <>
            <FacebookPostTemplateField
              id={`offer-facebook-template-${offerId}`}
              listingType={self.listingType}
              role={captioned ? "caption" : "post"}
              value={templateText}
              onChange={setDraft}
              style={TEMPLATE_INPUT}
              disabled={isPending}
            />
            {draft !== null && draft !== ownTemplate && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                <DialogSecondaryButton type="button" disabled={isPending} onClick={saveTemplate}>
                  Save template
                </DialogSecondaryButton>
                <button
                  type="button"
                  style={LINK_BTN}
                  disabled={isPending}
                  onClick={() => setDraft(null)}
                >
                  {ownTemplate === null ? "Cancel" : "Undo changes"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={FOLLOWED_TEMPLATE}>
            <span style={{ flexShrink: 0 }}>Same as group:</span>
            <span style={{ color: "var(--color-text-primary)", whiteSpace: "pre-wrap", minWidth: 0 }}>
              {groupTemplate.trim() || "None"}
            </span>
          </div>
        )}
      </div>

      {/* Where the post went up: the offer's own listing link, asked by Activate (#1668). A lot's is
          its post's, recorded from the post's screen (#1842). */}
      {!kit.post && (
        <div style={{ marginTop: "0.875rem" }}>
          <p style={SECTION_LABEL}>Listing link</p>
          {posted && self.url ? (
            <>
              <a href={self.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.875rem", color: "var(--color-accent)", wordBreak: "break-all" }}>
                {self.url} ↗
              </a>
              {pendingApproval && <PendingLinkMark />}
            </>
          ) : pendingApproval ? (
            <p style={{ ...MUTED, margin: 0 }}>Waiting for approval, with no link recorded.</p>
          ) : posted ? (
            <p style={{ ...MUTED, margin: 0 }}>Up, with no link recorded — add the post&apos;s link as the listing link.</p>
          ) : (
            <p style={{ ...MUTED, margin: 0 }}>
              {self.state === "ready"
                ? "The post's link. Activate asks for it once the post is up."
                : "Mark the offer Ready first."}
            </p>
          )}
          {/* A quick-buy post a few days old is seen by nobody (#1718): delete it, post it again — the
              text rebuilt from the current template (#1800), shown in the dialog — and record the new
              post's link on the same offer. */}
          {onRepost && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.375rem" }}>
              <DialogSecondaryButton type="button" disabled={isPending} onClick={onRepost}>
                Repost…
              </DialogSecondaryButton>
              <span style={MUTED}>Post it again — the dialog shows the text as it goes up now — then record the new link.</span>
            </div>
          )}
        </div>
      )}

      {/* The bidding, typed by hand while it runs (#1545). Once it has closed the winning bid can still
          be typed before selling — the figure *Sell* puts on the sale (#1777). */}
      {up && auction && (
        <div style={{ marginTop: "0.875rem" }}>
          <p style={SECTION_LABEL}>Bidding</p>
          {closed && (
            <p style={{ ...MUTED, margin: "0 0 0.375rem", color: "var(--color-warning)", fontWeight: 600 }}>
              Closed {formatRelative(self.endsAt!, now)} — sell it to the winner, or withdraw it if nobody bid.
            </p>
          )}
          <p style={{ ...MUTED, margin: "0 0 0.375rem" }}>
            {hasBid ? (
              <>
                Highest bid <strong style={{ color: "var(--color-text-primary)" }}>{self.price} {self.currency}</strong>
                {self.priceCheckedAt && (
                  <>
                    {" "}
                    <Tooltip content={`Recorded ${formatInstant(self.priceCheckedAt)}`}>
                      <span>· recorded {formatRelative(self.priceCheckedAt, now)}</span>
                    </Tooltip>
                  </>
                )}
              </>
            ) : (
              "No bid recorded yet."
            )}
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <NumericInput
              kind="amount"
              placeholder={`Highest bid in ${self.currency}`}
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              disabled={isPending}
              style={INPUT}
              aria-label="Highest bid"
            />
            <DialogSecondaryButton type="button" disabled={isPending || !bid.trim()} onClick={recordBid}>
              {closed ? "Record winning bid" : "Record bid"}
            </DialogSecondaryButton>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.8125rem", margin: "0.375rem 0 0" }}>
          {error}
        </p>
      )}
    </section>
  );
}
