"use client";

import { useCallback, useEffect, useState } from "react";
import type { PhotoSummary } from "@/lib/photos";
import { SLOT_ROLE_META, isSlotRole } from "./photo-slot-meta";

// Read-only photo display for a copy row / inventory popup (#112). Renders thumbnails with
// front/back visually distinguished from titled extras; clicking one opens a full-size
// lightbox with prev/next navigation (arrow keys) and Esc to close. Bytes come from the
// collection-scoped serving route (thumb + full variants).

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

export function PhotoStrip({
  collectionId,
  photos,
  plain = false,
}: {
  collectionId: string;
  photos: PhotoSummary[];
  /** Aggregate galleries (e.g. an issue's main photos, #137) suppress the reserved-slot border
   * and badge — every thumbnail is a main photo, so the ★ marker would just be noise. */
  plain?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const total = photos.length;

  const close = useCallback(() => setOpenIndex(null), []);
  // Cyclic prev/next so navigation never dead-ends at the strip's edges.
  const step = useCallback(
    (delta: number) =>
      setOpenIndex((i) => (i === null ? i : (i + delta + total) % total)),
    [total]
  );

  const open = openIndex !== null;
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (photos.length === 0) return null;

  const current = openIndex !== null ? photos[openIndex] : null;

  return (
    <div
      style={{
        display: "flex",
        gap: "0.375rem",
        marginTop: "0.6rem",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {photos.map((photo, index) => {
        // Reserved slots share their colour + badge with the editor (front = blue, back =
        // violet, main = accent); `plain` galleries (#137) suppress the marker entirely.
        const slotMeta = !plain && isSlotRole(photo.role) ? SLOT_ROLE_META[photo.role] : null;
        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => setOpenIndex(index)}
            title={roleLabel(photo)}
            aria-label={`View ${roleLabel(photo)}`}
            style={{
              position: "relative",
              width: "2.75rem",
              height: "2.75rem",
              padding: 0,
              borderRadius: "0.375rem",
              overflow: "hidden",
              cursor: "pointer",
              background: "var(--color-bg-page)",
              // Reserved slots take their role colour; extras a plain border.
              border: slotMeta
                ? `2px solid ${slotMeta.color}`
                : "1px solid var(--color-border)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(collectionId, photo.id)}
              alt={roleLabel(photo)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {slotMeta && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  fontSize: "0.5625rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  textAlign: "center",
                  color: "#fff",
                  background: slotMeta.color,
                  lineHeight: 1.4,
                }}
              >
                {slotMeta.short}
              </span>
            )}
          </button>
        );
      })}

      {current && openIndex !== null && (
        <div
          onClick={close}
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
            label="✕"
            ariaLabel="Close preview"
            onClick={close}
            style={{ position: "absolute", top: "1rem", right: "1rem" }}
          />

          {/* Prev / next — only when there's more than one photo */}
          {total > 1 && (
            <>
              <LightboxButton
                label="‹"
                ariaLabel="Previous photo"
                onClick={() => step(-1)}
                style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)" }}
              />
              <LightboxButton
                label="›"
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
                {openIndex + 1} / {total}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** Overlay control (close / prev / next). Stops propagation so its click doesn't hit the
 * backdrop's close handler. */
function LightboxButton({
  label,
  ariaLabel,
  onClick,
  style,
}: {
  label: string;
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
