"use client";

import { useRef, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/app/icons";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  commitCutAction,
  deleteBatchAction,
  pairTilesAction,
  recutBatchAction,
} from "@/app/actions/scans";
import { formatItemNo } from "@/lib/item-number";
import type { Box } from "@/lib/scan-boxes";
import type { CutReport, ScanBatchData, ScanSheetData, ScanTileData } from "@/lib/scan-sheets";
import { ScanCutEditor, type ScanCutEditorSheet } from "./scan-cut-editor";
import { TileIdentifyDialog } from "./tile-identify-dialog";
import { useInvalidateLotScans, useLotScans } from "./use-lot-scans-query";

/**
 * A lot's card scans (#566, ADR-0033) and the tiles cut from them (#567).
 *
 * The whole ingest path in one section: upload a card, review and commit its cut, upload the back
 * and let it pair by position, drag what did not pair, and re-cut from the retained scan when the
 * cut was wrong — and then work through the tiles, each of which becomes a copy, joins a copy that
 * already exists, or is discarded with a note.
 *
 * Clicking a tile opens that question (`tile-identify-dialog.tsx`); only the *new copy* answer
 * leaves this section, because it is the lot card's own picker → condition chain, entered from a
 * tile instead of from the **Add stamps** button.
 */

interface Props {
  collectionId: string;
  lotId: string;
  /** Only fetched while the section is open: a card of forty tiles is forty thumbnails. */
  open: boolean;
  /** Whether the lot itself is open. A closed lot takes no new copies, but a tile can still be
   * assigned to one of its copies or discarded — closing froze the money, not the photographs. */
  lotOpen: boolean;
  /** The header's tile chip, pressed (#567): show only the tiles still waiting. The chips beside
   * it narrow the *copies* list; this one narrows the tiles, which is the list it counts. */
  onlyUnidentified: boolean;
  /** Take the *new copy* answer up to the lot card, which owns the stamp picker and the condition
   * dialog every other intake goes through. */
  onIdentifyTile: (tileId: string) => void;
  onChanged: () => void;
}

/** The editor's subject: a sheet, the boxes to open on, and the batch it belongs to. */
interface EditorTarget {
  sheet: ScanCutEditorSheet;
  initialBoxes: Box[];
  frontTileCount: number | null;
}

export function LotScansCard({
  collectionId,
  lotId,
  open,
  lotOpen,
  onlyUnidentified,
  onIdentifyTile,
  onChanged,
}: Props) {
  const { data, isLoading } = useLotScans(collectionId, lotId, open);
  const { invalidateLotScans } = useInvalidateLotScans();
  // Collection URLs are slug-addressed (`/c/[collectionSlug]/…`), and what this component is handed
  // is the internal id — so the slug for a link out to a copy comes from the route.
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  /** Which tile's three outcomes are being asked. Held by id rather than by value so the dialog
   * re-reads the tile after a refetch instead of showing the state it had when it was opened. */
  const [tileId, setTileId] = useState<string | null>(null);
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
  const fromAuction = data?.fromAuction ?? false;
  const openTile = batches.flatMap((b) => b.tiles).find((t) => t.id === tileId) ?? null;
  // Tiles whose copy is on no line of the auction description. A signal worth surfacing, not a
  // problem to hide: the parcel holds something nobody announced.
  const undescribed = batches.flatMap((b) => b.tiles).filter((t) => t.outsideDescription).length;

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

      {/* A stamp the auction description never listed (#567). The counterpart of a line marked
          *not delivered*: between them they say exactly how the parcel differed from what was bid
          on, which is information the collector wants rather than a discrepancy to smooth over. */}
      {undescribed > 0 && (
        <Banner tone="warning">
          {undescribed === 1
            ? "1 tile became a stamp that is on none of this auction lot's lines."
            : `${undescribed} tiles became stamps that are on none of this auction lot's lines.`}{" "}
          The parcel holds more than its description said.
        </Banner>
      )}

      {onlyUnidentified && (
        <Banner tone="info">Showing only the tiles still waiting to be identified.</Banner>
      )}

      {isLoading && <Muted>Loading scans…</Muted>}
      {!isLoading && batches.length === 0 && (
        <Muted>
          No scans yet. Lay the stamps out on a black stockbook card, leaving about one perforation
          tooth of gap between them, and scan the whole card. Turn each stamp over in place and scan
          it again for the backs.
        </Muted>
      )}

      {batches
        // A batch whose tiles are all dealt with has nothing to show under the chip, and an empty
        // bordered box saying so would be the noise the chip was pressed to get away from.
        .filter((b) => !onlyUnidentified || b.tiles.some((t) => t.state === "unidentified"))
        .map((batch) => (
        <BatchSection
          key={batch.batchNo}
          batch={batch}
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          onlyUnidentified={onlyUnidentified}
          onOpenTile={setTileId}
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

      {openTile && (
        <TileIdentifyDialog
          collectionId={collectionId}
          lotId={lotId}
          tile={openTile}
          lotOpen={lotOpen}
          fromAuction={fromAuction}
          onIdentifyNew={() => {
            // The lot card takes it from here: the picker and the condition dialog are the ones
            // every other intake goes through, and a second pair of them would be a second set of
            // remembered choices.
            setTileId(null);
            onIdentifyTile(openTile.id);
          }}
          onDone={() => {
            setTileId(null);
            refresh();
          }}
          onClose={() => setTileId(null)}
        />
      )}

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
                {/* Named rather than assumed: a discarded tile is the record of something the
                    parcel held and nothing else keeps it (#567). Re-cutting is still allowed —
                    the card is being drawn again, discards included — but not silently. */}
                {discardedInBatch(batches, confirm.batchNo) > 0 && (
                  <>
                    {" "}
                    <strong>
                      {discardedInBatch(batches, confirm.batchNo)} discarded tile
                      {discardedInBatch(batches, confirm.batchNo) === 1 ? "" : "s"}
                    </strong>{" "}
                    and their notes go with them — the only record of what the parcel held.
                  </>
                )}
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

/** How many of a batch's tiles were discarded — what a re-cut is about to take with it. */
function discardedInBatch(batches: ScanBatchData[], batchNo: number): number {
  return (
    batches.find((b) => b.batchNo === batchNo)?.tiles.filter((t) => t.state === "discarded")
      .length ?? 0
  );
}

// ── One batch ────────────────────────────────────────────────────────────────────────────────

function BatchSection({
  batch,
  collectionId,
  collectionSlug,
  onlyUnidentified,
  onOpenTile,
  busy,
  onReview,
  onUploadBack,
  onRecut,
  onDelete,
  onPair,
}: {
  batch: ScanBatchData;
  collectionId: string;
  collectionSlug: string;
  onlyUnidentified: boolean;
  onOpenTile: (tileId: string) => void;
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

  // The copies list searches internal numbers, so a copy's own number is the address that reaches
  // it (#268) — the same route "Go to purchase" takes in the other direction.
  const copyHref = (tile: ScanTileData): string | null =>
    tile.state === "consumed" && tile.item
      ? `/c/${collectionSlug}/inventory?search=${tile.item.itemNo}`
      : null;

  const shown = onlyUnidentified
    ? batch.tiles.filter((t) => t.state === "unidentified")
    : batch.tiles;
  const frontTiles = shown.filter((t) => t.frontBox != null);
  const backOnly = shown.filter((t) => t.frontBox == null);
  // Counted off every tile, not the filtered ones: what the batch says about itself must not
  // change because a chip is pressed.
  const waiting = batch.tiles.filter((t) => t.state === "unidentified").length;
  const discarded = batch.tiles.filter((t) => t.state === "discarded").length;

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
          {waiting > 0 && ` · ${waiting} waiting`}
          {discarded > 0 && ` · ${discarded} discarded`}
          {/* The moment the batch was finished with. Shown because it is also the moment its
              retained scan stopped being able to do anything (#578 is what acts on it). */}
          {batch.doneAt && waiting === 0 && ` · done ${batch.doneAt.slice(0, 10)}`}
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
              copyHref={copyHref(tile)}
              droppable={dragging != null && tile.backPhotoId == null && tile.state === "unidentified"}
              onOpen={() => onOpenTile(tile.id)}
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

/**
 * One tile on the card.
 *
 * **The strip is a map of the card on the desk**: position *n* here is position *n* on the
 * stockbook, and that correspondence is how a tile is matched to the piece in the tweezers. So a
 * worked tile never disappears and never moves — it steps back, keeps its square, and keeps its
 * picture. Narrowing to what is left is the *N tiles unidentified* chip's job, not the layout's.
 *
 * A **consumed** tile shows its copy's front, which is the tile's own front row under its new owner
 * (consuming reassigns `tileId → itemId`, so no picture ever went anywhere), and clicking it goes
 * to that copy. A tile that went well must not look more broken than one that became nothing.
 *
 * An **unidentified** tile opens the three-outcomes dialog; a **discarded** one opens it too, where
 * its note is written and it can be put back.
 */
function TileCell({
  tile,
  collectionId,
  copyHref,
  droppable,
  onOpen,
  onDropBack,
}: {
  tile: ScanTileData;
  collectionId: string;
  /** Where this tile's copy lives, for a consumed tile. Null for every other state, and for a
   * consumed tile whose copy has since been deleted — there is nothing to reach. */
  copyHref: string | null;
  droppable: boolean;
  onOpen: () => void;
  onDropBack: (backTileId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const settled = tile.state !== "unidentified";
  // The picture follows the photo row to whoever owns it now.
  const photoId = tile.frontPhotoId ?? tile.item?.frontPhotoId ?? null;

  const style: React.CSSProperties = {
    display: "block",
    padding: 0,
    textAlign: "left",
    font: "inherit",
    color: "inherit",
    textDecoration: "none",
    cursor: "pointer",
    border: `1px solid ${
      over
        ? "var(--color-action-primary)"
        : tile.outsideDescription
          ? "var(--color-warning-border)"
          : "var(--color-border)"
    }`,
    borderRadius: "0.375rem",
    overflow: "hidden",
    background: droppable ? "var(--color-bg-subtle)" : "transparent",
    // A tile that has been dealt with steps back without disappearing: it is still part of the
    // record of the card, and a discarded one is the only record there is.
    opacity: settled ? 0.6 : 1,
    position: "relative",
  };

  const body = (
    <>
      <TileImage
        photoId={photoId}
        collectionId={collectionId}
        alt={`Tile ${tile.position + 1}, front`}
        // The one honest placeholder: the copy this tile became has been deleted, so its images
        // went with it and there is nothing left to show. Said in words, because a broken-looking
        // square is what every consumed tile used to look like.
        emptyLabel={tile.state === "consumed" ? "copy deleted" : undefined}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.25rem",
          padding: "0.125rem 0.25rem",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
        }}
      >
        <span>{tile.position + 1}</span>
        {tile.state === "consumed" ? (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tile.item ? formatItemNo(tile.item.itemNo) : "copy deleted"}
          </span>
        ) : tile.state === "discarded" ? (
          <span>discarded</span>
        ) : (
          // A tile with no back is the ordinary case, not a fault: backs are optional and a card
          // may never be turned over at all. Marked quietly rather than warned about.
          <Icon name={tile.backPhotoId ? "check" : "noPhoto"} size="xs" />
        )}
      </div>
    </>
  );

  // A consumed tile is a link, so it can be opened in a tab beside the card being worked — the
  // rest are buttons, because they open a dialog rather than going anywhere.
  if (copyHref) {
    return (
      <a href={copyHref} title={tileTitle(tile)} style={style}>
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
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
      title={tileTitle(tile)}
      style={style}
    >
      {body}
    </button>
  );
}

function tileTitle(tile: ScanTileData): string {
  const head = `Tile ${tile.position + 1}`;
  if (tile.state === "consumed") {
    if (!tile.item) {
      return `${head} · became a copy that has since been deleted, so its images went with it`;
    }
    const copy = `copy ${formatItemNo(tile.item.itemNo)}`;
    return tile.outsideDescription
      ? `${head} · became ${copy}, which is on none of the auction lot's lines — click to open it`
      : `${head} · became ${copy} — click to open it`;
  }
  if (tile.state === "discarded") {
    return tile.note ? `${head} · discarded: ${tile.note}` : `${head} · discarded`;
  }
  return `${head}${tile.backPhotoId ? " · front and back" : " · front only"} — click to identify`;
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
  emptyLabel,
}: {
  photoId: string | null;
  collectionId: string;
  alt: string;
  /** Said instead of the bare icon when there is a *reason* the square is empty, rather than
   * merely no image — a consumed tile whose copy was deleted took its pictures with it. */
  emptyLabel?: string;
}) {
  if (!photoId) {
    return (
      <div
        style={{
          aspectRatio: "1",
          display: "grid",
          placeItems: "center",
          gap: "0.125rem",
          background: "var(--color-bg-subtle)",
          padding: "0.25rem",
          textAlign: "center",
        }}
      >
        <Icon name="noPhoto" size={emptyLabel ? "sm" : "lg"} />
        {emptyLabel && (
          <span style={{ fontSize: "0.625rem", color: "var(--color-text-muted)" }}>
            {emptyLabel}
          </span>
        )}
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
