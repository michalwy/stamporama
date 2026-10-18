"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PhotoSummary } from "@/lib/photos";
import type { PhotoCoverState } from "@/lib/photo-covers";
import { DEFAULT_PHOTO_COVER_STYLE } from "@/lib/photo-cover-rules";
import type { CopyPhotoScales } from "@/lib/photo-scales";
import { DETAIL_BUTTON, DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { PhotoStrip, photoFullUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { CoveredPhoto } from "@/app/c/[collectionSlug]/shared/photo-cover-editor";
import { PhotoCoverWalkDialog } from "@/app/c/[collectionSlug]/shared/photo-cover-walk-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { CopyPhotoScalesDialog } from "./copy-photo-scales-dialog";

// The copy's photos, and the covers drawn on them for offers (#1665). The covers are never part of
// the copy's own photo, so the strip shows the photos as they are; the overlay is a switch, off by
// default, offered once a photo has been checked — covers are drawn from an offer, where they are
// needed, and only *revisited* here.
//
// What each photo was scanned with (#2061) is set here too, one copy at a time: the button says how
// many of its photos have no scale, which is what keeps an offer collage from drawing them at the
// same scale as the rest.

const TOGGLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  fontSize: "0.75rem",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

function sideLabel(photo: PhotoSummary): string {
  if (photo.role === "front") return "Front";
  if (photo.role === "back") return "Back";
  return photo.title || "Photo";
}

export function CopyPhotosCard({
  collectionId,
  itemId,
  photos,
}: {
  collectionId: string;
  itemId: string;
  photos: PhotoSummary[];
}) {
  const queryClient = useQueryClient();
  const queryKey = ["item-photo-covers", collectionId, itemId] as const;
  const { data: covers } = useQuery<PhotoCoverState[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/items/${itemId}/photo-covers`);
      if (!res.ok) throw new Error("Failed to load the covers");
      return res.json();
    },
    enabled: photos.length > 0,
  });
  const [showCovers, setShowCovers] = useState(false);
  const [editingAt, setEditingAt] = useState<number | null>(null);
  // Keyed by the photos too, so a photo added or removed through the copy's edit dialog is read again.
  const scalesKey = ["item-photo-scales", collectionId, itemId, photos.map((p) => p.id).join(",")] as const;
  const { data: scales } = useQuery<CopyPhotoScales>({
    queryKey: scalesKey,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/items/${itemId}/photo-scales`);
      if (!res.ok) throw new Error("Failed to load the scales");
      return res.json();
    },
    enabled: photos.length > 0,
  });
  const [editingScales, setEditingScales] = useState(false);
  const unscaled = (scales?.photos ?? []).filter((p) => p.scale.kind === "none").length;

  const byPhoto = new Map((covers ?? []).map((c) => [c.photoId, c]));
  const anyChecked = (covers ?? []).some((c) => c.checked);
  const coveredCount = (covers ?? []).filter((c) => c.covers.length > 0).length;

  return (
    <DetailCard
      title="Photos"
      count={photos.length}
      empty={photos.length === 0}
      actions={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
          {anyChecked && (
            <Tooltip content="Show the covers drawn on these photos for offers that need symbols covered. The photos themselves never change.">
              <label style={TOGGLE}>
                <input type="checkbox" checked={showCovers} onChange={(e) => setShowCovers(e.target.checked)} />
                Offer covers{coveredCount > 0 ? ` (${coveredCount})` : ""}
              </label>
            </Tooltip>
          )}
          {scales && (
            <Tooltip content="What each photo was scanned with, so offer collages draw every stamp at the same scale.">
              <button type="button" style={DETAIL_BUTTON} onClick={() => setEditingScales(true)}>
                {unscaled > 0 ? `Scale (${unscaled} without)` : "Scale"}
              </button>
            </Tooltip>
          )}
        </span>
      }
    >
      {showCovers ? (
        <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.125rem" }}>
          {photos.map((photo, i) => (
            <Tooltip key={photo.id} content={`${sideLabel(photo)} — click to edit its covers`}>
              <button
                type="button"
                onClick={() => setEditingAt(i)}
                style={{
                  flexShrink: 0,
                  width: "7rem",
                  height: "7rem",
                  padding: 0,
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-subtle)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <CoveredPhoto
                  src={photoFullUrl(collectionId, photo.id)}
                  covers={byPhoto.get(photo.id)?.covers ?? []}
                  alt={sideLabel(photo)}
                  style={{ maxWidth: "100%", maxHeight: "100%" }}
                />
              </button>
            </Tooltip>
          ))}
        </div>
      ) : (
        <PhotoStrip collectionId={collectionId} photos={photos} size="7rem" />
      )}
      {editingScales && scales && (
        <CopyPhotoScalesDialog
          collectionId={collectionId}
          itemId={itemId}
          photos={photos}
          scales={scales}
          labelOf={sideLabel}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: scalesKey })}
          onClose={() => setEditingScales(false)}
        />
      )}
      {editingAt != null && (
        <PhotoCoverWalkDialog
          collectionId={collectionId}
          title="Covers for offer photos"
          photos={photos.map((photo) => ({
            photoId: photo.id,
            label: sideLabel(photo),
            checked: byPhoto.get(photo.id)?.checked ?? false,
            covers: byPhoto.get(photo.id)?.covers ?? [],
          }))}
          startIndex={editingAt}
          defaultStyle={DEFAULT_PHOTO_COVER_STYLE}
          onSaved={() => void queryClient.invalidateQueries({ queryKey })}
          onClose={() => setEditingAt(null)}
        />
      )}
    </DetailCard>
  );
}
