"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoSummary } from "@/lib/photos";
import { SLOT_ROLE_META, isSlotRole } from "./photo-slot-meta";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useEscapeLayer } from "@/app/escape-stack";
import { Icon } from "@/app/icons";

// Read-only photo display for a list row (#112, #137). Shows a single, larger thumbnail — the
// first attached photo — meant to sit at the left of a row with the rest of the row's content
// beside it. When a row has more than one photo the thumbnail becomes a small carousel: a count
// badge signals there's more, and ‹ / › controls cycle through them in place. Clicking the
// thumbnail opens a full-size lightbox with prev/next navigation (arrow keys, Esc to close).
// Reserved slots (front/back/main) are flagged with a corner badge rather than a coloured border,
// so the marker survives the larger, single-image layout. Bytes come from the collection-scoped
// serving route (thumb + full variants).

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
        <Tooltip content={roleLabel(current)} style={{ width: "100%", height: "100%" }}>
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
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </button>
        </Tooltip>

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
          <Tooltip key={p.id} content={roleLabel(p)} style={{ flexShrink: 0 }}>
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
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
          </Tooltip>
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

/** Full-size photo overlay with prev/next + Esc, shared by `PhotoThumb`, `PhotoStrip` and the
 * offer photos panel (#314), which previews generated images that are not an owner's gallery.
 * Rendered through a portal to `document.body` so it fills the viewport instead of being clipped
 * by an ancestor that establishes a containing block (e.g. a transformed/`overflow:hidden` dialog
 * shell), which would otherwise crop a plain `position: fixed` overlay. */
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
  const total = photos.length;
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1);
  const current = photos[safeIndex];
  const step = useCallback(
    (delta: number) => {
      if (total === 0) return;
      onIndex((safeIndex + delta + total) % total);
    },
    [safeIndex, total, onIndex]
  );

  // The lightbox is a layer like any dialog: opened last, it is topmost, so the shared stack gives
  // it Escape and leaves the dialog it was opened from alone (#361).
  useEscapeLayer(onClose);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        step(1);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [step]);

  if (typeof document === "undefined" || !current) return null;

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={roleLabel(current)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "2rem",
        background: "rgba(0,0,0,0.8)",
        cursor: "zoom-out",
      }}
    >
      {/* Close — top-right */}
      <LightboxButton
        label={<Icon name="close" size="lg" />}
        ariaLabel="Close preview"
        onClick={onClose}
        style={{ position: "absolute", top: "1rem", right: "1rem" }}
      />

      {/* Prev / next — only when there's more than one photo */}
      {total > 1 && (
        <>
          <LightboxButton
            label={<Icon name="previous" size="lg" />}
            ariaLabel="Previous photo"
            onClick={() => step(-1)}
            style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)" }}
          />
          <LightboxButton
            label={<Icon name="next" size="lg" />}
            ariaLabel="Next photo"
            onClick={() => step(1)}
            style={{ position: "absolute", right: "1rem", top: "50%", transform: "translateY(-50%)" }}
          />
        </>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fullUrl(collectionId, current.id)}
        alt={roleLabel(current)}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "88vw",
          maxHeight: "80vh",
          objectFit: "contain",
          borderRadius: "0.5rem",
          cursor: "default",
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}
      />
      <span style={{ color: "#fff", fontSize: "0.875rem", fontWeight: 500 }}>
        {roleLabel(current)}
        {total > 1 && (
          <span style={{ color: "rgba(255,255,255,0.6)", marginLeft: "0.5rem" }}>
            {safeIndex + 1} / {total}
          </span>
        )}
      </span>
    </div>,
    document.body
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

/** Overlay control (close / prev / next) in the lightbox. Stops propagation so its click doesn't
 * hit the backdrop's close handler. */
function LightboxButton({
  label,
  ariaLabel,
  onClick,
  style,
}: {
  label: React.ReactNode;
  ariaLabel: string;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "2.75rem",
        height: "2.75rem",
        borderRadius: "999px",
        border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(0,0,0,0.4)",
        color: "#fff",
        fontSize: "1.5rem",
        lineHeight: 1,
        cursor: "pointer",
        ...style,
      }}
    >
      {label}
    </button>
  );
}
