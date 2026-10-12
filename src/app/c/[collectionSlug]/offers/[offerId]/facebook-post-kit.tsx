"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FacebookKitLot, FacebookOfferKit } from "@/lib/facebook-auctions";
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
import { Icon } from "@/app/icons";
import { PhotoLightbox, THUMB_OBJECT_FIT, type ViewablePhoto } from "@/app/photo-viewer";
import { useFacebookPostLotPhotos, useOfferPhotoPlans } from "../use-offers-query";
import { lotPhotosNotReady } from "@/lib/facebook-lot-photo-rules";
import type { FacebookPostLotPhoto } from "@/lib/facebook-lot-photos";
import { renderFacebookKitPost } from "./facebook-kit-post";
import { FACEBOOK_CASE_PARAM, facebookSettingCase } from "@/app/c/[collectionSlug]/settings/facebook-settings-cases";

// A Facebook post's kit (#1544; ADR-0061 §3): its text and its photos, each taken in one click — and,
// for a post of several lots, how it is laid out (#1841). Drawn by an offer posted alone on its own
// Facebook card, and by a multi-lot post on the post's own screen (#1842); a lot's card no longer
// repeats it.
//
// On the post's screen the kit shows every photo the post puts up, in post order, large enough to
// recognise the stamps (#1848): captioned, each lot's one photo with its caption and its own *Copy*;
// as text, every lot's upload set. A click on a photo opens it enlarged, stepping through the post's
// photos in lot order, as a photo does everywhere else; one photo downloads by a discreet button on it
// (#1865), and ↓ Photos stays the way to take them all. Posting needs no lot opened.
// Those are drawn in the post's one list of lots (#1863), each lot's row carrying its photos and
// caption beside its state and actions; the post-wide part — layout, text, ZIP — stays above it.
// A captioned lot's photo is stored once drawn (#1861): one still being drawn says so, and the ZIP
// waits until every lot's is ready.
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

// The post's photos (#1848), each large enough to tell the stamps apart — not a thumbnail. Exported for
// the lot rows that hold them (#1863), which wrap rather than shrink a photo.
export const PHOTO_SIZE = "18rem";

// A lot's photos laid out as text: side by side, wrapping onto the next line.
const LOT_PHOTOS: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
};

const POST_PHOTO: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: PHOTO_SIZE,
  objectFit: THUMB_OBJECT_FIT,
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
};

// The one-photo download (#1865): small, in the photo's corner, shown while the photo is hovered or
// the button has focus (`.post-photo` in globals.css) — ↓ Photos is the main download.
const PHOTO_DOWNLOAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
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
  renderLots,
}: {
  collectionSlug: string;
  kit: FacebookOfferKit;
  /** The offer whose own card draws the kit — an offer posted alone — so a gap in its own template
   *  points at the field below rather than at a link to itself. Null on the post's screen, where every
   *  lot's gap links to its offer. */
  selfOfferId: string | null;
  /** The screen re-reads itself after a write; the kit holds no copy of its own. */
  onChanged: () => void;
  /** A multi-lot post's screen draws its list of lots here, under the post-wide part, each row taking
   *  what the kit puts up for that lot (#1863). */
  renderLots?: (lotKit: (lot: FacebookKitLot) => FacebookLotKit) => React.ReactNode;
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
  const lotPhotos = useFacebookPostLotPhotos(kit.collectionId, kit.post?.id ?? null, captioned);
  // The ZIP of a captioned post is refused until every lot's photo is ready (#1861).
  const zipWaits = captioned
    ? lotPhotos.data
      ? lotPhotosNotReady(lotPhotos.data)
      : "Loading the lots' photos…"
    : null;
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
          {zipWaits ? (
            <Tooltip content={zipWaits}>
              <span style={MUTED}>↓ Photos, one per lot</span>
            </Tooltip>
          ) : (
            <a href={kit.photoZipPath} download style={{ ...MUTED, color: "var(--color-accent)" }}>
              ↓ Photos{captioned ? ", one per lot" : multiLot ? ", in lot order" : ""}
            </a>
          )}
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
      {multiLot && renderLots && (
        <PostLots
          kit={kit}
          captioned={captioned}
          captions={captions}
          lotPhotos={lotPhotos.data}
          showSource={showSource}
          renderLots={renderLots}
        />
      )}
    </div>
  );
}

/** What the kit puts up for one lot of a multi-lot post (#1863), drawn in that lot's row. */
export type FacebookLotKit = {
  /** Captioned, the lot's one photo; as text, its upload set — or why there is nothing to show. */
  photos: React.ReactNode;
  /** Captioned, the lot's caption with its own *Copy*; null as text, where there are no captions. */
  caption: React.ReactNode | null;
};

/**
 * A multi-lot post's lots, each with its part of the kit (#1863): the kit owns what a lot puts up —
 * its photos and, captioned, its caption under the post's Source switch — and the post's screen draws
 * each lot's row around it, so the lots are listed once.
 */
function PostLots({
  kit,
  captioned,
  captions,
  lotPhotos,
  showSource,
  renderLots,
}: {
  kit: FacebookOfferKit;
  captioned: boolean;
  captions: ReturnType<typeof renderFacebookKitPost>["captions"];
  /** A captioned post's stored lot photos (#1861); undefined while they load. */
  lotPhotos: FacebookPostLotPhoto[] | undefined;
  showSource: boolean;
  renderLots: (lotKit: (lot: FacebookKitLot) => FacebookLotKit) => React.ReactNode;
}) {
  const { collectionId, lots } = kit;
  // The text layout puts up each lot's upload set, read through its photo plan (#1848).
  const plans = useOfferPhotoPlans(
    collectionId,
    lots.map((l) => l.offerId),
    !captioned
  );
  const [viewing, setViewing] = useState<number | null>(null);

  // Every photo the post puts up, in lot order (#1865): what the lightbox steps through, each named by
  // its lot. A lot whose photos are still loading — or, captioned, still being drawn (#1861) — joins the
  // run once they are in.
  const postPhotos = useMemo(() => {
    const photos: PostPhotoEntry[] = [];
    const photoBase = `/api/collections/${collectionId}/photos/`;
    lots.forEach((lot, index) => {
      const lotNo = lot.lotNo ?? index + 1;
      if (captioned) {
        const stored = lotPhotos?.find((l) => l.offerId === lot.offerId);
        if (stored?.state.status !== "ready") return;
        const src = `${photoBase}${stored.state.photoId}/full`;
        photos.push({
          key: lot.offerId,
          src,
          label: `Lot ${stored.lotNo}`,
          name: `lot ${stored.lotNo}'s photo`,
          href: `${src}?download=${encodeURIComponent(stored.fileName)}`,
          fileName: stored.fileName,
        });
        return;
      }
      const images = plans[index]?.data ? facebookLotUploadPhotos(plans[index].data.images) : [];
      images.forEach((image, i) => {
        const fileName = facebookLotPhotoFileName(lotNo, image.fileName);
        const of = images.length > 1 ? ` ${i + 1}` : "";
        photos.push({
          key: `${lot.offerId}:${image.photoId}`,
          src: `${photoBase}${image.photoId}/full`,
          label: images.length > 1 ? `Lot ${lotNo} · photo ${i + 1} of ${images.length}` : `Lot ${lotNo}`,
          name: `lot ${lotNo}'s photo${of}`,
          href: `${photoBase}${image.photoId}/full?download=${encodeURIComponent(fileName)}`,
          fileName,
        });
      });
    });
    return photos;
  }, [lots, captioned, lotPhotos, plans, collectionId]);

  function photo(key: string) {
    const index = postPhotos.findIndex((p) => p.key === key);
    if (index < 0) return null;
    return <PostPhoto photo={postPhotos[index]} onOpen={() => setViewing(index)} />;
  }

  function lotKit(lot: FacebookKitLot): FacebookLotKit {
    const index = lots.findIndex((l) => l.offerId === lot.offerId);
    if (captioned) {
      const caption = captions.find((c) => c.offerId === lot.offerId);
      return {
        photos: <LotPhoto lot={lotPhotos?.find((l) => l.offerId === lot.offerId)} photo={photo} />,
        caption: caption ? (
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.25rem",
              }}
            >
              <p style={{ ...SECTION_LABEL, margin: 0 }}>Caption</p>
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
        ) : null,
      };
    }
    const plan = plans[index];
    return {
      photos: <TextLayoutPhotos offerId={lot.offerId} plan={plan} photo={photo} />,
      caption: null,
    };
  }

  return (
    <>
      {renderLots(lotKit)}
      {viewing !== null && (
        <PhotoLightbox photos={postPhotos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

/** One photo the post puts up: what the lightbox shows, and how the photo alone is downloaded. */
type PostPhotoEntry = ViewablePhoto & {
  /** What a screen reader calls it on the row: *lot 3's photo 2*. */
  name: string;
  href: string;
  /** The name it downloads under — the one the post's ZIP gives it — where the route does not name it. */
  fileName?: string;
};

/**
 * One of the post's photos, drawn large (#1848). A click opens it enlarged (#1865); the button in its
 * corner downloads this one photo, under the name the post's ZIP gives it.
 */
function PostPhoto({ photo, onOpen }: { photo: PostPhotoEntry; onOpen: () => void }) {
  return (
    <div className="post-photo" style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Enlarge ${photo.name}`}
        style={{ display: "block", width: "100%", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes */}
        <img src={photo.src} alt={photo.name} loading="lazy" style={POST_PHOTO} />
      </button>
      <span className="post-photo-download" style={{ position: "absolute", top: "0.375rem", right: "0.375rem" }}>
        <Tooltip content="Download this photo">
          <a href={photo.href} download={photo.fileName ?? true} aria-label={`Download ${photo.name}`} style={PHOTO_DOWNLOAD}>
            <Icon name="download" size="sm" />
          </a>
        </Tooltip>
      </span>
    </div>
  );
}

/**
 * A captioned lot's one photo (#1861): the stored one once it is ready — opening enlarged, and
 * downloaded from its corner under the name the post's ZIP gives it (#1865); until then, a placeholder
 * saying where it stands.
 */
function LotPhoto({
  lot,
  photo,
}: {
  lot: FacebookPostLotPhoto | undefined;
  /** Draws one of the post's photos by its key, opening the lightbox on it. */
  photo: (key: string) => React.ReactNode;
}) {
  const state = lot?.state;
  if (lot && state?.status === "ready") return photo(lot.offerId);
  const message = !state
    ? "Loading the photo…"
    : state.status === "generating"
      ? "Generating the photo…"
      : state.status === "failed"
        ? `The photo could not be generated: ${state.error}`
        : state.status === "none"
          ? state.reason
          : "";
  const warn = state?.status === "failed" || state?.status === "none";
  return (
    <div
      style={{
        ...POST_PHOTO,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        textAlign: "center",
        boxSizing: "border-box",
      }}
    >
      <p style={{ ...MUTED, margin: 0, color: warn ? "var(--color-warning)" : MUTED.color }}>{message}</p>
    </div>
  );
}

/**
 * One lot of a post laid out as text (#1848): what it puts up — its upload set, the files the post's
 * ZIP carries under the same `lot-NN-` names — without captions, since there are none. A lot with
 * nothing to put up says so in its row rather than showing nothing.
 */
function TextLayoutPhotos({
  offerId,
  plan,
  photo,
}: {
  offerId: string;
  plan: ReturnType<typeof useOfferPhotoPlans>[number];
  /** Draws one of the post's photos by its key, opening the lightbox on it. */
  photo: (key: string) => React.ReactNode;
}) {
  if (!plan.data) {
    return plan.isError ? (
      <p style={{ ...MUTED, margin: 0, color: "var(--color-warning)" }}>Its photos could not be read.</p>
    ) : (
      <p style={{ ...MUTED, margin: 0 }}>Loading the photos…</p>
    );
  }
  const photos = facebookLotUploadPhotos(plan.data.images);
  if (photos.length === 0) {
    return <p style={{ ...MUTED, margin: 0, color: "var(--color-warning)" }}>No photos to put up.</p>;
  }
  return (
    <ol style={LOT_PHOTOS}>
      {photos.map((image, i) => (
        <li key={image.photoId} style={{ width: PHOTO_SIZE }}>
          {photo(`${offerId}:${image.photoId}`)}
          {photos.length > 1 && (
            <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
              {i + 1} of {photos.length}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
