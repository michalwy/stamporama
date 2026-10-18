"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DialogActions, DialogBody, DialogSecondaryButton, DialogShell } from "@/app/dialog-shell";
import {
  readScaleListPhotosAction,
  setCollectionPhotoScalesAction,
} from "@/app/actions/photo-scales";
import type { ScaleListPhotos } from "@/lib/photo-scales";
import {
  defaultPhotoScale,
  draftFromScale,
  sameScale,
  scaleFromDraft,
  type PhotoScaleDraft,
} from "@/lib/photo-scale";
import { PhotoScalePicker } from "./photo-scale-picker";
import { THUMB_OBJECT_FIT, photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// The photos that keep an offer's images — or a one-off collage's (#2052) — from being drawn at one
// scale, listed where the count of them is shown and given a scale there (#2067), one at a time or
// all at once, without leaving the offer. **The scale is the photo's**, written exactly as from the
// copy's own Photos card, so it holds for every offer the photo is on; the caller picks up what that
// does to its images (out of date, and a regeneration offered).

const MUTED = "var(--color-text-muted)";

function sideName(role: string | null): string {
  if (role === "front") return "Front";
  if (role === "back") return "Back";
  return "Photo";
}

export function PhotoScaleListDialog({
  collectionId,
  photoIds,
  onSaved,
  onClose,
  zIndexBase,
}: {
  collectionId: string;
  /** The photos without a scale, in the order the images draw them. */
  photoIds: string[];
  /** Called with how many photos were given a scale, before the dialog closes. */
  onSaved: (count: number) => void;
  onClose: () => void;
  /** As {@link DialogShell}'s — raised when the list is opened over another dialog. */
  zIndexBase?: number;
}) {
  const queryClient = useQueryClient();
  const [list, setList] = useState<ScaleListPhotos | null>(null);
  const [drafts, setDrafts] = useState<Map<string, PhotoScaleDraft>>(new Map());
  const [allDraft, setAllDraft] = useState<PhotoScaleDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const idsKey = photoIds.join(",");

  useEffect(() => {
    let live = true;
    void readScaleListPhotosAction(collectionId, idsKey ? idsKey.split(",") : []).then((answer) => {
      if (!live) return;
      if (answer.status === "error") {
        setError(answer.message);
        return;
      }
      setList(answer.result);
      setDrafts(new Map(answer.result.photos.map((p) => [p.photoId, draftFromScale(p.scale)])));
      setAllDraft(draftFromScale(defaultPhotoScale(answer.result.scanning)));
    });
    return () => {
      live = false;
    };
  }, [collectionId, idsKey]);

  const changes = (list?.photos ?? []).flatMap((photo) => {
    const scale = scaleFromDraft(drafts.get(photo.photoId)!);
    return scale && sameScale(scale, photo.scale) ? [] : [{ photoId: photo.photoId, scale }];
  });
  const invalid = changes.some((c) => c.scale === null);
  const allScale = allDraft ? scaleFromDraft(allDraft) : null;

  function giveAll() {
    if (!list || !allDraft || !allScale) return;
    setDrafts(new Map(list.photos.map((p) => [p.photoId, allDraft])));
  }

  function save() {
    setError(undefined);
    startTransition(async () => {
      const result = await setCollectionPhotoScalesAction(collectionId, changes);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      // The copies' own Photos cards read the same scales.
      void queryClient.invalidateQueries({ queryKey: ["item-photo-scales", collectionId] });
      onSaved(result.count);
      onClose();
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogShell
      title="Photos without a scale"
      onClose={pending ? () => {} : onClose}
      maxWidth="44rem"
      zIndexBase={zIndexBase}
    >
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          These photos are marked <strong>No scale</strong>, so the images holding them are not drawn at
          one scale. A scale given here is the photo&rsquo;s, and holds in every offer it is in.
        </p>
        {!list ? (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: MUTED }}>{error ? "" : "Reading the photos…"}</p>
        ) : list.photos.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: MUTED }}>Every photo here has a scale now.</p>
        ) : (
          <>
            {list.photos.length > 1 && allDraft && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  paddingBottom: "0.75rem",
                  marginBottom: "0.75rem",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>All of them</span>
                <PhotoScalePicker
                  setup={list.scanning}
                  draft={allDraft}
                  onChange={setAllDraft}
                  allowNone={false}
                  disabled={pending}
                />
                <DialogSecondaryButton onClick={giveAll} disabled={pending || !allScale}>
                  Give to all
                </DialogSecondaryButton>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {list.photos.map((photo) => (
                <div key={photo.photoId} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
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
                      src={photoThumbUrl(collectionId, photo.photoId)}
                      alt={`${photo.copyLabel}, ${sideName(photo.role).toLowerCase()}`}
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: THUMB_OBJECT_FIT }}
                    />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                      {photo.copyLabel} <span style={{ color: MUTED }}>· {sideName(photo.role)}</span>
                    </div>
                    <PhotoScalePicker
                      setup={list.scanning}
                      draft={drafts.get(photo.photoId)!}
                      onChange={(draft) => setDrafts((d) => new Map(d).set(photo.photoId, draft))}
                      allowNone
                      allowDefault
                      disabled={pending}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
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
