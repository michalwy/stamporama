"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { setMeasuredStampSizeAction } from "@/app/actions/photo-measure";
import type { PhotoSummary } from "@/lib/photos";
import { formatStampSize, type StampSize, type StampSizeFields } from "@/lib/stamp-size";
import { TileZoomView } from "@/app/c/[collectionSlug]/shared/tile-zoom-view";
import { ScanToolButton } from "@/app/c/[collectionSlug]/shared/scan-tool-button";

/**
 * What a screen tells a photo strip so that its photos can be measured (#1290).
 *
 * The scale is the collection's, prefilled and correctable in the viewer for the sitting, exactly as
 * on a scan tile (#598). The stamp is the one a measured size is written to — the copy's stamp, or
 * the stamp whose screen it is — and null where a picture is of no one stamp (a piece carrying
 * several), which keeps the measuring and drops the writing.
 */
export interface PhotoMeasureContext {
  scanDpi: number;
  stampId: string | null;
}

/**
 * A photo, large, with the tile viewer's tools on it (#1290, #674) — the ruler, the size, the
 * perforation gauge and the watermark view, plus the marks and the snapshot.
 *
 * It **is** the tile viewer rather than a second one: a photo is handed over as a single side whose
 * frame is its upload's own pixels (`photo-measure-frame.ts`) in place of a box on a card, and every
 * rule the viewer already keeps — a figure never without its scale, the scale edited here for this
 * sitting only, no tools where the frame cannot be known — holds unchanged.
 *
 * The one thing this adds is the write the issue asks for: a size read off the picture can be set as
 * the stamp's, and a size the stamp already states is replaced only once the collector has seen it
 * and said so. The server asks the question; this dialog only relays it.
 */
export function PhotoMeasureDialog({
  collectionId,
  photo,
  label,
  context,
  onClose,
}: {
  collectionId: string;
  photo: PhotoSummary;
  label: string;
  context: PhotoMeasureContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reading, setReading] = useState<{ size: StampSize; dpi: number } | null>(null);
  const [confirm, setConfirm] = useState<{
    size: StampSize;
    dpi: number;
    current: StampSizeFields;
  } | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const stampId = context.stampId;

  function writeSize(target: { size: StampSize; dpi: number }, replace: boolean) {
    if (!stampId) return;
    setError(undefined);
    startTransition(async () => {
      const state = await setMeasuredStampSizeAction(
        stampId,
        target.size.widthMm,
        target.size.heightMm,
        replace
      );
      if (state.status === "error") {
        setError(state.message);
        return;
      }
      if (state.status === "confirm") {
        setConfirm({ size: state.size, dpi: target.dpi, current: state.current });
        return;
      }
      setConfirm(null);
      if (state.status === "same") {
        toast({ message: `The stamp already states ${formatStampSize(state.size)}`, tone: "info" });
        return;
      }
      toast({ message: `Stamp size set to ${formatStampSize(state.size)}, measured at ${target.dpi} dpi` });
      router.refresh();
    });
  }

  return (
    <>
    <DialogShell
      title={label}
      onClose={pending ? () => {} : onClose}
      maxWidth="min(92vw, 84rem)"
      height="90vh"
      dismissable={!confirm}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          padding: "1rem 1.25rem",
          gap: "0.625rem",
        }}
      >
        <TileZoomView
          collectionId={collectionId}
          sides={[
            {
              side: "front",
              label,
              photoId: photo.id,
              box: null,
              frame: photo.measureFrame ?? null,
              turn: 0,
              sheetId: null,
            },
          ]}
          position={0}
          scanDpi={context.scanDpi}
          subject="photo"
          onSize={setReading}
          onSnapshotSaved={() => router.refresh()}
        />

        {/* The write (#1290), under the viewer and only while a size stands on it: measuring and
            setting the size are one act, and a button offering a figure nobody has taken would be
            the app proposing a size of its own. */}
        {stampId && reading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
              padding: "0.5rem 0.75rem",
              border: "1px solid var(--color-accent-border)",
              borderRadius: "0.375rem",
              background: "var(--color-accent-soft)",
              fontSize: "0.8125rem",
            }}
          >
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {formatStampSize(reading.size)} at {reading.dpi} dpi
            </span>
            <span style={{ flex: 1 }} />
            {error && <span style={{ color: "var(--color-error)" }}>{error}</span>}
            <ScanToolButton
              label={pending ? "Saving…" : "Set as the stamp's size"}
              hint="Write this width and height onto the stamp — if it already states a size, you are asked before it is replaced"
              disabled={pending}
              onClick={() => writeSize(reading, false)}
            />
          </div>
        )}
      </div>
    </DialogShell>

      {/* Beside the dialog rather than inside it: the panel's `transform` would otherwise hold the
          confirmation's fixed layout inside the panel. Later in the document, so it paints above. */}
      {confirm && (
        <ConfirmDialog
          title="Replace the stamp's size?"
          message={
            <>
              The stamp states <strong>{formatStampSize(confirm.current)}</strong> now. Replace it
              with <strong>{formatStampSize(confirm.size)}</strong>, measured at {confirm.dpi} dpi?
            </>
          }
          actionLabel="Replace"
          pendingLabel="Replacing…"
          variant="primary"
          isPending={pending}
          error={error}
          onConfirm={() => writeSize(confirm, true)}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
