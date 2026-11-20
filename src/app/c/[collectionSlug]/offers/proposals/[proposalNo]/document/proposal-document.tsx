"use client";

import { useMemo, useState } from "react";
import type { ProposalDocument as ProposalDocumentData, ProposalDocumentLot } from "@/lib/proposal-handout";
import {
  proposalDocumentLabelLanguage,
  proposalDocumentLabels,
  proposalPickedTotal,
  type ProposalDocumentLabels,
} from "@/lib/proposal-document-rules";
import { DEFAULT_CURRENCY_STYLE, writtenAmount } from "@/lib/template-amount";
import { PhotoLightbox, THUMB_OBJECT_FIT, type ViewablePhoto } from "@/app/photo-viewer";

// **A proposal's document for its buyer** (#2288): the proposal as it is offered — every lot with its
// number, title, price and photos, then the total — drawn the same for the collector's printable page
// and the buyer's link, which only address the photos differently. It reads like a post's preview
// (#2212). The page's own words are in the proposal's language; the lots' titles are their own.
//
// A client module for the enlarged view of a photo, which the printed page does without.
//
// **On the buyer's link the lots can be ticked** (#2601): given `picks`, each lot still offered has a
// tick box and a line pinned under the lots sums what is ticked. The collector's printable page passes
// none, and printing or saving the buyer's page leaves the boxes and the line out (`PICK_CLASS`).

/** What the buyer's page hands the document to tick lots with; the state and the saving are the
 *  page's. */
export interface ProposalDocumentPicks {
  /** The lot numbers ticked. */
  picked: ReadonlySet<number>;
  onToggle: (lotNo: number, picked: boolean) => void;
  /** Set while the last tick did not save; the box is back as it was. */
  failed: boolean;
}

/** On everything only the buyer's ticking draws — hidden on paper. */
const PICK_CLASS = "proposal-pick";

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

const PICK_LABEL: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  marginTop: "0.5rem",
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const PICKED_LINE: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  margin: 0,
  padding: "0.75rem 1rem",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem 1rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

export function ProposalDocument({
  document,
  photoSrc,
  picks,
}: {
  document: ProposalDocumentData;
  /** Given on the buyer's link only: the lots can be ticked. */
  picks?: ProposalDocumentPicks;
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
          {picks && lot.pickable && (
            <label className={PICK_CLASS} style={PICK_LABEL}>
              <input
                type="checkbox"
                checked={picks.picked.has(lot.lotNo)}
                onChange={(e) => picks.onToggle(lot.lotNo, e.currentTarget.checked)}
                style={{ width: "1.125rem", height: "1.125rem", margin: 0, cursor: "pointer" }}
              />
              {labels.pick}
            </label>
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

      {picks && document.lots.some((lot) => lot.pickable) && (
        <PickedLine document={document} picks={picks} labels={labels} />
      )}
      {/* Printed or saved, the document has no tick boxes (#2601). */}
      {picks && <style>{`@media print { .${PICK_CLASS} { display: none !important; } }`}</style>}

      {viewing !== null && (
        <PhotoLightbox photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </article>
  );
}

/** Pinned under the lots while the buyer reads them: what is ticked, at the lots' current prices, or a
 *  hint while nothing is — and a tick that did not save. */
function PickedLine({
  document,
  picks,
  labels,
}: {
  document: ProposalDocumentData;
  picks: ProposalDocumentPicks;
  labels: ProposalDocumentLabels;
}) {
  const ticked = document.lots.filter((lot) => lot.pickable && picks.picked.has(lot.lotNo));
  const { count, total } = proposalPickedTotal(ticked);
  return (
    <p className={PICK_CLASS} role="status" style={PICKED_LINE}>
      {count === 0 ? (
        <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>{labels.pickHint}</span>
      ) : (
        labels.picked(count, writtenAmount(total, document.currency, DEFAULT_CURRENCY_STYLE))
      )}
      {picks.failed && <span style={{ color: "var(--color-error)", fontWeight: 400 }}>{labels.pickFailed}</span>}
    </p>
  );
}

/** *Lot 3 · title*, or *Lot 3* alone for a lot with no title. */
function lotName(lot: ProposalDocumentLot, labels: ProposalDocumentLabels): string {
  return lot.title ? `${labels.lot} ${lot.lotNo} · ${lot.title}` : `${labels.lot} ${lot.lotNo}`;
}
