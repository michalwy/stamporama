"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AlbumEditorBlock,
  AlbumEditorBox,
  AlbumEditorFreeElement,
  AlbumEditorSheet,
  AlbumEditorText,
} from "@/lib/album-editor";
import { photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import {
  blockDropMark,
  boxDropMark,
  type AlbumCarry,
  type AlbumDropMark,
} from "@/lib/album-drag";
import { albumBoxFlag, type AlbumBoxFlag } from "@/lib/album-box-flag";
import { albumBoxOutline } from "@/lib/album-box-outline";
import { albumFrame } from "@/lib/album-frame";
import type { AlbumRect } from "@/lib/album-layout";
import { albumOrnamentPathData, type AlbumOrnamentDrawing } from "@/lib/album-ornament-svg";
import { ALBUM_MM_DECIMALS, type AlbumRenderPreset } from "@/lib/album-template-rules";
import type { AlbumFieldMark } from "@/lib/album-field-marks";
import {
  isBoxSelected,
  toggleBoxSelection,
  type AlbumEditorSelection,
} from "@/lib/album-selection";

// The sheet, drawn (#769).
//
// ## This component does not measure anything, and that is the whole of its contract
//
// Every millimetre it draws — where a box sits, how wide it is, which words are on which line, where
// a heading's baseline falls — arrived from the server, decided once in `album-layout.ts` against the
// faces the PDF embeds. **The client is not allowed to measure, because the client is not a planner**
// (ADR-0045 §7). A canvas reaching for `measureText` to lay out its own text would break a heading in
// one place and the printer in another, at exactly the millimetre this track exists to protect, and
// it would look right until somebody put a ruler on a card.
//
// One thing here is genuinely the browser's and is a **paint** difference rather than a plan one:
// each already-wrapped line is centred with `text-anchor="middle"`, which uses whatever face the
// machine actually has. `album-fonts.ts` names the metric twin of every embedded face first in its
// `cssStack` for exactly this, so on an ordinary machine the ink lands where the PDF puts it — and
// even where it does not, nothing about *where a block breaks* depends on it.
//
// ## A reorder is carried in state, because a ref cannot be drawn
//
// The three millimetre gestures (`space`, `spaceAfter`, `size`) ride in `CanvasDrag` and the canvas
// draws them. Reordering used to ride in a `useRef`, which by design does not re-render — so between
// press and release nothing knew a drag was happening and nothing could be drawn (#816). It is a
// `useState` now. It is deliberately **not** a `CanvasDrag`: that shape is millimetres already moved,
// it is written from the panel as well as from here, and it is read on release to commit a number. A
// reorder has no millimetres and no second writer — only a source, a target, and this canvas — so
// folding it in would have given every reader of `CanvasDrag` a case it can neither produce nor use.
//
// What is drawn is decided in `album-drag.ts` rather than here, and that is the point of the split:
// the mark under the pointer is a **promise about what the drop will do**, and the drop reads the
// same function, so the two cannot drift. A target with no mark is one where dropping does nothing.
//
// ## Dragging is a geometric offset, never a re-plan
//
// While a handle is held, the affected shapes are translated or resized by the pointer's own
// movement in millimetres and nothing else happens. The re-plan happens **server-side on release**,
// which is why a dragged box can snap somewhere other than where it was let go: a box's height is
// the height of the shortest strip in the drawer the piece fits into (#765), so it moves in strip
// steps rather than continuously.
//
// ## Two shapes: the editor's canvas, and a picture of a sheet
//
// `interactive: false` is the album template's preview (#795) — the same drawing with nothing to
// pick up. It is a **separate props shape** rather than six no-op handlers, and that is the point:
// a canvas handed functions that do nothing still draws grab cursors and drop marks, which is a
// promise about what a gesture will do, made by a surface where nothing happens. The editor's own
// handlers stay required, so forgetting one there is still a type error.
//
// ## The sheet is paper in both themes
//
// White ground, black ink, and the flag colours below are literals rather than semantic tokens. That
// is `ui-patterns.md`'s stated exception — the reading label drawn on a scan (#598) makes the same
// call — and the reason is the same: everything inside this frame has to stay legible over white
// paper and printed ink whichever theme the app is in, and a token that inverts would make the
// canvas the one surface where *dark mode* means *a black album page*. Everything outside the frame
// is tokens.

/** A millimetre in SVG user units. The canvas's `viewBox` is the sheet in millimetres, so this is 1
 *  by construction and is named only so the arithmetic below reads as what it is. */
const MM = 1;

/** Ink and paper. Not tokens — see the note above. */
const PAPER = "#ffffff";
const INK = "#111111";
/** The sheet's own edge and the content frame, both drawing aids that are on no card. */
const SHEET_EDGE = "#c9c9c9";
const GUIDE = "#dcdcdc";
/** Selection and the handles that are dragged. Blue because nothing else on a page is: it can never
 *  be mistaken for ink. */
const HANDLE = "#2563eb";
/** What the Page template dialog's field in hand controls (#1431). Not the handle's blue: the preview
 *  draws a real album's corrected boxes in blue, and a mark must not read as one of them. */
const MARK = "#c026d3";

/**
 * What a box is flagged for, in the order the flags are worth reading.
 *
 * All three are things a collector needs to know **before** a sheet goes into the printer and never
 * after, which is why they are shown here and are kept off the paper (ADR-0047 §9): a hawid cut to
 * an inherited figure as if it had been measured is gone, and so is one cut for a box nobody can
 * supply. `corrected` is not a warning at all — it says a figure is the collector's own, so that a
 * page they no longer remember correcting does not read as one the rule produced.
 */
const FLAG: Record<AlbumBoxFlag, { colour: string; label: string }> = {
  unmeasured: { colour: "#c2410c", label: "No size anywhere on the checklist" },
  oversize: { colour: "#b45309", label: "Pocket — no strip is tall enough" },
  inherited: { colour: "#a16207", label: "Sized from a neighbour, not measured" },
  corrected: { colour: "#1d4ed8", label: "Corrected by hand" },
};

export type { AlbumBoxFlag };

/** The one rule, shared with the album screen's summary (#1430) so the two count the same boxes. */
export function boxFlag(box: AlbumEditorBox): AlbumBoxFlag | null {
  return albumBoxFlag(box);
}

export const BOX_FLAGS = FLAG;

/**
 * The page frame (#1427): what `album-frame.ts` places, drawn. Nothing is worked out here — the rule
 * this canvas lives under — so the preview and the PDF are one frame, and a double rule's gap on the
 * screen is the gap on the paper. The ornament is drawn from its outlines, never from the file the
 * collector uploaded. A title set into the frame line (#1428) breaks the top rule around it, and a
 * footer (#1457) the bottom one.
 */
function SheetFrame({
  preset,
  ornament,
  title,
  footer,
}: {
  preset: AlbumRenderPreset;
  ornament: AlbumOrnamentDrawing | null;
  title: AlbumRect | null;
  footer: AlbumRect | null;
}) {
  const frame = albumFrame(preset, ornament, title, footer);
  return (
    <g pointerEvents="none">
      {frame.rects.map((r, i) => (
        <rect
          key={`r${i}`}
          x={r.xMm}
          y={r.yMm}
          width={r.widthMm}
          height={r.heightMm}
          fill="none"
          stroke={INK}
          strokeWidth={frame.lineMm}
        />
      ))}
      {frame.paths.map((points, i) => (
        <polyline
          key={`p${i}`}
          points={points.map((pt) => `${pt.xMm},${pt.yMm}`).join(" ")}
          fill="none"
          stroke={INK}
          strokeWidth={frame.lineMm}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      ))}
      {frame.lines.map((l, i) => (
        <line
          key={`l${i}`}
          x1={l.x1Mm}
          y1={l.y1Mm}
          x2={l.x2Mm}
          y2={l.y2Mm}
          stroke={INK}
          strokeWidth={frame.lineMm}
          strokeLinecap="butt"
        />
      ))}
      {ornament &&
        frame.ornaments.map((o) => (
          <g key={o.corner} transform={`matrix(${o.matrix.join(" ")})`}>
            {ornament.paths.map((p, i) => (
              <path
                key={i}
                d={albumOrnamentPathData(p.commands)}
                fill={p.fill ?? "none"}
                fillRule={p.fillRule}
                stroke={p.stroke ?? "none"}
                strokeWidth={p.strokeWidth}
                strokeLinecap={p.lineCap}
                strokeLinejoin={p.lineJoin}
              />
            ))}
          </g>
        ))}
    </g>
  );
}

/** What is selected on the canvas. A box is named by the pair that identifies **one box** — the
 *  entry and the stamp — because a box is a slot and one stamp can have two of them (ADR-0047 §2).
 *  Several boxes are selected by shift-clicking, to give them one size (#1309); the rules are in
 *  `album-selection.ts`. */
export type CanvasSelection = AlbumEditorSelection;

/** A drag in progress, as millimetres already moved. Applied as an offset to what is drawn and to
 *  nothing else; the server re-plans when it ends.
 *
 *  `move` and `width` are a free page's element (#1429): the one place the collector places something
 *  rather than correcting the layout, so the offset *is* the new position — the release writes the
 *  element's own millimetres, and the plan only re-wraps a text to its new width. */
export interface CanvasDrag {
  kind: "space" | "spaceAfter" | "size" | "move" | "width";
  /** The block, or the box's block — or the free page an element is on. */
  blockId: string;
  stampId?: string;
  /** The free page's element being moved or widened. */
  elementId?: string;
  dxMm: number;
  dyMm: number;
}

/** Where the canvas and the picture list fetch a library picture (#1429). A vector comes back as an
 *  SVG written from its outlines — the four commands the PDF draws — never as the file uploaded. */
export function albumPictureUrl(collectionId: string, pictureId: string): string {
  return `/api/collections/${collectionId}/album-pictures/${pictureId}`;
}

/** The colour a picture too coarse to print well is outlined in — the oversize box's, since both say
 *  *this will not come out as it looks here*. On no card. */
const COARSE = "#b45309";

/** A box's identity as one string, for saying which one the pointer is over. The pair is what names
 *  a box (ADR-0047 §2) and both halves are cuids, so a colon cannot occur inside either. */
function boxKey(blockId: string, stampId: string): string {
  return `${blockId}:${stampId}`;
}

/** The insertion mark's own weight: 0.8 mm is about three pixels at 1:1, which is the thickness the
 *  shared reorder kit draws its line at (`reorder-list.tsx`). */
const MARK_MM = 0.8;

// What a non-interactive canvas has instead of handlers. Module constants rather than inline
// closures so a render never creates a new identity for them.
const NO_SELECT: (selection: CanvasSelection) => void = () => {};
const NO_DRAG: (drag: CanvasDrag | null) => void = () => {};
const NO_DRAG_END: (drag: CanvasDrag) => void = () => {};
const NO_REORDER: (blockId: string, from: string, to: string) => void = () => {};
const NO_REORDER_BLOCKS: (from: string, to: string) => void = () => {};
const NO_ROW_BREAK: (entryId: string, stampId: string, on: boolean) => void = () => {};
const NO_BAND_BREAK: (blockId: string, on: boolean) => void = () => {};
const NO_OPEN_GAPS: (
  text: AlbumEditorText,
  at: { left: number; bottom: number }
) => void = () => {};

interface AlbumPageCanvasBase {
  sheet: AlbumEditorSheet;
  collectionId: string;
  zoom: number;
}

/** The editor's canvas: everything on the sheet can be picked up, and every gesture has somewhere to
 *  go. This is the shape #769 uses and the reason the handlers below are required rather than
 *  optional — a forgotten one would leave a gesture that draws a promise and then does nothing. */
interface AlbumPageCanvasInteractive extends AlbumPageCanvasBase {
  interactive?: true;
  selection: CanvasSelection;
  onSelect: (selection: CanvasSelection) => void;
  drag: CanvasDrag | null;
  onDrag: (drag: CanvasDrag | null) => void;
  /** Called when a drag ends, with the millimetres it moved. The screen turns that into a delta and
   *  sends it; nothing is committed from inside the canvas. */
  onDragEnd: (drag: CanvasDrag) => void;
  /** Called when a box is dropped onto another box of the same block — a stamp reorder. */
  onReorder: (blockId: string, fromStampId: string, toStampId: string) => void;
  /** Called when a block's heading is dropped onto another block's — the order the album prints its
   *  blocks in, which is the one override on this canvas that is not a millimetre. */
  onReorderBlocks: (fromBlockId: string, toBlockId: string) => void;
  /** Called when the selected box's row-break tab is clicked (#1214): start a new row at this box,
   *  or stop doing so. The panel's checkbox writes the same thing. */
  onToggleRowBreak: (entryId: string, stampId: string, on: boolean) => void;
  /** Called when the selected block's line tab is clicked (#1421): start it on its own line rather
   *  than beside the block before it, or stop doing so. The panel's checkbox writes the same thing. */
  onToggleBandBreak: (blockId: string, on: boolean) => void;
  /** Opens the translation editor for a text that fell back to the default language (#298/#300). */
  onOpenGaps: (text: AlbumEditorText, at: { left: number; bottom: number }) => void;
}

/**
 * The same sheet as a **picture** — the album template's preview (#795).
 *
 * Nothing on it can be picked up, selected or dragged, and the cursors say so. A separate shape
 * rather than a set of no-op handlers, for the reason the union above exists: a canvas handed six
 * functions that do nothing still draws grab cursors and drop marks, which is a promise about what a
 * gesture will do, made by a surface where nothing happens.
 *
 * The template dialog draws it because reusing this component is the only way its preview and the
 * printed card can be guaranteed to agree — see `album-preview.ts`.
 */
interface AlbumPageCanvasStatic extends AlbumPageCanvasBase {
  interactive: false;
  /** What the Page template dialog's field in hand controls on this sheet (#1431), drawn over it. */
  marks?: readonly AlbumFieldMark[];
}

type AlbumPageCanvasProps = AlbumPageCanvasInteractive | AlbumPageCanvasStatic;

export function AlbumPageCanvas(props: AlbumPageCanvasProps) {
  const { sheet, collectionId, zoom } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const preset = sheet.preset;
  /** Whether this canvas is the editor's or a picture of a sheet. */
  const interactive = props.interactive !== false;
  const selection = props.interactive === false ? null : props.selection;
  const drag = props.interactive === false ? null : props.drag;
  const onSelect = props.interactive === false ? NO_SELECT : props.onSelect;
  const onDrag = props.interactive === false ? NO_DRAG : props.onDrag;
  const onDragEnd = props.interactive === false ? NO_DRAG_END : props.onDragEnd;
  const onReorder = props.interactive === false ? NO_REORDER : props.onReorder;
  const onReorderBlocks = props.interactive === false ? NO_REORDER_BLOCKS : props.onReorderBlocks;
  const onToggleRowBreak = props.interactive === false ? NO_ROW_BREAK : props.onToggleRowBreak;
  const onToggleBandBreak = props.interactive === false ? NO_BAND_BREAK : props.onToggleBandBreak;
  const onOpenGaps = props.interactive === false ? NO_OPEN_GAPS : props.onOpenGaps;
  /** A printed sheet may be looked at and selected but not changed (#778); a preview may only be
   *  looked at. Everything that writes reads this; everything that only highlights reads
   *  `interactive`. */
  const readOnly = sheet.readOnly || !interactive;
  /** What is being carried between press and release — a box, or a block by its heading. State
   *  rather than a ref, because the whole point of holding it is to draw it (#816). */
  const [carry, setCarry] = useState<AlbumCarry | null>(null);
  /** The target under the pointer, by {@link boxKey} or by block id. Only the carry decides whether
   *  anything is drawn over it; this only says which one the pointer is on. */
  const [over, setOver] = useState<string | null>(null);

  // A press let go over blank paper is not a drop, and nothing on the canvas hears about it — so the
  // release is heard on the window, or the lifted box would stay lifted until the next press. The
  // target's own handler runs first (React listens at its root, inside the window), so a real drop
  // has already been committed by the time this clears it.
  useEffect(() => {
    if (!carry) return;
    const drop = () => {
      setCarry(null);
      setOver(null);
    };
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [carry]);

  /** Pixels to millimetres, off the rendered frame. Reading the DOM for a **scale factor** is not
   *  measuring: it asks how big the drawing is on screen, never how wide a word is. */
  function pxToMm(px: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    return (px * preset.pageHeightMm) / rect.height;
  }

  function startDrag(
    e: React.PointerEvent,
    kind: CanvasDrag["kind"],
    blockId: string,
    stampId?: string,
    elementId?: string
  ) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    let live: CanvasDrag = { kind, blockId, stampId, elementId, dxMm: 0, dyMm: 0 };

    const move = (raw: Event) => {
      const ev = raw as PointerEvent;
      live = {
        kind,
        blockId,
        stampId,
        elementId,
        dxMm: pxToMm(ev.clientX - startX),
        dyMm: pxToMm(ev.clientY - startY),
      };
      onDrag(live);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onDrag(null);
      if (live.dxMm !== 0 || live.dyMm !== 0) onDragEnd(live);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  /** How far this block's contents are shifted by a drag in progress. Zero unless the collector is
   *  holding this block's own *space before* handle — space **after** moves nothing on this sheet,
   *  since it opens a gap under the block and everything below it has already been placed. */
  function spaceOffset(blockId: string): number {
    return drag?.kind === "space" && drag.blockId === blockId ? drag.dyMm : 0;
  }

  /** The gap a *space after* drag is opening, drawn as a band under the block so the figure being
   *  chosen is visible while it is being chosen. */
  function trailingOffset(blockId: string): number {
    return drag?.kind === "spaceAfter" && drag.blockId === blockId ? drag.dyMm : 0;
  }

  /** Which page boxes belong to which block — the page's boxes are grouped in block order by
   *  construction, but the box rows carry their entry, and a split block is one entry on two sheets,
   *  so the block a box is drawn under is the one whose slice it falls in. */
  const blockOfBox = new Map<number, string>();
  {
    let cursor = 0;
    for (const block of sheet.blocks) {
      for (let n = 0; n < block.boxCount; n += 1) blockOfBox.set(cursor + n, block.id);
      cursor += block.boxCount;
    }
  }

  function drawText(
    text: AlbumEditorText,
    key: string,
    dy: number,
    flagged: boolean,
    dx = 0
  ) {
    const style: React.CSSProperties = {
      fontFamily: text.face.cssStack,
      fontWeight: text.face.bold ? 700 : 400,
      fontStyle: text.face.italic ? "italic" : "normal",
    };
    // The alignment is a paint difference like the centring always was: the line is anchored where
    // `albumLineStartMm` puts it in the PDF, and the browser's own face sets the ink from there.
    const anchorX =
      text.align === "left"
        ? text.xMm
        : text.align === "right"
          ? text.xMm + text.widthMm
          : text.xMm + text.widthMm / 2;
    const textAnchor = text.align === "left" ? "start" : text.align === "right" ? "end" : "middle";
    return (
      <g key={key}>
        {text.lines.map((line, i) => (
          <text
            key={i}
            x={anchorX + dx}
            y={text.yMm + dy + i * text.face.lineHeightMm + text.face.baselineOffsetMm}
            fontSize={text.face.sizeMm}
            textAnchor={textAnchor}
            fill={INK}
            style={style}
          >
            {line}
          </text>
        ))}
        {flagged && (
          // A dotted rule under a text that fell back to the default language (#298), and clicking it
          // opens the same editor the offer preview's flagged token opens (#300). On a screen a
          // fallback is a small annoyance; on a card glued into a binder it is permanent.
          <rect
            x={text.xMm}
            y={text.yMm + dy}
            width={text.widthMm}
            height={Math.max(text.heightMm, text.face.lineHeightMm)}
            fill="transparent"
            stroke={FLAG.inherited.colour}
            strokeWidth={0.3 * MM}
            strokeDasharray="0.6 0.6"
            // On a preview the rule still says the text fell back — that is worth seeing on a real
            // album drawn under a template being edited — but it opens nothing, so it neither takes
            // the pointer nor claims it can be clicked.
            style={{ cursor: interactive ? "pointer" : "default" }}
            pointerEvents={interactive ? undefined : "none"}
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.target as Element).getBoundingClientRect();
              onOpenGaps(text, { left: r.left, bottom: r.bottom });
            }}
          />
        )}
      </g>
    );
  }

  const boxDash = (weightMm: number) =>
    preset.boxBorderStyle === "dashed"
      ? "1.5 1"
      : preset.boxBorderStyle === "dotted"
        ? `${weightMm} ${weightMm * 2}`
        : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${preset.pageWidthMm} ${preset.pageHeightMm}`}
      // Rendered in **CSS millimetres**, so 100% is the sheet at 1:1 on a display that reports its
      // own DPI honestly. It proves nothing about the printed card — a viewer applies its own zoom
      // and the print dialog applies another (ADR-0046) — but it is the right default for a screen
      // whose subject is a piece of paper.
      style={{
        width: `${preset.pageWidthMm * zoom}mm`,
        height: `${preset.pageHeightMm * zoom}mm`,
        background: PAPER,
        border: `1px solid ${SHEET_EDGE}`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
        flexShrink: 0,
        touchAction: "none",
        // A drawing surface, and never a document: press-and-move over it is a drag, so without this
        // the catalog numbers under the boxes get selected on the way (#816). Always rather than only
        // while carrying — there is nothing here anyone copies, the sheet's words all exist as rows
        // elsewhere, and a rule that only holds during a gesture is one more thing to keep in step.
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      onPointerDown={() => onSelect(null)}
    >
      {/* The template's own frame — rules and corner ornaments, placed by `album-frame.ts`, which the
          PDF draws from too — and then the content frame, a drawing aid that is on no card, which is
          why it is the palest thing here. */}
      <SheetFrame
        preset={preset}
        ornament={sheet.frameOrnament}
        title={sheet.title}
        footer={sheet.footer}
      />
      <rect
        x={sheet.content.xMm}
        y={sheet.content.yMm}
        width={sheet.content.widthMm}
        height={sheet.content.heightMm}
        fill="none"
        stroke={GUIDE}
        strokeWidth={0.2 * MM}
        strokeDasharray="2 2"
      />

      {/* The running head is the album's name, and is flagged when that name is still the area's
          default-language one with nothing in the album's language to replace it (#1308). */}
      {sheet.title && drawText(sheet.title, "title", 0, sheet.title.gaps.length > 0)}
      {sheet.chapter &&
        drawText(sheet.chapter, "chapter", 0, sheet.chapter.gaps.length > 0)}
      {sheet.footer && drawText(sheet.footer, "footer", 0, sheet.footer.gaps.length > 0)}

      {/* A page without stamps (#1429): its pictures and texts in their drawing order, each where the
          collector put it. Picked up anywhere to move it; the handle on the selected one widens it. */}
      {sheet.free?.elements.map((el) => (
        <FreeElement
          key={el.id}
          el={el}
          collectionId={collectionId}
          freePageId={sheet.free!.id}
          chosen={selection?.kind === "element" && selection.id === el.id}
          drag={drag?.elementId === el.id ? drag : null}
          interactive={interactive}
          readOnly={readOnly}
          drawText={drawText}
          onSelect={() => onSelect({ kind: "element", id: el.id })}
          onStartDrag={startDrag}
        />
      ))}

      {/* Headings, in the order the blocks that own them were placed. An issue heading (#1509) is
          owned by the block it stands over, the first of its run on the sheet. */}
      {sheet.headings.map((heading, i) => {
        const block = sheet.blocks.find(
          (b): b is AlbumEditorBlock & { kind: "entry" | "text" } =>
            b.kind !== "page" && (b.headingIndex === i || b.issueHeadingIndex === i)
        );
        const dy = block ? spaceOffset(block.id) : 0;
        const bandMm = Math.max(heading.heightMm, heading.face.lineHeightMm);
        const lifted = carry?.kind === "block" && !!block && carry.blockId === block.id;
        const mark: AlbumDropMark | null =
          block && over === block.id
            ? blockDropMark(carry, { blockId: block.id, blockKind: block.kind })
            : null;
        return (
          <g
            key={`h${i}`}
            style={{ cursor: readOnly ? "default" : "grab" }}
            opacity={lifted ? 0.4 : undefined}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!block) return;
              onSelect({ kind: "block", id: block.id });
              if (!readOnly) {
                setCarry({ kind: "block", blockId: block.id, blockKind: block.kind });
              }
            }}
            // Only while something is in hand: outside a drag this is a re-render for every box the
            // pointer crosses, and nothing would be drawn with it.
            onPointerEnter={() => {
              if (carry && block) setOver(block.id);
            }}
            onPointerLeave={() => setOver((prev) => (prev === block?.id ? null : prev))}
            onPointerUp={() => {
              const held = carry;
              setCarry(null);
              setOver(null);
              if (!held || held.kind !== "block" || !block) return;
              // The same function that decided whether to draw a mark decides whether to fire, so a
              // drop can never do something the canvas did not promise — or promise something it does
              // not do. The one drop this stops making a call for is a checklist onto a note, which
              // the screen already discarded: a note is not in the entry order to be positioned in.
              if (!blockDropMark(held, { blockId: block.id, blockKind: block.kind })) return;
              onReorderBlocks(held.blockId, block.id);
            }}
          >
            {/* The heading's own band is the drop target, so a block can be picked up anywhere along
                it rather than only where its words happen to fall. */}
            <rect
              x={heading.xMm}
              y={heading.yMm + dy}
              width={heading.widthMm}
              height={bandMm}
              fill="transparent"
            />
            {drawText(heading, `heading-${i}`, dy, heading.gaps.length > 0)}
            {lifted && (
              // Faded and outlined in the drag colour: this is the one in hand. The dashes say it is
              // not where it lives — the solid rectangle on this canvas means *selected*.
              <rect
                x={heading.xMm - 0.8}
                y={heading.yMm + dy - 0.8}
                width={heading.widthMm + 1.6}
                height={bandMm + 1.6}
                fill="none"
                stroke={HANDLE}
                strokeWidth={0.4 * MM}
                strokeDasharray="1.5 1.2"
                pointerEvents="none"
              />
            )}
            {mark === "insert-before" && (
              // A rule across the content width, above the block it would go in front of. The order
              // is written insert-before, so this is where the carried checklist lands and this
              // heading is what moves down — never an exchange of places.
              <rect
                x={sheet.content.xMm}
                y={heading.yMm + dy - 1.6}
                width={sheet.content.widthMm}
                height={MARK_MM}
                rx={MARK_MM / 2}
                fill={HANDLE}
                pointerEvents="none"
              />
            )}
            {mark === "file-here" && (
              // A note is filed *against* a block rather than slotted between two of them, so what is
              // marked is the block itself. Same soft plate the *space after* band is drawn with.
              <>
                <rect
                  x={heading.xMm}
                  y={heading.yMm + dy}
                  width={heading.widthMm}
                  height={bandMm}
                  fill={HANDLE}
                  opacity={0.14}
                  pointerEvents="none"
                />
                <rect
                  x={heading.xMm}
                  y={heading.yMm + dy}
                  width={heading.widthMm}
                  height={bandMm}
                  fill="none"
                  stroke={HANDLE}
                  strokeWidth={0.3 * MM}
                  pointerEvents="none"
                />
              </>
            )}
          </g>
        );
      })}

      {/* Boxes. */}
      {sheet.boxes.map((box, i) => {
        const blockId = blockOfBox.get(i) ?? box.entryId;
        const dy = spaceOffset(blockId);
        const sizing =
          drag?.kind === "size" && drag.stampId === box.stampId && drag.blockId === blockId
            ? drag
            : null;
        const widthMm = Math.max(1, box.widthMm + (sizing?.dxMm ?? 0));
        const heightMm = Math.max(1, box.heightMm + (sizing?.dyMm ?? 0));
        const chosen = isBoxSelected(selection, box);
        /** The one box selected, which alone carries the handles: a size handle or a row-break tab
         *  on each of several boxes would promise a gesture for all of them that moves one. */
        const alone = chosen && selection?.kind === "box";
        const flag = boxFlag(box);
        // The outline lies inside the box, as it does in the PDF (#1466); with none, the bare box is
        // still what takes the pointer.
        const outline = albumBoxOutline(preset, { xMm: box.xMm, yMm: box.yMm + dy, widthMm, heightMm });
        const lifted =
          carry?.kind === "box" && carry.blockId === blockId && carry.stampId === box.stampId;
        const mark: AlbumDropMark | null =
          over === boxKey(blockId, box.stampId)
            ? boxDropMark(carry, { blockId, stampId: box.stampId })
            : null;
        return (
          <g key={`b${i}`} opacity={lifted ? 0.4 : undefined}>
            {/* The sheet's own preset decides, as it does for the PDF: the album's for a live sheet,
                the card's for a printed one — a card set without photos draws none (#1307). */}
            {box.photoId && preset.printPhotos && (
              <image
                href={photoThumbUrl(collectionId, box.photoId)}
                x={box.xMm}
                y={box.yMm + dy}
                width={widthMm}
                height={heightMm}
                // Fits, never crops — `THUMB_OBJECT_FIT`'s rule, and stronger here: the mount is
                // size-true because a hawid is about to be cut to it (ADR-0046 §9).
                preserveAspectRatio="xMidYMid meet"
                opacity={preset.photoOpacityPercent / 100}
              />
            )}
            <rect
              x={outline?.rect.xMm ?? box.xMm}
              y={outline?.rect.yMm ?? box.yMm + dy}
              width={outline?.rect.widthMm ?? widthMm}
              height={outline?.rect.heightMm ?? heightMm}
              fill="transparent"
              stroke={outline ? INK : "none"}
              strokeWidth={outline?.weightMm}
              strokeDasharray={outline ? boxDash(outline.weightMm) : undefined}
              style={{
                cursor: !interactive ? "default" : readOnly ? "pointer" : "grab",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                // Shift (or the platform's command key) adds the box to what is selected, or takes
                // it off (#1309), and picks nothing up: a group is selected to be given one size,
                // and a press that also lifted the box would reorder it on the way.
                if (!readOnly && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                  onSelect(
                    toggleBoxSelection(selection, { entryId: box.entryId, stampId: box.stampId })
                  );
                  return;
                }
                onSelect({ kind: "box", entryId: box.entryId, stampId: box.stampId });
                if (!readOnly) setCarry({ kind: "box", blockId, stampId: box.stampId });
              }}
              onPointerEnter={() => {
                if (carry) setOver(boxKey(blockId, box.stampId));
              }}
              onPointerLeave={() =>
                setOver((prev) => (prev === boxKey(blockId, box.stampId) ? null : prev))
              }
              onPointerUp={() => {
                const held = carry;
                setCarry(null);
                setOver(null);
                if (!held || held.kind !== "box") return;
                // One function for the mark and for the drop — see the heading above.
                if (!boxDropMark(held, { blockId, stampId: box.stampId })) return;
                onReorder(blockId, held.stampId, box.stampId);
              }}
            />
            {flag && (
              <rect
                x={box.xMm - 0.6}
                y={box.yMm + dy - 0.6}
                width={widthMm + 1.2}
                height={heightMm + 1.2}
                fill="none"
                stroke={FLAG[flag].colour}
                strokeWidth={0.4 * MM}
                strokeDasharray={flag === "corrected" ? undefined : "1.5 1"}
                pointerEvents="none"
              />
            )}
            {(chosen || lifted) && (
              // One rectangle doing two jobs: solid it means *selected*, dashed it means *in hand*.
              // A box being carried is always the selected one — picking it up selects it — so a
              // second outline over the first would only be two blue rings around one box.
              <rect
                x={box.xMm - 1.4}
                y={box.yMm + dy - 1.4}
                width={widthMm + 2.8}
                height={heightMm + 2.8}
                fill="none"
                stroke={HANDLE}
                strokeWidth={0.5 * MM}
                strokeDasharray={lifted ? "1.5 1.2" : undefined}
                pointerEvents="none"
              />
            )}
            {mark === "insert-before" && (
              // A bar in the gap in front of this box, on its leading edge. The order is written
              // insert-before: the carried box takes *this* box's place and this one moves along, so
              // the honest mark is the slot it lands in and not a second highlighted box, which would
              // read as a swap and predict the wrong result every time.
              <rect
                x={box.xMm - 1.7}
                y={box.yMm + dy - 0.8}
                width={MARK_MM}
                height={heightMm + 1.6}
                rx={MARK_MM / 2}
                fill={HANDLE}
                pointerEvents="none"
              />
            )}
            {alone && !readOnly && (
              // The size handle. Dragging it writes the number the panel shows, and typing that
              // number moves this rectangle — neither is the real interface with the other a
              // fallback.
              <rect
                x={box.xMm + widthMm - 1.6}
                y={box.yMm + dy + heightMm - 1.6}
                width={3.2}
                height={3.2}
                fill={HANDLE}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(e) => startDrag(e, "size", blockId, box.stampId)}
              />
            )}
            {box.rowBreakable && box.rowBreakBefore && !alone && (
              // **A row starts here by hand** (#1214): a bracket round the box's top-left corner,
              // outside it. Not a bar beside the box — that is the reorder kit's insertion mark and
              // would read as *something will be put here* — and not a ring, which says *selected*
              // or *flagged*. A drawing aid in the handle colour, like every other: on no card.
              <path
                d={`M ${box.xMm - 1.2} ${box.yMm + dy + 4} V ${box.yMm + dy - 1.2} H ${box.xMm + 4}`}
                fill="none"
                stroke={HANDLE}
                strokeWidth={0.5 * MM}
                pointerEvents="none"
              />
            )}
            {alone && !readOnly && box.rowBreakable && (
              // The row-break tab, on the corner opposite the size handle: filled when a new row
              // starts at this box, hollow when it does not, and a click turns it over. Offered only
              // where a break could mean anything — never on a block's first box, which already
              // starts a row, so the tab cannot promise a break the layout would ignore.
              <rect
                x={box.xMm - 1.6}
                y={box.yMm + dy - 1.6}
                width={3.2}
                height={3.2}
                fill={box.rowBreakBefore ? HANDLE : PAPER}
                stroke={HANDLE}
                strokeWidth={0.4 * MM}
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleRowBreak(box.entryId, box.stampId, !box.rowBreakBefore);
                }}
              />
            )}
            {box.label && drawText(box.label, `l${i}`, dy, box.label.gaps.length > 0)}
          </g>
        );
      })}

      {sheet.blocks.map((block) => {
        // **A block starts its own line by hand** (#1421) — #1214's row-break language one level up,
        // drawn at the block's top-left corner rather than a box's: a bracket when it is set, and on
        // the selected block the tab that turns it over, filled when set and hollow when not. Offered
        // only where it could mean anything (`bandBreakable`), so the tab never promises a line the
        // layout would ignore.
        if (!block.bandBreakable) return null;
        const corner = blockCornerMm(sheet, block.id);
        if (!corner) return null;
        const on = block.correction?.bandBreakBefore === true;
        const chosen = selection?.kind === "block" && selection.id === block.id;
        const y = corner.yMm + spaceOffset(block.id);
        if (chosen && !readOnly) {
          return (
            <rect
              key={`band-${block.id}`}
              x={corner.xMm - 1.6}
              y={y - 1.6}
              width={3.2}
              height={3.2}
              fill={on ? HANDLE : PAPER}
              stroke={HANDLE}
              strokeWidth={0.4 * MM}
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleBandBreak(block.id, !on);
              }}
            />
          );
        }
        if (!on) return null;
        return (
          <path
            key={`band-${block.id}`}
            d={`M ${corner.xMm - 1.2} ${y + 4} V ${y - 1.2} H ${corner.xMm + 4}`}
            fill="none"
            stroke={HANDLE}
            strokeWidth={0.5 * MM}
            pointerEvents="none"
          />
        );
      })}

      {!readOnly && selection?.kind === "block" && (
        // The two space handles for the selected block: grips in the left margin at its own top and
        // bottom edges, dragged down to open a gap and up to close one. Their own component, because
        // an inline function created during render may not reach the ref `startDrag` reads.
        <BlockSpaceHandles
          sheet={sheet}
          blockId={selection.id}
          beforeMm={spaceOffset(selection.id)}
          afterMm={trailingOffset(selection.id)}
          onStartDrag={startDrag}
        />
      )}

      {props.interactive === false && props.marks && props.marks.length > 0 && (
        <FieldMarks marks={props.marks} pageWidthMm={preset.pageWidthMm} />
      )}
    </svg>
  );
}

/**
 * The Page template dialog's marks (#1431), drawn over the sheet: a dimension line with its value for
 * a distance, an outline for an element. Where they go is `album-field-marks.ts`'s answer from the
 * placed geometry; this only paints it, last, so nothing on the sheet covers it.
 */
function FieldMarks({
  marks,
  pageWidthMm,
}: {
  marks: readonly AlbumFieldMark[];
  pageWidthMm: number;
}) {
  const TICK = 1.6;
  const text = {
    fontSize: 3.2,
    fontWeight: 600,
    fill: MARK,
    // A white halo, so the figure reads over ink and rules alike.
    stroke: PAPER,
    strokeWidth: 0.9,
    paintOrder: "stroke" as const,
    style: { fontFamily: "system-ui, sans-serif" },
  };
  return (
    <g pointerEvents="none">
      {marks.map((mark, i) => {
        if (mark.kind === "outline") {
          // Outset, so the outline does not sit on a box's own rule and hide it.
          const r = mark.rect;
          return (
            <rect
              key={i}
              x={r.xMm - 0.8}
              y={r.yMm - 0.8}
              width={r.widthMm + 1.6}
              height={r.heightMm + 1.6}
              fill={MARK}
              fillOpacity={0.07}
              stroke={MARK}
              strokeWidth={0.45 * MM}
            />
          );
        }
        const label = `${Number(mark.valueMm.toFixed(ALBUM_MM_DECIMALS))} mm`;
        const mid = (mark.fromMm + mark.toMm) / 2;
        if (mark.axis === "x") {
          return (
            <g key={i}>
              <line x1={mark.fromMm} y1={mark.atMm} x2={mark.toMm} y2={mark.atMm} stroke={MARK} strokeWidth={0.4 * MM} />
              {[mark.fromMm, mark.toMm].map((x, j) => (
                <line key={j} x1={x} y1={mark.atMm - TICK} x2={x} y2={mark.atMm + TICK} stroke={MARK} strokeWidth={0.4 * MM} />
              ))}
              <text
                x={mid}
                y={mark.atMm < 6 ? mark.atMm + TICK + 3.4 : mark.atMm - TICK - 0.8}
                textAnchor="middle"
                {...text}
              >
                {label}
              </text>
            </g>
          );
        }
        // Beside the line, on whichever side has the room.
        const leftward = mark.atMm > pageWidthMm - 22;
        return (
          <g key={i}>
            <line x1={mark.atMm} y1={mark.fromMm} x2={mark.atMm} y2={mark.toMm} stroke={MARK} strokeWidth={0.4 * MM} />
            {[mark.fromMm, mark.toMm].map((y, j) => (
              <line key={j} x1={mark.atMm - TICK} y1={y} x2={mark.atMm + TICK} y2={y} stroke={MARK} strokeWidth={0.4 * MM} />
            ))}
            <text
              x={leftward ? mark.atMm - TICK - 0.8 : mark.atMm + TICK + 0.8}
              y={mid}
              textAnchor={leftward ? "end" : "start"}
              dominantBaseline="middle"
              {...text}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * One element of a free page (#1429), drawn where the collector put it and following a drag in
 * progress. A component of its own so that `onStartDrag` — which reads the SVG's frame to turn pixels
 * into millimetres — is only called from an event handler, `BlockSpaceHandles`' reason.
 *
 * The offset drawn while a handle is held is the whole of the preview: a move shifts the element, a
 * widening widens it — and a picture's height follows, since its proportions are its own. A text's
 * lines are re-wrapped by the server on release, never here (ADR-0045 §7).
 */
function FreeElement({
  el,
  collectionId,
  freePageId,
  chosen,
  drag,
  interactive,
  readOnly,
  drawText,
  onSelect,
  onStartDrag,
}: {
  el: AlbumEditorFreeElement;
  collectionId: string;
  freePageId: string;
  chosen: boolean;
  drag: CanvasDrag | null;
  interactive: boolean;
  readOnly: boolean;
  drawText: (text: AlbumEditorText, key: string, dy: number, flagged: boolean, dx?: number) => React.ReactNode;
  onSelect: () => void;
  onStartDrag: (
    e: React.PointerEvent,
    kind: CanvasDrag["kind"],
    blockId: string,
    stampId?: string,
    elementId?: string
  ) => void;
}) {
  const dx = drag?.kind === "move" ? drag.dxMm : 0;
  const dy = drag?.kind === "move" ? drag.dyMm : 0;
  const widthMm = Math.max(1, el.widthMm + (drag?.kind === "width" ? drag.dxMm : 0));
  const heightMm =
    el.kind === "picture" && el.widthMm > 0 ? (el.heightMm * widthMm) / el.widthMm : el.heightMm;
  const x = el.xMm + dx;
  const y = el.yMm + dy;
  /** Something to pick up, even for a text with no lines yet. */
  const bandMm = Math.max(heightMm, el.kind === "text" ? el.placed.face.lineHeightMm : 1);
  return (
    <g>
      {el.kind === "picture" ? (
        <image
          href={albumPictureUrl(collectionId, el.pictureId)}
          x={x}
          y={y}
          width={widthMm}
          height={heightMm}
          // Fits, never crops — and the rectangle already has the picture's proportions.
          preserveAspectRatio="xMidYMid meet"
          pointerEvents="none"
        />
      ) : (
        drawText({ ...el.placed, widthMm: drag?.kind === "width" ? widthMm : el.placed.widthMm }, `t-${el.id}`, dy, false, dx)
      )}
      <rect
        x={x}
        y={y}
        width={widthMm}
        height={bandMm}
        fill="transparent"
        stroke={el.kind === "picture" && el.tooCoarse ? COARSE : "none"}
        strokeWidth={0.4 * MM}
        strokeDasharray="1.5 1"
        style={{ cursor: !interactive ? "default" : readOnly ? "pointer" : "move" }}
        pointerEvents={interactive ? undefined : "none"}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect();
          onStartDrag(e, "move", freePageId, undefined, el.id);
        }}
      />
      {chosen && (
        <rect
          x={x - 1}
          y={y - 1}
          width={widthMm + 2}
          height={bandMm + 2}
          fill="none"
          stroke={HANDLE}
          strokeWidth={0.5 * MM}
          strokeDasharray={drag ? "1.5 1.2" : undefined}
          pointerEvents="none"
        />
      )}
      {chosen && !readOnly && (
        // The width handle, on the right edge: dragged, it writes the width the panel shows, and
        // typing that width moves it — one figure, two ways in (#769).
        <rect
          x={x + widthMm - 1.6}
          y={y + bandMm / 2 - 1.6}
          width={3.2}
          height={3.2}
          fill={HANDLE}
          style={{ cursor: "ew-resize" }}
          onPointerDown={(e) => onStartDrag(e, "width", freePageId, undefined, el.id)}
        />
      )}
    </g>
  );
}

/**
 * The two grips the space corrections are dragged by.
 *
 * A component rather than a branch inside the canvas so that `onStartDrag` — which reads the SVG's
 * own frame to turn pixels into millimetres — is only ever called from an event handler.
 */
function BlockSpaceHandles({
  sheet,
  blockId,
  beforeMm,
  afterMm,
  onStartDrag,
}: {
  sheet: AlbumEditorSheet;
  blockId: string;
  beforeMm: number;
  afterMm: number;
  onStartDrag: (
    e: React.PointerEvent,
    kind: CanvasDrag["kind"],
    blockId: string,
    stampId?: string
  ) => void;
}) {
  const top = blockTopMm(sheet, blockId);
  const bottom = blockBottomMm(sheet, blockId);
  if (top === null) return null;

  const edge = (yMm: number, kind: "space" | "spaceAfter") => (
    <>
      <line
        x1={sheet.content.xMm}
        y1={yMm}
        x2={sheet.content.xMm + sheet.content.widthMm}
        y2={yMm}
        stroke={HANDLE}
        strokeWidth={0.4}
        strokeDasharray="2 1.5"
        pointerEvents="none"
      />
      <rect
        x={sheet.content.xMm - 5}
        y={yMm - 2}
        width={4}
        height={4}
        rx={0.8}
        fill={HANDLE}
        style={{ cursor: "ns-resize" }}
        onPointerDown={(e) => onStartDrag(e, kind, blockId)}
      />
    </>
  );

  return (
    <g>
      {edge(top + beforeMm, "space")}
      {bottom !== null && (
        <>
          {afterMm !== 0 && (
            // The gap being opened, drawn while it is being chosen. Nothing below moves: the blocks
            // under this one were placed before the handle was touched, and the re-plan that moves
            // them happens on the server when it is let go.
            <rect
              x={sheet.content.xMm}
              y={bottom + beforeMm + Math.min(0, afterMm)}
              width={sheet.content.widthMm}
              height={Math.abs(afterMm)}
              fill={HANDLE}
              opacity={0.12}
              pointerEvents="none"
            />
          )}
          {edge(bottom + beforeMm + afterMm, "spaceAfter")}
        </>
      )}
    </g>
  );
}

/** The bottom of a block on this sheet: under its last box and that box's label, or under its
 *  heading for a block with no boxes on this sheet. The *space after* handle hangs here. */
function blockBottomMm(sheet: AlbumEditorSheet, blockId: string): number | null {
  let cursor = 0;
  for (const block of sheet.blocks) {
    if (block.id !== blockId) {
      cursor += block.boxCount;
      continue;
    }
    const slice = sheet.boxes.slice(cursor, cursor + block.boxCount);
    if (slice.length === 0) {
      const at = block.headingIndex ?? block.issueHeadingIndex;
      const heading = at !== null ? sheet.headings[at] : undefined;
      return heading ? heading.yMm + heading.heightMm : null;
    }
    return Math.max(
      ...slice.map((box) =>
        Math.max(
          box.yMm + box.heightMm,
          box.label ? box.label.yMm + box.label.heightMm : 0
        )
      )
    );
  }
  return null;
}

/** The top-left corner of a block on this sheet: its heading's if it has one — the heading spans the
 *  block's own column — otherwise its first box's. Where the line tab hangs (#1421). An issue heading
 *  over it (#1509) spans the whole band, not the block's column, so it is not the block's corner. */
function blockCornerMm(
  sheet: AlbumEditorSheet,
  blockId: string
): { xMm: number; yMm: number } | null {
  const own = sheet.blocks.find((b) => b.id === blockId)?.headingIndex ?? null;
  const heading = own !== null ? sheet.headings[own] : undefined;
  if (heading) return { xMm: heading.xMm, yMm: heading.yMm };
  let cursor = 0;
  for (const block of sheet.blocks) {
    if (block.id === blockId) {
      const box = sheet.boxes[cursor];
      return box ? { xMm: box.xMm, yMm: box.yMm } : null;
    }
    cursor += block.boxCount;
  }
  return null;
}

/** The top of a block on this sheet: the issue heading over it if it opens one (#1509) — its space
 *  before is spent above that heading — else its heading if it has one, otherwise its first box. Used
 *  only to hang the space handle where the collector would reach for it — the number it writes is
 *  the correction, not this coordinate. */
function blockTopMm(sheet: AlbumEditorSheet, blockId: string): number | null {
  const block = sheet.blocks.find((b) => b.id === blockId);
  const at = block?.issueHeadingIndex ?? block?.headingIndex ?? null;
  if (at !== null && sheet.headings[at]) {
    return sheet.headings[at].yMm;
  }
  let cursor = 0;
  for (const block of sheet.blocks) {
    if (block.id === blockId) {
      return sheet.boxes[cursor]?.yMm ?? null;
    }
    cursor += block.boxCount;
  }
  return null;
}
