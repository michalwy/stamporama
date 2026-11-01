"use client";

import { useMemo, useState } from "react";
import type { ProposalDocument as ProposalDocumentData, ProposalDocumentLot } from "@/lib/proposal-handout";
import {
  proposalDocumentLabelLanguage,
  proposalDocumentLabels,
  type ProposalDocumentLabels,
} from "@/lib/proposal-document-rules";
import { PhotoLightbox, THUMB_OBJECT_FIT, type ViewablePhoto } from "@/app/photo-viewer";

// **A proposal's document for its buyer** (#2288): the proposal as it is offered — every lot with its
// number, title, price and photos, then the total — drawn the same for the collector's printable page
// and the buyer's link, which only address the photos differently. It reads like a post's preview
// (#2212). The page's own words are in the proposal's language; the lots' titles are their own.
//
// A client module for the enlarged view of a photo, which the printed page does without.

const PHOTO_HEIGHT = "16rem";

const H1: React.CSSProperties = {
  margin: 0,
  fontSize: "1.375rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const MUTED: React.CSSProperties = { fontSize: "0.875rem", color: "var(--color-text-secondary)", margin: 0 };

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

const MARK_BADGE: React.CSSProperties = {
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

export function ProposalDocument({
  document,
  photoSrc,
}: {
  document: ProposalDocumentData;
  /** Each photo's address, full size, by photo id (`proposalDocumentPhotoSrcs`) — resolved by the
   *  page, because the collector's page and the buyer's link fetch the same picture through different
   *  routes. */
  photoSrc: Readonly<Record<string, string>>;
}) {
  const labels = proposalDocumentLabels(document.language);
  const language = proposalDocumentLabelLanguage(document.language);
  const [viewing, setViewing] = useState<number | null>(null);

  // Every photo in lot order: what the enlarged view steps through, each named by its lot.
  const photos = useMemo(() => {
    const all: ViewablePhoto[] = [];
    for (const lot of document.lots) {
      lot.photoIds.forEach((photoId, i) => {
        const name = lotName(lot, labels);
        all.push({
          key: `${lot.key}:${photoId}`,
          src: photoSrc[photoId] ?? "",
          label: lot.photoIds.length > 1 ? `${name} · ${i + 1}/${lot.photoIds.length}` : name,
        });
      });
    }
    return all;
  }, [document.lots, photoSrc, labels]);

  return (
    <article lang={language} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <h1 style={H1}>
        {labels.offer} #{document.proposalNo}
      </h1>

      {document.lots.map((lot) => (
        <section key={lot.key} style={LOT} aria-label={lotName(lot, labels)}>
          <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {lotName(lot, labels)}
            {lot.mark && <span style={MARK_BADGE}>{lot.mark === "sold" ? labels.sold : labels.unavailable}</span>}
          </h2>
          {lot.price && lot.mark === null && (
            <p style={{ ...MUTED, marginTop: "0.25rem" }}>
              {labels.price}: {lot.price}
            </p>
          )}
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
                      <img src={photos[index]?.src} alt={photos[index]?.label ?? ""} loading="lazy" style={PHOTO} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <p
        style={{
          margin: 0,
          paddingTop: "1rem",
          borderTop: "1px solid var(--color-border-strong)",
          fontSize: "1.0625rem",
          fontWeight: 700,
          color: "var(--color-text-primary)",
        }}
      >
        {labels.total}: {document.total}
      </p>

      {viewing !== null && (
        <PhotoLightbox photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </article>
  );
}

/** *Lot 3 · title*, or *Lot 3* alone for a lot with no title. */
function lotName(lot: ProposalDocumentLot, labels: ProposalDocumentLabels): string {
  return lot.title ? `${labels.lot} ${lot.lotNo} · ${lot.title}` : `${labels.lot} ${lot.lotNo}`;
}
