"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { setCopyPhotoScalesAction } from "@/app/actions/photo-scales";
import type { PhotoSummary } from "@/lib/photos";
import type { CopyPhotoScales } from "@/lib/photo-scales";
import {
  draftFromScale,
  sameScale,
  scaleFromDraft,
  type PhotoScaleDraft,
} from "@/lib/photo-scale";
import { PhotoScalePicker } from "@/app/c/[collectionSlug]/shared/photo-scale-picker";
import { THUMB_OBJECT_FIT, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// What each of a copy's photos was scanned with (#2061), one row per photo, saved together. Offer
// collages draw every stamp at one scale only when every picture on the image says what it was
// scanned with, so this is where a photo added before scales existed — or added with the wrong one —
// is put right, one copy at a time; the Copies list does the photos with none in bulk.

const MUTED = "var(--color-text-muted)";

export function CopyPhotoScalesDialog({
  collectionId,
  itemId,
  photos,
  scales,
  labelOf,
  onSaved,
  onClose,
}: {
  collectionId: string;
  itemId: string;
  photos: PhotoSummary[];
  scales: CopyPhotoScales;
  labelOf: (photo: PhotoSummary) => string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const byPhoto = new Map(scales.photos.map((p) => [p.photoId, p]));
  const [drafts, setDrafts] = useState<Map<string, PhotoScaleDraft>>(
    () => new Map(scales.photos.map((p) => [p.photoId, draftFromScale(p.scale)]))
  );
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const rows = photos.filter((photo) => byPhoto.has(photo.id));
  const changes = rows.flatMap((photo) => {
    const scale = scaleFromDraft(drafts.get(photo.id)!);
    const was = byPhoto.get(photo.id)!.scale;
    return scale && sameScale(scale, was) ? [] : [{ photoId: photo.id, scale }];
  });
  const invalid = changes.some((c) => c.scale === null);

  function save() {
    setError(undefined);
    startTransition(async () => {
      const result = await setCopyPhotoScalesAction(itemId, changes);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      toast({ message: changes.length === 1 ? "Scale saved" : `${changes.length} scales saved` });
      onSaved();
      onClose();
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogShell title="Scanned with" onClose={pending ? () => {} : onClose} maxWidth="40rem">
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          Offer collages draw every stamp at the same scale when each photo on the picture says what it
          was scanned with. Choose <strong>No scale</strong> for a photo that is not a flat scan.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {rows.map((photo) => (
            <div key={photo.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div
                style={{
                  flexShrink: 0,
                  width: "3.5rem",
                  height: "3.5rem",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.375rem",
                  background: "var(--color-bg-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoThumbUrl(collectionId, photo.id)}
                  alt={labelOf(photo)}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: THUMB_OBJECT_FIT }}
                />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>{labelOf(photo)}</div>
                <PhotoScalePicker
                  setup={scales.scanning}
                  draft={drafts.get(photo.id)!}
                  onChange={(draft) => setDrafts((d) => new Map(d).set(photo.id, draft))}
                  allowNone
                  disabled={pending}
                />
                {!byPhoto.get(photo.id)!.reckonable && (
                  <div style={{ fontSize: "0.75rem", color: MUTED, marginTop: "0.25rem" }}>
                    Its size before it was stored was not recorded, so collages cannot draw it to scale.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={pending ? "Saving…" : "Save"}
        onCancel={onClose}
        onAction={save}
        disabled={pending || changes.length === 0 || invalid}
        error={error}
      />
    </DialogShell>,
    document.body
  );
}
