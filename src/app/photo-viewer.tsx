"use client";

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useEscapeLayer } from "@/app/escape-stack";
import { Icon } from "@/app/icons";

// **Looking at a picture**, wherever the picture comes from: the hover preview (#632) and the
// full-size lightbox (#112, #137), with no idea of a collection between them.
//
// They were written inside `inventory/photo-thumb.tsx`, against a collection id and a `PhotoSummary`,
// which is all the app had ever needed. The partner's page (#666) needs the same two things about
// pictures it addresses through a **token** route and knows nothing else about — no role, no title,
// no collection. So the pair moved here and now takes **resolved sources**: whoever knows how to
// address a photo says so once, and the overlay stays one implementation rather than two to keep in
// step. `photo-thumb.tsx` keeps the collection-scoped call shape as a thin adapter over this.

/** Every thumbnail in the app **fits** its image inside the box rather than cropping it to fill
 * (#525). A stamp is the subject, and a cropped stamp hides exactly what the thumbnail is looked at
 * for — a margin, a perforation, an overprint at the edge. The box keeps its size; the image scales
 * by its longest edge and letterboxes against the tile's background. Import this rather than writing
 * `objectFit` by hand, so a new thumbnail cannot quietly go back to cropping. */
export const THUMB_OBJECT_FIT = "contain" as const;

/** One picture, already addressed. `src` is the full-size variant; `label` is what it is called, in
 *  the caption and to a screen reader. */
export interface ViewablePhoto {
  key: string;
  src: string;
  label: string;
}

/** How long the pointer rests on a thumbnail before the enlarged preview opens (#632). Long enough
 * that running down a list of forty thumbnails on the way somewhere else pops up nothing at all,
 * short enough that stopping on one reads as an answer rather than a wait. */
const PREVIEW_DELAY_MS = 400;

/** Edge of the preview box. Square, and the picture **fits** inside it exactly as the thumbnail it
 * came from does ({@link THUMB_OBJECT_FIT}) — this is the same image, larger, so a wide stamp
 * letterboxing here is the shape it already had on the row. Fixed rather than following the image:
 * a popup that changed size with every photo would jump around the screen as the pointer moves
 * along a strip. */
const PREVIEW_SIZE = "20rem";

/**
 * Hover a thumbnail, see it big (#632).
 *
 * Wraps a thumbnail so that resting on it opens an enlarged preview beside it, captioned with the
 * same label the plain hint used to carry. It **complements** the click, which still opens the
 * lightbox: the preview answers *what is this one* without leaving the list, and the lightbox is
 * for looking properly.
 *
 * It is the shared {@link Tooltip} with a picture in it rather than a second hover mechanism —
 * placement, viewport clamping and the rule that an inner hint silences the outer one are the hard
 * parts and are already right there. Every thumbnail that carried a `Tooltip` for its label swaps
 * that wrapper for this one, so the label is not lost and no site grows a second hover surface.
 *
 * Where there is nothing to enlarge (an empty slot, an upload whose bytes are not on the server
 * yet) it degrades to exactly the plain hint it replaced, immediately and with no picture.
 */
export function ThumbPreview({
  src,
  thumbSrc,
  label,
  style,
  children,
}: {
  /** Full-size image to show in the popup. Empty/absent falls back to a plain label hint. */
  src?: string | null;
  /** The thumbnail already on screen. Drawn behind `src` while it loads, so the popup opens with
   * the picture — upscaled and soft — instead of an empty box that fills in a moment later. */
  thumbSrc?: string | null;
  /** Caption under the preview, and the whole hint when there is no image. */
  label: React.ReactNode;
  /** Trigger wrapper styles, forwarded to `Tooltip` — see its note on why they belong there. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!src) {
    return (
      <Tooltip content={label} style={style}>
        {children}
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={
        <span style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <span
            style={{
              position: "relative",
              display: "block",
              width: PREVIEW_SIZE,
              height: PREVIEW_SIZE,
              borderRadius: "0.375rem",
              overflow: "hidden",
              background: "var(--color-bg-page)",
              backgroundImage: thumbSrc ? `url("${thumbSrc}")` : undefined,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              backgroundSize: "contain",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: THUMB_OBJECT_FIT,
                display: "block",
              }}
            />
          </span>
          {label ? <span style={{ textAlign: "center" }}>{label}</span> : null}
        </span>
      }
      maxWidth="none"
      delay={PREVIEW_DELAY_MS}
      style={style}
    >
      {children}
    </Tooltip>
  );
}

/** Full-size photo overlay with prev/next + Esc, shared by every screen that shows a picture — the
 * copy row and its strip, the offer photos panel (#314), which previews generated images that are
 * not an owner's gallery, and the partner's page (#666), whose pictures are addressed through a
 * token route.
 *
 * Rendered through a portal to `document.body` so it fills the viewport instead of being clipped
 * by an ancestor that establishes a containing block (e.g. a transformed/`overflow:hidden` dialog
 * shell), which would otherwise crop a plain `position: fixed` overlay. */
export function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: ViewablePhoto[];
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
      aria-label={current.label}
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
        src={current.src}
        alt={current.label}
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
        {current.label}
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
