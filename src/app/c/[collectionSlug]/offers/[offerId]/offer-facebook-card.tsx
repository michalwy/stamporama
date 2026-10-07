"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import {
  facebookMoney,
  isFacebookLotPosted,
  renderFacebookPostText,
  type FacebookPostLotText,
} from "@/lib/facebook-post-rules";
import { isAuctionListing, OFFER_LISTING_TYPE_LABEL, OFFER_STATE_LABEL } from "@/lib/offer-rules";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { ConfirmDialog, DialogPrimaryButton, DialogSecondaryButton } from "@/app/dialog-shell";
import { formatInstant, formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { FacebookResultDialog } from "./facebook-result-dialog";

// A Facebook offer's kit (#1544; ADR-0061 §2, §3): the group it is in, the post that carries it —
// alone, or as a numbered lot of a post holding several — and the post's text and photos, each taken
// in one click. Where the post went up is the offer's own listing link (#1668): *Activate* in the
// header asks for it, as on every platform, and for a lot it is written into every lot of the post.
//
// Facebook has no API for posting in groups, so the kit is the whole of posting: the collector pastes
// the text and uploads the photos by hand. The text is rendered **here**, in the browser, because the
// closing time it states is a local time and this is the one place the collector's zone is known —
// the same reason the closing time is typed in the browser (#490).
//
// While an auction is up, the card is also where it is followed (#1545; ADR-0061 §4): nothing reads
// the comments, so the standing bid is typed here, dated, and once the closing time has passed the card
// asks for the result — the winner and the winning bid, which records the sale, or *No bids*, which
// withdraws the offer and frees its copies. A quick buy (#1671) has no bidding: while it is up the
// card offers only its sale — the buyer and the price, recorded the same way.
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
  collectionId,
  collectionSlug,
  offerId,
  kit,
  onChanged,
}: {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
  kit: FacebookOfferKit;
  /** The offer screen re-reads itself after a write; the card holds no copy of its own. */
  onChanged: () => void;
}) {
  const router = useRouter();
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const [bid, setBid] = useState("");
  const [resultOpen, setResultOpen] = useState(false);
  const [confirmNoBids, setConfirmNoBids] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const self = kit.lots.find((l) => l.offerId === offerId) ?? kit.lots[0];
  const multiLot = kit.post !== null;

  const auction = isAuctionListing(self.listingType);
  const postText = useMemo(() => {
    const lots: FacebookPostLotText[] = kit.lots.map((lot) => ({
      lotNo: lot.lotNo,
      listingType: lot.listingType,
      title: lot.title,
      description: lot.description,
      catalog: lot.catalog,
      startingPrice: facebookMoney(lot.startingPrice, lot.currency),
      increment: facebookMoney(lot.bidIncrement, lot.currency),
      closesAt: formatClosesAt(lot.endsAt),
      price: isAuctionListing(lot.listingType) ? "" : facebookMoney(lot.price, lot.currency),
    }));
    return renderFacebookPostText(
      { auction: kit.group.postTemplate, quickBuy: kit.group.quickBuyTemplate },
      kit.group.standingNote,
      lots
    );
  }, [kit]);
  // The templates the post is written from that are blank, so their lots read as their description.
  const blankTemplates = [
    ...(kit.lots.some((l) => isAuctionListing(l.listingType)) && !kit.group.postTemplate.trim() ? ["auction"] : []),
    ...(kit.lots.some((l) => !isAuctionListing(l.listingType)) && !kit.group.quickBuyTemplate.trim() ? ["quick-buy"] : []),
  ];

  // Posted: once any lot has gone up — the lots of a post go up together.
  const posted = kit.lots.some((l) => isFacebookLotPosted(l.state));
  // What stands between the post and going up: every lot must be Ready, the gate publishing asks.
  const waiting = kit.lots.filter((l) => l.state !== "ready" && l.state !== "active");

  // Up in the group: the offer is running — an auction may have closed and wait for its result.
  const up = self.state === "active" || self.state === "paused";
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
        setConfirmNoBids(false);
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

  function recordNoBids() {
    run(async () => {
      const { recordFacebookAuctionNoBidsAction } = await import("@/app/actions/facebook");
      return recordFacebookAuctionNoBidsAction(offerId);
    });
  }

  function leavePost() {
    run(async () => {
      const { removeFacebookLotAction } = await import("@/app/actions/facebook");
      return removeFacebookLotAction(offerId);
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
                  · {OFFER_LISTING_TYPE_LABEL[lot.listingType]} · {OFFER_STATE_LABEL[lot.state]}
                  {lot.url && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={lot.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
                        link ↗
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
          <p style={{ ...MUTED, margin: 0 }}>
            Posted alone — one {auction ? "auction" : "quick buy"}, one post.
          </p>
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
        {blankTemplates.length > 0 && (
          <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
            {kit.group.name} has no{" "}
            {blankTemplates.length === 2 ? "post templates" : `${blankTemplates[0]} post template`}, so{" "}
            {multiLot ? "each such lot" : "the post"} is its description.
          </p>
        )}
      </div>

      {/* Where the post went up: the offer's own listing link, asked by Activate (#1668). */}
      <div style={{ marginTop: "0.875rem" }}>
        <p style={SECTION_LABEL}>Listing link</p>
        {posted && self.url ? (
          <a href={self.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.875rem", color: "var(--color-accent)", wordBreak: "break-all" }}>
            {self.url} ↗
          </a>
        ) : posted ? (
          <p style={{ ...MUTED, margin: 0 }}>Up, with no link recorded — add the post&apos;s link as the listing link.</p>
        ) : (
          <p style={{ ...MUTED, margin: 0 }}>
            {waiting.length > 0
              ? multiLot
                ? `Every lot must be Ready first: ${waiting.map((l) => `lot ${l.lotNo}`).join(", ")}.`
                : "Mark the offer Ready first."
              : multiLot
                ? `The post's link. Activate asks for it once and it activates all ${kit.lots.length} lots.`
                : "The post's link. Activate asks for it once the post is up."}
          </p>
        )}
      </div>

      {/* A quick buy's sale (#1671): nobody bids, so the card asks only who bought it and for how much. */}
      {up && !auction && (
        <div style={{ marginTop: "0.875rem" }}>
          <p style={SECTION_LABEL}>Sale</p>
          <p style={{ ...MUTED, margin: "0 0 0.375rem" }}>
            Price{" "}
            <strong style={{ color: "var(--color-text-primary)" }}>{facebookMoney(self.price, self.currency)}</strong>{" "}
            — the first buyer to claim it takes it.
          </p>
          <DialogPrimaryButton type="button" disabled={isPending} onClick={() => setResultOpen(true)}>
            Record sale…
          </DialogPrimaryButton>
        </div>
      )}

      {/* The bidding, typed by hand while it runs, and the result once it has closed (#1545). */}
      {up && auction && (
        <div style={{ marginTop: "0.875rem" }}>
          <p style={SECTION_LABEL}>Bidding</p>
          {closed && (
            <p style={{ ...MUTED, margin: "0 0 0.375rem", color: "var(--color-warning)", fontWeight: 600 }}>
              Closed {formatRelative(self.endsAt!, now)} — record who won, or that nobody bid.
            </p>
          )}
          <p style={{ ...MUTED, margin: "0 0 0.375rem" }}>
            {hasBid ? (
              <>
                Highest bid <strong style={{ color: "var(--color-text-primary)" }}>{facebookMoney(self.price, self.currency)}</strong>
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
          {!closed && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
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
                Record bid
              </DialogSecondaryButton>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {closed ? (
              <DialogPrimaryButton type="button" disabled={isPending} onClick={() => setResultOpen(true)}>
                Record result…
              </DialogPrimaryButton>
            ) : (
              <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setResultOpen(true)}>
                Record result…
              </DialogSecondaryButton>
            )}
            <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setConfirmNoBids(true)}>
              No bids
            </DialogSecondaryButton>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.8125rem", margin: "0.375rem 0 0" }}>
          {error}
        </p>
      )}

      {resultOpen && (
        <FacebookResultDialog
          offerId={offerId}
          listingType={self.listingType}
          currency={self.currency}
          standingBid={self.price}
          endsAt={auction ? self.endsAt : null}
          onClose={() => setResultOpen(false)}
          onRecorded={(saleId) => {
            setResultOpen(false);
            invalidateSales(collectionId);
            onChanged();
            router.push(`/c/${collectionSlug}/sales/${saleId}`);
          }}
        />
      )}
      {confirmNoBids && (
        <ConfirmDialog
          title="No bids"
          message="End this auction with nobody having bid? The offer is withdrawn and its copies are free to list again."
          actionLabel="Withdraw offer"
          pendingLabel="Withdrawing…"
          isPending={isPending}
          error={error ?? undefined}
          onConfirm={recordNoBids}
          onClose={() => setConfirmNoBids(false)}
        />
      )}
    </section>
  );
}
