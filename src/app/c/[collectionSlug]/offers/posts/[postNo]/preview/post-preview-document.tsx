"use client";

import { useMemo, useState } from "react";
import type { FacebookPostPreview, FacebookPostPreviewLot } from "@/lib/facebook-post-preview";
import {
  facebookPostPreviewLabelLanguage,
  facebookPostPreviewLabels,
  type FacebookPostPreviewLabels,
} from "@/lib/facebook-post-preview-rules";
import { RenderedHtml } from "@/app/c/[collectionSlug]/shared/rendered-description";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { PhotoLightbox, THUMB_OBJECT_FIT, type ViewablePhoto } from "@/app/photo-viewer";
import { renderFacebookKitPost } from "../../../[offerId]/facebook-kit-post";

// **A Facebook post's preview for a buyer** (#2212): the post as it will appear — its text, then each
// lot with its number, title, price and the photos that go up with it — drawn the same for the
// collector's printable page and the buyer's link, which only address the photos differently.
//
// A client module because the text is rendered as the post's own screen renders it
// (`renderFacebookKitPost`, sanitised with a DOM) and because the closing time is a local time only
// the browser knows the zone of (#490). Both wait for the browser, so the server's render and the
// first client render agree. The page's own words are in the post's language; the post's text is the
// post's own.

const PHOTO_HEIGHT = "16rem";

const H1: React.CSSProperties = {
  margin: 0,
  fontSize: "1.375rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const MUTED: React.CSSProperties = { fontSize: "0.875rem", color: "var(--color-text-secondary)", margin: 0 };

const POST_TEXT: React.CSSProperties = {
  margin: 0,
  color: "var(--color-text-primary)",
  fontSize: "0.9375rem",
  lineHeight: 1.55,
};

const LOT: React.CSSProperties = {
  borderTop: "1px solid var(--color-border)",
  paddingTop: "1rem",
  breakInside: "avoid",
};

const PHOTOS: React.CSSProperties = {
  listStyle: "none",
  margin: "0.75rem 0 0",
  padding: 0,
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
};

const PHOTO: React.CSSProperties = {
  display: "block",
  height: PHOTO_HEIGHT,
  maxWidth: "100%",
  objectFit: THUMB_OBJECT_FIT,
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
};

const SOLD_BADGE: React.CSSProperties = {
  display: "inline-block",
  marginLeft: "0.5rem",
  padding: "0.0625rem 0.5rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
  fontWeight: 600,
  verticalAlign: "middle",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-subtle)",
  border: "1px solid var(--color-border-strong)",
};

/** `Sun 5 Oct, 20:00` in the page's language and the reader's zone. */
function formatClosesAt(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function FacebookPostPreviewDocument({
  preview,
  photoSrc,
}: {
  preview: FacebookPostPreview;
  /** Each photo's address, full size, by photo id (`facebookPostPreviewPhotoSrcs`) — resolved by the
   *  page, because the collector's page and the buyer's link fetch the same picture through different
   *  routes. */
  photoSrc: Readonly<Record<string, string>>;
}) {
  const hydrated = useHydrated();
  const labels = facebookPostPreviewLabels(preview.language);
  const language = facebookPostPreviewLabelLanguage(preview.language);
  const post = useMemo(() => (hydrated && preview.kit ? renderFacebookKitPost(preview.kit) : null), [hydrated, preview.kit]);
  const [viewing, setViewing] = useState<number | null>(null);

  // Every photo in lot order: what the enlarged view steps through, each named by its lot.
  const photos = useMemo(() => {
    const all: (ViewablePhoto & { lotKey: string })[] = [];
    for (const lot of preview.lots) {
      lot.photoIds.forEach((photoId, i) => {
        const name = lotName(lot, labels);
        all.push({
          key: `${lot.key}:${photoId}`,
          lotKey: lot.key,
          src: photoSrc[photoId] ?? "",
          label: lot.photoIds.length > 1 ? `${name} · ${i + 1}/${lot.photoIds.length}` : name,
        });
      });
    }
    return all;
  }, [preview.lots, photoSrc, labels]);

  return (
    <article lang={language} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h1 style={H1}>{preview.title ?? labels.preview}</h1>
        {preview.postLink && (
          <p style={{ margin: 0 }}>
            <a
              href={preview.postLink}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-accent)" }}
            >
              {labels.viewPost} ↗
            </a>
          </p>
        )}
      </header>

      {post?.html && <RenderedHtml html={post.html} style={POST_TEXT} />}

      {preview.lots.map((lot) => {
        const caption = post?.captions.find((c) => c.offerId === lot.key);
        const dimmed = lot.mark !== null;
        return (
          <section key={lot.key} style={LOT} aria-label={lotName(lot, labels)}>
            <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
              {lot.lotNo !== null && <span>{labels.lot} {lot.lotNo} · </span>}
              {lot.title}
              {lot.mark && <span style={SOLD_BADGE}>{lot.mark === "sold" ? labels.sold : labels.unavailable}</span>}
            </h2>
            <LotPrice lot={lot} labels={labels} language={language} hydrated={hydrated} />
            {lot.photoIds.length > 0 && (
              <ul style={PHOTOS}>
                {lot.photoIds.map((photoId) => {
                  const index = photos.findIndex((p) => p.key === `${lot.key}:${photoId}`);
                  return (
                    <li key={photoId} style={{ maxWidth: "100%" }}>
                      <button
                        type="button"
                        onClick={() => setViewing(index)}
                        aria-label={photos[index]?.label}
                        style={{ display: "block", padding: 0, border: 0, background: "none", cursor: "zoom-in", maxWidth: "100%" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes, and printed */}
                        <img
                          src={photos[index]?.src}
                          alt={photos[index]?.label ?? ""}
                          loading="lazy"
                          style={{ ...PHOTO, opacity: dimmed ? 0.4 : 1 }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {caption?.html && <RenderedHtml html={caption.html} style={{ ...POST_TEXT, marginTop: "0.75rem" }} />}
          </section>
        );
      })}

      {viewing !== null && (
        <PhotoLightbox photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </article>
  );
}

/** *Lot 3 · title*, or the title alone for a post of one lot. */
function lotName(lot: FacebookPostPreviewLot, labels: FacebookPostPreviewLabels): string {
  return lot.lotNo !== null ? `${labels.lot} ${lot.lotNo} · ${lot.title}` : lot.title;
}

/** The lot's price as the post states it: a quick buy's price, or an auction's starting price and
 *  closing time. */
function LotPrice({
  lot,
  labels,
  language,
  hydrated,
}: {
  lot: FacebookPostPreviewLot;
  labels: FacebookPostPreviewLabels;
  language: string;
  hydrated: boolean;
}) {
  const parts: string[] = [];
  if (lot.price) parts.push(`${labels.price}: ${lot.price}`);
  if (lot.startingPrice) parts.push(`${labels.startingPrice}: ${lot.startingPrice}`);
  if (lot.endsAt && hydrated) parts.push(`${labels.closes}: ${formatClosesAt(lot.endsAt, language)}`);
  if (parts.length === 0) return null;
  return <p style={{ ...MUTED, marginTop: "0.25rem" }}>{parts.join(" · ")}</p>;
}
