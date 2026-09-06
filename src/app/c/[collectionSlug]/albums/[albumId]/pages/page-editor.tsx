"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  TranslationGapsPanel,
  TranslationGapPopover,
} from "@/app/c/[collectionSlug]/shared/translation-gaps";
import type { TitleFallback } from "@/lib/offer-title-template";
import type {
  AlbumEditorBlock,
  AlbumEditorBox,
  AlbumEditorData,
  AlbumEditorSheet,
} from "@/lib/album-editor";
import {
  ALBUM_BLOCK_BREAKS,
  ALBUM_BOX_DELTA_MAX_MM,
  ALBUM_BOX_DELTA_MIN_MM,
  ALBUM_CORRECTION_STEP_MM,
  ALBUM_SPACE_MAX_MM,
  ALBUM_SPACE_MIN_MM,
  ALBUM_TEXT_BLOCK_ROLES,
  ALBUM_TEXT_BLOCK_SIDES,
} from "@/lib/album-corrections";
import { insertBefore } from "@/lib/album-drag";
import {
  addAlbumTextBlockAction,
  clearAlbumBoxAdjustmentsAction,
  clearAlbumEntryStampOrderAction,
  deleteAlbumTextBlockAction,
  reorderAlbumEntriesAction,
  reorderAlbumTextBlocksAction,
  setAlbumBoxAdjustmentAction,
  setAlbumEntryLayoutAction,
  setAlbumEntryStampOrderAction,
  updateAlbumTextBlockAction,
  type AlbumActionState,
} from "@/app/actions/albums";
import {
  AlbumPageCanvas,
  BOX_FLAGS,
  boxFlag,
  type CanvasDrag,
  type CanvasSelection,
} from "./page-canvas";

// The page editor (#769): where the collector overrules the automatic layout.
//
// ## Dragging writes the number, and typing moves the drawing
//
// Neither is the real interface with the other a fallback, and the code says so structurally: both
// go through one **preview** — a geometric offset in millimetres applied to what is drawn — and both
// commit through the same server action, which re-plans. A handle held on the canvas sets the
// preview from the pointer; a figure typed in the panel sets the same preview from the difference
// between what is typed and what is stored. Neither ever re-plans in the browser, because the client
// is not a planner (ADR-0045 §7).
//
// ## Corrections are relative, so they survive a content change
//
// Nothing stored here is a coordinate: *this box 2 mm wider*, *5 mm more before this series*, *break
// here*, this block before that one, these stamps in this order, this note here. Adding a stamp
// re-flows the page and every one of them still means what it meant — which is the whole reason the
// automatic layout is still running underneath.
//
// ## A printed sheet is read-only, and this screen defers to #778 entirely
//
// A card in a binder opens showing what went onto the paper, with its divergences beside it.
// Correcting one is not an edit but a decision — a continuation page or a reprint — and that
// decision is made on the album screen. Nothing here offers it a second time.

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** The card every area-picking screen in this app is (`ui-patterns.md`): one bordered box with the
 *  rail inside it, not a floating rail beside a separate panel — and, this being a workbench rather
 *  than a document, the card **fills what the screen's heading leaves** (#815). It is the lot
 *  builder's spelling (`offers/lot-builder/lot-builder-panel.tsx`), the app's other three-region
 *  screen: `flex: 1` in the screen's column, with a floor below which the column scrolls instead of
 *  squeezing the card to nothing. The three columns then take their height from *this* box rather
 *  than from a constant repeated three times, which is what keeps them level.
 *
 *  **The floor is not what used to make the page scroll**, and it is worth saying because the
 *  obvious repair is to attack the wrong number. Under `minHeight: 100vh` the column's height was
 *  indefinite, so `flex: 1` had no space to distribute and the card sized to its *content* — a sheet
 *  of A4 drawn at 1:1 is 1122 px — which is far past any floor. A definite height is what fixes it;
 *  `24rem` only ever bit below a window of roughly 580 px. It is `18rem` now so that the exception
 *  is rarer still: below about 480 px of window, which on the desktop browsers this app supports is
 *  a window nobody works in. A card that short still leaves the canvas ~250 px, half a sheet at the
 *  50% zoom. */
const SCREEN_CARD: React.CSSProperties = {
  display: "flex",
  gap: 0,
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  overflow: "clip",
  flex: 1,
  minHeight: "18rem",
  background: "var(--color-bg-elevated)",
};

/** The two side columns keep their widths — they are column widths, not a cap on the screen — and
 *  carry no height of their own: stretched to the card, each scrolls inside itself. */
const RAIL: React.CSSProperties = {
  width: "13rem",
  flexShrink: 0,
  overflowY: "auto",
};

const PANEL: React.CSSProperties = {
  width: "20rem",
  flexShrink: 0,
  borderLeft: "1px solid var(--color-border)",
  padding: "0.875rem 1.25rem",
  overflowY: "auto",
};

/** A recessed frame for figures over what is selected — `--color-bg-page` inside the card's own
 *  white, the shape every summary bar in this app already carries. */
const FRAME: React.CSSProperties = {
  background: "var(--color-bg-page)",
  borderRadius: "0.5rem",
  padding: "0.625rem 0.75rem",
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "0.3125rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const BTN: React.CSSProperties = {
  padding: "0.3125rem 0.625rem",
  background: "transparent",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ZOOMS = [0.5, 0.75, 1, 1.5, 2];

/** Millimetres to a tenth, the precision everything on this track cuts to. */
function mm(value: number): number {
  return Math.round(value * 10) / 10;
}

interface AlbumPageEditorProps {
  collectionSlug: string;
  data: AlbumEditorData;
}

export function AlbumPageEditor({ collectionSlug, data }: AlbumPageEditorProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { album, sheet } = data;

  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  /** The one preview both a drag and a typed figure feed. See the note at the top of the file. */
  const [preview, setPreview] = useState<CanvasDrag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gapPopover, setGapPopover] = useState<{
    gaps: TitleFallback[];
    at: { left: number; bottom: number };
  } | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<AlbumActionState>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setAddingNote(false);
      router.refresh();
    });
  }

  /** Every checklist in the album, for a note's anchor — not only the ones on this sheet: the
   *  anchor is where a note is *filed*, and a note about a series two sheets on is an ordinary thing
   *  to write while looking at this one. */
  const anchorChoices = data.entries.map((e) => ({ id: e.id, name: e.checklistName }));

  function sheetHref(position: number): string {
    const params = new URLSearchParams(search.toString());
    params.set("sheet", String(position));
    return `/c/${collectionSlug}/albums/${album.id}/pages?${params.toString()}`;
  }

  const selectedBox: AlbumEditorBox | null =
    sheet && selection?.kind === "box"
      ? (sheet.boxes.find(
          (b) => b.stampId === selection.stampId && b.entryId === selection.entryId
        ) ?? null)
      : null;
  const selectedBlock: AlbumEditorBlock | null =
    sheet && selection?.kind === "block"
      ? (sheet.blocks.find((b) => b.id === selection.id) ?? null)
      : null;

  /** Commit a space correction — on a checklist or on one of the collector's own notes. The two are
   *  different rows and the same correction, which is why the block carries its kind. */
  function commitSpace(
    block: AlbumEditorBlock,
    // One field, never both. A drag moved one handle, and sending the other would let whatever is
    // in an open panel overwrite a correction made a second earlier on the canvas.
    value: { spaceBeforeMm: number } | { spaceAfterMm: number }
  ) {
    const form = new FormData();
    if ("spaceBeforeMm" in value) form.set("spaceBeforeMm", String(mm(value.spaceBeforeMm)));
    else form.set("spaceAfterMm", String(mm(value.spaceAfterMm)));
    run(() =>
      block.kind === "text"
        ? updateAlbumTextBlockAction(block.id, form)
        : setAlbumEntryLayoutAction(block.id, form)
    );
  }

  function commitSize(box: AlbumEditorBox, widthDeltaMm: number, heightDeltaMm: number) {
    const form = new FormData();
    form.set("widthDeltaMm", String(mm(widthDeltaMm)));
    form.set("heightDeltaMm", String(mm(heightDeltaMm)));
    run(() => setAlbumBoxAdjustmentAction(box.entryId, box.stampId, form));
  }

  /**
   * A stamp dropped onto another stamp of the same block.
   *
   * The order is written **whole** (ADR-0045 §6) and over the entry's *own* stamp list rather than
   * the sheet's: a checklist too tall for a page runs across two or three cards, and reordering from
   * what happens to be on the sheet in front of you would drop everything on the others.
   *
   * The splice itself is `insertBefore` (`album-drag.ts`) — **insert-before, not swap** — which is
   * the same function the canvas draws its insertion mark from, so what the collector was shown and
   * what is written cannot describe two different rules (#816).
   */
  function reorderStamps(blockId: string, fromStampId: string, toStampId: string) {
    const entry = data.entries.find((e) => e.id === blockId);
    if (!entry) return;
    const next = insertBefore(entry.stampIds, fromStampId, toStampId);
    if (!next) return;
    run(() => setAlbumEntryStampOrderAction(blockId, next));
  }

  /**
   * The order the album prints its blocks in — one heading dropped onto another.
   *
   * It is written over the **whole album's** entries and not over the sheet's, because that is what
   * the order is: an album-level sequence the packer falls out of. Moving a checklist can therefore
   * move it onto a different sheet, which is the point of moving it.
   *
   * A note is not moved this way. It is **anchored** to a checklist rather than positioned among
   * them, so where it goes is its anchor, and that is set in its own panel.
   */
  function reorderBlocks(fromBlockId: string, toBlockId: string) {
    // A **note** dropped somewhere is re-anchored rather than reordered: where a note goes is which
    // checklist it is filed against and on which side, so dropping it on a block writes *before that
    // block*. That is the gesture reading as a sequence while the model stays an anchor — which is
    // what makes the note travel when the collector later drags that checklist somewhere else.
    const note = data.textBlocks.find((n) => n.id === fromBlockId);
    if (note) {
      const ontoNote = data.textBlocks.find((n) => n.id === toBlockId);
      if (ontoNote) {
        // Two notes filed against the same checklist on the same side are ordered among themselves,
        // and a note dropped on one filed elsewhere joins it there. Both are the same gesture, so
        // neither is a second way of saying where a note goes.
        if (
          ontoNote.anchorAlbumEntryId === note.anchorAlbumEntryId &&
          ontoNote.side === note.side
        ) {
          const siblings = data.textBlocks
            .filter(
              (n) =>
                n.anchorAlbumEntryId === note.anchorAlbumEntryId && n.side === note.side
            )
            .map((n) => n.id);
          const next = insertBefore(siblings, note.id, ontoNote.id);
          if (!next) return;
          run(() =>
            reorderAlbumTextBlocksAction(
              album.id,
              note.anchorAlbumEntryId,
              note.side,
              next
            )
          );
          return;
        }
        const form = new FormData();
        form.set("anchorAlbumEntryId", ontoNote.anchorAlbumEntryId ?? "");
        form.set("side", ontoNote.side);
        run(() => updateAlbumTextBlockAction(note.id, form));
        return;
      }
      const onto = data.entries.find((e) => e.id === toBlockId);
      if (!onto) return;
      const form = new FormData();
      form.set("anchorAlbumEntryId", onto.id);
      form.set("side", "before");
      run(() => updateAlbumTextBlockAction(note.id, form));
      return;
    }
    const next = insertBefore(data.entries.map((e) => e.id), fromBlockId, toBlockId);
    if (!next) return;
    run(() => reorderAlbumEntriesAction(album.id, next));
  }

  return (
    // A workbench, not a document: the screen takes the window (#815). The heading, the zoom and the
    // paragraph stay put at the top and the card below them takes the rest, so the three columns are
    // as tall as the window allows and each scrolls its own contents. There was a `maxWidth: 84rem`
    // here and it was the only one in the application — on the one screen whose whole subject is
    // looking at a sheet of paper at 1:1.
    //
    // **`height`, not `minHeight`, and that one word is the whole of #815's amendment.** A floor
    // leaves the column's height indefinite, and a flex child with `flex: 1` in an indefinite column
    // has no space to distribute: the card sized to its own content instead, which is a 297 mm sheet
    // — so the *page* scrolled, and the sheet list and the panel scrolled away with it. Only the
    // canvas is supposed to move. A definite height is what gives the card a share to take and the
    // side columns a height to be stretched to.
    //
    // `overflow: auto` is where the exception goes. The card keeps a floor (`SCREEN_CARD`), so a
    // window too short for it overflows this column — and it scrolls *here* rather than at the
    // document, which keeps the app's own sidebar where it is and means the browser never grows a
    // second scrollbar beside the canvas's.
    <div
      style={{
        padding: "2rem",
        height: "100vh",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Link
        href={`/c/${collectionSlug}/albums/${album.id}`}
        style={{
          ...MUTED,
          textDecoration: "none",
          display: "inline-block",
          // The parent is a column now, and a stretched link would be a full-window click target.
          alignSelf: "flex-start",
          marginBottom: "0.5rem",
        }}
      >
        ← {album.name}
      </Link>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "0.25rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Pages</h2>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          <span style={MUTED}>Zoom</span>
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              style={{
                ...BTN,
                padding: "0.1875rem 0.5rem",
                fontSize: "0.75rem",
                background: z === zoom ? "var(--color-accent-soft)" : "transparent",
                borderColor: z === zoom ? "var(--color-accent-border)" : "var(--color-border-strong)",
              }}
            >
              {z === 1 ? "1:1" : `${z * 100}%`}
            </button>
          ))}
        </div>
      </div>
      <p style={{ ...MUTED, margin: "0 0 1.25rem", lineHeight: 1.6, maxWidth: "48rem" }}>
        The same plan the PDF draws, at 1:1. Every correction here is a <strong>delta</strong> — 2 mm
        wider, 5 mm more before this series, break here — so adding a stamp re-flows the page and
        keeps them. Drag a handle or type the millimetre; both write the same number.{" "}
        <strong>1:1 on a screen proves nothing about the card</strong>: a viewer applies its own zoom
        and the print dialog applies another.
      </p>

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {error}
        </p>
      )}
      {data.emptyStock && (
        <p
          style={{
            ...MUTED,
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-warning-border)",
            background: "var(--color-warning-soft)",
            borderRadius: "0.5rem",
            lineHeight: 1.6,
          }}
        >
          This collection has no hawid stock, so every box below is a pocket. Add the strips you own
          in Settings → Albums and the boxes will be cut from them.
        </p>
      )}

      <div style={SCREEN_CARD}>
        {/* ── The sheets ── */}
        <div style={RAIL}>
          <div
            style={{
              padding: "0.625rem 0.875rem",
              borderBottom: "1px solid var(--color-border)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              color: "var(--color-text-muted)",
            }}
          >
            Sheets
          </div>
          {data.sheets.length === 0 && (
            <p style={{ ...MUTED, padding: "0.875rem" }}>Nothing to lay out yet.</p>
          )}
          {data.sheets.map((row) => (
            <Link
              key={row.position}
              href={sheetHref(row.position)}
              style={{
                display: "block",
                padding: "0.5rem 0.875rem",
                textDecoration: "none",
                borderBottom: "1px solid var(--color-border)",
                background:
                  row.position === sheet?.position ? "var(--color-accent-soft)" : "transparent",
                color: "var(--color-text-primary)",
                fontSize: "0.8125rem",
              }}
            >
              <span style={{ fontWeight: row.position === sheet?.position ? 600 : 400 }}>
                {row.range || "(no catalog numbers)"}
              </span>
              <span style={{ ...MUTED, display: "block", fontSize: "0.75rem" }}>
                {row.chapterKey || "no year"}
                {row.printed ? " · on paper" : ""}
              </span>
            </Link>
          ))}
        </div>

        {/* ── The sheet ── */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderLeft: "1px solid var(--color-border)",
            padding: "1.25rem",
            background: "var(--color-bg-page)",
            // The sheet is drawn in real millimetres and an A4 page is 297 mm tall, so this viewport
            // scrolls whatever height it has. What it must not do is stop short of the window (#815).
            overflow: "auto",
            display: "flex",
            // **`safe` centre, not plain centre** (#820). A sheet wider than this viewport — a
            // narrow window at 150% or 200% — overflows it on *both* sides under plain centring,
            // and only the right side can be reached: a scroll container will not scroll to a
            // negative position, so the left edge of the page is simply unreachable. `safe` falls
            // back to start alignment exactly when centring would overflow, which is the one case
            // it goes wrong; a sheet that fits is still centred.
            justifyContent: "safe center",
          }}
        >
          {sheet ? (
            <AlbumPageCanvas
              sheet={sheet}
              collectionId={album.collectionId}
              zoom={zoom}
              selection={selection}
              onSelect={setSelection}
              drag={preview}
              onDrag={setPreview}
              onDragEnd={(d) => {
                if (d.kind === "space" || d.kind === "spaceAfter") {
                  const block = sheet.blocks.find((b) => b.id === d.blockId);
                  if (!block?.correction) return;
                  commitSpace(
                    block,
                    d.kind === "space"
                      ? { spaceBeforeMm: block.correction.spaceBeforeMm + d.dyMm }
                      : { spaceAfterMm: block.correction.spaceAfterMm + d.dyMm }
                  );
                  return;
                }
                const box = sheet.boxes.find(
                  (b) => b.stampId === d.stampId && b.entryId === d.blockId
                );
                if (!box) return;
                commitSize(
                  box,
                  (box.adjustment?.widthDeltaMm ?? 0) + d.dxMm,
                  (box.adjustment?.heightDeltaMm ?? 0) + d.dyMm
                );
              }}
              onReorder={reorderStamps}
              onReorderBlocks={reorderBlocks}
              onOpenGaps={(text, at) => setGapPopover({ gaps: text.gaps, at })}
            />
          ) : (
            <p style={MUTED}>This album has no sheets to lay out yet.</p>
          )}
        </div>

        {/* ── The numbers ── */}
        <div style={PANEL}>
          {sheet ? (
            sheet.readOnly ? (
              <PrintedSheetPanel
                sheet={sheet}
                albumHref={`/c/${collectionSlug}/albums/${album.id}`}
              />
            ) : selectedBox ? (
              <BoxPanel
                box={selectedBox}
                disabled={isPending}
                onPreview={(dx, dy) =>
                  setPreview(
                    dx === 0 && dy === 0
                      ? null
                      : {
                          kind: "size",
                          blockId: selectedBox.entryId,
                          stampId: selectedBox.stampId,
                          dxMm: dx,
                          dyMm: dy,
                        }
                  )
                }
                onCommit={(w, h) => {
                  setPreview(null);
                  commitSize(selectedBox, w, h);
                }}
                onSelectBlock={() =>
                  setSelection({ kind: "block", id: selectedBox.entryId })
                }
              />
            ) : selectedBlock ? (
              <BlockPanel
                block={selectedBlock}
                disabled={isPending}
                onPreview={(kind, dy) =>
                  setPreview(
                    dy === 0 ? null : { kind, blockId: selectedBlock.id, dxMm: 0, dyMm: dy }
                  )
                }
                onSave={(form) => {
                  setPreview(null);
                  run(() =>
                    selectedBlock.kind === "text"
                      ? updateAlbumTextBlockAction(selectedBlock.id, form)
                      : setAlbumEntryLayoutAction(selectedBlock.id, form)
                  );
                }}
                onClearStampOrder={() =>
                  run(() => clearAlbumEntryStampOrderAction(selectedBlock.id))
                }
                onClearBoxes={() => run(() => clearAlbumBoxAdjustmentsAction(selectedBlock.id))}
                onDelete={() => run(() => deleteAlbumTextBlockAction(selectedBlock.id))}
                anchors={anchorChoices}
                onMove={(by) => {
                  const order = data.entries.map((e) => e.id);
                  const at = order.indexOf(selectedBlock.id);
                  const to = at + by;
                  if (at === -1 || to < 0 || to >= order.length) return;
                  const next = order.filter((id) => id !== selectedBlock.id);
                  next.splice(to, 0, selectedBlock.id);
                  run(() => reorderAlbumEntriesAction(album.id, next));
                }}
              />
            ) : (
              <SheetPanel
                sheet={sheet}
                collectionId={album.collectionId}
                language={album.language}
                onAddNote={() => setAddingNote(true)}
                onSaved={() => router.refresh()}
              />
            )
          ) : null}
        </div>
      </div>

      {gapPopover && (
        <TranslationGapPopover
          collectionId={album.collectionId}
          language={album.language}
          gaps={gapPopover.gaps}
          anchor={gapPopover.at}
          onSaved={() => router.refresh()}
          onClose={() => setGapPopover(null)}
        />
      )}

      {addingNote && sheet && (
        <AddNoteDialog
          anchors={anchorChoices}
          isPending={isPending}
          error={error ?? undefined}
          onClose={() => !isPending && setAddingNote(false)}
          onSubmit={(form) => run(() => addAlbumTextBlockAction(album.id, form))}
        />
      )}
    </div>
  );
}

// ── The panels ───────────────────────────────────────────────────────────────

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "0.6875rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: "var(--color-text-muted)",
        marginBottom: "0.5rem",
      }}
    >
      {children}
    </div>
  );
}

/** Nothing selected: what is on the sheet, what needs attention before it is printed, and the way to
 *  add a note. */
function SheetPanel({
  sheet,
  collectionId,
  language,
  onAddNote,
  onSaved,
}: {
  sheet: AlbumEditorSheet;
  collectionId: string;
  language: string;
  onAddNote: () => void;
  onSaved: () => void;
}) {
  const counts = new Map<string, number>();
  for (const box of sheet.boxes) {
    const flag = boxFlag(box);
    if (flag) counts.set(flag, (counts.get(flag) ?? 0) + 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <PanelHeading>Sheet {sheet.position}</PanelHeading>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          {sheet.range || "(no catalog numbers on this sheet)"}
        </div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0", lineHeight: 1.5 }}>
          {sheet.boxes.length === 1 ? "1 box" : `${sheet.boxes.length} boxes`} ·{" "}
          {sheet.blocks.length === 1 ? "1 block" : `${sheet.blocks.length} blocks`}
          {sheet.chapterKey ? ` · ${sheet.chapterKey}` : ""}
        </p>
      </div>

      {sheet.blocks.some((b) => b.separated) && (
        <div style={{ ...FRAME, borderLeft: "3px solid var(--color-warning)" }}>
          <PanelHeading>A request the layout could not grant</PanelHeading>
          {/* Said here as well as on the block, and for the flags' own reason: a constraint dropped
              silently is one the collector discovers with the card in his hand. */}
          <div style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
            {sheet.blocks
              .filter((b) => b.separated)
              .map((b) => b.name)
              .join(", ")}{" "}
            asked to stay with the block above and opens this sheet instead — nothing could hold
            both.
          </div>
        </div>
      )}

      {counts.size > 0 && (
        <div style={FRAME}>
          <PanelHeading>Before it is printed</PanelHeading>
          {/* These are exactly the staleness-prone facts a card may not carry (ADR-0047 §9). They
              are shown here, on screen, before the sheet goes into the printer — which is the one
              moment they are worth anything, because a hawid cut wrong is gone. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {(Object.keys(BOX_FLAGS) as (keyof typeof BOX_FLAGS)[]).map((flag) =>
              counts.get(flag) ? (
                <div
                  key={flag}
                  style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: "0.625rem",
                      height: "0.625rem",
                      flexShrink: 0,
                      borderRadius: "0.125rem",
                      border: `2px solid ${BOX_FLAGS[flag].colour}`,
                    }}
                  />
                  <span style={{ fontSize: "0.8125rem", lineHeight: 1.4 }}>
                    {counts.get(flag)} — {BOX_FLAGS[flag].label}
                  </span>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      {sheet.gaps.length > 0 && (
        <div style={FRAME}>
          {/* A text that fell back to the default language is a small annoyance on a screen and
              permanent on a card, so it is worth knowing about at the same moment as an inherited
              size — before the sheet goes into the printer (#298/#299/#300). */}
          <TranslationGapsPanel
            collectionId={collectionId}
            language={language}
            gaps={sheet.gaps}
            onSaved={onSaved}
            note="These words would print in the collection's default language on this card."
            maxHeight="14rem"
          />
        </div>
      )}

      <div>
        <button type="button" onClick={onAddNote} style={BTN}>
          <Icon name="add" size="sm" /> Add a note
        </button>
        <p style={{ ...MUTED, margin: "0.5rem 0 0", lineHeight: 1.5 }}>
          A block of your own words, set in one of the template&apos;s voices and filed after a
          checklist so it travels with it.
        </p>
      </div>

      <p style={{ ...MUTED, margin: 0, lineHeight: 1.5 }}>
        Click a box or a heading to correct it.
      </p>
    </div>
  );
}

/** A card in a binder. Read-only, with what has changed under it since. */
function PrintedSheetPanel({
  sheet,
  albumHref,
}: {
  sheet: AlbumEditorSheet;
  albumHref: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <PanelHeading>On paper</PanelHeading>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          {sheet.range || "(no catalog numbers on this card)"}
        </div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0", lineHeight: 1.5 }}>
          {sheet.printedAt
            ? `Printed on ${new Date(sheet.printedAt).toLocaleDateString()}.`
            : "A stored sheet."}{" "}
          This draws what went onto the paper, in the faces and margins it was set in, whatever has
          changed since.
        </p>
      </div>

      <div style={FRAME}>
        <PanelHeading>What has changed since</PanelHeading>
        {sheet.divergences.length === 0 ? (
          <p style={{ ...MUTED, margin: 0, lineHeight: 1.5 }}>
            Nothing. The card still says what the data would now produce.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
            }}
          >
            {sheet.divergences.map((d, i) => (
              <li key={i} style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
                <span style={{ ...CHIP, marginRight: "0.375rem" }}>{d.kind}</span>
                {d.detail}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p style={{ ...MUTED, margin: 0, lineHeight: 1.6 }}>
        A card is not corrected here. Putting one right is a decision rather than an edit — a{" "}
        <strong>continuation page</strong> carrying the new stamps with a range of its own, or a{" "}
        <strong>reprint</strong> of the whole card — and both are made on the album screen.
      </p>
      <Link href={albumHref} style={BTN}>
        Printed cards on the album screen →
      </Link>
    </div>
  );
}

/** One box: its numbers, and the two millimetres the collector may correct. */
function BoxPanel({
  box,
  disabled,
  onPreview,
  onCommit,
  onSelectBlock,
}: {
  box: AlbumEditorBox;
  disabled: boolean;
  onPreview: (dxMm: number, dyMm: number) => void;
  onCommit: (widthDeltaMm: number, heightDeltaMm: number) => void;
  onSelectBlock: () => void;
}) {
  const stored = box.adjustment ?? { widthDeltaMm: 0, heightDeltaMm: 0 };
  const [width, setWidth] = useState(String(stored.widthDeltaMm));
  const [height, setHeight] = useState(String(stored.heightDeltaMm));
  // Re-synced when the selection moves to a different box, the pattern the album screen's optimistic
  // entry list uses: a keyed local draft plus the value it was taken from.
  const [syncedFrom, setSyncedFrom] = useState(box);
  if (syncedFrom !== box) {
    setSyncedFrom(box);
    setWidth(String(stored.widthDeltaMm));
    setHeight(String(stored.heightDeltaMm));
  }

  const flag = boxFlag(box);
  const commit = () =>
    onCommit(Number(width) || 0, Number(height) || 0);
  const previewFrom = (w: string, h: string) =>
    onPreview(
      (Number(w) || 0) - stored.widthDeltaMm,
      (Number(h) || 0) - stored.heightDeltaMm
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <PanelHeading>Box</PanelHeading>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          {box.catalogNumber || "(no catalog number)"}
        </div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0", lineHeight: 1.5 }}>
          {mm(box.widthMm)} × {mm(box.heightMm)} mm ·{" "}
          {box.stripLabel ? `from the ${box.stripLabel} strip` : "pocket — no strip fits"}
        </p>
      </div>

      {flag && (
        <div style={{ ...FRAME, borderLeft: `3px solid ${BOX_FLAGS[flag].colour}` }}>
          <div style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
            {BOX_FLAGS[flag].label}
            {flag === "inherited" && box.sizeFromCatalogNumber
              ? ` — from ${box.sizeFromCatalogNumber}`
              : ""}
            .
          </div>
        </div>
      )}

      <div>
        <PanelHeading>Corrected by</PanelHeading>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div style={{ flex: 1 }}>
            <LabelWithError htmlFor="box-width">Width, mm</LabelWithError>
            <input
              id="box-width"
              type="number"
              step={ALBUM_CORRECTION_STEP_MM}
              min={ALBUM_BOX_DELTA_MIN_MM}
              max={ALBUM_BOX_DELTA_MAX_MM}
              value={width}
              disabled={disabled}
              onChange={(e) => {
                setWidth(e.target.value);
                previewFrom(e.target.value, height);
              }}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              style={INPUT}
            />
          </div>
          <div style={{ flex: 1 }}>
            <LabelWithError htmlFor="box-height">Height, mm</LabelWithError>
            <input
              id="box-height"
              type="number"
              step={ALBUM_CORRECTION_STEP_MM}
              min={ALBUM_BOX_DELTA_MIN_MM}
              max={ALBUM_BOX_DELTA_MAX_MM}
              value={height}
              disabled={disabled}
              onChange={(e) => {
                setHeight(e.target.value);
                previewFrom(width, e.target.value);
              }}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              style={INPUT}
            />
          </div>
        </div>
        <p style={{ ...MUTED, margin: "0.5rem 0 0", lineHeight: 1.5 }}>
          Millimetres on the piece, not on the box. The width is the cut and moves with what you
          type; <strong>the height comes out of the drawer</strong> — it is the shortest strip the
          piece fits into, so it moves in strip steps and may not move at all.
        </p>
      </div>

      <button type="button" onClick={onSelectBlock} style={BTN}>
        The block this is on →
      </button>
    </div>
  );
}

/** One block: the space around it, where a page may break above it, and — for a note — its words. */
function BlockPanel({
  block,
  disabled,
  onPreview,
  onSave,
  onClearStampOrder,
  onClearBoxes,
  onDelete,
  anchors,
  onMove,
}: {
  block: AlbumEditorBlock;
  disabled: boolean;
  /** The live offset while a figure is being typed — the same preview a handle held on the canvas
   *  feeds, which is what makes typing and dragging one interface rather than two. */
  onPreview: (kind: "space" | "spaceAfter", dyMm: number) => void;
  onSave: (form: FormData) => void;
  onClearStampOrder: () => void;
  onClearBoxes: () => void;
  onDelete: () => void;
  /** Every checklist in the album, for a note's anchor. */
  anchors: { id: string; name: string }[];
  /** One step earlier or later in the album's own block order. The keyboard route to what dragging a
   *  heading does — an order is the one override here that is not a millimetre, so *typing it* is a
   *  pair of buttons rather than a field. */
  onMove?: (by: -1 | 1) => void;
}) {
  const correction = block.correction ?? {
    spaceBeforeMm: 0,
    spaceAfterMm: 0,
    breakBefore: "auto" as const,
  };
  const [before, setBefore] = useState(String(correction.spaceBeforeMm));
  const [after, setAfter] = useState(String(correction.spaceAfterMm));
  const [breakBefore, setBreakBefore] = useState<string>(correction.breakBefore);
  const [text, setText] = useState(block.text);
  const [role, setRole] = useState<string>(block.role);
  const [side, setSide] = useState<string>(block.anchor?.side ?? "after");
  const [anchor, setAnchor] = useState<string>(block.anchor?.albumEntryId ?? "");
  const [syncedFrom, setSyncedFrom] = useState(block);
  if (syncedFrom !== block) {
    setSyncedFrom(block);
    setBefore(String(correction.spaceBeforeMm));
    setAfter(String(correction.spaceAfterMm));
    setBreakBefore(correction.breakBefore);
    setText(block.text);
    setRole(block.role);
    setSide(block.anchor?.side ?? "after");
    setAnchor(block.anchor?.albumEntryId ?? "");
  }

  function save() {
    const form = new FormData();
    form.set("spaceBeforeMm", before);
    form.set("spaceAfterMm", after);
    form.set("breakBefore", breakBefore);
    if (block.kind === "text") {
      form.set("text", text);
      form.set("role", role);
      form.set("side", side);
      form.set("anchorAlbumEntryId", anchor);
    }
    onSave(form);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <PanelHeading>{block.kind === "text" ? "Note" : "Checklist"}</PanelHeading>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.35 }}>{block.name}</div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0", lineHeight: 1.5 }}>
          {block.part > 1 ? `Sheet ${block.part} of this block · ` : ""}
          {block.boxCount === 1 ? "1 box" : `${block.boxCount} boxes`} on this sheet
        </p>
      </div>

      {block.separated && (
        <div style={{ ...FRAME, borderLeft: "3px solid var(--color-warning)" }}>
          <div style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
            This block asked to stay with the one above it and could not: it opens a sheet, so what
            it was to stay with is on the one before. Nothing is wrong with the page — the request
            simply has no arrangement that satisfies it here, and it is said out loud rather than
            dropped quietly.
          </div>
        </div>
      )}

      {block.kind === "text" && (
        <div>
          <LabelWithError htmlFor="note-text">Words</LabelWithError>
          <textarea
            id="note-text"
            value={text}
            rows={3}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            style={{ ...INPUT, resize: "vertical" }}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <LabelWithError htmlFor="note-role">Set in</LabelWithError>
            <select
              id="note-role"
              value={role}
              disabled={disabled}
              onChange={(e) => setRole(e.target.value)}
              style={INPUT}
            >
              {ALBUM_TEXT_BLOCK_ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label} — {r.hint}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
            <div style={{ flex: "0 0 6rem" }}>
              <LabelWithError htmlFor="note-side">Filed</LabelWithError>
              <select
                id="note-side"
                value={side}
                disabled={disabled}
                onChange={(e) => setSide(e.target.value)}
                style={INPUT}
              >
                {ALBUM_TEXT_BLOCK_SIDES.map((sd) => (
                  <option key={sd.key} value={sd.key}>
                    {sd.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="note-anchor">this</LabelWithError>
              <select
                id="note-anchor"
                value={anchor}
                disabled={disabled}
                onChange={(e) => setAnchor(e.target.value)}
                style={INPUT}
              >
                <option value="">
                  {side === "before" ? "the head of the album" : "everything in the album"}
                </option>
                {anchors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ ...MUTED, margin: "0.5rem 0 0", lineHeight: 1.5 }}>
            An anchor, not a place on a sheet: the note goes where its checklist goes.{" "}
            <em>Before</em> and <em>after</em> are two different statements once the album is
            reordered, which is why a note that opens a chapter is filed <em>before</em> its first
            checklist rather than after the one that happens to precede it. Dragging its heading onto
            another block files it before that one.
          </p>
        </div>
      )}

      <div>
        <PanelHeading>Space around it</PanelHeading>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div style={{ flex: 1 }}>
            <LabelWithError htmlFor="space-before">Before, mm</LabelWithError>
            <input
              id="space-before"
              type="number"
              step={ALBUM_CORRECTION_STEP_MM}
              min={ALBUM_SPACE_MIN_MM}
              max={ALBUM_SPACE_MAX_MM}
              value={before}
              disabled={disabled}
              onChange={(e) => {
                setBefore(e.target.value);
                onPreview("space", (Number(e.target.value) || 0) - correction.spaceBeforeMm);
              }}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && save()}
              style={INPUT}
            />
          </div>
          <div style={{ flex: 1 }}>
            <LabelWithError htmlFor="space-after">After, mm</LabelWithError>
            <input
              id="space-after"
              type="number"
              step={ALBUM_CORRECTION_STEP_MM}
              min={ALBUM_SPACE_MIN_MM}
              max={ALBUM_SPACE_MAX_MM}
              value={after}
              disabled={disabled}
              onChange={(e) => {
                setAfter(e.target.value);
                onPreview("spaceAfter", (Number(e.target.value) || 0) - correction.spaceAfterMm);
              }}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && save()}
              style={INPUT}
            />
          </div>
        </div>
        <p style={{ ...MUTED, margin: "0.5rem 0 0", lineHeight: 1.5 }}>
          Added to the space the layout already leaves. Negative closes the gap; it stops at nothing
          rather than printing one block over another.
        </p>
      </div>

      <div>
        <LabelWithError htmlFor="break-before">A page may break above it</LabelWithError>
        <select
          id="break-before"
          value={breakBefore}
          disabled={disabled}
          onChange={(e) => {
            setBreakBefore(e.target.value);
          }}
          onBlur={save}
          style={INPUT}
        >
          {ALBUM_BLOCK_BREAKS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label} — {b.hint}
            </option>
          ))}
        </select>
      </div>

      <button type="button" onClick={save} disabled={disabled} style={BTN}>
        Save these numbers
      </button>

      {block.kind === "entry" && onMove && (
        <div>
          <PanelHeading>Where it prints</PanelHeading>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={disabled}
              style={{ ...BTN, flex: 1 }}
            >
              <Icon name="previous" size="sm" /> Earlier
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={disabled}
              style={{ ...BTN, flex: 1 }}
            >
              Later <Icon name="next" size="sm" />
            </button>
          </div>
          <p style={{ ...MUTED, margin: "0.5rem 0 0", lineHeight: 1.5 }}>
            The album&apos;s own order, so a checklist can move onto another sheet. Dragging a
            heading onto another does the same thing.
          </p>
        </div>
      )}

      {block.kind === "entry" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {block.ordersItsOwn && (
            <Tooltip content="Back to the order the checklist itself is in (#764). Drag one box onto another on the sheet to set an order of your own again.">
              <button type="button" onClick={onClearStampOrder} disabled={disabled} style={BTN}>
                <Icon name="revert" size="sm" /> Follow the checklist&apos;s order
              </button>
            </Tooltip>
          )}
          <button type="button" onClick={onClearBoxes} disabled={disabled} style={BTN}>
            <Icon name="revert" size="sm" /> Undo every box correction here
          </button>
        </div>
      )}

      {block.kind === "text" && (
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          style={{ ...BTN, color: "var(--color-error)", borderColor: "var(--color-error-border)" }}
        >
          <Icon name="delete" size="sm" /> Remove this note
        </button>
      )}
    </div>
  );
}

/** Adding one of the collector's own notes. Anchored to a checklist rather than dropped at a
 *  position, so it travels with the series it is about. */
function AddNoteDialog({
  anchors,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  anchors: { id: string; name: string }[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <DialogShell title="Add a note" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div>
              <LabelWithError htmlFor="new-note-text">Words</LabelWithError>
              <textarea
                id="new-note-text"
                name="text"
                rows={3}
                required
                autoFocus
                disabled={isPending}
                style={{ ...INPUT, resize: "vertical" }}
              />
            </div>
            <div>
              <LabelWithError htmlFor="new-note-role">Set in</LabelWithError>
              <select id="new-note-role" name="role" disabled={isPending} style={INPUT}>
                {ALBUM_TEXT_BLOCK_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label} — {r.hint}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <div style={{ flex: "0 0 7rem" }}>
                <LabelWithError htmlFor="new-note-side">Filed</LabelWithError>
                <select id="new-note-side" name="side" disabled={isPending} style={INPUT}>
                  {ALBUM_TEXT_BLOCK_SIDES.map((sd) => (
                    <option key={sd.key} value={sd.key}>
                      {sd.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
              <LabelWithError htmlFor="new-note-anchor">this</LabelWithError>
              <select
                id="new-note-anchor"
                name="anchorAlbumEntryId"
                disabled={isPending}
                style={INPUT}
              >
                <option value="">everything (the head or the end of the album)</option>
                {anchors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              </div>
            </div>
            <p style={{ ...MUTED, margin: "-0.375rem 0 0", lineHeight: 1.5 }}>
              An anchor, not a place on a sheet. Reorder the album and the note goes with the
              checklist it is filed against. <em>Before</em> and <em>after</em> are two different
              statements once that happens — a note opening a chapter belongs <em>before</em> that
              chapter&apos;s first checklist, not after the one that happens to precede it today.
              Anchored to nothing, <em>before</em> is the head of the album and <em>after</em> is
              the end of it.
            </p>
          </div>
        </DialogBody>
        {/* No `onAction`, so the shared action button stays a real `type="submit"` and the form's
            own validation runs — a note with nothing in it is refused by the browser rather than by
            a round trip. */}
        <DialogActions
          actionLabel="Add it"
          disabled={isPending}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
