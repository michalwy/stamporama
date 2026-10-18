"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import {
  countUnscaledCopyPhotosAction,
  giveUnscaledCopyPhotosScaleAction,
} from "@/app/actions/photo-scales";
import {
  defaultPhotoScale,
  draftFromScale,
  scaleFromDraft,
  type PhotoScaleDraft,
} from "@/lib/photo-scale";
import {
  PhotoScalePicker,
  useScanningSetup,
} from "@/app/c/[collectionSlug]/shared/photo-scale-picker";

// The ticked copies' photos that say nothing of what they were scanned with, given one scale in one
// write (#2061) — the photos added before scales existed are the case it is for. A photo that already
// names a profile or a resolution is never touched, so there is no *No scale* to choose here: undoing
// a scale is a copy-at-a-time act, on the copy's Photos card.

const MUTED = "var(--color-text-muted)";

export function CopiesPhotoScaleDialog({
  collectionId,
  itemIds,
  onClose,
}: {
  collectionId: string;
  itemIds: string[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scanning = useScanningSetup(collectionId);
  const [draft, setDraft] = useState<PhotoScaleDraft | null>(null);
  if (scanning.data && draft === null) setDraft(draftFromScale(defaultPhotoScale(scanning.data)));
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void countUnscaledCopyPhotosAction(collectionId, itemIds).then((result) => {
      if (!live) return;
      if (result.status === "success") setCount(result.count);
      else setError(result.message);
    });
    return () => {
      live = false;
    };
  }, [collectionId, itemIds]);

  const scale = draft ? scaleFromDraft(draft) : null;
  const copies = `${itemIds.length} ${itemIds.length === 1 ? "copy" : "copies"}`;

  function apply() {
    if (!scale) return;
    setError(undefined);
    startTransition(async () => {
      const result = await giveUnscaledCopyPhotosScaleAction(collectionId, itemIds, scale);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["item-photo-scales", collectionId] });
      toast({
        message:
          result.count === 0
            ? "No photo needed a scale"
            : `Gave ${result.count} ${result.count === 1 ? "photo" : "photos"} a scale`,
      });
      onClose();
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogShell title="Photo scale" onClose={pending ? () => {} : onClose} maxWidth="36rem">
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          Say what the photos of the {copies} were scanned with, so offer collages draw every stamp at
          the same scale. Only photos that have no scale yet are changed.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>Scanned with</span>
          {scanning.data && draft ? (
            <PhotoScalePicker
              setup={scanning.data}
              draft={draft}
              onChange={setDraft}
              allowNone={false}
              disabled={pending}
            />
          ) : (
            <span style={{ fontSize: "0.8125rem", color: MUTED }}>Loading…</span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: MUTED }}>
          {count === null
            ? "Counting the photos…"
            : count === 0
              ? "Every photo of these copies already has a scale."
              : `${count} ${count === 1 ? "photo has" : "photos have"} no scale and will be given this one.`}
        </p>
      </DialogBody>
      <DialogActions
        actionLabel={pending ? "Saving…" : "Give them this scale"}
        onCancel={onClose}
        onAction={apply}
        disabled={pending || !scale || scale.kind === "none" || !count}
        error={error}
      />
    </DialogShell>,
    document.body
  );
}
