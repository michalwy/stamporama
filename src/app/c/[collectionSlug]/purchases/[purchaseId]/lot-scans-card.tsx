"use client";

import { useRef, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/app/icons";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  commitCutAction,
  deleteBatchAction,
  pairTilesAction,
  proposeCutAction,
  recutBatchAction,
} from "@/app/actions/scans";
import { formatItemNo } from "@/lib/item-number";
import type { Box } from "@/lib/scan-boxes";
import type { CutReport, ScanBatchData, ScanSheetData, ScanTileData } from "@/lib/scan-sheets";
import { useInvalidateInventory } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { ScanCutEditor, type ScanCutEditorSheet } from "./scan-cut-editor";
import { TileIdentifyDialog } from "./tile-identify-dialog";
import { useInvalidateLotCopies } from "./use-lot-copies-query";
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
  const { invalidateLotCopies } = useInvalidateLotCopies();
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  // Collection URLs are slug-addressed (`/c/[collectionSlug]/…`), and what this component is handed
  // is the internal id — so the slug for a link out to a copy comes from the route.
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  /** Which tile's three outcomes are being asked. Held by id rather than by value so the dialog
   * re-reads the tile after a refetch instead of showing the state it had when it was opened. */
  const [tileId, setTileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** A detection pass in flight. Its own state rather than the transition's: it is the one wait in
   * this section that happens *before* a dialog opens, so the button that started it has to say so. */
  const [detecting, setDetecting] = useState(false);
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
  const expansion = useBatchExpansion();
  const openTile = batches.flatMap((b) => b.tiles).find((t) => t.id === tileId) ?? null;
  // Tiles whose copy is on no line of the auction description. A signal worth surfacing, not a
  // problem to hide: the parcel holds something nobody announced.
  const undescribed = batches.flatMap((b) => b.tiles).filter((t) => t.outsideDescription).length;
  // A carton is fifty cards, and fifty header lines is still a wall to read past — so a
  // worked-through batch is not merely collapsed but **set aside**, behind the count below.
  const doneCount = batches.filter((b) => b.doneAt != null).length;
  const [showDone, setShowDone] = useState(false);

  /**
   * Re-read what a write changed — **everywhere it is visible, not just on the surface that made
   * it.** A copy write shows up in three separate query namespaces, and each one missed is a screen
   * that keeps showing the collection as it was until a full page reload:
   *
   * - `lot-scans` — the tile itself moved. Always stale after a write here.
   * - `lot-copies` — an assign hands a copy the tile's photos, so the copies list would keep showing
   *   no thumbnail and the assign list would keep offering the copy that just took the images.
   * - `inventory` — what the **catalogue** side says about the stamp that copy points at: the
   *   copies-held badge and want marker on every picker row (#348/#532), the holdings line inside
   *   the intake step (#562), and the stamp's own thumbnail, which this copy's front may have just
   *   been promoted into (#149). Assigning a tile runs that auto-seed, so the picker opened for the
   *   *next* stamp was showing a stamp with no photo and no copies — both untrue by then.
   *
   * **A tile outcome that touches a copy invalidates all three; one that does not, invalidates only
   * the scans.** A discard, an un-discard and a note move no copy and say nothing about any stamp.
   *
   * `router.refresh()` is not a substitute for any of it: it re-renders the server components, and
   * all three of these stream from client queries (#172).
   */
  const refresh = (touchedCopy = false) => {
    void invalidateLotScans(collectionId);
    if (touchedCopy) {
      void invalidateLotCopies(collectionId);
      void invalidateInventory(collectionId);
    }
    onChanged();
  };

  /**
   * Open the editor on a **proposal** (#574) — the boxes detection found, to be corrected rather
   * than drawn.
   *
   * The proposal never blocks the editor: `proposeCutAction` answers with no boxes rather than an
   * error, and an empty canvas is exactly what this surface did before detection existed. Drawing
   * by hand is the primitive; this only decides how much of it is left to do.
   */
  const openProposed = async (sheet: ScanCutEditorSheet, frontTileCount: number | null) => {
    setDetecting(true);
    try {
      const { boxes } = await proposeCutAction(sheet.id);
      setEditor({ sheet, initialBoxes: boxes, frontTileCount });
    } finally {
      setDetecting(false);
    }
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
      await openProposed(
        { ...body, side },
        side === "back"
          ? (batches.find((b) => b.batchNo === body.batchNo)?.tiles.filter((t) => t.frontBox)
              .length ?? null)
          : null
      );
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
          busyLabel={detecting ? "Finding the stamps…" : undefined}
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

      {/* **The way back to the batches that are set aside** (#583). It lives here, in the card's
          own body above the list, and not on the batches themselves: with every worked batch
          hidden there is no header left to hang it on, and a control that disappears along with
          what it reveals is a section that has quietly lost its only door.

          Suppressed under the *only unidentified* chip, which already hides the same batches for
          its own reason and says so in the banner above — two controls answering one question, one
          of them contradicting the other, is worse than the wall of headers.

          Not persisted, for the reason the collapse rule is not: which batches are worth looking
          at is a fact about the work. Reaching for the record of a card you finished last week is
          a deliberate act, and it should start from the same place every time. */}
      {doneCount > 0 && !onlyUnidentified && (
        <SetAsideToggle count={doneCount} shown={showDone} onToggle={() => setShowDone((v) => !v)} />
      )}

      {batches
        // A batch whose tiles are all dealt with has nothing to show under the chip, and an empty
        // bordered box saying so would be the noise the chip was pressed to get away from.
        .filter((b) => !onlyUnidentified || b.tiles.some((t) => t.state === "unidentified"))
        // Worked-through batches are set aside until asked for — and come back **in place** when
        // they are, never gathered at the end: batch order is card order, and the pile on the desk
        // is in the same order.
        .filter((b) => showDone || b.doneAt == null)
        .map((batch) => (
        <BatchSection
          key={batch.batchNo}
          batch={batch}
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          onlyUnidentified={onlyUnidentified}
          expanded={expansion.isExpanded(batch)}
          onToggleExpanded={() => expansion.toggle(batch)}
          onOpenTile={setTileId}
          busy={uploading || pending || detecting}
          detecting={detecting}
          onReview={(sheet, frontTileCount) => void openProposed(sheet, frontTileCount)}
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
          onDone={(touchedCopy) => {
            setTileId(null);
            refresh(touchedCopy);
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

/**
 * Which batches are open (#583) — **derived from the work, never remembered.**
 *
 * A stockbook of five hundred pieces is a dozen cards or more, so after a week the section is
 * mostly strips nobody needs to look at any more. A worked-through batch therefore collapses to its
 * header line — it does not *disappear*: the strip is the record of a card that came in, position
 * *n* on screen was position *n* on the card, and a batch that vanished when finished would take
 * that record with it. So it stays openable, and opens on every tile it ever held.
 *
 * The rule reads **`ScanSheet.batchDoneAt`** (#567), which is stamped when the last tile of a batch
 * leaves `unidentified` and cleared when a discard is put back or the batch is re-cut. Nothing here
 * recomputes "no tile is still waiting" beside it: two rules for one question is how the header and
 * the layout come to disagree about whether a card is finished.
 *
 * Neither shared expansion hook fits, which is why this one is local:
 *
 *  - `useCardExpansion` (#382) is collapsed-by-default plus "a card that appears while the screen is
 *    open opens itself". Here the baseline is the opposite — a batch with work left in it is open —
 *    and it is a fact about the batch, not about when it turned up.
 *  - `useGroupExpansion` (#538) carries one mode for the whole list. Here every batch answers for
 *    itself.
 *
 * Toggles are held as **explicit choices**, not as a XOR against the default: a collector who opens
 * a finished batch and then puts one of its discards back has said "keep this open", and flipping it
 * shut because the derived default moved underneath would be the app arguing with them. A batch
 * finished while the screen is open and never touched here does fold itself away — that is the rule
 * working, and the caret is one click.
 */
function useBatchExpansion() {
  const [choices, setChoices] = useState<Map<number, boolean>>(new Map());
  return {
    isExpanded: (batch: ScanBatchData) => choices.get(batch.batchNo) ?? batch.doneAt == null,
    toggle: (batch: ScanBatchData) =>
      setChoices((prev) => {
        const next = new Map(prev);
        next.set(batch.batchNo, !(prev.get(batch.batchNo) ?? batch.doneAt == null));
        return next;
      }),
  };
}

/**
 * The door back to the batches that have been set aside (#583).
 *
 * Worded as a **count of what is there**, not as a filter that is on — "12 worked-through batches"
 * is a fact about the parcel and reads as one whether or not they happen to be showing, whereas
 * *Hide finished* would leave a collector who has never pressed it wondering what it is hiding.
 * The caret is the same one the batches themselves open on, one level up.
 */
function SetAsideToggle({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        alignSelf: "flex-start",
        padding: "0.25rem 0.5rem",
        marginLeft: "-0.5rem",
        background: "none",
        border: "none",
        borderRadius: "0.375rem",
        font: "inherit",
        fontSize: "0.8125rem",
        color: "var(--color-text-muted)",
        cursor: "pointer",
      }}
    >
      <Icon name={shown ? "collapse" : "expand"} size="sm" />
      {count} worked-through {count === 1 ? "batch" : "batches"}
      <span style={{ color: "var(--color-text-secondary)" }}>{shown ? "— hide" : "— show"}</span>
    </button>
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
  expanded,
  onToggleExpanded,
  onOpenTile,
  busy,
  detecting,
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
  /** Whether this batch shows its tiles, or only its summary line (#583). Derived from
   * `batchDoneAt` by the section above, which owns the rule for the whole card. */
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenTile: (tileId: string) => void;
  busy: boolean;
  /** Whether the wait the buttons are in is a detection pass, so they can say which wait it is. */
  detecting: boolean;
  /** Open the editor on this sheet, proposing its cut first (#574). Only ever called for a sheet
   * nothing has been cut from — a re-cut reopens on the previous boxes through `onRecut` instead,
   * because the cut that is being corrected beats a fresh proposal of it. */
  onReview: (sheet: ScanCutEditorSheet, frontTileCount: number | null) => void;
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
  // change because a chip is pressed — and when the batch is collapsed (#583) this line is the
  // whole of it, so it has to say how many tiles the card held and what became of them.
  const held = batch.tiles.filter((t) => t.frontBox != null).length;
  const waiting = batch.tiles.filter((t) => t.state === "unidentified").length;
  const consumed = batch.tiles.filter((t) => t.state === "consumed").length;
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
        {/* The lot card's own caret (#382), one level down. Batch order is card order and the pile
            on the desk is in the same order, so a worked batch folds up where it stands and is
            never moved to the bottom — the numbering exists for that one correspondence. */}
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse this batch" : "Show this batch's tiles"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            padding: 0,
            display: "inline-flex",
          }}
        >
          <Icon name={expanded ? "collapse" : "expand"} size="sm" />
        </button>
        <strong style={{ fontSize: "0.8125rem" }}>Batch {batch.batchNo}</strong>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {held} {held === 1 ? "tile" : "tiles"}
          {backOnly.length > 0 && ` · ${backOnly.length} unpaired ${backOnly.length === 1 ? "back" : "backs"}`}
          {/* What is left leads, as it does everywhere else on this screen. */}
          {waiting > 0 && ` · ${waiting} waiting`}
          {consumed > 0 && ` · ${consumed} ${consumed === 1 ? "copy" : "copies"}`}
          {discarded > 0 && ` · ${discarded} discarded`}
          {/* The moment the batch was finished with. Shown because it is also the moment its
              retained scan stopped being able to do anything (#578 is what acts on it). */}
          {batch.doneAt && waiting === 0 && ` · done ${batch.doneAt.slice(0, 10)}`}
        </span>
        <span style={{ flex: 1 }} />

        {/* The buttons belong to the batch's contents, so they fold away with them: a finished
            batch is one line, and Re-cut / Delete on a line that shows nothing would be a
            destructive click over a card the collector cannot currently see. */}
        {expanded && batch.front && !batch.front.cut && (
          <SmallButton
            onClick={() => onReview(editorSheet(batch.front!), null)}
            disabled={busy}
          >
            {detecting ? "Finding the stamps…" : "Review the front cut"}
          </SmallButton>
        )}
        {expanded && batch.front?.cut && !batch.back && (
          <UploadButton
            label="Add back scan"
            small
            busy={busy}
            busyLabel={detecting ? "Finding the stamps…" : undefined}
            onFile={onUploadBack}
          />
        )}
        {expanded && batch.back && !batch.back.cut && (
          <SmallButton
            onClick={() => onReview(editorSheet(batch.back!), frontTiles.length)}
            disabled={busy}
          >
            {detecting ? "Finding the stamps…" : "Review the back cut"}
          </SmallButton>
        )}
        {expanded && batch.tiles.length > 0 && (
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
        {expanded && (
          <SmallButton onClick={onDelete} disabled={busy} danger>
            <Icon name="delete" size="sm" /> Delete batch
          </SmallButton>
        )}
      </div>

      {expanded && batch.tiles.length === 0 && batch.front && !batch.front.cut && (
        <Muted>
          The scan is stored. Review the proposed boxes — correcting them, and drawing any the
          detection missed — to cut it into tiles.
        </Muted>
      )}

      {expanded && frontTiles.length > 0 && (
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

      {expanded && backOnly.length > 0 && (
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
 *
 * **The emphasis is on the tiles still waiting, and the state is *marked* rather than shaded**
 * (#582). The strip is read to answer what is *left*, so the queue is what stands out: a waiting
 * tile wears the accent edge this app uses everywhere for "this needs you", and a settled one
 * simply lets its picture recede. It used to be the other way round — everything drawn alike with
 * the done pile at 60% — and on a strip of forty that is not a difference the eye can find, because
 * the scans themselves vary in brightness far more than the fade does: a pale stamp on a dark card
 * already read as handled.
 *
 * A fade also cannot say **which** end a tile reached, and the two are not degrees of one thing —
 * one piece became a copy, the other deliberately became nothing. So each carries a corner badge,
 * `photo-thumb.tsx`'s own device for exactly this problem: an opaque mark with a hairline ring,
 * which says the same thing over a black margin as over a bright stamp. They differ on three axes
 * at once — filled versus outlined, accent versus neutral, `check` versus `excluded` — so that at
 * thumbnail size neither can be mistaken for a weaker version of the other. The copy number in the
 * footer stays as the consumed tile's own anchor; the badge is what is legible at a glance, and the
 * number is what is legible when you look.
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
    // Always two pixels, so nothing shifts by a pixel as a tile settles — only the colour moves.
    // A tile still waiting takes the accent edge; a settled one drops back to the plain border,
    // and the warning edge of a copy nobody described (#567) outranks both, being the one thing
    // here that is news rather than state.
    border: `2px solid ${
      tile.outsideDescription
        ? "var(--color-warning-border)"
        : settled
          ? "var(--color-border)"
          : "var(--color-accent)"
    }`,
    // The drop target needs its own signal now that waiting tiles are accent-edged already —
    // and a droppable tile is by definition one of them, so a halo rather than a fourth colour.
    boxShadow: over ? "0 0 0 3px var(--color-accent-soft)" : undefined,
    borderRadius: "0.375rem",
    overflow: "hidden",
    background: droppable ? "var(--color-bg-subtle)" : "transparent",
    position: "relative",
  };

  const body = (
    <>
      {/* The crop is inset from the frame rather than flush with it. A tile is a scan of a stamp
          on a black card, so its own edges are often dark — and an edge drawn right up against
          them merges into the picture, which is exactly the legibility the coloured edge is here
          to provide. The gap is what makes it read as a frame at all. */}
      <div style={{ padding: "0.25rem 0.25rem 0" }}>
        <TileImage
          photoId={photoId}
          collectionId={collectionId}
          alt={`Tile ${tile.position + 1}, front`}
          // A tile that has been dealt with steps back without disappearing: it is still part of
          // the record of the card, and a discarded one is the only record there is. The *picture*
          // is what recedes, never the badge or the label over it — a mark that faded with the
          // scan would be the fade this replaced, wearing a shape.
          dimmed={settled}
          // The one honest placeholder: the copy this tile became has been deleted, so its images
          // went with it and there is nothing left to show. Said in words, because a broken-looking
          // square is what every consumed tile used to look like.
          emptyLabel={tile.state === "consumed" ? "copy deleted" : undefined}
        />
      </div>
      {settled && <TileStateBadge state={tile.state} />}
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

/**
 * What became of a settled tile, said in the corner of its square (#582).
 *
 * `photo-thumb.tsx`'s reserved-slot marker is the pattern: a corner badge rather than a coloured
 * frame, opaque and hairline-ringed, so it says the same thing over a black card margin as over a
 * bright stamp. That independence from the photograph is the whole point — the thing a fade could
 * never manage on a strip where the scans vary more than the fade did.
 *
 * The two ends are drawn as **different kinds of mark, not two strengths of one**: a copy is a
 * filled accent tick — something was made — and a discard is an outlined neutral `excluded` — the
 * app's own glyph for a thing deliberately set aside. Filled versus outlined survives being 15 px
 * across, which two hues of the same badge would not.
 *
 * `aria-hidden`: the cell's `title` already names the outcome in words, and a screen reader reading
 * "became copy #00042" does not also need "check".
 */
function TileStateBadge({ state }: { state: ScanTileData["state"] }) {
  if (state !== "consumed" && state !== "discarded") return null;
  const consumed = state === "consumed";
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "0.15rem",
        left: "0.15rem",
        width: "0.95rem",
        height: "0.95rem",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "0.25rem",
        background: consumed ? "var(--color-accent)" : "var(--color-bg-elevated)",
        color: consumed ? "#fff" : "var(--color-text-muted)",
        boxShadow: consumed
          ? "0 0 0 1px rgba(0,0,0,0.25)"
          : "0 0 0 1px var(--color-border-strong)",
      }}
    >
      <Icon name={consumed ? "check" : "excluded"} size="xs" />
    </span>
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
        border: "2px solid var(--color-warning-border)",
        borderRadius: "0.375rem",
        overflow: "hidden",
        cursor: "grab",
        // Inset for the same reason a tile's crop is (#582): a scan's own dark edge merging into
        // the frame is what makes the frame stop saying anything.
        padding: "0.25rem",
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
  dimmed,
  emptyLabel,
}: {
  photoId: string | null;
  collectionId: string;
  alt: string;
  /** Let the picture recede — a tile that has been dealt with (#582). Only the image: the badge
   * and the label sit outside it, and the whole point of them is that they do not fade. */
  dimmed?: boolean;
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
          opacity: dimmed ? 0.55 : 1,
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
      style={{
        display: "block",
        width: "100%",
        aspectRatio: "1",
        objectFit: "contain",
        opacity: dimmed ? 0.55 : 1,
      }}
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
  busyLabel,
  small,
  onFile,
}: {
  label: string;
  busy: boolean;
  /** What the wait is, when it is not the upload — a card scan goes straight from being sent to
   * being searched for stamps, and one label for both would name the wrong half of it. */
  busyLabel?: string;
  small?: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <SmallButton onClick={() => inputRef.current?.click()} disabled={busy} large={!small}>
        <Icon name="scan" size="sm" /> {busy ? (busyLabel ?? "Uploading…") : label}
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
