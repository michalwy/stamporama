"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/app/icons";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  commitCutAction,
  deleteBatchAction,
  pairTilesAction,
  recutBatchAction,
} from "@/app/actions/scans";
import type { Box } from "@/lib/scan-boxes";
import type { CutReport, ScanBatchData, ScanSheetData, ScanTileData } from "@/lib/scan-sheets";
import { ScanCutEditor, type ScanCutEditorSheet } from "./scan-cut-editor";
import { useInvalidateLotScans, useLotScans } from "./use-lot-scans-query";

/**
 * A lot's card scans (#566, ADR-0033).
 *
 * The whole ingest path in one section: upload a card, review and commit its cut, upload the back
 * and let it pair by position, drag what did not pair, and re-cut from the retained scan when the
 * cut was wrong.
 *
 * What is deliberately **not** here is turning a tile into a copy — that is #567, and until it
 * lands a tile's end is simply "unidentified".
 */

interface Props {
  collectionId: string;
  lotId: string;
  /** Only fetched while the section is open: a card of forty tiles is forty thumbnails. */
  open: boolean;
  onChanged: () => void;
}

/** The editor's subject: a sheet, the boxes to open on, and the batch it belongs to. */
interface EditorTarget {
  sheet: ScanCutEditorSheet;
  initialBoxes: Box[];
  frontTileCount: number | null;
}

export function LotScansCard({ collectionId, lotId, open, onChanged }: Props) {
  const { data, isLoading } = useLotScans(collectionId, lotId, open);
  const { invalidateLotScans } = useInvalidateLotScans();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CutReport | null>(null);
  /** A pending re-cut carries the cut it is about to destroy: the tiles hold the boxes, and
   * re-cutting deletes the tiles, so reopening the editor on the previous boxes means reading them
   * off the screen *before* the action runs. On a card of forty that is the difference between
   * correcting a cut and drawing one again. */
  const [confirm, setConfirm] = useState<
    | { kind: "recut"; batchNo: number; reopen: EditorTarget | null }
    | { kind: "delete"; batchNo: number }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  const batches = data?.batches ?? [];

  const refresh = () => {
    void invalidateLotScans(collectionId);
    onChanged();
  };

  /** Send a scan and open the editor on it — the two halves of "add a card" are one act to the
   * collector, and a sheet uploaded with no cut drawn is exactly what a re-cut starts from anyway. */
  const upload = async (file: File, side: "front" | "back", batchNo?: number) => {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("side", side);
      if (batchNo != null) form.set("batchNo", String(batchNo));
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/scan-sheets`,
        { method: "POST", body: form }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to upload the scan.");
        return;
      }
      refresh();
      setEditor({
        sheet: { ...body, side },
        initialBoxes: [],
        frontTileCount:
          side === "back"
            ? (batches.find((b) => b.batchNo === body.batchNo)?.tiles.filter((t) => t.frontBox)
                .length ?? null)
            : null,
      });
    } catch {
      setError("Failed to upload the scan.");
    } finally {
      setUploading(false);
    }
  };

  const commit = (boxes: Box[]) => {
    if (!editor) return;
    setError(null);
    startTransition(async () => {
      const result = await commitCutAction(editor.sheet.id, boxes);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setEditor(null);
      setReport(result.report);
      refresh();
    });
  };

  const pair = (backTileId: string, frontTileId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await pairTilesAction(backTileId, frontTileId);
      if (result.status === "error") setError(result.message);
      else refresh();
    });
  };

  const runConfirmed = () => {
    if (!confirm) return;
    const target = confirm;
    setConfirm(null);
    setError(null);
    startTransition(async () => {
      const result =
        target.kind === "recut"
          ? await recutBatchAction(lotId, target.batchNo)
          : await deleteBatchAction(lotId, target.batchNo);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      refresh();
      // Straight back into the editor on the cut that was just thrown away, so the correction is
      // one box moved rather than a card redrawn.
      if (target.kind === "recut" && target.reopen) setEditor(target.reopen);
    });
  };

  if (!open) return null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Icon name="scan" size="lg" />
        <strong style={{ fontSize: "0.9375rem" }}>Card scans</strong>
        <span style={{ flex: 1 }} />
        <UploadButton
          label="Add card scan"
          busy={uploading}
          onFile={(f) => void upload(f, "front")}
        />
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {report && <CutReportBanner report={report} onDismiss={() => setReport(null)} />}

      {isLoading && <Muted>Loading scans…</Muted>}
      {!isLoading && batches.length === 0 && (
        <Muted>
          No scans yet. Lay the stamps out on a black stockbook card, leaving about one perforation
          tooth of gap between them, and scan the whole card. Turn each stamp over in place and scan
          it again for the backs.
        </Muted>
      )}

      {batches.map((batch) => (
        <BatchSection
          key={batch.batchNo}
          batch={batch}
          collectionId={collectionId}
          busy={uploading || pending}
          onReview={(sheet, boxes, frontTileCount) =>
            setEditor({ sheet, initialBoxes: boxes, frontTileCount })
          }
          onUploadBack={(f) => void upload(f, "back", batch.batchNo)}
          onRecut={(reopen) => setConfirm({ kind: "recut", batchNo: batch.batchNo, reopen })}
          onDelete={() => setConfirm({ kind: "delete", batchNo: batch.batchNo })}
          onPair={pair}
        />
      ))}

      {editor && (
        <ScanCutEditor
          // Remounted per sheet, so the boxes it opens with are re-read rather than carried over
          // from the last card reviewed.
          key={`${editor.sheet.id}:${editor.initialBoxes.length}`}
          collectionId={collectionId}
          sheet={editor.sheet}
          initialBoxes={editor.initialBoxes}
          frontTileCount={editor.frontTileCount}
          committing={pending}
          error={error}
          onCommit={commit}
          onClose={() => {
            setEditor(null);
            setError(null);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "recut" ? "Re-cut this batch?" : "Delete this batch?"}
          actionLabel={confirm.kind === "recut" ? "Re-cut" : "Delete"}
          isPending={pending}
          message={
            confirm.kind === "recut" ? (
              <>
                The batch&rsquo;s tiles and their images are thrown away. The scans themselves are
                kept, so the cut can be drawn again over the same card.
              </>
            ) : (
              <>
                The batch&rsquo;s tiles <strong>and its scans</strong> are deleted. A stockbook that
                has been broken up cannot be scanned again — re-cut instead if the cut is what was
                wrong.
              </>
            )
          }
          onConfirm={runConfirmed}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

// ── One batch ────────────────────────────────────────────────────────────────────────────────

function BatchSection({
  batch,
  collectionId,
  busy,
  onReview,
  onUploadBack,
  onRecut,
  onDelete,
  onPair,
}: {
  batch: ScanBatchData;
  collectionId: string;
  busy: boolean;
  onReview: (
    sheet: ScanCutEditorSheet,
    boxes: Box[],
    frontTileCount: number | null
  ) => void;
  onUploadBack: (file: File) => void;
  /** Handed the editor target to reopen once the tiles are gone — the previous cut, read off the
   * tiles while they still exist. Null when there is no front scan to reopen on. */
  onRecut: (reopen: EditorTarget | null) => void;
  onDelete: () => void;
  onPair: (backTileId: string, frontTileId: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);

  const frontTiles = batch.tiles.filter((t) => t.frontBox != null);
  const backOnly = batch.tiles.filter((t) => t.frontBox == null);

  const editorSheet = (sheet: ScanSheetData): ScanCutEditorSheet => ({
    id: sheet.id,
    side: sheet.side,
    batchNo: batch.batchNo,
    width: sheet.width,
    height: sheet.height,
    viewWidth: sheet.viewWidth,
    viewHeight: sheet.viewHeight,
  });

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.8125rem" }}>Batch {batch.batchNo}</strong>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {frontTiles.length} {frontTiles.length === 1 ? "tile" : "tiles"}
          {backOnly.length > 0 && ` · ${backOnly.length} unpaired ${backOnly.length === 1 ? "back" : "backs"}`}
        </span>
        <span style={{ flex: 1 }} />

        {batch.front && !batch.front.cut && (
          <SmallButton
            onClick={() => onReview(editorSheet(batch.front!), [], null)}
            disabled={busy}
          >
            Review the front cut
          </SmallButton>
        )}
        {batch.front?.cut && !batch.back && (
          <UploadButton label="Add back scan" small busy={busy} onFile={onUploadBack} />
        )}
        {batch.back && !batch.back.cut && (
          <SmallButton
            onClick={() => onReview(editorSheet(batch.back!), [], frontTiles.length)}
            disabled={busy}
          >
            Review the back cut
          </SmallButton>
        )}
        {batch.tiles.length > 0 && (
          <SmallButton
            onClick={() =>
              onRecut(
                batch.front
                  ? {
                      sheet: editorSheet(batch.front),
                      initialBoxes: frontTiles
                        .map((t) => t.frontBox)
                        .filter((b): b is Box => b != null),
                      frontTileCount: null,
                    }
                  : null
              )
            }
            disabled={busy}
          >
            <Icon name="refresh" size="sm" /> Re-cut
          </SmallButton>
        )}
        <SmallButton onClick={onDelete} disabled={busy} danger>
          <Icon name="delete" size="sm" /> Delete batch
        </SmallButton>
      </div>

      {batch.tiles.length === 0 && batch.front && !batch.front.cut && (
        <Muted>The scan is stored. Draw the boxes to cut it into tiles.</Muted>
      )}

      {frontTiles.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(5.5rem, 1fr))",
            gap: "0.5rem",
          }}
        >
          {frontTiles.map((tile) => (
            <TileCell
              key={tile.id}
              tile={tile}
              collectionId={collectionId}
              droppable={dragging != null && tile.backPhotoId == null && tile.state === "unidentified"}
              onDropBack={(backTileId) => {
                setDragging(null);
                onPair(backTileId, tile.id);
              }}
            />
          ))}
        </div>
      )}

      {backOnly.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-warning)" }}>
            These backs found no front in the same position. Drag each one onto the tile it belongs
            to.
          </span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {backOnly.map((tile) => (
              <BackOnlyTile
                key={tile.id}
                tile={tile}
                collectionId={collectionId}
                onDragStart={() => setDragging(tile.id)}
                onDragEnd={() => setDragging(null)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tiles ────────────────────────────────────────────────────────────────────────────────────

function TileCell({
  tile,
  collectionId,
  droppable,
  onDropBack,
}: {
  tile: ScanTileData;
  collectionId: string;
  droppable: boolean;
  onDropBack: (backTileId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!droppable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!droppable) return;
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/x-scan-tile");
        if (id) onDropBack(id);
      }}
      title={`Tile ${tile.position + 1}${tile.backPhotoId ? " · front and back" : " · front only"}`}
      style={{
        border: `1px solid ${over ? "var(--color-action-primary)" : "var(--color-border)"}`,
        borderRadius: "0.375rem",
        overflow: "hidden",
        background: droppable ? "var(--color-bg-subtle)" : "transparent",
        position: "relative",
      }}
    >
      <TileImage
        photoId={tile.frontPhotoId}
        collectionId={collectionId}
        alt={`Tile ${tile.position + 1}, front`}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.125rem 0.25rem",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
        }}
      >
        <span>{tile.position + 1}</span>
        {/* A tile with no back is the ordinary case, not a fault: backs are optional and a card
            may never be turned over at all. Marked quietly rather than warned about. */}
        <Icon name={tile.backPhotoId ? "check" : "noPhoto"} size="xs" />
      </div>
    </div>
  );
}

function BackOnlyTile({
  tile,
  collectionId,
  onDragStart,
  onDragEnd,
}: {
  tile: ScanTileData;
  collectionId: string;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-scan-tile", tile.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        width: "5.5rem",
        border: "1px solid var(--color-warning-border)",
        borderRadius: "0.375rem",
        overflow: "hidden",
        cursor: "grab",
      }}
    >
      <TileImage
        photoId={tile.backPhotoId}
        collectionId={collectionId}
        alt="Unpaired back"
      />
    </div>
  );
}

function TileImage({
  photoId,
  collectionId,
  alt,
}: {
  photoId: string | null;
  collectionId: string;
  alt: string;
}) {
  if (!photoId) {
    return (
      <div
        style={{
          aspectRatio: "1",
          display: "grid",
          placeItems: "center",
          background: "var(--color-bg-subtle)",
        }}
      >
        <Icon name="noPhoto" size="lg" />
      </div>
    );
  }
  // A tile is served by an authenticated route at whatever size the stamp was, which is exactly
  // what `next/image`'s loader cannot size or optimise — the same call every other photo here makes.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/collections/${collectionId}/photos/${photoId}/thumb`}
      alt={alt}
      style={{ display: "block", width: "100%", aspectRatio: "1", objectFit: "contain" }}
    />
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────────────────────

function CutReportBanner({
  report,
  onDismiss,
}: {
  report: CutReport;
  onDismiss: () => void;
}) {
  // A count mismatch is a signal, not a failure: it means a stamp fell out, two were drawn as one,
  // or the wrong file was uploaded. Which fronts found no back is named, because that is what turns
  // the number into something to look at.
  const mismatch = report.side === "back" && report.frontCount !== report.backCount;
  return (
    <Banner tone={mismatch || report.backOnly > 0 ? "warning" : "info"}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <span style={{ flex: 1 }}>
          {report.side === "front" ? (
            <>
              Cut into <strong>{report.created}</strong>{" "}
              {report.created === 1 ? "tile" : "tiles"}.
            </>
          ) : (
            <>
              Front {report.frontCount}, back {report.backCount}.{" "}
              <strong>{report.paired}</strong> paired by position.
              {report.frontWithoutBack.length > 0 && (
                <>
                  {" "}
                  No back found for{" "}
                  {report.frontWithoutBack.length > 8
                    ? `${report.frontWithoutBack.length} tiles`
                    : `tile ${report.frontWithoutBack.map((p) => p + 1).join(", ")}`}
                  .
                </>
              )}
              {report.backOnly > 0 && (
                <>
                  {" "}
                  {report.backOnly} {report.backOnly === 1 ? "back" : "backs"} found no front —
                  drag {report.backOnly === 1 ? "it" : "them"} onto the right tile below.
                </>
              )}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
        >
          <Icon name="close" size="sm" />
        </button>
      </div>
    </Banner>
  );
}

function UploadButton({
  label,
  busy,
  small,
  onFile,
}: {
  label: string;
  busy: boolean;
  small?: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <SmallButton onClick={() => inputRef.current?.click()} disabled={busy} large={!small}>
        <Icon name="scan" size="sm" /> {busy ? "Uploading…" : label}
      </SmallButton>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file twice — after a cut was thrown away — still fires.
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  danger,
  large,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: large ? "0.375rem 0.75rem" : "0.25rem 0.5rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-bg-elevated)",
        color: danger ? "var(--color-error)" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "warning" | "info";
  children: React.ReactNode;
}) {
  const palette = {
    error: ["var(--color-error-soft)", "var(--color-error)", "var(--color-error-border)"],
    warning: ["var(--color-warning-soft)", "var(--color-warning)", "var(--color-warning-border)"],
    info: ["var(--color-bg-subtle)", "var(--color-text-secondary)", "var(--color-border)"],
  }[tone];
  return (
    <div
      style={{
        padding: "0.5rem 0.75rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        background: palette[0],
        color: palette[1],
        border: `1px solid ${palette[2]}`,
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>{children}</p>
  );
}
