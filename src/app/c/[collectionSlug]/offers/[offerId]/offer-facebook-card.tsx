"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import { isFacebookLotPosted } from "@/lib/facebook-post-rules";
import { FACEBOOK_TERMS_PLACEHOLDER, type FacebookGroupSetting } from "@/lib/facebook-group-rules";
import { isAuctionListing, OFFER_LISTING_TYPE_LABEL, OFFER_STATE_LABEL } from "@/lib/offer-rules";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { RenderedHtml } from "@/app/c/[collectionSlug]/shared/rendered-description";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { DialogSecondaryButton } from "@/app/dialog-shell";
import { formatInstant, formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { PendingLinkMark } from "../offer-badges";
import { formControl, multiLineFormControl } from "@/app/control-style";
import { FacebookPostTemplateField } from "@/app/c/[collectionSlug]/shared/facebook-post-template-field";
import { renderFacebookKitPost } from "./facebook-kit-post";

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
// says so. The result is the offer's own *Sell* — to the winner, found by their Facebook profile — or
// *Withdraw* when nobody bid, as on every platform (#1777); the card records neither. A quick buy
// (#1671) has no bidding, so while it is up the card has nothing of its own to follow.
//
// The post is only what its template places (#1692): a missing template or an empty placeholder is
// named under the text, with a link to where it is set, and nothing is filled in to hide it.
//
// An offer may carry its own post template (#1780), overriding its group's for this offer only: the
// card shows *Same as group* with the template it follows, or the offer's own once *Custom for this
// offer* is ticked — prefilled with the group's, so it is edited rather than written from scratch —
// the Settings → Facebook pattern (#1661). It is still a template, written for the offer's current
// type; changing the type on the offer form drops it.
//
// The template is Markdown, limited to what Facebook's post editor offers (#1772): the text is shown
// formatted, with a Source switch back to the template's markup as filled in — the offer description's
// pattern (#319) — and Copy puts the formatted post and its plain text on the clipboard together.
//
// Once the offer is published — Pending or Active, whichever comes first — the text is **frozen**
// (#1800): it is drawn as it was posted, so editing a template, the offer's own or its figures no
// longer changes it. A repost puts the current template up again and freezes that; an offer taken
// back to Ready follows the template again.
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

const SMALL_BTN: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.1875rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
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

/** Why a placeholder came out empty, in the words of what is missing where that is plain. */
const EMPTY_PLACEHOLDER_REASON: Record<string, string> = {
  "{description}": "the offer has no description",
  "{startingPrice}": "no starting price",
  "{increment}": "no bid increment",
  "{closesAt}": "no closing time",
  "{price}": "no price",
  [FACEBOOK_TERMS_PLACEHOLDER.token]: "no note on shipping, payment and terms",
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
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const self = kit.lots.find((l) => l.offerId === offerId) ?? kit.lots[0];
  const multiLot = kit.post !== null;

  const auction = isAuctionListing(self.listingType);
  const { source: postText, html, plain, gaps, frozenAt } = useMemo(() => renderFacebookKitPost(kit), [kit]);
  // Where a setting is set: the group's own pane when it holds it, else Facebook's defaults (#1661).
  const settingHref = (setting: FacebookGroupSetting) =>
    `/c/${collectionSlug}/settings?tab=facebook&row=${encodeURIComponent(
      kit.group.custom.includes(setting) ? kit.group.id : "facebook:defaults"
    )}`;

  // This offer's own template (#1780), and the group's it otherwise follows for its type.
  const groupTemplate = auction ? kit.group.postTemplate : kit.group.quickBuyTemplate;
  const ownTemplate = self.ownTemplate;
  const customTemplate = ownTemplate !== null || draft !== null;
  const templateText = draft ?? ownTemplate ?? "";

  // Posted: once any lot has gone up — the lots of a post go up together.
  const posted = kit.lots.some((l) => isFacebookLotPosted(l.state));
  // What stands between the post and going up: every lot must be Ready, the gate publishing asks.
  const waiting = kit.lots.filter((l) => l.state !== "ready" && l.state !== "pending" && l.state !== "active");

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
            {postText.trim() && (
              <Tooltip content={showSource ? "Show the post the way Facebook will" : "Show the post's Markdown"}>
                <button type="button" onClick={() => setShowSource((v) => !v)} style={SMALL_BTN}>
                  {showSource ? "Rendered" : "Source"}
                </button>
              </Tooltip>
            )}
            <CopyButton value={plain} html={html} label="post text" />
            <a href={kit.photoZipPath} download style={{ ...MUTED, color: "var(--color-accent)" }}>
              ↓ Photos{multiLot ? ", in lot order" : ""}
            </a>
          </div>
        </div>
        {postText.trim() ? (
          showSource ? (
            <pre style={POST_TEXT}>{postText}</pre>
          ) : (
            <RenderedHtml html={html} style={{ ...POST_TEXT, whiteSpace: "normal" }} />
          )
        ) : (
          <p style={{ ...MUTED, margin: 0 }}>The post is empty.</p>
        )}
        {frozenAt && (
          <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
            As posted on {formatInstant(frozenAt)} — editing a template no longer changes it.
          </p>
        )}
        {(gaps.missingTemplates.length > 0 ||
          gaps.emptyOwnTemplates.length > 0 ||
          gaps.emptyPlaceholders.length > 0) && (
          <ul style={{ ...MUTED, margin: "0.25rem 0 0", paddingLeft: "1.25rem", color: "var(--color-warning)" }}>
            {gaps.missingTemplates.map((type) => (
              <li key={type}>
                No {type === "auction" ? "auction" : "quick-buy"} post template set
                {multiLot ? ", so those lots are empty" : ""} —{" "}
                <Link
                  href={settingHref(type === "auction" ? "postTemplate" : "quickBuyTemplate")}
                  style={{ color: "var(--color-accent)" }}
                >
                  set it in Settings → Facebook
                </Link>
              </li>
            ))}
            {gaps.emptyOwnTemplates.map((lotNo) => {
              const lot = kit.lots.find((l) => l.lotNo === lotNo);
              const isSelf = !lot || lot.offerId === offerId;
              return (
                <li key={`own:${lotNo}`}>
                  {multiLot ? `Lot ${lotNo}: its` : "This offer's"} own post template is empty
                  {multiLot ? ", so the lot is" : ""}
                  {isSelf ? (
                    <> — write it below, or untick it to follow the group&apos;s</>
                  ) : (
                    <>
                      {" "}
                      —{" "}
                      <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={{ color: "var(--color-accent)" }}>
                        open #{lot.offerNo}
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
            {gaps.emptyPlaceholders.map(({ lotNo, token }) => {
              const lot = kit.lots.find((l) => l.lotNo === lotNo);
              const where = multiLot ? `Lot ${lotNo}: ` : "";
              const reason = EMPTY_PLACEHOLDER_REASON[token];
              const fix =
                token === FACEBOOK_TERMS_PLACEHOLDER.token ? (
                  <Link href={settingHref("standingNote")} style={{ color: "var(--color-accent)" }}>
                    set it in Settings → Facebook
                  </Link>
                ) : multiLot && lot && lot.offerId !== offerId ? (
                  <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={{ color: "var(--color-accent)" }}>
                    open #{lot.offerNo}
                  </Link>
                ) : null;
              return (
                <li key={`${lotNo}:${token}`}>
                  {where}
                  <code>{token}</code> is empty
                  {reason && <> — {reason}</>}
                  {fix && <> — {fix}</>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* This offer's own post template (#1780): the group's it follows, or its own. */}
      <div style={{ marginTop: "0.875rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <p style={{ ...SECTION_LABEL, margin: 0 }}>
            {auction ? "Auction" : "Quick-buy"} post template{multiLot ? " for this lot" : ""}
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

      {/* Where the post went up: the offer's own listing link, asked by Activate (#1668). */}
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
            {waiting.length > 0
              ? multiLot
                ? `Every lot must be Ready first: ${waiting.map((l) => `lot ${l.lotNo}`).join(", ")}.`
                : "Mark the offer Ready first."
              : multiLot
                ? `The post's link. Activate asks for it once and it activates all ${kit.lots.length} lots.`
                : "The post's link. Activate asks for it once the post is up."}
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
