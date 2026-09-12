"use client";

import { useState } from "react";
import {
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { PhotoLightbox as PhotoLightboxView, THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import {
  heldCopyPlace,
  orderHeldCopyPictures,
  type HeldCopyPicture,
} from "@/lib/held-copies";
import { formatItemNo } from "@/lib/item-number";
import {
  useCollectionItemNoPad,
  useHeldCopyPictures,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import type { PhotoEditorPreview } from "@/app/c/[collectionSlug]/inventory/photo-editor";
import {
  collectionPhotoViews,
  PhotoLightbox,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { COPY_BUCKET_COLOR } from "@/app/c/[collectionSlug]/wants/want-copy-counts";
import {
  IdentifiedPieceAside,
  type IdentifiedPiece,
} from "@/app/c/[collectionSlug]/shared/tile-zoom-view";

/** Edge of each held copy's picture. Two of them — a front and a back — sit side by side in the
 * dialog's own column at a size where centring, a perforation and a shade can be judged, and a click
 * opens the full-size lightbox for anything finer. */
const PICTURE_SIZE = "15rem";

/**
 * *Is this one better than mine?* — the piece being identified, beside the copies already held of
 * the stamp it is being identified as (#1207).
 *
 * #562's line says *you hold 2: 1 in collection (MNH) · 1 for sale (U)*, and that settles whether a
 * copy is **needed**. It cannot settle whether the piece in the tweezers is **better** — fresher
 * colour, better centred, full perforations, a cleaner cancel — because that is judged by looking,
 * not by reading a condition code. Answering it meant leaving the identification for Inventory and
 * coming back. So this opens over the intake step, and closing it returns there with every answer
 * as it was left.
 *
 * **Only looking.** Nothing here is preset or written, and nothing ranks the copies: which one is
 * better is the collector's call, and what happens to either copy is done afterwards exactly as it
 * is today — the disposition chips of the step underneath included, which nothing on this screen
 * touches (#562's reasoning for not presetting them holds here too).
 *
 * The piece is the **aside**, to the left, the side the intake step already draws it on: a scan
 * tile's viewer, with its zoom, or the photos added in the step for an intake with no tile. With no
 * picture of it at all the held copies are still shown — the collector may have the stamp in hand.
 *
 * The held copies are `heldCopiesWhere`'s set, the one the line counts: **every** copy still his,
 * the ones in the collection first, each with its condition and disposition — or, for a copy not yet
 * filed, the line's own clause for where it is and no disposition. A copy with no photo is listed
 * and says so: hiding it would read as *not held*, which is the wrong answer to this question.
 *
 * Not the reference comparison (#1004/#1005), which aligns a stamp against a reference for
 * screening forgeries. This compares the collector's own copies, and measures nothing.
 */
export function HeldCopiesCompareDialog({
  collectionId,
  stampId,
  stampLabel,
  conditions,
  certificateStatuses,
  excludeItemId,
  pieces,
  previews,
  scanDpi,
  onClose,
}: {
  collectionId: string;
  stampId: string;
  /** The pick as the intake step names it. */
  stampLabel: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  /** The copy a re-identified tile already became: the piece itself, never one to compare it with. */
  excludeItemId: string | null;
  /** The scan tiles being identified, when there are any. */
  pieces?: IdentifiedPiece[];
  /** The photos added in the intake step, for an intake with no tile. */
  previews: PhotoEditorPreview[];
  scanDpi: number;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useHeldCopyPictures(collectionId, stampId, excludeItemId);
  const pad = useCollectionItemNoPad(collectionId);
  const copies = orderHeldCopyPictures(
    data ?? [],
    conditions.map((c) => c.id)
  );

  const hasPieces = pieces != null && pieces.some((p) => p.sides.length > 0);

  return (
    <DialogShell
      title="Compare with the copies you hold"
      onClose={onClose}
      // Over the intake step, which is itself a dialog at the base stacking order.
      zIndexBase={110}
      maxWidth="min(96vw, 90rem)"
      height="min(90vh, 56rem)"
      aside={
        <IncomingColumn
          collectionId={collectionId}
          pieces={hasPieces ? pieces : undefined}
          previews={previews}
          scanDpi={scanDpi}
        />
      }
      asideWidth="min(46vw, 38rem)"
    >
      <DialogBody>
        <div
          style={{
            marginBottom: "0.75rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
          }}
        >
          {stampLabel}
        </div>
        {isLoading ? (
          <p style={MUTED}>Loading the copies you hold…</p>
        ) : isError ? (
          // Named as a failed read, never left blank — an empty column reads as "you hold none".
          <p style={MUTED}>Could not load the copies you hold.</p>
        ) : copies.length === 0 ? (
          <p style={MUTED}>
            {excludeItemId
              ? "You hold no other copy of this stamp — the only one is the copy this piece already became."
              : "You hold no copy of this stamp."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>
              {copies.length === 1 ? "The copy you hold" : `The ${copies.length} copies you hold`}
            </div>
            {copies.map((copy) => (
              <HeldCopyCard
                key={copy.id}
                collectionId={collectionId}
                copy={copy}
                itemNo={formatItemNo(copy.itemNo, pad)}
                conditions={conditions}
                certificateStatuses={certificateStatuses}
              />
            ))}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose}>Back to the identification</DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

const MUTED: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const COLUMN_HEADING: React.CSSProperties = {
  margin: "0 0 0.5rem",
  fontWeight: 600,
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

/** The piece being identified — the tile's own viewer when there is a tile, otherwise the photos
 * added in the step, otherwise a sentence saying there is no picture of it yet. */
function IncomingColumn({
  collectionId,
  pieces,
  previews,
  scanDpi,
}: {
  collectionId: string;
  pieces?: IdentifiedPiece[];
  previews: PhotoEditorPreview[];
  scanDpi: number;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <h3 style={COLUMN_HEADING}>This piece</h3>
      {pieces ? (
        <IdentifiedPieceAside collectionId={collectionId} pieces={pieces} scanDpi={scanDpi} />
      ) : previews.length > 0 ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignContent: "start",
          }}
        >
          {previews.map((preview, i) => (
            <PictureButton
              key={preview.key}
              src={preview.src}
              label={preview.label}
              turn={preview.turn}
              onOpen={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      ) : (
        <p style={MUTED}>
          No picture of this piece yet. Add one under <strong>Photos</strong> in the identification
          to see it here.
        </p>
      )}
      {lightboxIndex !== null && (
        <PhotoLightboxView
          photos={previews}
          index={Math.min(lightboxIndex, previews.length - 1)}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** One held copy: what it is and where it is, then its pictures. */
function HeldCopyCard({
  collectionId,
  copy,
  itemNo,
  conditions,
  certificateStatuses,
}: {
  collectionId: string;
  copy: HeldCopyPicture;
  itemNo: string;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const condition = conditions.find((c) => c.id === copy.conditionId);
  const certificate = copy.certificateStatusId
    ? certificateStatuses.find((c) => c.id === copy.certificateStatusId)
    : undefined;
  const place = heldCopyPlace(copy);
  const views = collectionPhotoViews(collectionId, copy.photos);

  return (
    <div
      style={{
        padding: "0.625rem 0.75rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          flexWrap: "wrap",
          marginBottom: "0.5rem",
          fontSize: "0.8125rem",
        }}
      >
        <span style={{ color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {itemNo}
        </span>
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
          {condition ? condition.abbreviation || condition.name : "?"}
        </span>
        {certificate && (
          <span style={{ color: "var(--color-text-secondary)" }}>
            {certificate.abbreviation || certificate.name}
          </span>
        )}
        <span style={{ color: "var(--color-text-muted)" }}>·</span>
        {place.kind === "held" ? (
          place.markers.map((marker, i) => (
            <span key={marker.key} style={{ display: "inline-flex", gap: "0.5rem" }}>
              {i > 0 && <span style={{ color: "var(--color-text-muted)" }}>·</span>}
              <span
                style={{
                  fontWeight: 500,
                  color: marker.token
                    ? `var(--color-disposition-${marker.token})`
                    : "var(--color-text-muted)",
                }}
              >
                {marker.label}
              </span>
            </span>
          ))
        ) : (
          <span style={{ fontWeight: 500, color: COPY_BUCKET_COLOR[place.state] }}>
            {place.label}
          </span>
        )}
      </div>

      {copy.photos.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          <Icon name="noPhoto" size="md" />
          No picture of this copy.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {views.map((view, i) => (
            <PictureButton
              key={view.key}
              src={view.src}
              label={view.label}
              onOpen={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <PhotoLightbox
          collectionId={collectionId}
          photos={copy.photos}
          index={Math.min(lightboxIndex, copy.photos.length - 1)}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** A picture at comparison size, captioned, opening the lightbox on a click. The full derivative
 * rather than the thumbnail: a 320 px thumbnail drawn at this size is too soft to judge a
 * perforation by, which is the one thing it is here for. */
function PictureButton({
  src,
  label,
  turn,
  onOpen,
}: {
  src: string;
  label: string;
  /** A turn still to be saved on an upload, previewed as the photo strip previews it. */
  turn?: number;
  onOpen: () => void;
}) {
  return (
    <figure style={{ margin: 0, width: PICTURE_SIZE }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Enlarge ${label}`}
        style={{
          display: "block",
          width: PICTURE_SIZE,
          height: PICTURE_SIZE,
          padding: 0,
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          cursor: "zoom-in",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          loading="lazy"
          style={{
            width: "100%",
            height: "100%",
            objectFit: THUMB_OBJECT_FIT,
            display: "block",
            transform: turn ? `rotate(${turn}deg)` : undefined,
          }}
        />
      </button>
      <figcaption
        style={{
          marginTop: "0.25rem",
          fontSize: "0.75rem",
          color: "var(--color-text-secondary)",
          textAlign: "center",
        }}
      >
        {label}
      </figcaption>
    </figure>
  );
}
