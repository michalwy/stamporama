"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TileSideView } from "@/lib/scan-tile-view";
import {
  ZOOM_STEP,
  actualSizeViewport,
  clampOffsets,
  clampScale,
  fitViewport,
  panBy,
  zoomBy,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";
import { ScanToolButton } from "./scan-tool-button";
import { useSheetRegion } from "./use-sheet-region";

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
 */

interface Props {
  collectionId: string;
  /** Front, back, or a lone back — from `tileSideViews`, never assembled here. */
  sides: TileSideView[];
  /** For the alt text, which is the only place a tile's position is named on this side of the
   * dialog. */
  position: number;
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
 */
export function IdentifiedPieceAside({
  collectionId,
  pieces,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
}) {
  const shown = pieces.filter((p) => p.sides.length > 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = shown.find((p) => p.tileId === openId) ?? null;

  if (shown.length === 0) return null;
  if (shown.length === 1) {
    return (
      <TileZoomView
        collectionId={collectionId}
        sides={shown[0].sides}
        position={shown[0].position}
      />
    );
  }
  if (opened) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          style={{
            alignSelf: "flex-start",
            marginBottom: "0.5rem",
            padding: "0.25rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            font: "inherit",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          ← All {shown.length} pieces
        </button>
        <TileZoomView
          // Remounted per piece, so the viewer opens fitted to the tile that was clicked rather than
          // carrying the previous one's zoom onto a differently sized crop.
          key={opened.tileId}
          collectionId={collectionId}
          sides={opened.sides}
          position={opened.position}
        />
      </div>
    );
  }
  return <IdentifiedPieceGrid collectionId={collectionId} pieces={shown} onOpen={setOpenId} />;
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
  onOpen,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
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
        <strong>{pieces.length} pieces</strong>, being identified as one stamp. Check them against
        each other before you confirm — click one to look at it closely.
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
        {pieces.map((piece) => {
          const front = piece.sides.find((s) => s.side === "front") ?? piece.sides[0];
          return (
            <button
              key={piece.tileId}
              type="button"
              onClick={() => onOpen(piece.tileId)}
              title={`Tile ${piece.position + 1} — click to look at it closely`}
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
              <span style={{ fontSize: "0.6875rem" }}>{piece.position + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The natural size of a loaded photo, in its own pixels. Measured rather than stored: it is the
 * width of the derivative actually on screen, which is what decides whether the retained scan has
 * anything more to offer — and the browser knows it exactly. */
interface Natural {
  width: number;
  height: number;
}

export function TileZoomView({ collectionId, sides, position }: Props) {
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
  /** The picture in **scan** pixels: the tile's box on the card, or — for a tile carrying no box —
   * the photo's own size, which is then all there is to know about it. */
  const pictureWidth = current?.box?.w ?? measured?.width ?? 0;
  const pictureHeight = current?.box?.h ?? measured?.height ?? 0;
  const ready = pictureWidth > 0 && pictureHeight > 0 && size.width > 0;

  const markFitted = useCallback((value: boolean) => {
    fittedRef.current = value;
    setFitted(value);
  }, []);

  // Measure the viewport, and fit inside it. One observer covers the dialog being resized with the
  // window and the first observation the browser delivers on mount, which is where the opening fit
  // comes from.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
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
  useEffect(() => {
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

  const pan = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ready) return;
    // The whole surface pans: there is nothing to draw or select on a tile, so the plain drag is
    // free to be the hand tool rather than a modifier on one.
    pan.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const last = pan.current;
    if (!last || !ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    setView((v) => panBy(v, e.clientX - last.x, e.clientY - last.y, picture, size));
    pan.current = { x: e.clientX, y: e.clientY };
  };
  const endPan = () => {
    pan.current = null;
    setPanning(false);
  };

  const detail = useSheetRegion({
    collectionId,
    sheetId: current?.sheetId ?? null,
    width: pictureWidth,
    height: pictureHeight,
    viewWidth: measured?.width ?? 0,
    originX: current?.box?.x ?? 0,
    originY: current?.box?.y ?? 0,
    view,
    size,
  });

  if (!current) return null;

  const atActualSize = ready && Math.abs(view.scale - 1) < 1e-6;

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
              onClick={() => setSideKey(s.side)}
            />
          ))}
        <span style={{ flex: 1 }} />
        <ScanToolButton icon="zoomOut" label="−" hint="Zoom out (−)" onClick={() => zoomStep(1 / ZOOM_STEP)} />
        <span
          style={{
            fontSize: "0.8125rem",
            color: detail ? "var(--color-text-secondary)" : "var(--color-text-muted)",
            minWidth: "3.25rem",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
          // The percentage is against the **scan**, exactly as in the cut editor. The dot marks the
          // visible part being served from the retained card rather than magnified out of the
          // tile's own photo.
          title={
            detail
              ? "Showing this part at full resolution from the retained card scan"
              : "Showing the tile's own image"
          }
        >
          {ready ? `${Math.round(view.scale * 100)}%` : "—"}
          {detail ? " ·" : ""}
        </span>
        <ScanToolButton icon="zoomIn" label="+" hint="Zoom in (+)" onClick={() => zoomStep(ZOOM_STEP)} />
        <ScanToolButton
          icon="zoomFit"
          label="Fit"
          hint="The whole tile on screen (0)"
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
        style={{
          flex: 1,
          minHeight: "20rem",
          position: "relative",
          overflow: "hidden",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-subtle)",
          cursor: panning ? "grabbing" : "grab",
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
          }}
        >
          {/* Served by an authenticated route at whatever size the crop was, which is exactly the
              case `next/image`'s loader cannot size or optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/collections/${collectionId}/photos/${current.photoId}/full`}
            alt={`Tile ${position + 1}, ${current.label.toLowerCase()}`}
            draggable={false}
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
        </div>
      </div>

      <p
        style={{
          margin: "0.5rem 0 0",
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
        }}
      >
        Drag to move · wheel or <kbd>+</kbd>/<kbd>−</kbd> zooms · <kbd>0</kbd> fits
        {sides.length > 1 ? " · the zoom is kept when you switch sides" : ""}
      </p>
    </div>
  );
}
