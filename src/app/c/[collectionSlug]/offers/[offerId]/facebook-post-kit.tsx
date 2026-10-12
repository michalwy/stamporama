"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import { isFacebookLotPosted } from "@/lib/facebook-post-rules";
import {
  FACEBOOK_MULTI_LOT_LAYOUT_LABEL,
  FACEBOOK_MULTI_LOT_LAYOUTS,
  FACEBOOK_TERMS_PLACEHOLDER,
  type FacebookGroupSetting,
  type FacebookMultiLotLayout,
} from "@/lib/facebook-group-rules";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { RenderedHtml } from "@/app/c/[collectionSlug]/shared/rendered-description";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formatInstant } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { formControl } from "@/app/control-style";
import { renderFacebookKitPost } from "./facebook-kit-post";

// A Facebook post's kit (#1544; ADR-0061 §3): its text and its photos, each taken in one click — and,
// for a post of several lots, how it is laid out (#1841). Drawn by an offer posted alone on its own
// Facebook card, and by a multi-lot post on the post's own screen (#1842); a lot's card no longer
// repeats it.
//
// The text is rendered **here**, in the browser, because the closing time it states is a local time
// and this is the one place the collector's zone is known (#490). It is Markdown limited to Facebook's
// post editor (#1772), shown formatted with a Source switch (#319's pattern). Once published it is
// frozen (#1800) and drawn as it was posted. What is missing is named under it, with a link to where it
// is set (#1692); nothing is filled in to hide it.

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

const LOT_PHOTO: React.CSSProperties = {
  width: "6rem",
  height: "6rem",
  objectFit: "contain",
  flexShrink: 0,
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
};

const SELECT: React.CSSProperties = {
  ...formControl,
  padding: "0.25rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
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

/** Why a placeholder came out empty, in the words of what is missing where that is plain. */
const EMPTY_PLACEHOLDER_REASON: Record<string, string> = {
  "{description}": "the offer has no description",
  "{startingPrice}": "no starting price",
  "{increment}": "no bid increment",
  "{closesAt}": "no closing time",
  "{price}": "no price",
  [FACEBOOK_TERMS_PLACEHOLDER.token]: "no note on shipping, payment and terms",
};

export function FacebookPostKit({
  collectionSlug,
  kit,
  selfOfferId,
  onChanged,
}: {
  collectionSlug: string;
  kit: FacebookOfferKit;
  /** The offer whose own card draws the kit — an offer posted alone — so a gap in its own template
   *  points at the field below rather than at a link to itself. Null on the post's screen, where every
   *  lot's gap links to its offer. */
  selfOfferId: string | null;
  /** The screen re-reads itself after a write; the kit holds no copy of its own. */
  onChanged: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const multiLot = kit.post !== null;
  const {
    source: postText,
    html,
    plain,
    gaps,
    frozenAt,
    layout,
    captions,
  } = useMemo(() => renderFacebookKitPost(kit), [kit]);
  const captioned = layout === "captions";
  // Posted: once any lot has gone up — the lots of a post go up together.
  const posted = kit.lots.some((l) => isFacebookLotPosted(l.state));
  // Where a setting is set: the group's own pane when it holds it, else Facebook's defaults (#1661).
  const settingHref = (setting: FacebookGroupSetting) =>
    `/c/${collectionSlug}/settings?tab=facebook&row=${encodeURIComponent(
      kit.group.custom.includes(setting) ? kit.group.id : "facebook:defaults"
    )}`;

  function setLayout(value: FacebookMultiLotLayout | null) {
    if (!kit.post) return;
    const postId = kit.post.id;
    setError(null);
    startTransition(async () => {
      const { setFacebookPostLayoutAction } = await import("@/app/actions/facebook");
      const result = await setFacebookPostLayoutAction(postId, value);
      if (result.status === "error") setError(result.message);
      else onChanged();
    });
  }

  return (
    <div>
      {/* How the post is laid out (#1841): the group's setting, or the post's own until it is up. */}
      {multiLot && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <label htmlFor={`facebook-post-layout-${kit.post!.id}`} style={MUTED}>
            Layout
          </label>
          {posted ? (
            <span style={{ ...MUTED, color: "var(--color-text-primary)" }}>
              {FACEBOOK_MULTI_LOT_LAYOUT_LABEL[layout]}
            </span>
          ) : (
            <select
              id={`facebook-post-layout-${kit.post!.id}`}
              value={kit.post?.layout ?? ""}
              disabled={isPending}
              onChange={(e) => setLayout(e.target.value === "" ? null : (e.target.value as FacebookMultiLotLayout))}
              style={SELECT}
            >
              <option value="">
                Same as group — {FACEBOOK_MULTI_LOT_LAYOUT_LABEL[kit.group.multiLotLayout].toLowerCase()}
              </option>
              {FACEBOOK_MULTI_LOT_LAYOUTS.map((l) => (
                <option key={l} value={l}>
                  {FACEBOOK_MULTI_LOT_LAYOUT_LABEL[l]}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* The kit: the post's text and its photos, one click each. */}
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
            ↓ Photos{captioned ? ", one per lot" : multiLot ? ", in lot order" : ""}
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
      {/* A captioned post (#1841): per lot, in post order, its one photo and the caption under it. */}
      {captioned && (
        <ol style={{ listStyle: "none", margin: "0.625rem 0 0", padding: 0, display: "grid", gap: "0.625rem" }}>
          {captions.map((caption) => (
            <li key={caption.offerId} style={{ display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
              {kit.lotPhotoBase && (
                <a
                  href={`${kit.lotPhotoBase}${caption.offerId}/photo?download`}
                  download
                  aria-label={`Download lot ${caption.lotNo}'s photo`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- drawn on demand by our own route */}
                  <img
                    src={`${kit.lotPhotoBase}${caption.offerId}/photo`}
                    alt={`Lot ${caption.lotNo}`}
                    loading="lazy"
                    style={LOT_PHOTO}
                  />
                </a>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                  <p style={{ ...SECTION_LABEL, margin: 0 }}>
                    Lot {caption.lotNo} · #{caption.offerNo} caption
                  </p>
                  <CopyButton value={caption.plain} html={caption.html} label="caption" />
                </div>
                {caption.source.trim() ? (
                  showSource ? (
                    <pre style={POST_TEXT}>{caption.source}</pre>
                  ) : (
                    <RenderedHtml html={caption.html} style={{ ...POST_TEXT, whiteSpace: "normal" }} />
                  )
                ) : (
                  <p style={{ ...MUTED, margin: 0 }}>The caption is empty.</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {frozenAt && (
        <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
          As posted on {formatInstant(frozenAt)} — editing a template no longer changes it.
        </p>
      )}
      {(gaps.missingPostText ||
        gaps.missingTemplates.length > 0 ||
        gaps.emptyOwnTemplates.length > 0 ||
        gaps.emptyPlaceholders.length > 0) && (
        <ul style={{ ...MUTED, margin: "0.25rem 0 0", paddingLeft: "1.25rem", color: "var(--color-warning)" }}>
          {gaps.missingPostText && (
            <li>
              No post text template set for captioned posts, so the post&apos;s text is empty —{" "}
              <Link href={settingHref("captionPostTemplate")} style={{ color: "var(--color-accent)" }}>
                set it in Settings → Facebook
              </Link>
            </li>
          )}
          {gaps.missingTemplates.map((type) => (
            <li key={type}>
              No {type === "auction" ? "auction" : "quick-buy"} {captioned ? "caption" : "post"} template set
              {multiLot ? (captioned ? ", so those captions are empty" : ", so those lots are empty") : ""} —{" "}
              <Link
                href={settingHref(
                  captioned
                    ? type === "auction"
                      ? "auctionCaptionTemplate"
                      : "quickBuyCaptionTemplate"
                    : type === "auction"
                      ? "postTemplate"
                      : "quickBuyTemplate"
                )}
                style={{ color: "var(--color-accent)" }}
              >
                set it in Settings → Facebook
              </Link>
            </li>
          ))}
          {gaps.emptyOwnTemplates.map((lotNo) => {
            const lot = kit.lots.find((l) => l.lotNo === lotNo) ?? (multiLot ? undefined : kit.lots[0]);
            const isSelf = lot !== undefined && lot.offerId === selfOfferId;
            return (
              <li key={`own:${lotNo}`}>
                {multiLot ? `Lot ${lotNo}: its` : "This offer's"} own {captioned ? "caption" : "post"} template is
                empty{multiLot ? (captioned ? ", so its caption is" : ", so the lot is") : ""}
                {isSelf ? (
                  <> — write it below, or untick it to follow the group&apos;s</>
                ) : lot ? (
                  <>
                    {" "}
                    —{" "}
                    <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={{ color: "var(--color-accent)" }}>
                      open #{lot.offerNo}
                    </Link>
                  </>
                ) : null}
              </li>
            );
          })}
          {gaps.emptyPlaceholders.map(({ lotNo, token }) => {
            const lot = lotNo === null && captioned ? undefined : kit.lots.find((l) => l.lotNo === lotNo);
            const where = captioned && lotNo === null ? "Post text: " : multiLot ? `Lot ${lotNo}: ` : "";
            const reason = EMPTY_PLACEHOLDER_REASON[token];
            const fix =
              token === FACEBOOK_TERMS_PLACEHOLDER.token ? (
                <Link href={settingHref("standingNote")} style={{ color: "var(--color-accent)" }}>
                  set it in Settings → Facebook
                </Link>
              ) : multiLot && lot && lot.offerId !== selfOfferId ? (
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
      {error && (
        <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.8125rem", margin: "0.375rem 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
