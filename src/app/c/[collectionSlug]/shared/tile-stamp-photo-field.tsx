"use client";

import { LabelWithError } from "@/app/dialog-shell";
import {
  THUMB_OBJECT_FIT,
  ThumbPreview,
  photoFullUrl,
  photoThumbUrl,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import type { EditablePhotoSummary } from "@/lib/photos";
import type { IdentifiedPiece } from "./tile-zoom-view";

const THUMB = "4.5rem";

/** The preview's trigger fills the figure's box, so the whole square answers to the pointer. */
const PREVIEW_TRIGGER: React.CSSProperties = { display: "block", width: "100%", height: "100%" };

/** A piece's front picture, or null for a tile cut from the back alone. */
export function pieceFrontPhotoId(piece: IdentifiedPiece): string | null {
  return piece.sides.find((s) => s.side === "front")?.photoId ?? null;
}

/**
 * *Use the tile's photo as the stamp's photo* (#1340), in the identification's condition step.
 *
 * The stamp's current photo is drawn beside the tile's, because the choice is a comparison: the
 * first copy identified gave the stamp its picture, and this is the moment a better one is in hand.
 * With several tiles identified as one stamp (#596) each is offered and one is picked — the stamp has
 * one main picture, and the app does not choose it for the collector.
 *
 * The choice is about quality — centring, colour, cancel, margins — and none of that can be judged at
 * this size, so each picture opens the shared hover preview, as every other thumbnail does (#1344).
 * Hover only: the collector settled that a click-to-compare view was more than the choice needs.
 *
 * The state and its defaults are the dialog's (`tile-stamp-photo.ts`); this only draws them.
 */
export function TileStampPhotoField({
  collectionId,
  pieces,
  stampPhotos,
  offered,
  on,
  tileId,
  disabled,
  onChange,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
  /** The stamp's photos, main first — undefined while loading. */
  stampPhotos: EditablePhotoSummary[] | undefined;
  /** False for a piece in a format other than the single (#346). */
  offered: boolean;
  on: boolean | undefined;
  tileId: string;
  disabled: boolean;
  onChange: (next: { on: boolean; tileId: string }) => void;
}) {
  const withFront = pieces.filter((p) => pieceFrontPhotoId(p) !== null);
  if (withFront.length === 0) return null;
  const current = stampPhotos?.[0] ?? null;
  const several = withFront.length > 1;

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <LabelWithError htmlFor="intake-stamp-photo">Stamp photo</LabelWithError>
      {!offered ? (
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          Only a single&apos;s picture can become the stamp&apos;s photo — a pair or a block would
          misrepresent the stamp.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
              flexWrap: "wrap",
              marginTop: "0.25rem",
            }}
          >
            <Figure caption="Now">
              {stampPhotos === undefined ? (
                <Placeholder text="…" />
              ) : current ? (
                <ThumbPreview
                  src={photoFullUrl(collectionId, current.id)}
                  thumbSrc={photoThumbUrl(collectionId, current.id)}
                  label="The stamp's current photo"
                  style={PREVIEW_TRIGGER}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoThumbUrl(collectionId, current.id)}
                    alt="The stamp's current photo"
                    style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                  />
                </ThumbPreview>
              ) : (
                <Placeholder text="No photo" />
              )}
            </Figure>
            {withFront.map((piece) => {
              const chosen = piece.tileId === tileId;
              const frontId = pieceFrontPhotoId(piece) as string;
              return (
                <Figure
                  key={piece.tileId}
                  caption={`Tile ${piece.position + 1}`}
                  selected={several && on === true && chosen}
                >
                  <ThumbPreview
                    src={photoFullUrl(collectionId, frontId)}
                    thumbSrc={photoThumbUrl(collectionId, frontId)}
                    label={`Tile ${piece.position + 1}, front`}
                    style={PREVIEW_TRIGGER}
                  >
                    <button
                      type="button"
                      disabled={disabled || !several}
                      aria-pressed={several ? chosen : undefined}
                      aria-label={`Use tile ${piece.position + 1}'s front`}
                      onClick={() => onChange({ on: true, tileId: piece.tileId })}
                      style={{
                        width: "100%",
                        height: "100%",
                        padding: 0,
                        border: "none",
                        background: "none",
                        cursor: several && !disabled ? "pointer" : "default",
                        // A disabled button swallows the pointer, and the preview's wrapper would
                        // never hear it arrive — so a button with nothing to do lets it through.
                        pointerEvents: disabled || !several ? "none" : undefined,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoThumbUrl(collectionId, frontId)}
                        alt={`Tile ${piece.position + 1}, front`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: THUMB_OBJECT_FIT,
                          display: "block",
                          opacity: several && !(on && chosen) ? 0.55 : 1,
                        }}
                      />
                    </button>
                  </ThumbPreview>
                </Figure>
              );
            })}
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "var(--color-text-secondary)",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              id="intake-stamp-photo"
              type="checkbox"
              checked={on === true}
              disabled={disabled || on === undefined}
              onChange={(e) => onChange({ on: e.target.checked, tileId })}
            />
            {several
              ? "Use the chosen tile's front as the stamp's photo"
              : "Use the tile's front as the stamp's photo"}
          </label>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {current
              ? "It replaces the stamp's current photo. A stamp above it changes too only where it shows that same picture."
              : "The stamp has no photo yet, so this would be its first."}
          </p>
        </>
      )}
    </div>
  );
}

function Figure({
  caption,
  selected = false,
  children,
}: {
  caption: string;
  /** The tile picked, among several (#596). */
  selected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
      <div
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: selected ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
      <figcaption style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>{caption}</figcaption>
    </figure>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.6875rem",
        color: "var(--color-text-muted)",
      }}
    >
      {text}
    </div>
  );
}
