"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { setMeasuredStampSizeAction } from "@/app/actions/photo-measure";
import type { PhotoSummary } from "@/lib/photos";
import {
  formatSizeMm,
  formatStampSize,
  parseCorrectedSize,
  parseSizeMm,
  type StampSize,
  type StampSizeFields,
} from "@/lib/stamp-size";
import { TileZoomView } from "@/app/c/[collectionSlug]/shared/tile-zoom-view";
import { ScanToolButton } from "@/app/c/[collectionSlug]/shared/scan-tool-button";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";

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
 *
 * **The figures can be corrected before they are set** (#1299). A ruler's ends are hard to put exactly
 * on a stamp's edges, and the collector often knows the true size to the tenth; so the width and the
 * height are fields prefilled with the measurement, with the measurement and its scale left standing
 * beside them to read a correction against. What is written is the corrected size, and it is still a
 * size taken at that scale — the correction refines the measurement rather than replacing it (#763).
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
  /** The width and height as they stand in the fields (#1299), and the measurement they were filled
   * from. A new measurement refills them — adjusted while rendering, so the fields never show one
   * frame of the previous figures beside the new reading. */
  const readingKey = reading ? `${reading.size.widthMm}×${reading.size.heightMm}@${reading.dpi}` : null;
  const [fields, setFields] = useState<{ key: string | null; width: string; height: string }>({
    key: null,
    width: "",
    height: "",
  });
  if (fields.key !== readingKey) {
    setFields({
      key: readingKey,
      width: reading ? formatSizeMm(reading.size.widthMm) : "",
      height: reading ? formatSizeMm(reading.size.heightMm) : "",
    });
  }
  const corrected = parseCorrectedSize(fields.width, fields.height);
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
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "var(--color-text-muted)" }}>Measured </span>
              <strong>{formatStampSize(reading.size)}</strong> at {reading.dpi} dpi
            </span>
            <span style={{ flex: 1 }} />
            {/* The correction (#1299): the measured figures, editable, beside the measurement they
                came from — so a changed tenth is always read against what the picture said. */}
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <SizeField
                value={fields.width}
                label="Width in millimetres"
                onChange={(width) => setFields((f) => ({ ...f, width }))}
              />
              <span style={{ color: "var(--color-text-muted)" }}>×</span>
              <SizeField
                value={fields.height}
                label="Height in millimetres"
                onChange={(height) => setFields((f) => ({ ...f, height }))}
              />
              <span style={{ color: "var(--color-text-muted)" }}>mm</span>
            </label>
            {error && <span style={{ color: "var(--color-error)" }}>{error}</span>}
            <ScanToolButton
              label={pending ? "Saving…" : "Set as the stamp's size"}
              hint={
                corrected
                  ? "Write this width and height onto the stamp — if it already states a size, you are asked before it is replaced"
                  : "Give both a width and a height, in millimetres"
              }
              disabled={pending || !corrected}
              onClick={() => corrected && writeSize({ size: corrected, dpi: reading.dpi }, false)}
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

/** One of the two size fields (#1299) — a comma or a full stop, as every number field here (#233). */
function SizeField({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const parsed = parseSizeMm(value);
  // Blank is marked too: a size set from a measurement is the whole of it.
  const bad = !parsed.ok || parsed.mm === null;
  return (
    <TextInput
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      aria-label={label}
      style={{
        width: "4rem",
        padding: "0.25rem 0.375rem",
        border: `1px solid ${bad ? "var(--color-error-border)" : "var(--color-border-strong)"}`,
        borderRadius: "0.375rem",
        fontFamily: "inherit",
        fontSize: "0.8125rem",
        color: "var(--color-text-primary)",
        background: "var(--color-bg-page)",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      }}
    />
  );
}
