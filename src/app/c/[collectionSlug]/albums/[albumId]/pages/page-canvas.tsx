"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AlbumEditorBox,
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

/**
 * What a box is flagged for, in the order the flags are worth reading.
 *
 * All three are things a collector needs to know **before** a sheet goes into the printer and never
 * after, which is why they are shown here and are kept off the paper (ADR-0047 §9): a hawid cut to
 * an inherited figure as if it had been measured is gone, and so is one cut for a box nobody can
 * supply. `corrected` is not a warning at all — it says a figure is the collector's own, so that a
 * page they no longer remember correcting does not read as one the rule produced.
 */
const FLAG = {
  unmeasured: { colour: "#c2410c", label: "No size anywhere on the checklist" },
  oversize: { colour: "#b45309", label: "Pocket — no strip is tall enough" },
  inherited: { colour: "#a16207", label: "Sized from a neighbour, not measured" },
  corrected: { colour: "#1d4ed8", label: "Corrected by hand" },
} as const;

export type AlbumBoxFlag = keyof typeof FLAG;

export function boxFlag(box: AlbumEditorBox): AlbumBoxFlag | null {
  if (box.sizeSource === null) return "unmeasured";
  if (box.stripLabel === null) return "oversize";
  if (box.sizeSource === "inherited") return "inherited";
  if (box.adjustment) return "corrected";
  return null;
}

export const BOX_FLAGS = FLAG;

/** What is selected on the canvas. A box is named by the pair that identifies **one box** — the
 *  entry and the stamp — because a box is a slot and one stamp can have two of them (ADR-0047 §2). */
export type CanvasSelection =
  | { kind: "box"; entryId: string; stampId: string }
  | { kind: "block"; id: string }
  | null;

/** A drag in progress, as millimetres already moved. Applied as an offset to what is drawn and to
 *  nothing else; the server re-plans when it ends. */
export interface CanvasDrag {
  kind: "space" | "spaceAfter" | "size";
  /** The block, or the box's block. */
  blockId: string;
  stampId?: string;
  dxMm: number;
  dyMm: number;
}

/** A box's identity as one string, for saying which one the pointer is over. The pair is what names
 *  a box (ADR-0047 §2) and both halves are cuids, so a colon cannot occur inside either. */
function boxKey(blockId: string, stampId: string): string {
  return `${blockId}:${stampId}`;
}

/** The insertion mark's own weight: 0.8 mm is about three pixels at 1:1, which is the thickness the
 *  shared reorder kit draws its line at (`reorder-list.tsx`). */
const MARK_MM = 0.8;

interface AlbumPageCanvasProps {
  sheet: AlbumEditorSheet;
  collectionId: string;
  zoom: number;
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
  /** Opens the translation editor for a text that fell back to the default language (#298/#300). */
  onOpenGaps: (text: AlbumEditorText, at: { left: number; bottom: number }) => void;
}

export function AlbumPageCanvas({
  sheet,
  collectionId,
  zoom,
  selection,
  onSelect,
  drag,
  onDrag,
  onDragEnd,
  onReorder,
  onReorderBlocks,
  onOpenGaps,
}: AlbumPageCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const preset = sheet.preset;
  const readOnly = sheet.readOnly;
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
    stampId?: string
  ) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    let live: CanvasDrag = { kind, blockId, stampId, dxMm: 0, dyMm: 0 };

    const move = (raw: Event) => {
      const ev = raw as PointerEvent;
      live = {
        kind,
        blockId,
        stampId,
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

  function drawText(text: AlbumEditorText, key: string, dy: number, flagged: boolean) {
    const style: React.CSSProperties = {
      fontFamily: text.face.cssStack,
      fontWeight: text.face.bold ? 700 : 400,
      fontStyle: text.face.italic ? "italic" : "normal",
    };
    return (
      <g key={key}>
        {text.lines.map((line, i) => (
          <text
            key={i}
            x={text.xMm + text.widthMm / 2}
            y={text.yMm + dy + i * text.face.lineHeightMm + text.face.baselineOffsetMm}
            fontSize={text.face.sizeMm}
            textAnchor="middle"
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
            style={{ cursor: "pointer" }}
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

  const boxDash =
    preset.boxBorderStyle === "dashed"
      ? "1.5 1"
      : preset.boxBorderStyle === "dotted"
        ? `${preset.boxBorderWidthMm} ${preset.boxBorderWidthMm * 2}`
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
      {/* The template's own decorative border, and then the content frame — a drawing aid that is on
          no card, which is why it is the palest thing here. */}
      {preset.borderStyle !== "none" && preset.borderWidthMm > 0 && (
        <>
          <rect
            x={preset.borderInsetMm}
            y={preset.borderInsetMm}
            width={preset.pageWidthMm - 2 * preset.borderInsetMm}
            height={preset.pageHeightMm - 2 * preset.borderInsetMm}
            fill="none"
            stroke={INK}
            strokeWidth={preset.borderWidthMm}
          />
          {preset.borderStyle === "double" && (
            <rect
              x={preset.borderInsetMm + preset.borderWidthMm + 1}
              y={preset.borderInsetMm + preset.borderWidthMm + 1}
              width={preset.pageWidthMm - 2 * (preset.borderInsetMm + preset.borderWidthMm + 1)}
              height={preset.pageHeightMm - 2 * (preset.borderInsetMm + preset.borderWidthMm + 1)}
              fill="none"
              stroke={INK}
              strokeWidth={preset.borderWidthMm}
            />
          )}
        </>
      )}
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

      {sheet.title && drawText(sheet.title, "title", 0, false)}
      {sheet.chapter &&
        drawText(sheet.chapter, "chapter", 0, sheet.chapter.gaps.length > 0)}
      {sheet.footer && drawText(sheet.footer, "footer", 0, sheet.footer.gaps.length > 0)}

      {/* Headings, in the order the blocks that own them were placed. */}
      {sheet.headings.map((heading, i) => {
        const block = sheet.blocks.filter((b) => b.heading)[i];
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
        const chosen =
          selection?.kind === "box" &&
          selection.stampId === box.stampId &&
          selection.entryId === box.entryId;
        const flag = boxFlag(box);
        const lifted =
          carry?.kind === "box" && carry.blockId === blockId && carry.stampId === box.stampId;
        const mark: AlbumDropMark | null =
          over === boxKey(blockId, box.stampId)
            ? boxDropMark(carry, { blockId, stampId: box.stampId })
            : null;
        return (
          <g key={`b${i}`} opacity={lifted ? 0.4 : undefined}>
            {box.photoId && (
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
              x={box.xMm}
              y={box.yMm + dy}
              width={widthMm}
              height={heightMm}
              fill="transparent"
              stroke={preset.boxBorderStyle === "none" ? "none" : INK}
              strokeWidth={preset.boxBorderWidthMm}
              strokeDasharray={boxDash}
              style={{ cursor: readOnly ? "pointer" : "grab" }}
              onPointerDown={(e) => {
                e.stopPropagation();
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
            {chosen && !readOnly && (
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
            {box.label && drawText(box.label, `l${i}`, dy, box.label.gaps.length > 0)}
          </g>
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
    </svg>
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
      const withHeadings = sheet.blocks.filter((b) => b.heading);
      const at = withHeadings.findIndex((b) => b.id === blockId);
      const heading = at >= 0 ? sheet.headings[at] : undefined;
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

/** The top of a block on this sheet: its heading if it has one, otherwise its first box. Used only
 *  to hang the space handle where the collector would reach for it — the number it writes is the
 *  correction, not this coordinate. */
function blockTopMm(sheet: AlbumEditorSheet, blockId: string): number | null {
  const withHeadings = sheet.blocks.filter((b) => b.heading);
  const headingIndex = withHeadings.findIndex((b) => b.id === blockId);
  if (headingIndex >= 0 && sheet.headings[headingIndex]) {
    return sheet.headings[headingIndex].yMm;
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
