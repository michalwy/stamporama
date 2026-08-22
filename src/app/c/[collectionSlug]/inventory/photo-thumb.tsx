"use client";

import { useCallback, useState } from "react";
import type { PhotoSummary } from "@/lib/photos";
import { SLOT_ROLE_META, isSlotRole } from "./photo-slot-meta";
import {
  PhotoLightbox as PhotoLightboxView,
  THUMB_OBJECT_FIT,
  ThumbPreview,
  type ViewablePhoto,
} from "@/app/photo-viewer";
import { Icon } from "@/app/icons";

// The hover preview and the overlay themselves live in `@/app/photo-viewer`, which knows nothing
// about collections (#666). Re-exported from here because every caller in the app reaches them
// through this module and a thumbnail's neighbours are what a reader looks for them beside.
export { THUMB_OBJECT_FIT, ThumbPreview };

// Read-only photo display for a list row (#112, #137). Shows a single, larger thumbnail — the
// first attached photo — meant to sit at the left of a row with the rest of the row's content
// beside it. When a row has more than one photo the thumbnail becomes a small carousel: a count
// badge signals there's more, and ‹ / › controls cycle through them in place. Clicking the
// thumbnail opens a full-size lightbox with prev/next navigation (arrow keys, Esc to close).
// Reserved slots (front/back/main) are flagged with a corner badge rather than a coloured border,
// so the marker survives the larger, single-image layout. Bytes come from the collection-scoped
// serving route (thumb + full variants), which is this module's whole business: it turns a
// collection's photos into addresses and hands them to the shared viewer.

const DEFAULT_THUMB_SIZE = "4rem"; // 64px — larger than the old strip's 2.75rem thumbnails.

function thumbUrl(collectionId: string, photoId: string): string {
  return `/api/collections/${collectionId}/photos/${photoId}/thumb`;
}
function fullUrl(collectionId: string, photoId: string): string {
  return `/api/collections/${collectionId}/photos/${photoId}/full`;
}

function roleLabel(photo: PhotoSummary): string {
  if (photo.role === "front") return "Front";
  if (photo.role === "back") return "Back";
  if (photo.role === "main") return "Main";
  return photo.title || "Photo";
}

export function PhotoThumb({
  collectionId,
  photos,
  plain = false,
  reserveWhenEmpty = false,
  size = DEFAULT_THUMB_SIZE,
}: {
  collectionId: string;
  photos: PhotoSummary[];
  /** Aggregate galleries (e.g. an issue's main photos, #137) suppress the reserved-slot badge —
   * every thumbnail is a main photo, so the ★ marker would just be noise. */
  plain?: boolean;
  /** List rows render the thumbnail as a fixed left column; when a row has no photos, keep the
   * column so the text of every row lines up. Inline galleries leave this off and collapse. */
  reserveWhenEmpty?: boolean;
  /** Edge length of the (square) thumbnail. Taller rows (inventory copies) pass a larger value
   * so the preview doesn't sit short against the row. */
  size?: string;
}) {
  // Index of the photo shown in the thumbnail; also the lightbox's starting photo.
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // In-place carousel arrows stay hidden until the thumbnail is hovered, to reduce clutter (#153).
  const [hovered, setHovered] = useState(false);
  const total = photos.length;
  // A photo can be removed elsewhere; keep the shown index in range.
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1);

  // Cyclic prev/next so navigation never dead-ends at the edges.
  const step = useCallback(
    (delta: number) => setIndex((i) => (total === 0 ? 0 : (i + delta + total) % total)),
    [total]
  );

  if (total === 0) {
    if (!reserveWhenEmpty) return null;
    // Empty placeholder keeps row text aligned with photo-bearing rows, with a faint stamp
    // glyph so it reads as "no photo" rather than an empty box.
    return (
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: "0.375rem",
          border: "1px dashed var(--color-border)",
          background: "var(--color-bg-page)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Sized as a fraction of the slot rather than in steps: the placeholder follows the
            thumbnail, which is a different size on every list that draws one. */}
        <Icon
          name="noPhoto"
          color="var(--color-text-muted)"
          style={{ width: "62%", height: "62%", opacity: 0.28 }}
        />
      </div>
    );
  }

  const current = photos[safeIndex];
  const slotMeta = !plain && isSlotRole(current.role) ? SLOT_ROLE_META[current.role] : null;

  return (
    <div style={{ flexShrink: 0, width: size }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-page)",
        }}
      >
        <ThumbPreview
          src={fullUrl(collectionId, current.id)}
          thumbSrc={thumbUrl(collectionId, current.id)}
          label={roleLabel(current)}
          style={{ width: "100%", height: "100%" }}
        >
          <button
            type="button"
            onClick={() => setLightbox(true)}
            aria-label={`View ${roleLabel(current)}`}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(collectionId, current.id)}
              alt={roleLabel(current)}
              style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
            />
          </button>
        </ThumbPreview>

        {/* Reserved-slot marker: a corner badge instead of a coloured frame. */}
        {slotMeta && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "0.15rem",
              left: "0.15rem",
              minWidth: "0.95rem",
              height: "0.95rem",
              padding: "0 0.2rem",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.5625rem",
              fontWeight: 700,
              lineHeight: 1,
              color: "#fff",
              background: slotMeta.color,
              borderRadius: "0.25rem",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
            }}
          >
            {slotMeta.icon ? <Icon name={slotMeta.icon} size="xs" /> : slotMeta.short}
          </span>
        )}

        {/* More-than-one signal + in-place navigation. */}
        {total > 1 && (
          <>
            <ThumbNavButton side="left" visible={hovered} onClick={() => step(-1)} />
            <ThumbNavButton side="right" visible={hovered} onClick={() => step(1)} />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: "0.15rem",
                right: "0.15rem",
                padding: "0 0.25rem",
                fontSize: "0.5625rem",
                fontWeight: 600,
                lineHeight: 1.5,
                color: "#fff",
                background: "rgba(0,0,0,0.6)",
                borderRadius: "0.25rem",
              }}
            >
              {safeIndex + 1}/{total}
            </span>
          </>
        )}
      </div>

      {lightbox && (
        <PhotoLightbox
          collectionId={collectionId}
          photos={photos}
          index={safeIndex}
          onIndex={setIndex}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}

/** Read-only strip of all of an owner's photos (#147). Unlike `PhotoThumb` (one thumbnail with an
 * in-place carousel), this lays every photo out as a row of thumbnails — the same shape as the
 * copy editor's photo strip, but with no editing controls. Clicking a thumbnail opens the shared
 * lightbox at that photo. Meant for read-only contexts (e.g. the quick catalog-value dialog). */
export function PhotoStrip({
  collectionId,
  photos,
  size = "4.5rem",
}: {
  collectionId: string;
  photos: PhotoSummary[];
  /** Edge length of each (square) thumbnail. */
  size?: string;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.125rem" }}>
      {photos.map((p, i) => {
        const slotMeta = isSlotRole(p.role) ? SLOT_ROLE_META[p.role] : null;
        return (
          <ThumbPreview
            key={p.id}
            src={fullUrl(collectionId, p.id)}
            thumbSrc={thumbUrl(collectionId, p.id)}
            label={roleLabel(p)}
            style={{ flexShrink: 0 }}
          >
            <button
              type="button"
              onClick={() => setLightboxIndex(i)}
              aria-label={`View ${roleLabel(p)}`}
              style={{
                position: "relative",
                flexShrink: 0,
                width: size,
                height: size,
                padding: 0,
                borderRadius: "0.375rem",
                overflow: "hidden",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-page)",
                cursor: "pointer",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl(collectionId, p.id)}
                alt={roleLabel(p)}
                style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
              />
              {slotMeta && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: "0.15rem",
                    left: "0.15rem",
                    minWidth: "0.95rem",
                    height: "0.95rem",
                    padding: "0 0.2rem",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.5625rem",
                    fontWeight: 700,
                    lineHeight: 1,
                    color: "#fff",
                    background: slotMeta.color,
                    borderRadius: "0.25rem",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                  }}
                >
                  {slotMeta.icon ? <Icon name={slotMeta.icon} size="xs" /> : slotMeta.short}
                </span>
              )}
            </button>
          </ThumbPreview>
        );
      })}
      {lightboxIndex !== null && (
        <PhotoLightbox
          collectionId={collectionId}
          photos={photos}
          index={Math.min(lightboxIndex, photos.length - 1)}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** The collection's photos as the shared viewer takes them (#666): ids turned into addresses and
 * roles turned into words, once, here — the overlay itself knows neither. */
export function collectionPhotoViews(
  collectionId: string,
  photos: PhotoSummary[]
): ViewablePhoto[] {
  return photos.map((photo) => ({
    key: photo.id,
    src: fullUrl(collectionId, photo.id),
    label: roleLabel(photo),
  }));
}

/** The shared lightbox, addressed by collection: the call shape every screen in the app already
 * uses, over the overlay in `@/app/photo-viewer`. */
export function PhotoLightbox({
  collectionId,
  photos,
  index,
  onIndex,
  onClose,
}: {
  collectionId: string;
  photos: PhotoSummary[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <PhotoLightboxView
      photos={collectionPhotoViews(collectionId, photos)}
      index={index}
      onIndex={onIndex}
      onClose={onClose}
    />
  );
}


/** Small round chevron overlaid on the thumbnail that cycles the shown photo without opening the
 * lightbox. A circular puck keeps most of the stamp visible (unlike a full-height bar). Stops
 * propagation so it never triggers the image's open-lightbox click. Hidden until the thumbnail is
 * hovered (#153); `pointer-events` follow visibility so the invisible control isn't clickable. */
function ThumbNavButton({
  side,
  visible,
  onClick,
}: {
  side: "left" | "right";
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        position: "absolute",
        top: "50%",
        [side]: "0.15rem",
        transform: "translateY(-50%)",
        width: "1.1rem",
        height: "1.1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "999px",
        border: "none",
        padding: 0,
        fontSize: "0.8rem",
        lineHeight: 1,
        color: "#fff",
        background: "rgba(0,0,0,0.55)",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 120ms ease",
      }}
    >
      <Icon name={side === "left" ? "previous" : "next"} size="xs" />
    </button>
  );
}
