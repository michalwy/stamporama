"use client";

import { useState } from "react";
import Link from "next/link";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { PhotoLightbox, THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { useToast } from "@/app/toast-provider";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { canCopyImages, copyImageAt } from "@/app/c/[collectionSlug]/shared/copy-image";
import { ThumbPreview } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import type { ProposalScreen } from "@/lib/proposals";
import type { ProposalLotPhotos } from "@/lib/proposal-handout";
import { useProposalMessage } from "../use-proposals-query";

// **What a proposal's buyer is sent** (#2288), on the proposal's screen: the message to copy, the lots'
// photos to download in one archive — each lot's are also on its row, to copy or download one by one —
// and the document to print or share as a link. Each carries the lot numbers the screen shows, and
// handing any of them out marks a proposal being prepared sent (`onHandedOut`).

const META: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

const LINK: React.CSSProperties = { color: "var(--color-accent)" };

const SECONDARY_BUTTON: React.CSSProperties = {
  ...baseBtn,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
};

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.25rem",
  display: "grid",
  gridTemplateColumns: "minmax(0, 2fr) minmax(14rem, 1fr)",
  gap: "1.5rem",
};

const HEADING: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-secondary)",
};

const MESSAGE: React.CSSProperties = {
  margin: 0,
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
  whiteSpace: "pre-wrap",
  fontFamily: "inherit",
  fontSize: "0.875rem",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
  maxHeight: "16rem",
  overflowY: "auto",
};

const THUMB_SIZE = "5.5rem";

const PHOTO_BUTTON: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.5rem",
  height: "1.5rem",
  padding: 0,
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const lotsText = (n: number) => (n === 1 ? "1 lot" : `${n} lots`);

/** The card above the lots: the message, the photos' archive and the document. */
export function ProposalBuyerCard({
  screen,
  collectionSlug,
  photos,
  photoless,
  onHandedOut,
  onOpenDocument,
}: {
  screen: ProposalScreen;
  collectionSlug: string;
  photos: ProposalLotPhotos[] | undefined;
  /** How many lots have no photos yet (#2323) — what *Make photos* makes; 0 once it is sent. */
  photoless: number;
  /** Something went to the buyer: a proposal being prepared becomes sent. */
  onHandedOut: () => void;
  onOpenDocument: () => void;
}) {
  const { data: message, isLoading } = useProposalMessage(screen.collectionId, screen.proposalId);
  const offered = new Set(screen.lots.filter((lot) => lot.state !== "withdrawn").map((lot) => lot.offerId));
  const photoCount = (photos ?? []).filter((lot) => offered.has(lot.offerId)).reduce((n, lot) => n + lot.images.length, 0);
  const settings = `/c/${collectionSlug}/settings?tab=direct`;

  return (
    <section style={CARD} aria-label="For the buyer">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h3 style={HEADING}>Message</h3>
          <span style={{ flex: 1 }} />
          {message?.text && <CopyButton value={message.text} label="message" onCopied={onHandedOut} />}
        </div>
        {isLoading ? (
          <p style={{ ...META, margin: 0 }}>Loading the message…</p>
        ) : message?.text ? (
          <>
            <pre style={MESSAGE}>{message.text}</pre>
            {message.unknownPlaceholders.length > 0 && (
              <p style={{ ...META, margin: 0, color: "var(--color-warning)" }}>
                Not a placeholder, so it stays as typed: {message.unknownPlaceholders.join(", ")}.{" "}
                <Link href={settings} style={LINK}>
                  Edit the template
                </Link>
              </p>
            )}
          </>
        ) : (
          <p style={{ ...META, margin: 0 }}>
            No message: {screen.platform.name} has no proposal message template.{" "}
            <Link href={settings} style={LINK}>
              Write one in Settings → {screen.platform.name}
            </Link>
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h3 style={HEADING}>Photos</h3>
          {photoCount > 0 && (
            <Tooltip content="Every lot's photos in one ZIP, each file named for its lot">
              <a
                href={`/api/collections/${screen.collectionId}/proposals/${screen.proposalId}/photos/zip`}
                download
                onClick={onHandedOut}
                style={{ ...SECONDARY_BUTTON, alignSelf: "flex-start" }}
              >
                <Icon name="download" size="sm" />
                Download all ({photoCount})
              </a>
            </Tooltip>
          )}
          {photos === undefined ? (
            <p style={{ ...META, margin: 0 }}>Loading the photos…</p>
          ) : photoless > 0 ? (
            // Pointing at *Make photos* (#2323): the lots added after Ready — or made Active — that have none.
            <p style={{ ...META, margin: 0, color: photoCount > 0 ? "var(--color-warning)" : undefined }}>
              {photoCount > 0 ? `${lotsText(photoless)} without photos` : `No photos yet on ${lotsText(photoless)}`} — Make
              photos, beside the lots, makes them.
            </p>
          ) : (
            photoCount === 0 && <p style={{ ...META, margin: 0 }}>No photos yet.</p>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h3 style={HEADING}>Document</h3>
          <button
            type="button"
            style={{ ...SECONDARY_BUTTON, alignSelf: "flex-start" }}
            disabled={screen.lots.length === 0}
            onClick={onOpenDocument}
          >
            <Icon name="document" size="sm" />
            Print or share…
          </button>
        </div>
      </div>
    </section>
  );
}

/** A lot's photos on its row — the ones the buyer is sent, each to enlarge, copy or download under the
 *  name the archive gives it. While the lot has none yet, its first copy's own photo stands in (#2313),
 *  so its stamps are always in view, said to be the copy's and not something to send. */
export function LotPhotos({
  collectionId,
  lot,
  copyPhotoId,
  onHandedOut,
}: {
  collectionId: string;
  /** Its photos as the buyer is sent them; absent once the proposal is closed or the lot withdrawn. */
  lot: ProposalLotPhotos | undefined;
  /** Its first copy's front photo, or null when no copy has one. */
  copyPhotoId: string | null;
  onHandedOut: () => void;
}) {
  const { toast } = useToast();
  const [viewing, setViewing] = useState<number | null>(null);
  if (!lot || lot.images.length === 0) {
    const generating = lot?.status === "queued" || lot?.status === "running";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", width: THUMB_SIZE }}>
        {copyPhotoId ? (
          <ThumbPreview
            src={`/api/collections/${collectionId}/photos/${copyPhotoId}/full`}
            thumbSrc={`/api/collections/${collectionId}/photos/${copyPhotoId}/thumb`}
            label="The first copy"
            style={{ display: "block", width: THUMB_SIZE, height: THUMB_SIZE }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes */}
            <img
              src={`/api/collections/${collectionId}/photos/${copyPhotoId}/thumb`}
              alt="The first copy"
              loading="lazy"
              style={{
                display: "block",
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                objectFit: THUMB_OBJECT_FIT,
                border: "1px dashed var(--color-border-strong)",
                borderRadius: "0.375rem",
                background: "var(--color-bg-subtle)",
              }}
            />
          </ThumbPreview>
        ) : null}
        {lot && (
          <span style={{ ...META, lineHeight: 1.3 }}>
            {generating ? "Generating the photos…" : copyPhotoId ? "The copy's photo — none to send yet" : "No photos to send yet"}
          </span>
        )}
      </div>
    );
  }
  const src = (photoId: string, variant: "thumb" | "full") =>
    `/api/collections/${collectionId}/photos/${photoId}/${variant}`;
  const viewable = lot.images.map((image, i) => ({
    key: image.photoId,
    src: src(image.photoId, "full"),
    label: `Lot ${lot.lotNo} · ${i + 1}/${lot.images.length}`,
  }));

  function copy(photoId: string, index: number) {
    if (!canCopyImages()) {
      toast({ message: "This browser does not allow copying a picture here — download it instead", tone: "error" });
      return;
    }
    copyImageAt(src(photoId, "full")).then(
      () => {
        toast({ message: `Lot ${lot!.lotNo}'s photo ${index + 1} copied` });
        onHandedOut();
      },
      () => toast({ message: "Could not copy — the browser blocked the clipboard", tone: "error" })
    );
  }

  return (
    <>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {lot.images.map((image, i) => (
          <li key={image.photoId} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", width: THUMB_SIZE }}>
            <button
              type="button"
              onClick={() => setViewing(i)}
              aria-label={`Enlarge ${viewable[i].label}`}
              style={{ display: "block", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes */}
              <img
                src={src(image.photoId, "thumb")}
                alt={viewable[i].label}
                loading="lazy"
                style={{
                  display: "block",
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  objectFit: THUMB_OBJECT_FIT,
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-subtle)",
                }}
              />
            </button>
            <span style={{ display: "flex", gap: "0.25rem", justifyContent: "center" }}>
              <Tooltip content="Copy this photo, to paste into a chat">
                <button
                  type="button"
                  aria-label={`Copy ${viewable[i].label}`}
                  onClick={() => copy(image.photoId, i)}
                  style={PHOTO_BUTTON}
                >
                  <Icon name="copy" size="sm" />
                </button>
              </Tooltip>
              <Tooltip content={`Download as ${image.fileName}`}>
                <a
                  href={src(image.photoId, "full")}
                  download={image.fileName}
                  aria-label={`Download ${viewable[i].label}`}
                  onClick={onHandedOut}
                  style={PHOTO_BUTTON}
                >
                  <Icon name="download" size="sm" />
                </a>
              </Tooltip>
            </span>
          </li>
        ))}
      </ol>
      {viewing !== null && (
        <PhotoLightbox photos={viewable} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}
