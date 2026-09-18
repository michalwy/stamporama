"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
// From the viewer module itself rather than `inventory/photo-thumb`, which re-exports it: that module
// opens this viewer over a copy's photo (#1290), and importing back through it would close a cycle.
import { ThumbPreview } from "@/app/photo-viewer";
import { Icon } from "@/app/icons";
import {
  ANNOTATION_COLOURS,
  ANNOTATION_FONT_FAMILY,
  MAX_TEXT_MARK,
  NO_MARKS,
  annotationAt,
  annotationBounds,
  annotationFromDrag,
  changeMarks,
  restyleMark,
  snapshotRegion,
  styleFieldsOf,
  textMarkAt,
  undoMarks,
  type AnnotationKind,
  type AnnotationStyle,
  type MarksHistory,
  type SnapshotMark,
} from "@/lib/annotations";
import type { Box } from "@/lib/scan-boxes";
import { AnnotationShapes } from "./annotation-layer";
import { AnnotationStyleControls } from "./annotation-style-controls";
import { useAnnotationStyle } from "./use-annotation-style";
import { SnapshotDialog } from "./snapshot-dialog";
import { useEscapeLayer } from "@/app/escape-stack";
import type { TileSideView } from "@/lib/scan-tile-view";
import {
  MM_PER_INCH,
  formatGaugeAt,
  formatMillimetres,
  isPlausibleGauge,
  measureDistance,
  parseScanDpi,
  parseToothCount,
  perforationGauge,
  type ScanPoint,
} from "@/lib/scan-measure";
import {
  formatStampSize,
  sizeFromScanPixels,
  type StampSize,
} from "@/lib/stamp-size";
import { usePublishSizeProposal } from "./measured-size";
import { countTeethBetweenMarks, type Pixels } from "@/lib/scan-perf-count";
import {
  DEFAULT_WATERMARK_CHANNEL,
  DEFAULT_WATERMARK_STRENGTH,
  MAX_WATERMARK_STRENGTH,
  MIN_WATERMARK_STRENGTH,
  WATERMARK_CHANNELS,
  type WatermarkChannel,
} from "@/lib/scan-watermark";
import {
  ZOOM_STEP,
  actualSizeViewport,
  clampOffsets,
  clampScale,
  fitViewport,
  panBy,
  toSheetPoint,
  zoomBy,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";
import { isSideways, turnBy, turnedSize, type QuarterTurn } from "@/lib/tile-turn";
import { ScanToolButton } from "./scan-tool-button";
import { useSheetRegion } from "./use-sheet-region";
import { useWatermarkView, type WatermarkStatus } from "./use-watermark-view";

/**
 * The tile, large and zoomable — the identification dialog's whole left-hand side (#585).
 *
 * ## Why this is the payoff of scanning at all
 *
 * Which variant a stamp is comes down to detail: perforation teeth, a watermark, a plate flaw, a
 * shade. That work is done with a loupe over the physical piece — *after* it has been scanned at
 * 1200 dpi, where all of that detail is already sitting unlooked-at. A single stamp's tile is
 * around 1400 px, comfortably under `FULL_MAX_EDGE`, so **the tile photo already holds the whole
 * scan of it**; showing it at the size of a postage stamp was the only thing standing between the
 * collector and a pass done at the keyboard.
 *
 * ## Reuse, not a second implementation
 *
 * Every number here comes from `scan-viewport.ts` — zoom to the cursor, fit, clamping, and a `1:1`
 * that means one screen pixel per **scan** pixel. That module was written for the cut editor and is
 * about a picture and a viewport, so a tile is simply a second caller: the picture is a rectangle of
 * the very same card, and its size in scan pixels is the tile's own box. A control claiming `1:1`
 * over anything else would lie about the one question this dialog exists to answer — what is real
 * detail and what is enlargement.
 *
 * ## Two things that decide whether it replaces a loupe
 *
 * - **Switching front to back keeps the zoom and the pan.** Telling a variant apart is a comparison,
 *   and being thrown back to fit on every flip is what makes a comparison expensive. The viewport is
 *   therefore held across the switch and only re-clamped, which is exact rather than approximate
 *   because the scale is in *scan* pixels: the two sides are two crops of the same card at the same
 *   density, so the same scale is the same magnification on both.
 * - **Past the photo's own resolution the pixels come from the retained sheet** (`useSheetRegion`),
 *   the same escalation the cut editor makes and the same reason the original is kept. It reaches
 *   for that only when the photo is genuinely a downscale — a big se-tenant block or a strip past
 *   the cap — since for the ordinary single stamp the photo *is* the scan.
 *
 * When the sheet's bytes have been swept (#578) there is no deeper source, and the tile photo alone
 * is what is shown. Which sides exist and which of them still have a scan behind them is decided in
 * `scan-tile-view.ts`, away from the DOM, so the swept case is a unit test rather than a cron job.
 *
 * ## Measuring (#598)
 *
 * The same viewport is also the ruler and the perforation gauge, and it is the same reuse again:
 * everything a measurement needs is already here. A mark is placed in **scan pixels**
 * (`toSheetPoint`), never in screen pixels, so the reading is taken on the card's own grid whatever
 * the browser happens to be drawing — a downscaled photo, or the retained original where
 * `useSheetRegion` has escalated to it. The zoom then affects only how precisely a mark can be
 * *placed*, which is why the bar says so below `1:1` rather than quietly returning a worse number.
 *
 * The **scale is stated and never inferred** (`scan-measure.ts`), and its field sits in the bar
 * beside the result: prefilled from the collection, corrected here for this sitting, and never
 * written back — see `docs/agents/purchases-and-intake.md` for why that asymmetry is the point.
 * Nothing a measurement produces is stored anywhere.
 *
 * The **tooth count is read off the edge** when a perforation drag is released (#614,
 * `scan-perf-count.ts`), into a field that stays hand-editable and says when the figure is one this
 * app put there. See {@link TileZoomView}'s `teethSource` for why filling it is safe where
 * inferring the *scale* would not be.
 *
 * ## Reading a watermark (#625)
 *
 * The third tool is not a measurement at all — it is a **way of looking**. A watermark is a
 * thickness difference in the paper, so a reflective scan of the back very often *contains* it
 * without *showing* it: a weak, low-frequency luminance variation sitting under the paper grain.
 * `scan-watermark.ts` throws away what is louder than it at both ends of the scale and stretches
 * what is left, and `use-watermark-view.ts` decides when that runs and where the result is put.
 *
 * It shares the tools' one gate — a side with **no box** has no scan geometry, so the control is
 * absent there rather than approximate — and it shares their promise: nothing is stored, nothing is
 * written back, and the toggle changes only what is on screen. It is deliberately *not* a fourth
 * `MeasureTool`: it takes no marks, the plain drag stays the hand, and it composes with the ruler
 * rather than replacing it.
 */

/**
 * One picture the viewer draws. A tile's side is exactly {@link TileSideView}; a plain photo (#1290)
 * is the same shape with no box, no card behind it, and a `frame` — its upload's own pixels
 * (`photo-measure-frame.ts`) — standing where the box would. The frame is what a photo is measured
 * in, as the box is what a tile is: absent, and the measuring tools are absent too.
 */
export interface ZoomSide extends TileSideView {
  frame?: { width: number; height: number } | null;
}

interface Props {
  collectionId: string;
  /** Front, back, or a lone back — from `tileSideViews`, never assembled here — or one photo. */
  sides: ZoomSide[];
  /** What the picture is, for the words the viewer uses about it. A tile is the default. */
  subject?: "tile" | "photo";
  /**
   * The size on the bar, or null when there is not one (#1290) — the photo viewer's way of offering
   * it as the stamp's size, on `onGauge`'s terms: the viewer measures, and what a figure is for is
   * the caller's business. Always with the scale it was taken at.
   */
  onSize?: (reading: { size: StampSize; dpi: number } | null) => void;
  /** A snapshot was saved (#674) — for a screen that shows the photos it just gained. */
  onSnapshotSaved?: () => void;
  /** For the alt text, which is the only place a tile's position is named on this side of the
   * dialog. */
  position: number;
  /** What this collection scans at (#598) — the measuring bar's prefill, and the only scale in the
   * app. Passed down rather than fetched here: it is one integer the page already loaded, and a
   * viewer that read it for itself would be a second source for the one number that must not have
   * two. */
  scanDpi: number;
  /**
   * The gauge currently on the bar, or null when there is not one (#740).
   *
   * The viewer measures; it does not know what a measurement is *for*. Reporting the figure upward
   * lets the identification dialog compare it against the candidates' own perforations without the
   * comparison — or the candidate list, or anything about identification — reaching in here. Null
   * covers every way there is no reading: the tool is up, the marks are unplaced, the tooth count is
   * missing, the figure is not a perforation at all, and the viewer being unmounted.
   */
  onGauge?: (gauge: number | null) => void;
  /**
   * Stand the side on screen the right way up (#1006) — absent wherever the pictures are not this
   * tile's to turn: every step of the chain after the tile dialog, and a tile that has become a copy.
   * The viewer only asks; the turn is stored on the tile, the side is cut again, and what comes back
   * is a new photo drawn through the same sides this was given.
   */
  onTurn?: (side: TileSideView["side"], turn: QuarterTurn) => void;
  /** A turn is on its way — the controls wait for it rather than stacking a second on top. */
  turning?: boolean;
}

/**
 * The piece an identification chain is **about** (#592), carried through every dialog the chain
 * opens: the stamp picker, an issue or a stamp created from inside it, and the condition step.
 *
 * A record rather than a tile id, and that is the decision rather than a convenience. Which sides
 * exist and which still have a retained card behind them is `tileSideViews`' answer, computed once
 * where the batch's sheets are in hand (`purchase-scans-card.tsx`); handing the chain an id instead
 * would mean every dialog in it re-deriving that — including the swept-sheet case (#578), which is
 * exactly the one a second derivation would get wrong.
 *
 * There is **no `stampId` fallback in it and there must not be one**: this is a picture of *the*
 * piece in the tweezers, and a stamp's catalogue photo is a picture of *a* specimen. Standing one
 * in beside a condition field invites reading a condition off the wrong stamp, so intake with no
 * scan behind it carries no piece and shows nothing at all.
 */
export interface IdentifiedPiece {
  tileId: string;
  sides: TileSideView[];
  position: number;
}

/**
 * The pieces as a dialog's `aside` (`DialogShell.aside`) — one call site's worth of wrapping, so
 * that every dialog in the chain shows the same thing rather than its own arrangement of it. Null
 * when there is no picture at all, which is what keeps the aside absent rather than empty.
 *
 * **One piece is the viewer; several are all of them, small** (#596). With a run of tiles ticked
 * there is no single piece the step is about, and answering "show the first one" would be the app
 * picking one photograph to stand for fifteen pieces of paper. Ticking them was the collector
 * *asserting* they are the same stamp in the same condition, and seeing them side by side is how a
 * mistake in that assertion is caught — before it becomes fifteen copies rather than after. The app
 * never checks the assertion itself and never offers to find duplicates: telling two shades or two
 * perforations apart is the work being done here.
 *
 * Any one of them can still be looked at properly — clicking a thumbnail opens #585's viewer on it,
 * with the way back to the grid — because the doubt a grid raises is answered by a loupe, and there
 * is already one.
 *
 * The loupe **steps along the run** (‹ / ›, ← / →, with `n / N` between them): the comparison this
 * panel exists for is made by flicking from one piece to the next at the same magnification, and
 * grid → click → grid → click turns that into three acts per pair. It does not wrap, and the
 * buttons say so by going dead at the ends — on a card of fifteen near-identical stamps a step
 * that quietly landed back on the first would read as "still going".
 */
/** The one shape the opened piece's header buttons share — back, previous and next are the same
 * control at three widths, so a single object keeps them from drifting apart. */
const PIECE_NAV_BTN: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  font: "inherit",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

export function IdentifiedPieceAside({
  collectionId,
  pieces,
  scanDpi,
  onGauge,
  onTurn,
  turning,
  runOrder,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
  /** The collection's stated scan resolution (#598), carried to whichever viewer this resolves to. */
  scanDpi: number;
  /** The gauge the open viewer is reading, passed straight through (#740). A run showing the grid
   * has no viewer and so no reading — which is right: the pieces were ticked as one stamp, but a
   * perforation is measured on **one** of them, and there is no run-wide answer to report. Opening
   * the loupe on a piece starts one; going back to the grid ends it. */
  onGauge?: (gauge: number | null) => void;
  /** Turning a piece's side (#1006), for whichever viewer is open — only the tile dialog passes it,
   * and only for tiles whose pictures are still their own. */
  onTurn?: (tileId: string, side: TileSideView["side"], turn: QuarterTurn) => void;
  turning?: boolean;
  /** The pieces are a run about to take one issue's stamps in turn (#1220), in the order they were
   * ticked — so the grid says that rather than *one stamp*, and numbers each by its turn. */
  runOrder?: boolean;
}) {
  const shown = pieces.filter((p) => p.sides.length > 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const openedIndex = shown.findIndex((p) => p.tileId === openId);
  const opened = openedIndex === -1 ? null : shown[openedIndex];

  // ‹ / › and the arrow keys, while one piece is open. Stepping *is* the comparison this panel
  // exists for — a run is told apart by flicking between two pieces at the same zoom, and going
  // back out to the grid to click the neighbour breaks that into three acts. Not while a field has
  // focus: the steps in front of this panel are forms, and ← / → are cursor keys inside them.
  useEffect(() => {
    if (openedIndex === -1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable))
        return;
      const next = openedIndex + (e.key === "ArrowRight" ? 1 : -1);
      // Deliberately no wrap-around, matching the disabled buttons: the last piece of the run is a
      // fact worth feeling, and a step that silently lands back on the first would be read as
      // "still going" on a card of fifteen near-identical stamps.
      if (next < 0 || next >= shown.length) return;
      e.preventDefault();
      setOpenId(shown[next].tileId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openedIndex, shown]);

  if (shown.length === 0) return null;
  if (shown.length === 1) {
    return (
      <TileZoomView
        collectionId={collectionId}
        sides={shown[0].sides}
        position={shown[0].position}
        scanDpi={scanDpi}
        onGauge={onGauge}
        onTurn={onTurn ? (side, turn) => onTurn(shown[0].tileId, side, turn) : undefined}
        turning={turning}
      />
    );
  }
  if (opened) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginBottom: "0.5rem",
          }}
        >
          <button type="button" onClick={() => setOpenId(null)} style={PIECE_NAV_BTN}>
            ← All {shown.length} pieces
          </button>
          <span style={{ flex: 1 }} />
          <Tooltip content="Previous piece (←)">
            <button
              type="button"
              onClick={() => setOpenId(shown[openedIndex - 1].tileId)}
              disabled={openedIndex === 0}
              aria-label="Previous piece"
              style={{
                ...PIECE_NAV_BTN,
                padding: "0.25rem 0.375rem",
                cursor: openedIndex === 0 ? "default" : "pointer",
                opacity: openedIndex === 0 ? 0.45 : 1,
              }}
            >
              <Icon name="previous" size="sm" />
            </button>
          </Tooltip>
          <span
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {openedIndex + 1} / {shown.length}
          </span>
          <Tooltip content="Next piece (→)">
            <button
              type="button"
              onClick={() => setOpenId(shown[openedIndex + 1].tileId)}
              disabled={openedIndex === shown.length - 1}
              aria-label="Next piece"
              style={{
                ...PIECE_NAV_BTN,
                padding: "0.25rem 0.375rem",
                cursor: openedIndex === shown.length - 1 ? "default" : "pointer",
                opacity: openedIndex === shown.length - 1 ? 0.45 : 1,
              }}
            >
              <Icon name="next" size="sm" />
            </button>
          </Tooltip>
        </div>
        <TileZoomView
          // Remounted per piece, so the viewer opens fitted to the tile that was clicked rather than
          // carrying the previous one's zoom onto a differently sized crop.
          key={opened.tileId}
          collectionId={collectionId}
          sides={opened.sides}
          position={opened.position}
          scanDpi={scanDpi}
          onGauge={onGauge}
          onTurn={onTurn ? (side, turn) => onTurn(opened.tileId, side, turn) : undefined}
          turning={turning}
        />
      </div>
    );
  }
  return (
    <IdentifiedPieceGrid
      collectionId={collectionId}
      pieces={shown}
      runOrder={runOrder}
      onOpen={setOpenId}
    />
  );
}

/**
 * Every ticked piece at once (#596).
 *
 * The **front** of each, at the size that lets a run be compared rather than merely counted, in the
 * order the card is laid out in and labelled with the tile's own position — the strip is a map of
 * the card on the desk, and the panel beside the form has to be readable against it.
 */
function IdentifiedPieceGrid({
  collectionId,
  pieces,
  runOrder,
  onOpen,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
  runOrder?: boolean;
  onOpen: (tileId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <p
        style={{
          margin: "0 0 0.625rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
        }}
      >
        {runOrder ? (
          <>
            <strong>{pieces.length} pieces</strong>, in the order you ticked them — they take the
            issue&rsquo;s stamps in turn. Click one to look at it closely.
          </>
        ) : (
          <>
            <strong>{pieces.length} pieces</strong>, being identified as one stamp. Check them
            against each other before you confirm — click one to look at it closely.
          </>
        )}
      </p>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(7.5rem, 1fr))",
          gap: "0.5rem",
          alignContent: "start",
        }}
      >
        {pieces.map((piece, turn) => {
          const front = piece.sides.find((s) => s.side === "front") ?? piece.sides[0];
          return (
            <ThumbPreview
              key={piece.tileId}
              src={`/api/collections/${collectionId}/photos/${front.photoId}/full`}
              thumbSrc={`/api/collections/${collectionId}/photos/${front.photoId}/thumb`}
              label={`Tile ${piece.position + 1} — click to look at it closely`}
              style={{ display: "block" }}
            >
            <button
              type="button"
              onClick={() => onOpen(piece.tileId)}
              style={{
                display: "block",
                padding: "0.25rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                background: "var(--color-bg-page)",
                font: "inherit",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              {/* The **thumb**, which is the strip's own derivative and so usually already in
                  cache: a grid of fifteen full crops of a 1200 dpi card would be tens of megabytes
                  fetched to be drawn two inches wide. At 320 px against a ~7.5 rem cell it is
                  oversampled either way, and the piece that raises a doubt is one click from the
                  full-resolution viewer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/collections/${collectionId}/photos/${front.photoId}/thumb`}
                alt={`Tile ${piece.position + 1}, ${front.label.toLowerCase()}`}
                draggable={false}
                style={{
                  display: "block",
                  width: "100%",
                  aspectRatio: "1",
                  objectFit: "contain",
                }}
              />
              <span style={{ fontSize: "0.6875rem" }}>
                {runOrder ? `#${turn + 1} · tile ${piece.position + 1}` : piece.position + 1}
              </span>
            </button>
            </ThumbPreview>
          );
        })}
      </div>
    </div>
  );
}

/** Which measuring tool is down, if any (#598). Three, because they are three questions: a distance
 * is a distance, a perforation is that distance divided into teeth, and a size is two distances
 * taken at right angles in one act. The gauge is arithmetic over the ruler rather than a second
 * measurement, which is also how a physical odontometer works — so nothing new has to be learned to
 * read one.
 *
 * The size tool (#763) is the ruler with a second axis rather than a rectangle-drawing tool: the
 * same drag, the same two marks in scan pixels, read as opposite corners instead of as the ends of
 * a line. One act rather than *now the width, now the height*, because two separate readings are
 * two chances to measure two different stamps and nothing would notice. */
type MeasureTool = "off" | "ruler" | "perforation" | "size" | AnnotationKind;

/** The tools that draw a mark rather than take a measurement (#674, #1300): a ring, a line, a ruler
 * mark and a note. They leave their mark on the picture — kept only in a snapshot. A ring and a line
 * need no scale and no scan geometry; a note is placed by a click rather than a drag. */
function isAnnotationTool(tool: MeasureTool): tool is AnnotationKind {
  return tool === "ellipse" || tool === "line" || tool === "rulerMark" || tool === "text";
}

/** The tools whose result is a length (#598, #1300) — the ruler mark is one of them, so it follows the
 * ruler's rule: absent where the picture's scale cannot be stated. */
function needsScale(tool: MeasureTool): boolean {
  return tool === "ruler" || tool === "perforation" || tool === "size" || tool === "rulerMark";
}

/** A note being typed or edited (#1300): a new one where the picture was clicked (`index` null), or the
 * note at `index` opened again. A new note takes the settings as they stand when it is kept; a note
 * opened again keeps its own style (#1342). */
interface TextEdit {
  index: number | null;
  at: ScanPoint;
  text: string;
}

/**
 * What the measuring bar says right now (#598) — the figure, or the reason there is not one.
 *
 * A plain function of its inputs so the wording is in one place and the rules it encodes are read
 * together. Two of them are the ones the issue turns on:
 *
 * - **No figure without a scale.** An unparseable resolution produces a sentence asking for one,
 *   never a reading against a fallback. A number taken at a scale nobody stated is exactly the
 *   thing that gets written down as a variant's defining feature and is wrong.
 * - **A figure never appears without the scale it was taken at.** Both `text` values below come
 *   from `formatMillimetresAt` / `formatGaugeAt`, which cannot render one without the other.
 *
 * A gauge outside what perforations actually occupy is reported as a mistake rather than quoted: at
 * that point the marks or the tooth count are wrong, and "47.32" said confidently is worse than
 * saying so.
 */
function describeReading(args: {
  tool: MeasureTool;
  marks: { a: ScanPoint; b: ScanPoint } | null;
  dpi: number | null;
  teeth: number | null;
  /** What the picture is called — *tile* or *photo*. */
  noun: string;
}): { text: string; muted: boolean; detail?: string; gauge?: number; size?: StampSize } {
  const { tool, marks, dpi, teeth, noun } = args;
  if (tool === "off") return { text: "", muted: true };
  // The marks say nothing numeric, so they need no scale and are not refused for the lack of one.
  if (tool === "ellipse") return { text: "Drag across a detail to ring it.", muted: true };
  if (tool === "line") return { text: "Drag to draw a line for reference.", muted: true };
  if (tool === "text") {
    return { text: "Click where the note goes and type — click a note to edit it.", muted: true };
  }
  if (dpi === null) {
    return {
      text: "State the resolution you scan at — a measurement is only as good as it.",
      muted: true,
    };
  }
  if (!marks) {
    return {
      text:
        tool === "ruler"
          ? `Drag across the ${noun} to measure it.`
          : tool === "rulerMark"
            ? "Drag along what to measure — the line stays on the picture with its graduations."
          : tool === "size"
            ? "Drag a box around the stamp, corner to corner."
            : "Drag from the first hole of a run to the last.",
      muted: true,
    };
  }
  const { px, mm } = measureDistance(marks.a, marks.b, dpi);
  if (px <= 0) {
    return { text: "One mark placed — drag to the second.", muted: true };
  }
  if (tool === "size") {
    // The two marks read as opposite corners. A box with no width or no height is a line, and a
    // line is the ruler's answer rather than a size of `0 × 25.4 mm` — so it is the prompt again.
    const w = Math.abs(marks.b.x - marks.a.x);
    const h = Math.abs(marks.b.y - marks.a.y);
    const size = sizeFromScanPixels({ w, h }, dpi, MM_PER_INCH);
    if (!size) {
      return { text: "Drag a box around the stamp, corner to corner.", muted: true };
    }
    return {
      text: `${formatStampSize(size)} at ${dpi} dpi`,
      // Out beside the sentence, on `gauge`'s rule (#740): the one place that decided a reading is
      // real is the one place that hands it on, so nothing downstream can offer a figure this
      // function refused to state.
      size,
      muted: false,
      detail: `${Math.round(w)} × ${Math.round(h)} scan px`,
    };
  }
  if (tool === "ruler" || tool === "rulerMark") {
    return {
      text: `${formatMillimetres(mm)} mm at ${dpi} dpi`,
      muted: false,
      detail: `${Math.round(px)} scan px`,
    };
  }
  if (teeth === null) {
    return { text: "How many teeth lie between the two marks?", muted: true };
  }
  const gauge = perforationGauge(mm, teeth);
  if (gauge === null || !isPlausibleGauge(gauge)) {
    return {
      text: "That is not a perforation — check the marks and the tooth count.",
      muted: true,
      detail: `${formatMillimetres(mm)} mm, ${teeth} teeth`,
    };
  }
  return {
    text: `Perf ${formatGaugeAt(gauge, dpi)}`,
    // The figure itself rides out beside the sentence (#740), so the one place that decided a
    // reading is real is also the one place that hands it to whatever compares it. A caller cannot
    // arrive at a gauge this function called a mistake.
    gauge,
    muted: false,
    detail: `${formatMillimetres(mm)} mm over ${teeth} teeth`,
  };
}

/**
 * Where the tooth count in the field came from (#614), and — when it came from nowhere — what
 * stopped it.
 *
 * Every failure is named. An attempt that gives up quietly is indistinguishable from a feature that
 * is not wired up, which is worse than either: the collector has no way to tell *mark a longer run*
 * from *this is not a perforation* from *something is broken*, and so learns to ignore the tool.
 */
type TeethSource =
  /** Typed by hand — the resting state, and what typing over a count returns to. */
  | "typed"
  /** Read off the edge between the marks. */
  | "counted"
  /** The picture is being fetched and decoded — one fetch per tile side, so this is brief, but a
   * count that takes a moment must not look like one that did nothing. */
  | "counting"
  /** The run is too short to carry a countable number of cycles. */
  | "short"
  /** Read, but carrying no period worth a number — not a perforation, or too ragged to be one. */
  | "weak"
  /** The pixels could not be got at all: the photo is not loaded, or the canvas will not be read. */
  | "no-picture";

/** What the bar says for each, beside the field. Absent for the two that need no sentence. */
const TEETH_SOURCE_NOTE: Partial<Record<TeethSource, string>> = {
  counting: "counting…",
  short: "too short to count — mark a longer run, or type it",
  weak: "couldn't find a perforation here — check the marks, or type it",
  "no-picture": "couldn't read the picture — type it",
};

/** What the watermark bar says while the chain is between states. Absent for the two that need no
 * sentence — off, and a crop on screen. */
const WATERMARK_STATUS_NOTE: Partial<Record<WatermarkStatus, string>> = {
  working: "processing…",
  "no-picture": "couldn't read the picture",
};

/** The natural size of a loaded photo, in its own pixels. Measured rather than stored: it is the
 * width of the derivative actually on screen, which is what decides whether the retained scan has
 * anything more to offer — and the browser knows it exactly. */
interface Natural {
  width: number;
  height: number;
}

export function TileZoomView({
  collectionId,
  sides,
  position,
  scanDpi,
  onGauge,
  onTurn,
  turning,
  subject = "tile",
  onSize,
  onSnapshotSaved,
}: Props) {
  const noun = subject === "photo" ? "photo" : "tile";
  const [sideKey, setSideKey] = useState(() => sides[0]?.side ?? "front");
  const current = sides.find((s) => s.side === sideKey) ?? sides[0];
  const [natural, setNatural] = useState<Record<string, Natural>>({});

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 });
  /** Whether the view is still the fitted one — what keeps **Fit** lit, and what tells a resize or a
   * flip whether to re-fit or to leave a chosen zoom alone. Held as a ref beside the state because
   * the resize observer fires outside React's render. */
  const [fitted, setFitted] = useState(true);
  const fittedRef = useRef(true);
  const [panning, setPanning] = useState(false);

  const measured = current ? natural[current.photoId] : undefined;
  /** How far the side on screen is turned from its box (#1006). The photo is already cut turned, so
   * nothing is rotated here; the turn is only how the picture finds its way back to the card. */
  const turn = current?.turn ?? 0;
  /** The picture in **scan** pixels: the tile's box on the card — turned, since the picture is — or,
   * for a tile carrying no box, the photo's own size, which is then all there is to know about it.
   *
   * Everything this view measures is taken in this frame, the one the collector sees. A length does
   * not care which way round it was taken, and a size taken on a piece stood the right way up is its
   * width and height rather than the other way about — which is the point of standing it up. */
  const drawnBox = current?.box
    ? turnedSize({ width: current.box.w, height: current.box.h }, turn)
    : // A photo's frame (#1290): its upload's own pixels, which is to a photo what the box is to a
      // tile — the size the stated scale applies to, whatever derivative is on screen.
      (current?.frame ?? null);
  const pictureWidth = drawnBox?.width ?? measured?.width ?? 0;
  const pictureHeight = drawnBox?.height ?? measured?.height ?? 0;
  const ready = pictureWidth > 0 && pictureHeight > 0 && size.width > 0;

  /**
   * Whether this side can be measured at all (#598) — **only with a box**.
   *
   * With one, the picture's size is stated in the card's own scan pixels, so a mark converts to
   * millimetres against the stated resolution and the answer is right whatever derivative happens
   * to be drawn. Without one the fallback above is the *photo's* size, and a photo has been through
   * `FULL_MAX_EDGE`: it may be the scan, or it may be a downscale of it by an unknown factor, and
   * nothing on this side can tell which. Measuring there would silently take a reading at a
   * resolution the app merely assumed, which is the one thing this tool must never do — so the
   * controls are absent rather than approximate.
   */
  const canMeasure = drawnBox !== null;

  const markFitted = useCallback((value: boolean) => {
    fittedRef.current = value;
    setFitted(value);
  }, []);

  // Measure the viewport, and fit inside it. One observer covers the dialog being resized with the
  // window and the later observations; the **first** measurement is taken here, synchronously,
  // because the observer's first callback only arrives after a paint has already happened — and a
  // viewer with no measured viewport draws the picture at 100% of the panel, which is the flash of
  // an over-sized stamp seen when stepping from one piece to the next remounts this view.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    }
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      setSize(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit is the default; a chosen zoom is only re-clamped. This runs on the picture changing as well
  // as on the viewport changing, which is what carries a zoom across the front/back flip: the two
  // crops differ by a few pixels of card, so re-clamping is the whole of the adjustment.
  // A layout effect, so the fit lands in the same commit as the measurement above rather than a
  // painted frame later.
  useLayoutEffect(() => {
    if (!ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    setView((v) =>
      fittedRef.current
        ? fitViewport(picture, size)
        : clampOffsets({ ...v, scale: clampScale(v.scale, picture, size) }, picture, size)
    );
  }, [pictureWidth, pictureHeight, ready, size]);

  const zoomStep = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      if (!ready) return;
      const picture = { width: pictureWidth, height: pictureHeight };
      setView((v) =>
        zoomBy(v, factor, anchor ?? { x: size.width / 2, y: size.height / 2 }, picture, size)
      );
      markFitted(false);
    },
    [markFitted, pictureHeight, pictureWidth, ready, size]
  );

  const fit = useCallback(() => {
    if (!ready) return;
    setView(fitViewport({ width: pictureWidth, height: pictureHeight }, size));
    markFitted(true);
  }, [markFitted, pictureHeight, pictureWidth, ready, size]);

  const actualSize = useCallback(() => {
    if (!ready) return;
    setView(actualSizeViewport({ width: pictureWidth, height: pictureHeight }, size));
    markFitted(false);
  }, [markFitted, pictureHeight, pictureWidth, ready, size]);

  // Bound by hand rather than through `onWheel`: React's is passive, and a passive listener cannot
  // call `preventDefault` — the dialog would scroll under the zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => zoomBy(v, Math.pow(ZOOM_STEP, -delta / 100), anchor, picture, size));
      markFitted(false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [markFitted, pictureHeight, pictureWidth, ready, size]);

  // The same keys as the editor, so the two surfaces are one habit. Not while a field has focus —
  // the settled tile's note is a textarea, and `-` is a character in it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomStep(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomStep(1 / ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomStep]);

  // ── Measuring (#598) ────────────────────────────────────────────────────────────────────────

  /** Off, or one of the two tools. Off is the resting state and stays it: the viewer's plain drag
   * is the hand, and a surface that started out measuring would make every look-at-a-stamp begin
   * by putting a tool down. */
  const [chosenTool, setChosenTool] = useState<MeasureTool>("off");
  /** …and what is actually down. Derived rather than corrected after the fact: a side with no box
   * cannot be measured at all, and forcing the choice back to `off` from an effect would let one
   * render happen with a tool down over a side that has no scan geometry. */
  const tool: MeasureTool = canMeasure || !needsScale(chosenTool) ? chosenTool : "off";
  /** A tool that takes a drag is down — a measurement or a mark. */
  const measuring = tool !== "off";
  const annotating = isAnnotationTool(tool);

  /** The two marks, in the picture's own **scan** pixels — the coordinate space every number here
   * is taken in, and the reason a reading does not change when the zoom does. */
  const [marks, setMarks] = useState<{ a: ScanPoint; b: ScanPoint } | null>(null);
  /** The picture the marks were placed on. A turn (#1006) hands this view a **new** photo in a new
   * frame, where the old marks would lie across somewhere else — so they go, adjusted while rendering
   * rather than in an effect, which would draw them over the turned picture for a frame first. */
  const [marksOn, setMarksOn] = useState<string | null>(current?.photoId ?? null);
  /** The marks drawn so far (#674, #1300), in the same scan pixels as the measuring marks, with every
   * change to them kept for **Undo**. They stay until cleared — a detail is usually ringed and then
   * given a line or a note beside it — and they belong to the picture they were drawn on, so they go
   * with it exactly as the measuring marks do. */
  const [history, setHistory] = useState<MarksHistory>(NO_MARKS);
  const annotations = history.marks;
  /** A note being typed (#1300). Held in a ref beside the state: it is finished from a blur, a key and a
   * click, which can arrive in one turn, and only the first of them may keep it. */
  const [editing, setEditing] = useState<TextEdit | null>(null);
  const editingRef = useRef<TextEdit | null>(null);
  /** The mark selected by a click (#1342), whose style the settings then change — that mark only.
   * An index into the marks, so anything that reorders or replaces them lets it go. */
  const [selected, setSelected] = useState<number | null>(null);
  if (marksOn !== (current?.photoId ?? null)) {
    setMarksOn(current?.photoId ?? null);
    setMarks(null);
    setHistory(NO_MARKS);
    setEditing(null);
    setSelected(null);
  }
  // …and the note's ref with it, once the new picture is in: a blur arriving from the old picture's
  // field must find nothing to keep.
  const photoOnScreen = current?.photoId ?? null;
  useEffect(() => {
    editingRef.current = null;
  }, [photoOnScreen]);

  /** How the next mark is drawn (#1300, #1342), remembered for the next sitting. A mark already drawn
   * keeps the style it was drawn in. */
  const [annotationStyle, setAnnotationStyle] = useAnnotationStyle();

  const editNote = useCallback((next: TextEdit | null) => {
    editingRef.current = next;
    setEditing(next);
    // A note opened for typing is the one the settings act on; nothing else stays selected beside it.
    if (next) setSelected(null);
  }, []);

  /** Finish the note being typed: keep it (an emptied note is removed), or drop the edit. */
  const finishNote = useCallback(
    (keep: boolean) => {
      const edit = editingRef.current;
      if (!edit) return;
      editNote(null);
      if (!keep) return;
      const text = edit.text.trim().slice(0, MAX_TEXT_MARK);
      setHistory((h) => {
        if (edit.index === null) {
          return text
            ? changeMarks(h, [...h.marks, { kind: "text", at: edit.at, text, style: annotationStyle }])
            : h;
        }
        const note = h.marks[edit.index];
        if (!note || note.kind !== "text" || note.text === text) return h;
        return changeMarks(
          h,
          text
            ? h.marks.map((m, i) => (i === edit.index ? { ...note, text } : m))
            : h.marks.filter((_, i) => i !== edit.index)
        );
      });
    },
    [annotationStyle, editNote]
  );

  /** The stated scale, as typed. Prefilled from the collection and **never written back**: a card
   * scanned at 600 measured once is a fact about that card, not a new assumption for every later
   * measurement. Changing what the collection assumes is a Settings act. */
  const [dpiText, setDpiText] = useState(String(scanDpi));
  const dpi = parseScanDpi(dpiText);

  /**
   * How many teeth lie **between the marks** — the field, and where the figure in it came from.
   *
   * #598 asked for it and counted nothing, on the grounds that a detector's failures would be
   * *plausible numbers*. #614 counts it anyway, and what answers that objection is not a better
   * detector but **where the number lands**: in a field already under the collector's eye, next to
   * a gauge recomputed live, marked as counted rather than typed, and a keystroke from being
   * corrected. A wrong 13 beside a picture of twelve teeth is visible; a wrong gauge inside a
   * catalogue note is not.
   *
   * The field stays the authority. Counting fills it, typing takes it back, and nothing downstream
   * knows or cares which happened.
   */
  const [teethText, setTeethText] = useState("10");
  const [teethSource, setTeethSource] = useState<TeethSource>("typed");
  const teeth = parseToothCount(teethText);

  /** Space is the hand tool while a measuring tool is down, exactly as in the cut editor — one
   * habit across both scan surfaces rather than two. */
  const [spaceHeld, setSpaceHeld] = useState(false);

  /** Show a side. A mark belongs to the side it was placed on — the front and the back are
   * different pieces of card, so carrying a line across the flip would draw a measurement of
   * somewhere else over a picture of somewhere else. The zoom is kept, deliberately (#585); only
   * the marks are not. */
  const showSide = useCallback(
    (side: TileSideView["side"]) => {
      setSideKey(side);
      setMarks(null);
      setHistory(NO_MARKS);
      editNote(null);
      setSelected(null);
    },
    [editNote]
  );

  /** Put a tool down, or take it up again. A note being typed is kept first — reaching for the next
   * tool is how a note is usually finished. */
  const chooseTool = (next: MeasureTool) => {
    finishNote(true);
    setChosenTool((t) => (t === next ? "off" : next));
    setMarks(null);
    setSelected(null);
  };

  useEffect(() => {
    if (!measuring) return;
    const down = (e: KeyboardEvent) => {
      // A space typed into a note is a space, not the hand.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === " ") setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [measuring]);

  // Escape clears the line, and then puts the tool down — before it reaches the dialog. The layer
  // is pushed when the tool comes out, which is after the dialog registered its own, so this is the
  // topmost layer exactly while there is something here to dismiss (`escape-stack.ts`). A collector
  // three marks into a perforation run who presses Escape means "not like that", not "close
  // everything", which is the same judgement #597 made for the note.
  useEscapeLayer(() => {
    if (marks) {
      setMarks(null);
      return;
    }
    setChosenTool("off");
  }, measuring);
  // A note being typed is the topmost thing of all: Escape drops the edit, and the tool stays down.
  useEscapeLayer(() => finishNote(false), editing !== null);
  // A selected mark is let go of first, before the line or the tool (#1342).
  useEscapeLayer(() => setSelected(null), selected !== null);

  /** A viewport point as a mark, clamped to the picture: a drag that leaves the tile would
   * otherwise measure to a point of card that is not on it. */
  const markAt = useCallback(
    (clientX: number, clientY: number): ScanPoint | null => {
      const el = viewportRef.current;
      if (!el || !ready) return null;
      const rect = el.getBoundingClientRect();
      const p = toSheetPoint(view, clientX - rect.left, clientY - rect.top);
      return {
        x: Math.min(Math.max(p.x, 0), pictureWidth),
        y: Math.min(Math.max(p.y, 0), pictureHeight),
      };
    },
    [pictureHeight, pictureWidth, ready, view]
  );

  /**
   * Count the teeth between two marks off the picture itself (#614), and fill the field.
   *
   * **The pixels come from the tile's own photo, and that is safe here for a reason that does not
   * generalise.** For an ordinary single stamp the photo *is* the scan; for an oversized tile it is
   * a downscale by a factor nothing states. A count is a *frequency* and survives that — an unknown
   * scale factor cannot change how many teeth lie between two marks — while the millimetres are an
   * *absolute* and do not, which is why the length keeps coming from the marks in scan pixels
   * against the stated resolution (#598) and never from here. Two numbers, two sources, on purpose.
   *
   * Nothing is drawn from this and the marks are never moved: a count that nudged the line would
   * also move the length it is dividing, which is the one thing the collector placed by hand.
   */
  /** The decoded picture the count reads, kept per photo so pressing **Count** again — or measuring
   * a second run on the same side — does not fetch and decode it a second time. */
  const bitmapRef = useRef<{ photoId: string; bitmap: ImageBitmap } | null>(null);
  useEffect(() => {
    return () => {
      bitmapRef.current?.bitmap.close();
      bitmapRef.current = null;
    };
  }, []);

  const photoId = current?.photoId ?? null;

  /**
   * The picture's pixels, **fetched from this origin** rather than taken off the `<img>` on screen.
   *
   * That indirection is the whole of #614's one real deployment problem. On the redirecting storage
   * backend the photo route answers with a 302 to a signed URL on the storage provider's origin —
   * which is exactly what it is for, and which also means the `<img>` holds a cross-origin picture
   * and **taints any canvas it is drawn into**. `getImageData` then throws, on every count, on
   * every tile, and only on deployments using that backend. So the count asks the route for the
   * proxied copy (`?inline=1`) and decodes that. One fetch per tile side, cached here, against a
   * response the browser will serve from its own cache anyway.
   */
  const loadPixels = useCallback(async (): Promise<ImageBitmap | null> => {
    if (!photoId) return null;
    const held = bitmapRef.current;
    if (held?.photoId === photoId) return held.bitmap;
    try {
      const res = await fetch(
        `/api/collections/${collectionId}/photos/${photoId}/full?inline=1`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return null;
      const bitmap = await createImageBitmap(await res.blob());
      bitmapRef.current?.bitmap.close();
      bitmapRef.current = { photoId, bitmap };
      return bitmap;
    } catch {
      return null;
    }
  }, [collectionId, photoId]);

  /**
   * Count the teeth between two marks off the picture itself (#614), and fill the field.
   *
   * **The pixels come from the tile's own photo, and that is safe here for a reason that does not
   * generalise.** For an ordinary single stamp the photo *is* the scan; for an oversized tile it is
   * a downscale by a factor nothing states. A count is a *frequency* and survives that — an unknown
   * scale factor cannot change how many teeth lie between two marks — while the millimetres are an
   * *absolute* and do not, which is why the length keeps coming from the marks in scan pixels
   * against the stated resolution (#598) and never from here. Two numbers, two sources, on purpose.
   * It is also why the retained original is not fetched for this: it would buy precision the count
   * does not spend.
   *
   * Nothing is drawn from this and the marks are never moved: a count that nudged the line would
   * also move the length it is dividing, which is the one thing the collector placed by hand.
   */
  const countTeeth = useCallback(
    async (m: { a: ScanPoint; b: ScanPoint }) => {
      if (pictureWidth <= 0) {
        setTeethSource("no-picture");
        return;
      }
      setTeethSource("counting");
      const picture = await loadPixels();
      if (!picture || !picture.width) {
        setTeethSource("no-picture");
        return;
      }

      // Scan pixels → this photo's own pixels. One ratio: the crop is the same rectangle either
      // way, so the photo is the picture at some scale and never a different framing of it.
      const ratio = picture.width / pictureWidth;
      const a = { x: m.a.x * ratio, y: m.a.y * ratio };
      const b = { x: m.b.x * ratio, y: m.b.y * ratio };

      // Only the strip the marks cross, grown by enough for the perpendicular offsets to have
      // somewhere to sit. Decoding the whole photo to read one line would cost megabytes per drag.
      const pad = 16;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
      const x1 = Math.min(picture.width, Math.ceil(Math.max(a.x, b.x) + pad));
      const y1 = Math.min(picture.height, Math.ceil(Math.max(a.y, b.y) + pad));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 2 || h < 2) {
        setTeethSource("short");
        return;
      }

      let pixels: Pixels;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setTeethSource("no-picture");
          return;
        }
        ctx.drawImage(picture, x0, y0, w, h, 0, 0, w, h);
        pixels = ctx.getImageData(0, 0, w, h);
      } catch {
        // Said rather than swallowed: silence here is indistinguishable from the feature not being
        // wired up at all, which is exactly the confusion that made every one of these worth
        // stating.
        setTeethSource("no-picture");
        return;
      }

      const found = countTeethBetweenMarks({
        image: pixels,
        a: { x: a.x - x0, y: a.y - y0 },
        b: { x: b.x - x0, y: b.y - y0 },
        // The stated scale bounds the candidates to counts a perforation could actually be — the
        // scale earning its keep a second time. Null when none has been stated, which widens the
        // search rather than stopping it.
        runLengthMm: dpi === null ? null : measureDistance(m.a, m.b, dpi).mm,
      });

      if (!found.ok) {
        setTeethSource(found.reason);
        return;
      }
      setTeethText(String(found.teeth));
      setTeethSource("counted");
    },
    [dpi, loadPixels, pictureWidth]
  );

  // ── Reading a watermark (#625) ──────────────────────────────────────────────────────────────

  /**
   * Whether the visible region is being redrawn through the watermark chain, and the two controls
   * that steer it.
   *
   * Chosen and effective are kept apart exactly as the measuring tool is: a side with no box has no
   * scan geometry, and correcting the choice from an effect would let one render happen with the
   * filter down over a side that cannot support it.
   *
   * **Two controls and no more**, which is #625's scope and worth holding to. The channel is a
   * control because which one carries the thickness contrast depends on the paper — blue usually
   * wins on cream and toned stock, which is most philatelic paper, but not always. The strength is a
   * control because the honest output sits between *too flat to read* and *grain, confidently
   * displayed*, and where that line falls depends on the scan. Everything else — the band, the
   * grain radius, the tile size — is fixed in `scan-watermark.ts` against the paper's own scale,
   * where a collector has no way to judge a number and every value that helps is inside the window
   * already chosen.
   */
  const [chosenWatermark, setChosenWatermark] = useState(false);
  const [watermarkChannel, setWatermarkChannel] =
    useState<WatermarkChannel>(DEFAULT_WATERMARK_CHANNEL);
  const [watermarkStrength, setWatermarkStrength] = useState(DEFAULT_WATERMARK_STRENGTH);
  const watermarkOn = canMeasure && chosenWatermark;

  // Escape puts the filter away, and it is the topmost layer while it is down — so the order over a
  // marked-up tile is: the watermark, then the marks, then the tool. Each press undoes one thing,
  // which is the rule the measuring tools already follow (`escape-stack.ts`).
  useEscapeLayer(() => setChosenWatermark(false), watermarkOn);

  const {
    render: watermarkCrop,
    status: watermarkStatus,
    paint: paintWatermark,
  } = useWatermarkView({
    enabled: watermarkOn,
    // The same decoded photo the tooth count reads, fetched once per tile side — see `loadPixels`
    // for why it comes from the route rather than off the `<img>`.
    loadPixels,
    photoId,
    pictureWidth,
    pictureHeight,
    view,
    size,
    // The stated resolution again (#598), doing a different job: not converting a length into a
    // fact, but keeping the filter's band on the millimetre scale a watermark occupies whatever the
    // scan's density. A wrong figure here costs a picture filtered slightly off-band, which the
    // strength control absorbs — so this falls back rather than refusing the way a reading does.
    scanPixelsPerMm: dpi === null ? null : dpi / MM_PER_INCH,
    channel: watermarkChannel,
    strength: watermarkStrength,
  });

  const pan = useRef<{ x: number; y: number } | null>(null);
  const marking = useRef(false);
  /** Where the primary button went down, to tell a click — which selects a mark (#1342) — from a drag,
   * which draws one or moves the picture. */
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  /** The line as the pointer left it. A ref beside the state because the count runs on pointer-up
   * and wants the mark the drag actually finished on, not the one the last render happened to
   * have. */
  const markedRef = useRef<{ a: ScanPoint; b: ScanPoint } | null>(null);
  /** Whether the plain drag is the hand. It is, unless a measuring tool is down and space is not
   * held — the cut editor's rule, for the same reason: panning has to keep working in every mode,
   * because the thing being marked is usually not the thing currently on screen. */
  const handDrag = !measuring || spaceHeld;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready) return;
    // A click away from a note being typed keeps it, and does nothing else: a second click places
    // the next one. Doing both in one would read the marks before the kept note is among them.
    if (editingRef.current) {
      finishNote(true);
      return;
    }
    pressedAt.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (e.button === 0 && !handDrag && tool === "text") {
      const at = markAt(e.clientX, e.clientY);
      if (!at) return;
      const hit = textMarkAt(annotations, at, view.scale);
      const note = hit === null ? null : annotations[hit];
      editNote(
        note && note.kind === "text"
          ? { index: hit, at: note.at, text: note.text }
          : { index: null, at, text: "" }
      );
      return;
    }
    if (e.button === 0 && !handDrag) {
      const at = markAt(e.clientX, e.clientY);
      if (!at) return;
      // Both ends start together: a click that never becomes a drag leaves a zero-length line,
      // which reads as "one mark placed" rather than as a measurement of nothing.
      setMarks({ a: at, b: at });
      markedRef.current = { a: at, b: at };
      marking.current = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    // The whole surface pans while no tool is down: there is nothing else to do to a tile, so the
    // plain drag is free to be the hand rather than a modifier on one.
    pan.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (marking.current) {
      const at = markAt(e.clientX, e.clientY);
      if (at) {
        setMarks((m) => (m ? { a: m.a, b: at } : m));
        const started = markedRef.current;
        if (started) markedRef.current = { a: started.a, b: at };
      }
      return;
    }
    const last = pan.current;
    if (!last || !ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    setView((v) => panBy(v, e.clientX - last.x, e.clientY - last.y, picture, size));
    pan.current = { x: e.clientX, y: e.clientY };
  };
  const endPan = (e: React.PointerEvent) => {
    pan.current = null;
    setPanning(false);
    const wasMarking = marking.current;
    marking.current = false;
    const pressed = pressedAt.current;
    pressedAt.current = null;
    // A press that let go where it went down is a click, not a drag.
    const clicked =
      e.type === "pointerup" &&
      pressed !== null &&
      Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < CLICK_SLOP;
    // The count runs when the line is finished, not while it is being dragged: reading the pixels
    // on every pointer move would recount a run the collector is still stretching, and the number
    // under their hand would flicker through every count on the way to the one they meant.
    const line = markedRef.current;
    if (wasMarking && tool === "perforation" && line) void countTeeth(line);
    // A ring, a line or a ruler mark is finished when the drag is, and joins the ones already
    // drawn; the marks clear so the next drag starts a new one rather than stretching this. A ruler
    // mark takes the scale on the bar with it — the one it was drawn at.
    // A click draws nothing: it is how a mark is selected instead.
    if (wasMarking && isAnnotationTool(tool) && tool !== "text" && line) {
      const mark = clicked ? null : annotationFromDrag(tool, line.a, line.b, annotationStyle, dpi);
      if (mark) {
        setHistory((h) => changeMarks(h, [...h.marks, mark]));
        setSelected(null);
      }
      setMarks(null);
    }
    // A click on a mark selects it, so its style can be changed on its own (#1342); a click anywhere
    // else lets go. The text tool's click belongs to notes — it places one or opens one.
    if (clicked && tool !== "text") {
      const at = markAt(e.clientX, e.clientY);
      const hit = at ? annotationAt(annotations, at, view.scale) : null;
      setSelected(hit);
      // The press set the measuring line's first end; on a mark, it was a selection, not a start.
      if (hit !== null && !annotating) setMarks(null);
    }
  };

  const detail = useSheetRegion({
    collectionId,
    sheetId: current?.sheetId ?? null,
    width: pictureWidth,
    height: pictureHeight,
    viewWidth: measured?.width ?? 0,
    originX: current?.box?.x ?? 0,
    originY: current?.box?.y ?? 0,
    turn,
    view,
    size,
  });

  /** The reading, or the reason there is not one yet. Recomputed on every render rather than held
   * in state: it is a function of the marks, the scale and the tooth count, and a cached copy of it
   * is a copy that can be stale — which for a number quoted as a measurement is not a bug worth
   * risking to save an arithmetic. */
  const reading = describeReading({ tool, marks, dpi, teeth, noun });
  const gauge = reading.gauge ?? null;

  // Hand the figure to whoever asked for it (#740). Above the `current` guard because it is a hook,
  // and split in two so that the unmount — the loupe closing back to the grid, the dialog moving to
  // the next tile — reports *no reading* rather than leaving the last one standing beside a piece it
  // was not taken on.
  useEffect(() => {
    onGauge?.(gauge);
  }, [gauge, onGauge]);
  useEffect(() => () => onGauge?.(null), [onGauge]);

  // The two size proposals (#763), published for whatever is beside this viewer and able to take
  // one — the stamp form, when the picker handed it this viewer as its aside; nothing at all
  // otherwise. Hooks, so they sit above the `current` guard with the gauge's.
  //
  // The **measured** figure is the size tool's reading and exists only while one stands.
  usePublishSizeProposal("measured", reading.size ?? null, dpi);
  // The **estimate** is the tile's own crop box divided by the stated scale, and it is always
  // there: the box was cut by #574's detector or by hand in the cut editor, and either way it is
  // the stamp plus whatever slack the cut carried. Good enough to propose, never good enough to
  // write — which is why it travels marked as an estimate and is offered as one.
  const box = current?.box ?? null;
  const cropSize = useMemo(() => {
    if (!box || dpi === null) return null;
    // Width and height as the piece stands on screen (#1006), not as it happened to lie on the card.
    const upright = isSideways(turn) ? { ...box, w: box.h, h: box.w } : box;
    return sizeFromScanPixels(upright, dpi, MM_PER_INCH);
  }, [box, dpi, turn]);
  usePublishSizeProposal("estimated", cropSize, dpi);

  // The size on the bar, for a caller that writes one (#1290) — split like the gauge's, so the viewer
  // closing takes the figure with it.
  const sizeWidth = reading.size?.widthMm ?? null;
  const sizeHeight = reading.size?.heightMm ?? null;
  useEffect(() => {
    onSize?.(
      sizeWidth === null || sizeHeight === null || dpi === null
        ? null
        : { size: { widthMm: sizeWidth, heightMm: sizeHeight }, dpi }
    );
  }, [dpi, onSize, sizeHeight, sizeWidth]);
  useEffect(() => () => onSize?.(null), [onSize]);

  /** A snapshot being named before it is saved (#674): what was in view and what was drawn on it,
   * fixed at the moment the button was pressed so a pan behind the dialog cannot change it. */
  const [snapshot, setSnapshot] = useState<{
    region: Box;
    marks: SnapshotMark[];
    viewScale: number;
  } | null>(null);

  if (!current) return null;

  const atActualSize = ready && Math.abs(view.scale - 1) < 1e-6;

  /** Keep what is on screen (#674). The measurement standing on the bar goes in with the marks, as
   * the figure the bar shows — scale and all — so a snapshot of a gauge is never a line with a bare
   * number beside it. Only a real reading: a prompt is not a figure. */
  const takeSnapshot = () => {
    if (!ready) return;
    const region = snapshotRegion(view, { width: pictureWidth, height: pictureHeight }, size);
    if (!region) return;
    const kept: SnapshotMark[] = [...annotations];
    if (marks && !reading.muted && (tool === "ruler" || tool === "perforation" || tool === "size")) {
      kept.push({
        kind: tool === "size" ? "box" : "distance",
        a: marks.a,
        b: marks.b,
        label: reading.text,
        // Drawn as it stands on screen: in the settings of the moment, like the next mark.
        style: annotationStyle,
      });
    }
    setSnapshot({ region, marks: kept, viewScale: view.scale });
  };

  /** What the settings bar acts on (#1342): a note open for editing or a mark selected by a click —
   * that mark only — or else the settings for the next mark drawn. */
  const targetIndex = editing ? editing.index : selected;
  const target = targetIndex === null ? null : (annotations[targetIndex] ?? null);
  const restyleTarget = (next: AnnotationStyle) => {
    if (targetIndex === null) return;
    setHistory((h) => changeMarks(h, restyleMark(h.marks, targetIndex, next)));
  };
  /** The style the note being typed shows in: its own when it is opened again, the settings when new. */
  const noteStyle = target?.kind === "text" ? target.style : annotationStyle;
  const selectedMark = editing ? null : target;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0 0 0.625rem",
          flexWrap: "wrap",
        }}
      >
        {/* Only when there is a second side to go to. A lone front with a disabled *Back* beside it
            would be the dialog reporting a missing photograph, which the strip already says. */}
        {sides.length > 1 &&
          sides.map((s) => (
            <ScanToolButton
              key={s.side}
              label={s.label}
              hint={`Show the ${s.label.toLowerCase()} of this tile — the zoom and the position are kept`}
              active={s.side === current.side}
              onClick={() => showSide(s.side)}
            />
          ))}
        {/* Standing a sideways piece up (#1006), on the side being looked at: the back of a piece is
            turned over in place, so it lies the other way round and is turned on its own. Beside
            the side switch because both are about *which picture*, not about how closely it is
            looked at. */}
        {onTurn && (
          <>
            <ScanToolButton
              icon="turnLeft"
              label=""
              hint={`Turn the ${current.label.toLowerCase()} a quarter to the left — the tile stays where it is on the card, so every measurement stays true`}
              disabled={turning}
              onClick={() => onTurn(current.side, turnBy(current.turn, -1))}
            />
            <ScanToolButton
              icon="turnRight"
              label=""
              hint={`Turn the ${current.label.toLowerCase()} a quarter to the right — the tile stays where it is on the card, so every measurement stays true`}
              disabled={turning}
              onClick={() => onTurn(current.side, turnBy(current.turn, 1))}
            />
          </>
        )}
        {/* The two measuring tools (#598), on the same toolbar as the zoom because they are the
            same act: looking closely at one thing. Absent — not disabled — on a side with no box,
            since there is then no scan geometry to measure against and a greyed control would be
            promising something this side cannot do. */}
        {canMeasure && (
          <>
            <ScanToolButton
              icon="measure"
              label="Ruler"
              hint={`Measure between two points of the ${subject === "photo" ? "picture" : "scan"}, in millimetres`}
              active={tool === "ruler"}
              onClick={() => chooseTool("ruler")}
            />
            {/* The size tool (#763) — the ruler's second axis. Beside it rather than folded into
                it because they answer different questions and a tool that quietly changed what a
                drag meant would be worse than a third button. What it produces is offered to the
                stamp form when there is one beside this viewer, and nothing is ever written by the
                act of measuring. */}
            <ScanToolButton
              label="Size"
              hint="Drag a box around the stamp — its width and height in millimetres, offered to the stamp's size when a stamp form is open beside this"
              active={tool === "size"}
              onClick={() => chooseTool("size")}
            />
            <ScanToolButton
              label="Perforation"
              hint="Mark the first and last hole of a run — the teeth between them are counted for you, and you can correct the count"
              active={tool === "perforation"}
              onClick={() => chooseTool("perforation")}
            />
            {/* The third tool (#625) — under the same gate, since it too is about the scan's own
                geometry, and beside the other two because it answers the same kind of question at
                the same moment. Not a `MeasureTool`: it takes no marks and leaves the drag as the
                hand, so it can be down at the same time as the ruler. */}
            <ScanToolButton
              label="Watermark"
              hint="Redraw what is on screen so a watermark in the paper becomes readable — a way of looking, nothing is stored"
              active={watermarkOn}
              onClick={() => setChosenWatermark((on) => !on)}
            />
          </>
        )}
        {/* Marking a detail and keeping it (#674). Not under the measuring gate: a ring says nothing
            numeric, so it needs no scale and no scan geometry, and a picture that cannot be measured
            can still have its flaw pointed at. */}
        <ScanToolButton
          icon="annotateRing"
          label="Ring"
          hint="Drag around a detail to ring it — kept only when you save a snapshot"
          active={tool === "ellipse"}
          onClick={() => chooseTool("ellipse")}
        />
        <ScanToolButton
          icon="annotateLine"
          label="Line"
          hint="Drag to draw a straight line for reference — kept only when you save a snapshot"
          active={tool === "line"}
          onClick={() => chooseTool("line")}
        />
        {/* The ruler mark (#1300): the ruler's line kept on the picture, graduations and figure and
            all. Under the ruler's gate, since its figure is a length — a ring or a note keeps
            working where there is no scale, and this is simply not offered. */}
        {canMeasure && (
          <ScanToolButton
            icon="annotateRuler"
            label="Ruler mark"
            hint="Drag to draw a line with graduations and its length in millimetres — it stays on the picture, and in a snapshot"
            active={tool === "rulerMark"}
            onClick={() => chooseTool("rulerMark")}
          />
        )}
        <ScanToolButton
          icon="annotateText"
          label="Text"
          hint="Click to place a note and type it — click a note again to change it"
          active={tool === "text"}
          onClick={() => chooseTool("text")}
        />
        <ScanToolButton
          icon="snapshot"
          label="Snapshot"
          hint={`Keep what is on screen — with your marks and the measurement — as a new photo beside this ${noun}`}
          disabled={!ready}
          onClick={takeSnapshot}
        />
        <span style={{ flex: 1 }} />
        <ScanToolButton icon="zoomOut" label="−" hint="Zoom out (−)" onClick={() => zoomStep(1 / ZOOM_STEP)} />
        {/* The percentage is against the **scan**, exactly as in the cut editor. The dot marks the
            visible part being served from the retained card rather than magnified out of the
            tile's own photo. */}
        <Tooltip
          content={
            detail
              ? "Showing this part at full resolution from the retained card scan"
              : `Showing the ${noun}'s own image`
          }
        >
        <span
          style={{
            fontSize: "0.8125rem",
            color: detail ? "var(--color-text-secondary)" : "var(--color-text-muted)",
            minWidth: "3.25rem",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {ready ? `${Math.round(view.scale * 100)}%` : "—"}
          {detail ? " ·" : ""}
        </span>
        </Tooltip>
        <ScanToolButton icon="zoomIn" label="+" hint="Zoom in (+)" onClick={() => zoomStep(ZOOM_STEP)} />
        <ScanToolButton
          icon="zoomFit"
          label="Fit"
          hint={`The whole ${noun} on screen (0)`}
          active={fitted}
          onClick={fit}
        />
        <ScanToolButton
          label="1:1"
          hint="One screen pixel per pixel of the scan itself — past this the picture is enlarged, not sharper"
          active={!fitted && atActualSize}
          onClick={actualSize}
        />
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        // Middle-button down starts the browser's own autoscroll, which `onPointerDown` is too
        // late to stop — the same guard the cut editor needs for the same reason. And a click that
        // opens a note (#1342): the field is focused as the press comes down, and the mouse-down
        // that follows would move the focus to the page behind it — blurring the field, which keeps
        // the note, empty, and so drops it before a letter could be typed.
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
          if (e.button === 0 && tool === "text" && !handDrag) e.preventDefault();
        }}
        style={{
          flex: 1,
          minHeight: "20rem",
          position: "relative",
          overflow: "hidden",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-subtle)",
          cursor: panning ? "grabbing" : handDrag ? "grab" : tool === "text" ? "text" : "crosshair",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: view.offsetX,
            top: view.offsetY,
            width: ready ? pictureWidth * view.scale : "100%",
            height: ready ? pictureHeight * view.scale : "100%",
            // Nothing is drawn before the picture has a scale. The unmeasured fallback above is the
            // whole panel, so painting it would show the stamp blown up for a frame and then snap
            // it down — worse than an empty panel, and it is the one thing the eye catches when
            // stepping along a run. `visibility` rather than a mount guard: the photo still loads
            // (and reports its natural size, which is what makes a box-less tile ready at all).
            visibility: ready ? "visible" : "hidden",
          }}
        >
          {/* Served by an authenticated route at whatever size the crop was, which is exactly the
              case `next/image`'s loader cannot size or optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/collections/${collectionId}/photos/${current.photoId}/full`}
            alt={subject === "photo" ? current.label : `Tile ${position + 1}, ${current.label.toLowerCase()}`}
            draggable={false}
            // No `crossOrigin`: the route is same-origin, so the canvas the tooth count reads from
            // is untainted as it stands, and asking for CORS mode on a same-origin authenticated
            // route would only give the request a second cache entry and one more way to fail.
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural((n) =>
                n[current.photoId]
                  ? n
                  : { ...n, [current.photoId]: { width: img.naturalWidth, height: img.naturalHeight } }
              );
            }}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "fill" }}
          />

          {/* The visible part at the card's own resolution, drawn over the photo it magnifies and
              never instead of it: a crop still in flight is a soft edge rather than a blank panel,
              and one that never arrives leaves a picture of the stamp on screen. */}
          {detail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.url}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: detail.box.x * view.scale,
                top: detail.box.y * view.scale,
                width: detail.box.w * view.scale,
                height: detail.box.h * view.scale,
                objectFit: "fill",
                pointerEvents: "none",
              }}
            />
          )}

          {/* The processed crop, in the same transformed layer as everything else — which is what
              pins it to the pixels it was computed from. A pan therefore carries it along instead
              of sliding it across the stamp, and the worst a stale crop can be is *too small*: raw
              scan around the edges until the next one lands. Over the detail crop and under the
              marks, because a measurement is still taken on the scan and its line must not be
              buried by a picture of a filter's opinion. */}
          {watermarkCrop && (
            <canvas
              ref={paintWatermark}
              style={{
                position: "absolute",
                left: watermarkCrop.box.x * view.scale,
                top: watermarkCrop.box.y * view.scale,
                width: watermarkCrop.box.w * view.scale,
                height: watermarkCrop.box.h * view.scale,
                pointerEvents: "none",
              }}
            />
          )}

          {/* The line, drawn in the same transformed layer as the picture, so it stays over the
              pixels it was placed on through every zoom and pan without a single coordinate being
              recomputed. Marks are held in scan pixels and scaled here — never the other way
              round, which would make the reading a function of the zoom. */}
          {ready && (annotations.length > 0 || (measuring && marks)) && (
            <svg
              width={pictureWidth * view.scale}
              height={pictureHeight * view.scale}
              style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
            >
              {/* The marks already drawn (#674, #1300), under whatever is being dragged now — less the
                  note being typed, which the field below stands in for. Then the drag itself, through
                  the same layer and the same style: a ruler, a size box or a perforation run is
                  drawn as it will be burnt into a snapshot, so what is on screen is what is kept. */}
              <AnnotationShapes
                marks={editing?.index != null ? annotations.filter((_, i) => i !== editing.index) : annotations}
                scale={view.scale}
              />
              {measuring && marks && tool !== "text" && (
                <AnnotationShapes marks={[dragMark(tool, marks, dpi, annotationStyle)]} scale={view.scale} />
              )}
              {/* The selected mark (#1342), outlined on screen only — a snapshot never shows it. */}
              {selectedMark && <SelectionOutline box={annotationBounds(selectedMark, view.scale)} scale={view.scale} />}
            </svg>
          )}

          {/* The note being typed (#1300), where it will be set: the field wears the note's own size,
              face and colour, so typing it is placing it. */}
          {editing && ready && (
            <input
              autoFocus
              value={editing.text}
              maxLength={MAX_TEXT_MARK}
              size={Math.max(editing.text.length + 1, 8)}
              aria-label="Note on the picture"
              placeholder="Note"
              onChange={(e) => {
                const held = editingRef.current;
                if (held) editNote({ ...held, text: e.target.value });
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finishNote(true);
                }
              }}
              onBlur={() => finishNote(true)}
              style={{
                position: "absolute",
                left: editing.at.x * view.scale,
                top: editing.at.y * view.scale,
                margin: 0,
                padding: 0,
                border: "none",
                outline: `1px dashed ${noteColour(noteStyle).colour}`,
                background: "rgba(17, 17, 17, 0.35)",
                color: noteColour(noteStyle).colour,
                font: `600 ${noteStyle.fontSize}px ${ANNOTATION_FONT_FAMILY}`,
                lineHeight: 1.25,
                userSelect: "text",
              }}
            />
          )}

          {/* The reading at the end of the line, where the hand already is — so a run is adjusted
              while watching the figure move rather than by dragging, glancing down at the bar, and
              dragging again. It stays after the drag for the same reason it appeared: the figure
              belongs to the line, and the bar keeps it too along with the scale and the fields. Only
              a real figure gets one; the prompts ("drag from the first hole…") are the bar's job and
              would be a label following the pointer to say nothing. */}
          {measuring && marks && ready && !reading.muted && tool !== "rulerMark" && (
            <span
              style={{
                position: "absolute",
                left: marks.b.x * view.scale,
                top: marks.b.y * view.scale,
                // Above the second mark and clear of the pointer, which is on the thing being
                // aimed at — the one part of the picture a label must not cover.
                transform: "translate(-50%, calc(-100% - 0.75rem))",
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
                // Its own colours rather than the surface tokens: this sits on a scan, which is
                // white paper in some places and printed ink in others, and it has to be legible
                // over both in either theme.
                background: "rgba(17, 17, 17, 0.85)",
                color: "#fff",
                fontSize: "0.75rem",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {reading.text}
            </span>
          )}
        </div>
      </div>

      {/* The measuring bar (#598) — the reading, and beside it the scale it was taken at.
          Deliberately together and deliberately here rather than at upload: a value set weeks
          earlier is inherited by someone who cannot see it, while one beside the result is on view
          exactly when it acts (#573). */}
      {/* The marks bar (#674) — how many are drawn and the way to take them back, while a marking
          tool is down or anything is drawn. Said on the bar because a mark is not saved anywhere
          until a snapshot is, and a collector who closes the viewer should not expect it back. */}
      {(annotating || annotations.length > 0 || editing) && (
        <div style={TOOL_BAR}>
          <span style={{ color: "var(--color-text-muted)" }}>
            {editing
              ? "Type the note — Enter keeps it, Esc drops the change"
              : selectedMark
                ? `${MARK_NOUN[selectedMark.kind]} selected — the settings change it only · Esc lets go`
              : annotations.length > 0
                ? `${annotations.length} ${annotations.length === 1 ? "mark" : "marks"} — kept only in a snapshot`
                : tool === "rulerMark"
                  ? "Ruler marks stay on the picture — kept only in a snapshot"
                  : reading.text}
          </span>
          {/* The settings for the next mark, or for the one selected (#1342) — a mark keeps the style it
              was drawn in until it is selected and changed. */}
          <AnnotationStyleControls
            style={target?.style ?? annotationStyle}
            onChange={target ? restyleTarget : setAnnotationStyle}
            target={target ? "selected" : "next"}
            fields={target ? styleFieldsOf(target.kind) : undefined}
          />
          <span style={{ flex: 1 }} />
          {editing?.index != null && (
            <ScanToolButton
              label="Remove note"
              hint="Take this note off the picture"
              keepFocus
              onClick={() => {
                const held = editingRef.current;
                if (!held) return;
                editingRef.current = { ...held, text: "" };
                finishNote(true);
              }}
            />
          )}
          {history.past.length > 0 && (
            <ScanToolButton
              label="Undo"
              hint="Take back the last change — a mark drawn, a note typed, changed or removed, or Clear"
              onClick={() => {
                editNote(null);
                setSelected(null);
                setHistory(undoMarks);
              }}
            />
          )}
          {annotations.length > 0 && (
            <ScanToolButton
              label="Clear marks"
              hint="Take every mark off — Undo brings them back"
              onClick={() => {
                editNote(null);
                setSelected(null);
                setHistory((h) => changeMarks(h, []));
              }}
            />
          )}
        </div>
      )}

      {measuring && (!annotating || tool === "rulerMark") && (
        <div style={TOOL_BAR}>
          <span
            style={{
              color: reading.muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
              fontWeight: reading.muted ? 400 : 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {reading.text}
          </span>
          {reading.detail && (
            <span style={{ color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {reading.detail}
            </span>
          )}

          <span style={{ flex: 1 }} />

          {tool === "perforation" && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <input
                value={teethText}
                onChange={(e) => {
                  setTeethText(e.target.value);
                  // Typing takes the count back, and the *counted* mark with it. The field is the
                  // authority; #614 only fills it (see {@link TeethSource}).
                  setTeethSource("typed");
                }}
                inputMode="numeric"
                aria-label="Teeth between the marks"
                style={{
                  ...MEASURE_FIELD,
                  width: "3rem",
                  // Lit while the figure is one this app put there, so a wrong count reads as
                  // something to check rather than as something the collector typed and forgot.
                  borderColor:
                    teethSource === "counted"
                      ? "var(--color-action-primary)"
                      : "var(--color-border-strong)",
                }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>teeth between the marks</span>
              {teethSource === "counted" && (
                <Tooltip content="Counted off the edge between your marks. Check it against the picture — it is a reading, not a fact, and typing over it takes it back.">
                  <span
                    style={{
                      padding: "0.0625rem 0.3125rem",
                      borderRadius: "0.25rem",
                      border: "1px solid var(--color-action-primary)",
                      color: "var(--color-action-primary)",
                      fontSize: "0.6875rem",
                    }}
                  >
                    counted
                  </span>
                </Tooltip>
              )}
              {/* Said, rather than filled with a guess: a run too short or too ragged to carry a
                  period is exactly the case a plausible number would be worst in — and which of
                  those it was is a different instruction, so it is a different sentence. */}
              {TEETH_SOURCE_NOTE[teethSource] && (
                <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                  {TEETH_SOURCE_NOTE[teethSource]}
                </span>
              )}
            </label>
          )}

          <Tooltip
            content={`What this ${subject === "photo" ? "picture" : "card"} was scanned at. Correcting it here holds for this sitting only — the collection keeps its own setting, in Settings → General.`}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <input
                value={dpiText}
                onChange={(e) => setDpiText(e.target.value)}
                inputMode="numeric"
                aria-label="Scan resolution in dots per inch"
                style={{
                  ...MEASURE_FIELD,
                  width: "4rem",
                  borderColor:
                    dpi === null ? "var(--color-error-border)" : "var(--color-border-strong)",
                }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>dpi</span>
            </label>
          </Tooltip>

          {marks && (
            <ScanToolButton label="Clear" hint="Take the marks off (Esc)" onClick={() => setMarks(null)} />
          )}
        </div>
      )}

      {/* The watermark bar (#625) — its own bar rather than a third row of the measuring one,
          because the two tools answer different questions and can be down together. What it says
          about itself is as much the point as what it does: the chain lifts show-through from the
          front along with the watermark, and a picture presented without that caveat is one a
          collector could read a variant off. */}
      {watermarkOn && (
        <div style={TOOL_BAR}>
          {/* Four chips rather than a dropdown, and the reason is the work: which channel carries a
              watermark is not known in advance, so the control is *cycled through* — a dropdown
              makes that two clicks per try and hides the alternatives between them. Lit-is-current
              is also the vocabulary this dialog already speaks, Front/Back and Fit being the same
              control: one of N, and the one you are on is the lit one. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span style={{ color: "var(--color-text-muted)", marginRight: "0.125rem" }}>
              Channel
            </span>
            {WATERMARK_CHANNELS.map((c) => (
              <ScanToolButton
                key={c.value}
                label={c.label}
                hint={c.hint}
                active={watermarkChannel === c.value}
                tint={WATERMARK_CHANNEL_TINT[c.value]}
                onClick={() => setWatermarkChannel(c.value)}
              />
            ))}
          </div>

          <Tooltip content="How hard the local contrast is stretched. Push it too far and paper grain organises itself into a watermark that is not there — if a mark only appears at the top of this slider, it is not a mark.">
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ color: "var(--color-text-muted)" }}>Strength</span>
              <input
                type="range"
                min={MIN_WATERMARK_STRENGTH}
                max={MAX_WATERMARK_STRENGTH}
                step={0.05}
                value={watermarkStrength}
                onChange={(e) => setWatermarkStrength(Number(e.target.value))}
                aria-label="Strength of the watermark filter"
                style={{ width: "8rem" }}
              />
            </label>
          </Tooltip>

          {/* Said rather than left to guess, for the reason every note in this dialog is: a filter
              that has done nothing looks exactly like one that is not wired up. */}
          {WATERMARK_STATUS_NOTE[watermarkStatus] && (
            <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
              {WATERMARK_STATUS_NOTE[watermarkStatus]}
            </span>
          )}

          <span style={{ flex: 1 }} />

          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            The design printed on the front lifts with the watermark — nothing is stored
          </span>
        </div>
      )}

      <p
        style={{
          margin: "0.5rem 0 0",
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
        }}
      >
        {measuring ? (
          <>
            {tool === "text" ? "Click to place a note, or on a note to change it" : "Drag to mark · click a mark to select it"} · hold <kbd>space</kbd> or the middle button to move · <kbd>Esc</kbd> clears
            {/* Said only when it is true, and it is the accuracy warning rather than a tip: the
                reading is taken on the scan's own pixels either way, but below 1:1 a mark is placed
                to within more than one of them, and a gauge separates 11½ from 12 by under 4%. */}
            {ready && view.scale < 1 && (
              <> · zoom to <kbd>1:1</kbd> or closer to place the marks accurately</>
            )}
          </>
        ) : (
          <>
            Drag to move · wheel or <kbd>+</kbd>/<kbd>−</kbd> zooms · <kbd>0</kbd> fits
            {annotations.length > 0 ? " · click a mark to select it" : ""}
            {sides.length > 1 ? " · the zoom is kept when you switch sides" : ""}
            {/* Said for a photo, where the tools' absence has a reason worth knowing (#1290): a
                tile without a box is rare and explained on the purchase screen, while an old photo
                whose original size was never recorded looks like any other. */}
            {subject === "photo" && !canMeasure
              ? " · this photo's original size was not recorded, so it cannot be measured"
              : ""}
          </>
        )}
      </p>

      {snapshot && (
        <SnapshotDialog
          collectionId={collectionId}
          photoId={current.photoId}
          region={snapshot.region}
          marks={snapshot.marks}
          viewScale={snapshot.viewScale}
          onClose={() => setSnapshot(null)}
          onSaved={() => {
            setSnapshot(null);
            onSnapshotSaved?.();
          }}
        />
      )}
    </div>
  );
}

/** The palette entry a style names — the colour a note is typed in. */
function noteColour(style: AnnotationStyle) {
  return ANNOTATION_COLOURS.find((c) => c.id === style.colour) ?? ANNOTATION_COLOURS[0];
}

/**
 * The mark a drag in progress draws (#1300), in the shapes a snapshot keeps: a ring, a line or a ruler
 * mark as it will be, the size tool's box, and the ruler's or the perforation run's line with its rings.
 * The figure is left off — the viewer sets it in the page beside the line — except on a ruler mark,
 * whose figure is part of the mark.
 */
function dragMark(
  tool: MeasureTool,
  marks: { a: ScanPoint; b: ScanPoint },
  dpi: number | null,
  style: AnnotationStyle
): SnapshotMark {
  const { a, b } = marks;
  if (tool === "ellipse" || tool === "line") return { kind: tool, a, b, style };
  if (tool === "rulerMark") {
    return dpi === null ? { kind: "line", a, b, style } : { kind: "rulerMark", a, b, dpi, style };
  }
  if (tool === "size") return { kind: "box", a, b, label: "", style };
  return { kind: "distance", a, b, label: "", style };
}

/** How far the pointer may travel between down and up, in screen pixels, for the press to be a click
 * — which selects a mark (#1342) — rather than a drag. */
const CLICK_SLOP = 4;

/** What the marks bar calls a selected mark. */
const MARK_NOUN: Record<SnapshotMark["kind"], string> = {
  ellipse: "Ring",
  line: "Line",
  rulerMark: "Ruler mark",
  text: "Note",
  distance: "Measurement",
  box: "Size",
};

/** A selected mark's outline (#1342): a dashed box a little outside it, light over a dark halo so it
 * shows on paper and ink. Screen furniture — it is not a mark and a snapshot never draws it. */
function SelectionOutline({ box, scale }: { box: Box; scale: number }) {
  const pad = 6;
  const x = box.x * scale - pad;
  const y = box.y * scale - pad;
  const w = box.w * scale + pad * 2;
  const h = box.h * scale + pad * 2;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth={3} />
      <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke="#ffffff" strokeWidth={1} strokeDasharray="4 3" />
    </>
  );
}

/**
 * What each channel chip is coloured (#625) — the channel itself, not a token.
 *
 * The one place in this dialog where a colour carries meaning of its own: these chips *are* the red,
 * the green and the blue of the scan, so borrowing `--color-error` for the red one would make *the
 * red channel* and *something is wrong* the same colour on a surface whose whole job is judging a
 * picture. Mid tones rather than pure hues, because each one has to carry white text when it is the
 * chip in use and sit legibly in both themes when it is not — which is also why grey is a grey with
 * weight rather than the pale one the word suggests.
 */
const WATERMARK_CHANNEL_TINT: Record<WatermarkChannel, string> = {
  blue: "#2563eb",
  green: "#15803d",
  red: "#b91c1c",
  grey: "#6b7280",
};

/** The bar under the viewport — the measuring one (#598) and the watermark one (#625) are the same
 * strip of controls under the same picture, so they are one style rather than two that drift. */
const TOOL_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  flexWrap: "wrap",
  margin: "0.5rem 0 0",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  fontSize: "0.8125rem",
};

/** The two number fields in the measuring bar, which are one control wearing two labels. */
const MEASURE_FIELD: React.CSSProperties = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontFamily: "inherit",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
