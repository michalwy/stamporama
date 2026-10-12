"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FacebookOfferKit } from "@/lib/facebook-auctions";
import {
  facebookLotPhotoFileName,
  facebookLotUploadPhotos,
  isFacebookLotPosted,
} from "@/lib/facebook-post-rules";
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
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { useOfferPhotoPlans } from "../use-offers-query";
import { renderFacebookKitPost } from "./facebook-kit-post";
import { FACEBOOK_CASE_PARAM, facebookSettingCase } from "@/app/c/[collectionSlug]/settings/facebook-settings-cases";

// A Facebook post's kit (#1544; ADR-0061 §3): its text and its photos, each taken in one click — and,
// for a post of several lots, how it is laid out (#1841). Drawn by an offer posted alone on its own
// Facebook card, and by a multi-lot post on the post's own screen (#1842); a lot's card no longer
// repeats it.
//
// On the post's screen the kit shows every photo the post puts up, in post order, large enough to
// recognise the stamps (#1848): captioned, each lot's one photo with its caption and its own *Copy*;
// as text, every lot's upload set. One click on a photo downloads it, so posting needs no lot opened.
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

// The post's photos (#1848): a grid across the screen's width, each photo large enough to tell the
// stamps apart — not a thumbnail.
const PHOTO_GRID: React.CSSProperties = {
  listStyle: "none",
  margin: "0.75rem 0 0",
  padding: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))",
  gap: "0.875rem",
  alignItems: "start",
};

const POST_PHOTO: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "18rem",
  objectFit: THUMB_OBJECT_FIT,
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
  // Where a setting is set: the group's own pane when it holds it, else Facebook's defaults (#1661),
  // open on the tab the setting is on (#1849).
  const settingHref = (setting: FacebookGroupSetting) =>
    `/c/${collectionSlug}/settings?tab=facebook&row=${encodeURIComponent(
      kit.group.custom.includes(setting) ? kit.group.id : "facebook:defaults"
    )}&${FACEBOOK_CASE_PARAM}=${facebookSettingCase(setting)}`;

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
        <ol style={PHOTO_GRID}>
          {captions.map((caption) => (
            <li key={caption.offerId} style={{ minWidth: 0 }}>
              {kit.lotPhotoBase && (
                <PhotoLink
                  href={`${kit.lotPhotoBase}${caption.offerId}/photo?download`}
                  src={`${kit.lotPhotoBase}${caption.offerId}/photo`}
                  name={`lot ${caption.lotNo}'s photo`}
                />
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  margin: "0.375rem 0 0.25rem",
                }}
              >
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
            </li>
          ))}
        </ol>
      )}
      {/* A post of several lots laid out as text (#1848): every lot's photos, in lot order. */}
      {multiLot && !captioned && <TextLayoutPhotos collectionSlug={collectionSlug} kit={kit} />}
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

/** One of the post's photos: drawn large, and downloaded by a click (#1848). */
function PhotoLink({ href, src, name, fileName }: { href: string; src: string; name: string; fileName?: string }) {
  return (
    <Tooltip content={fileName ? `Download as ${fileName}` : `Download ${name}`} align="start">
      <a href={href} download={fileName ?? true} aria-label={`Download ${name}`} style={{ display: "block" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes */}
        <img src={src} alt={name} loading="lazy" style={POST_PHOTO} />
      </a>
    </Tooltip>
  );
}

/**
 * A post laid out as text (#1848): what each lot puts up — its upload set, the files the post's ZIP
 * carries under the same `lot-NN-` names — in lot order, without captions, since there are none. A lot
 * with nothing to put up is named, with a link to it, rather than left out silently.
 */
function TextLayoutPhotos({ collectionSlug, kit }: { collectionSlug: string; kit: FacebookOfferKit }) {
  const { collectionId, lots } = kit;
  const plans = useOfferPhotoPlans(
    collectionId,
    lots.map((l) => l.offerId),
    true
  );
  const photoBase = `/api/collections/${collectionId}/photos/`;
  const empty: { lotNo: number; offerId: string; offerNo: number; reason: string }[] = [];
  const tiles = lots.flatMap((lot, index) => {
    const lotNo = lot.lotNo ?? index + 1;
    const plan = plans[index];
    if (!plan.data) {
      if (plan.isError) empty.push({ lotNo, offerId: lot.offerId, offerNo: lot.offerNo, reason: "its photos could not be read" });
      return [];
    }
    const photos = facebookLotUploadPhotos(plan.data.images);
    if (photos.length === 0) {
      empty.push({ lotNo, offerId: lot.offerId, offerNo: lot.offerNo, reason: "no photos to put up" });
    }
    return photos.map((image, i) => ({ lot, lotNo, image, nth: i + 1, of: photos.length }));
  });
  const loading = plans.some((p) => p.isPending);

  return (
    <>
      {tiles.length > 0 && (
        <ol style={PHOTO_GRID}>
          {tiles.map(({ lot, lotNo, image, nth, of }) => {
            const fileName = facebookLotPhotoFileName(lotNo, image.fileName);
            return (
              <li key={image.photoId} style={{ minWidth: 0 }}>
                <PhotoLink
                  href={`${photoBase}${image.photoId}/full?download=${encodeURIComponent(fileName)}`}
                  src={`${photoBase}${image.photoId}/full`}
                  name={`lot ${lotNo}'s photo${of > 1 ? ` ${nth}` : ""}`}
                  fileName={fileName}
                />
                <p style={{ ...SECTION_LABEL, margin: "0.375rem 0 0" }}>
                  Lot {lotNo} · #{lot.offerNo}
                  {of > 1 && ` · ${nth} of ${of}`}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {loading && <p style={{ ...MUTED, margin: "0.5rem 0 0" }}>Loading the photos…</p>}
      {empty.length > 0 && (
        <ul style={{ ...MUTED, margin: "0.5rem 0 0", paddingLeft: "1.25rem", color: "var(--color-warning)" }}>
          {empty.map(({ lotNo, offerId, offerNo, reason }) => (
            <li key={offerId}>
              Lot {lotNo}: {reason} —{" "}
              <Link href={`/c/${collectionSlug}/offers/${offerId}`} style={{ color: "var(--color-accent)" }}>
                open #{offerNo}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
