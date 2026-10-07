"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  DIALOG_MAX_HEIGHT,
  DIALOG_MAX_WIDTH,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { photoFullUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import type { PhotoCover, PhotoCoverStyle } from "@/lib/photo-cover-rules";
import { PhotoCoverEditor } from "./photo-cover-editor";

// The walk through photos to cover symbols on (#1665; ADR-0066): one photo at a time, as large as the
// window allows, the next one coming with Enter. Saving a photo — with covers, or with none, which is
// *nothing to cover* — marks it checked, so it is never asked about again.
//
// It walks a list it was handed and keeps that list for as long as it is open: a photo saved here
// stays in the walk (← goes back to it), rather than vanishing from under the counter the moment the
// plan is refetched.

export interface CoverWalkEntry {
  photoId: string;
  /** What the photo is of — the copy, and which side. */
  label: string;
  checked: boolean;
  covers: PhotoCover[];
}

export function PhotoCoverWalkDialog({
  collectionId,
  title,
  photos,
  defaultStyle,
  startIndex = 0,
  footerNote,
  onSaved,
  onClose,
}: {
  collectionId: string;
  title: string;
  photos: CoverWalkEntry[];
  defaultStyle: PhotoCoverStyle;
  startIndex?: number;
  /** Something the caller says beside the buttons — the offer's *regenerate when done*. */
  footerNote?: ReactNode;
  /** After every save, so the caller can pick up the counts it shows. */
  onSaved?: () => void;
  /** `changed` is whether anything was saved while the walk was open. */
  onClose: (changed: boolean) => void;
}) {
  const [index, setIndex] = useState(() => Math.min(startIndex, Math.max(0, photos.length - 1)));
  const [entries, setEntries] = useState(photos);
  const entry = entries[index] ?? null;
  const [covers, setCovers] = useState<PhotoCover[]>(entry?.covers ?? []);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [changed, setChanged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const primaryRef = useRef<HTMLButtonElement>(null);

  const left = entries.filter((e) => !e.checked).length;
  const last = index >= entries.length - 1;

  /** Move to another photo, starting from what is stored for it — `from` is the list to read it
   *  from, which a save has just updated. */
  const go = (next: number, from = entries) => {
    if (next < 0 || next >= from.length) return;
    setIndex(next);
    setCovers(from[next].covers);
    setDirty(false);
    setError(undefined);
  };

  const save = () => {
    if (!entry || isPending) return;
    setError(undefined);
    startTransition(async () => {
      const { savePhotoCoversAction } = await import("@/app/actions/photo-covers");
      const result = await savePhotoCoversAction(entry.photoId, covers);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setChanged(true);
      const updated = entries.map((e) =>
        e.photoId === entry.photoId ? { ...e, checked: true, covers: result.state.covers } : e
      );
      setEntries(updated);
      setDirty(false);
      onSaved?.();
      if (last) onClose(true);
      else go(index + 1, updated);
    });
  };

  // Enter saves and moves on; ← / → step without saving, while nothing is drawn but unsaved.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "SELECT" || target.tagName === "INPUT")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "ArrowLeft" && !dirty) {
        go(index - 1);
      } else if (e.key === "ArrowRight" && !dirty) {
        go(index + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const primaryLabel = `${covers.length === 0 ? "Nothing to cover" : "Save covers"}${last ? "" : " & next"}`;

  return (
    <DialogShell
      title={title}
      onClose={() => !isPending && onClose(changed)}
      maxWidth={DIALOG_MAX_WIDTH}
      height={DIALOG_MAX_HEIGHT}
      zIndexBase={300}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.5rem", padding: "1rem 1.5rem 0.5rem" }}>
        {entry ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", fontSize: "0.875rem" }}>
              <strong style={{ color: "var(--color-text-primary)" }}>{entry.label}</strong>
              {entry.checked && (
                <span style={{ fontSize: "0.75rem", color: "var(--color-success)" }}>
                  {entry.covers.length === 0 ? "✓ nothing to cover" : `✓ ${entry.covers.length} covered`}
                </span>
              )}
              <span style={{ marginLeft: "auto", color: "var(--color-text-muted)" }}>
                Photo {index + 1} of {entries.length} · {left === 0 ? "all checked" : `${left} left to check`}
              </span>
            </div>
            <PhotoCoverEditor
              key={entry.photoId}
              src={photoFullUrl(collectionId, entry.photoId)}
              covers={covers}
              defaultStyle={defaultStyle}
              disabled={isPending}
              onChange={(next) => {
                setCovers(next);
                setDirty(true);
              }}
            />
          </>
        ) : (
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>No photos to check.</p>
        )}
      </div>
      <DialogFooter error={error}>
        {footerNote && <span style={{ marginRight: "auto", fontSize: "0.8125rem" }}>{footerNote}</span>}
        <DialogSecondaryButton disabled={isPending || index === 0} onClick={() => go(index - 1)}>
          ← Previous
        </DialogSecondaryButton>
        <DialogSecondaryButton disabled={isPending || last} onClick={() => go(index + 1)}>
          Skip →
        </DialogSecondaryButton>
        <DialogPrimaryButton ref={primaryRef} type="button" disabled={isPending || !entry} onClick={save}>
          {isPending ? "Saving…" : `${primaryLabel} ⏎`}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
