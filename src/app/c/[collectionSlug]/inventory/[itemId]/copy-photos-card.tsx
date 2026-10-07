"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PhotoSummary } from "@/lib/photos";
import type { PhotoCoverState } from "@/lib/photo-covers";
import { DEFAULT_PHOTO_COVER_STYLE } from "@/lib/photo-cover-rules";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { PhotoStrip, photoFullUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { CoveredPhoto } from "@/app/c/[collectionSlug]/shared/photo-cover-editor";
import { PhotoCoverWalkDialog } from "@/app/c/[collectionSlug]/shared/photo-cover-walk-dialog";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// The copy's photos, and the covers drawn on them for offers (#1665). The covers are never part of
// the copy's own photo, so the strip shows the photos as they are; the overlay is a switch, off by
// default, offered once a photo has been checked — covers are drawn from an offer, where they are
// needed, and only *revisited* here.

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

  const byPhoto = new Map((covers ?? []).map((c) => [c.photoId, c]));
  const anyChecked = (covers ?? []).some((c) => c.checked);
  const coveredCount = (covers ?? []).filter((c) => c.covers.length > 0).length;

  return (
    <DetailCard
      title="Photos"
      count={photos.length}
      empty={photos.length === 0}
      actions={
        anyChecked ? (
          <Tooltip content="Show the covers drawn on these photos for offers that need symbols covered. The photos themselves never change.">
            <label style={TOGGLE}>
              <input type="checkbox" checked={showCovers} onChange={(e) => setShowCovers(e.target.checked)} />
              Offer covers{coveredCount > 0 ? ` (${coveredCount})` : ""}
            </label>
          </Tooltip>
        ) : null
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
