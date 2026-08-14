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
