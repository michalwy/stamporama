"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { Icon, type IconName } from "@/app/icons";
import {
  MIN_BOX_EDGE_PX,
  mergeBoxes,
  normalizeBox,
  readingOrder,
  splitBox,
  type Box,
} from "@/lib/scan-boxes";
import {
  ZOOM_STEP,
  actualSizeViewport,
  clampOffsets,
  fitViewport,
  panBy,
  regionKey,
  regionRequest,
  toSheetPoint,
  zoomBy,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";

/**
 * The cut review editor (#566, ADR-0033), zoomable since #579.
 *
 * **The primitive, not a fallback.** However good detection gets (#574), it will sometimes take two
 * touching stamps for one, halve a dark one, or find a shadow along the card's edge — and a bad cut
 * on a parcel already broken up cannot be undone by re-scanning. So the graphical repair exists
 * first and unconditionally; detection quality decides how often it is reached, never whether it
 * exists. Since #574 the boxes usually arrive proposed, and this surface cannot tell: a proposed
 * box and a drawn one are the same four numbers, moved, split, merged and deleted the same way.
 *
 * It works in **rectangles** — not because stamps are rectangular, which triangles and diamonds are
 * not, but because a crop is. Nothing here paints a mask or edits an outline.
 *
 * Nothing is created until Commit, so the whole review is free to be wrong.
 *
 * Coordinates are the **sheet's original pixels** throughout, converted for display by one scale
 * factor. That is what `sharp.extract` is handed, it survives the browser being resized mid-cut,
 * and it means a box means the same number here and in the database.
 *
 * ## Zoom is what makes the review able to answer its own question
 *
 * The likeliest bad cut is the quietest: a box clipping a stamp's perforation by a few pixels. At
 * fit-to-window on a whole card that is invisible, so this surface can only be trusted if it can be
 * looked into. Hence wheel zoom **to the cursor**, panning, and a **1:1** that means one screen
 * pixel to one *sheet* pixel — never to one view pixel, which would have the control lie about the
 * very thing it is there for.
 *
 * And zooming alone would not be enough. The image on screen is the `view` derivative, capped at
 * 2500 px against a 600 dpi card's ~7000, so magnifying it shows a larger blur rather than more
 * stamp. Past the view's own scale the visible region is therefore fetched from the **retained
 * original** and drawn over it (`detail` below). The view stays underneath at every zoom, so a
 * region still in flight is a soft edge rather than a blank card.
 *
 * The transform is a view transform and nothing more: every box is whole sheet pixels at every
 * zoom. The arithmetic lives in `scan-viewport.ts`, whose one conversion back towards the sheet is
 * fractional by design and always passes through `normalizeBox`, which rounds.
 */

export interface ScanCutEditorSheet {
  id: string;
  side: "front" | "back";
  batchNo: number;
  /** Original dimensions — the coordinate space every box lives in. */
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

interface Props {
  collectionId: string;
  sheet: ScanCutEditorSheet;
  /** The boxes to open on: a proposal from detection (#574), or a previous cut's boxes when
   * re-cutting. Empty is still an ordinary case — a scan detection could not read, or a card it
   * found nothing on, opens on an empty canvas and is drawn by hand. */
  initialBoxes: Box[];
  /** How many front tiles the batch already holds, shown while cutting a back so the two counts
   * can be compared *before* committing rather than only in the report afterwards. */
  frontTileCount: number | null;
  committing: boolean;
  error: string | null;
  onCommit: (boxes: Box[]) => void;
  onClose: () => void;
}

/** What the next pointer-down will do. `select` is the resting state; the two split modes are armed
 * by a toolbar button and disarmed by committing one cut or pressing Escape. */
type Mode = "select" | "split-v" | "split-h";

type Drag =
  | { kind: "draw"; originX: number; originY: number; current: Box | null }
  | { kind: "move"; ids: string[]; startX: number; startY: number; origin: Map<string, Box> }
  | { kind: "resize"; id: string; handle: Handle; start: Box }
  /** Panning, in display pixels — the one drag that is about the view rather than about a box. */
  | { kind: "pan"; lastX: number; lastY: number };

/** The eight grips. Named by the edges they move, so the maths below is the same for all of them. */
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface Region {
  id: string;
  box: Box;
}

let nextRegionId = 0;
const newRegion = (box: Box): Region => ({ id: `r${nextRegionId++}`, box });

/** A crop of the original currently drawn over the `view` derivative: where it sits on the sheet,
 * and the URL it came from. Held only once it has finished loading, so what is on screen is never
 * replaced by a half-arrived image. */
interface Detail {
  key: string;
  box: Box;
  url: string;
}

/** How long the viewport must be still before a region is fetched. Each region costs a full decode
 * of a 30 Mpx original server-side, so a pan must not ask for one per frame — this, plus the grid
 * `regionRequest` snaps to, is what keeps a drag across a card to a handful of fetches. */
const REGION_DEBOUNCE_MS = 200;

export function ScanCutEditor({
  collectionId,
  sheet,
  initialBoxes,
  frontTileCount,
  committing,
  error,
  onCommit,
  onClose,
}: Props) {
  const [regions, setRegions] = useState<Region[]>(() => initialBoxes.map(newRegion));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("select");
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Where the split guide currently sits, in sheet pixels, while a split mode is armed. */
  const [splitAt, setSplitAt] = useState<number | null>(null);

  /** The window onto the card. Everything is drawn inside it and nothing scrolls: this surface owns
   * the wheel, because on a card of forty the wheel is the zoom. */
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  /** Display pixels per sheet pixel, and where the card's top-left sits — the single display
   * conversion, now under the collector's hand rather than derived from the layout. */
  const [view, setView] = useState<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 });
  /** Whether the view is still the fitted one. Tracked rather than recomputed, because the question
   * a resize asks is about the view *before* the resize: a chosen zoom must survive the window
   * changing, and a fitted one must follow it. Held twice — as state for the lit control, and as a
   * ref for the resize observer, which fires outside React's render and must read the current
   * answer rather than the one captured when it was subscribed. */
  const [fitted, setFitted] = useState(true);
  const fittedRef = useRef(true);
  /** Space is the hand tool, as everywhere else that draws on an image. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  const sheetSize = useMemo(
    () => ({ width: sheet.width, height: sheet.height }),
    [sheet.width, sheet.height]
  );
  const markFitted = useCallback((value: boolean) => {
    fittedRef.current = value;
    setFitted(value);
  }, []);

  // Measuring and re-fitting are one step, in the observer's own callback: fit is the default and
  // what a resize keeps while nothing has been zoomed, and a chosen zoom is only re-clamped, so
  // widening the dialog never throws away the detail being looked at. `ResizeObserver` delivers a
  // first observation of its own, which is where the initial fit comes from.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      setSize(next);
      setView((v) =>
        fittedRef.current ? fitViewport(sheetSize, next) : clampOffsets(v, sheetSize, next)
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sheetSize]);

  const fit = useCallback(() => {
    setView(fitViewport(sheetSize, size));
    markFitted(true);
  }, [markFitted, sheetSize, size]);

  const actualSize = useCallback(() => {
    setView(actualSizeViewport(sheetSize, size));
    markFitted(false);
  }, [markFitted, sheetSize, size]);

  /** Zoom a step about a point in the viewport, defaulting to its centre — which is what a control
   * or a keystroke means by "here" when there is no cursor to speak of. */
  const zoomStep = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((v) =>
        zoomBy(v, factor, anchor ?? { x: size.width / 2, y: size.height / 2 }, sheetSize, size)
      );
      markFitted(false);
    },
    [markFitted, sheetSize, size]
  );

  /** A pointer's position inside the viewport, in display pixels. */
  const toLocal = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /** …and the same position as a **fractional** sheet coordinate. Fractional on purpose: every
   * caller hands it to `normalizeBox` or `splitBox`, which round. Rounding here instead would
   * quantise the gesture to whole sheet pixels — at 8× zoom, one pixel of stamp per eight of
   * mouse — and would still not be the number that gets stored. */
  const toSheet = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const local = toLocal(clientX, clientY);
      return toSheetPoint(view, local.x, local.y);
    },
    [toLocal, view]
  );

  // The wheel is bound by hand rather than through `onWheel`, because React's is passive and a
  // passive listener cannot call `preventDefault` — the page would scroll under the zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || size.width === 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Continuous rather than notched, so a trackpad's small deltas zoom smoothly and a mouse's
      // one notch is one `ZOOM_STEP`. Line-mode deltas are converted to pixels first.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => zoomBy(v, Math.pow(ZOOM_STEP, -delta / 100), anchor, sheetSize, size));
      markFitted(false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [markFitted, sheetSize, size]);

  // ── Detail from the original ───────────────────────────────────────────────────────────────

  const regionSheet = useMemo(
    () => ({ width: sheet.width, height: sheet.height, viewWidth: sheet.viewWidth }),
    [sheet.width, sheet.height, sheet.viewWidth]
  );
  /** The region last asked for. A load that arrives after the view has moved on is dropped against
   * this, so a slow fetch cannot paint a stale crop over the card. */
  const wantedRegion = useRef<string | null>(null);

  useEffect(() => {
    if (size.width === 0) return;
    const request = regionRequest(view, regionSheet, size, window.devicePixelRatio || 1);
    const key = request ? regionKey(request) : null;
    if (key === wantedRegion.current) return;

    // Everything, including *clearing* the crop, waits out the debounce — so a wheel spun past the
    // threshold and back does not blink the detail away and fetch it again.
    const timer = setTimeout(() => {
      wantedRegion.current = key;
      if (!request) {
        // Back below the view's own scale: the derivative has every pixel the screen can show, and
        // leaving a crop up would keep one part of the card sharper than the rest for no reason.
        setDetail(null);
        return;
      }
      const loaded = regionKey(request);
      const { box, renderWidth } = request;
      const url =
        `/api/collections/${collectionId}/scan-sheets/${sheet.id}/region` +
        `?x=${box.x}&y=${box.y}&w=${box.w}&h=${box.h}&rw=${renderWidth}`;
      // Preloaded rather than rendered straight into an `<img>`: swapping `src` blanks the element
      // while the next one decodes, which at 8× would flash the card away exactly when the
      // collector is looking hardest at it. A repeat of a crop already fetched comes from the
      // browser's cache — the route marks these immutable, since a sheet's bytes never change.
      const image = new Image();
      image.onload = () => {
        if (wantedRegion.current === loaded) setDetail({ key: loaded, box, url });
      };
      // A region that fails to arrive is a soft failure: the `view` underneath is still a picture
      // of the card, and the cut can still be edited over it.
      image.src = url;
    }, REGION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [collectionId, regionSheet, sheet.id, size, view]);

  const selectedRegions = useMemo(
    () => regions.filter((r) => selected.has(r.id)),
    [regions, selected]
  );
  const soleSelected = selectedRegions.length === 1 ? selectedRegions[0] : null;

  // Reading order drives the number drawn in each box, so the collector sees the order the tiles
  // will actually be created in — which is the order they will then be worked through in #567.
  const order = useMemo(() => {
    const positions = new Map<string, number>();
    readingOrder(regions.map((r) => r.box)).forEach((regionIndex, position) => {
      positions.set(regions[regionIndex].id, position + 1);
    });
    return positions;
  }, [regions]);

  // ── Editing ────────────────────────────────────────────────────────────────────────────────

  const replaceSelection = useCallback((next: Region[], select: string[]) => {
    setRegions(next);
    setSelected(new Set(select));
  }, []);

  const deleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    replaceSelection(
      regions.filter((r) => !selected.has(r.id)),
      []
    );
  }, [regions, selected, replaceSelection]);

  const mergeSelected = useCallback(() => {
    if (selectedRegions.length < 2) return;
    const merged = mergeBoxes(selectedRegions.map((r) => r.box));
    if (!merged) return;
    const replacement = newRegion(merged);
    replaceSelection(
      [...regions.filter((r) => !selected.has(r.id)), replacement],
      [replacement.id]
    );
  }, [regions, selected, selectedRegions, replaceSelection]);

  const commitSplit = useCallback(
    (at: number) => {
      if (!soleSelected || mode === "select") return;
      const halves = splitBox(soleSelected.box, mode === "split-v" ? "vertical" : "horizontal", at);
      // A cut that would leave a sliver is simply refused; the guide stays up so the collector can
      // aim again, rather than producing a box they then have to notice and delete.
      if (!halves) return;
      const created = halves.map(newRegion);
      replaceSelection(
        [...regions.filter((r) => r.id !== soleSelected.id), ...created],
        created.map((r) => r.id)
      );
      setMode("select");
      setSplitAt(null);
    },
    [mode, regions, soleSelected, replaceSelection]
  );

  // ── Pointer ────────────────────────────────────────────────────────────────────────────────

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    // Panning comes first and works in every mode, including while a split is armed: the seam being
    // aimed at is often the reason the card is zoomed in the first place.
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      setDrag({ kind: "pan", lastX: e.clientX, lastY: e.clientY });
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = toSheet(e.clientX, e.clientY);

    if (mode !== "select") {
      commitSplit(mode === "split-v" ? p.x : p.y);
      return;
    }

    // Topmost box under the pointer wins, so a box drawn inside another is still reachable.
    const hit = [...regions].reverse().find((r) => inside(r.box, p));
    if (hit) {
      const nextSelected = e.shiftKey
        ? toggled(selected, hit.id)
        : selected.has(hit.id)
          ? selected
          : new Set([hit.id]);
      setSelected(nextSelected);
      const ids = [...nextSelected];
      setDrag({
        kind: "move",
        ids,
        startX: p.x,
        startY: p.y,
        origin: new Map(regions.filter((r) => nextSelected.has(r.id)).map((r) => [r.id, r.box])),
      });
    } else {
      if (!e.shiftKey) setSelected(new Set());
      setDrag({ kind: "draw", originX: p.x, originY: p.y, current: null });
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onSurfacePointerMove = (e: React.PointerEvent) => {
    if (drag?.kind === "pan") {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      setView((v) => panBy(v, dx, dy, sheetSize, size));
      setDrag({ kind: "pan", lastX: e.clientX, lastY: e.clientY });
      return;
    }

    const p = toSheet(e.clientX, e.clientY);

    if (mode !== "select") {
      setSplitAt(mode === "split-v" ? p.x : p.y);
      return;
    }
    if (!drag) return;

    if (drag.kind === "draw") {
      setDrag({
        ...drag,
        current: normalizeBox(
          { x: drag.originX, y: drag.originY, w: p.x - drag.originX, h: p.y - drag.originY },
          sheet
        ),
      });
      return;
    }
    if (drag.kind === "move") {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      setRegions((rs) =>
        rs.map((r) => {
          const origin = drag.origin.get(r.id);
          if (!origin) return r;
          // Clamped as a whole rather than per edge: a box dragged past the card's edge stops
          // there keeping its size, instead of being squashed against it.
          return {
            ...r,
            box: {
              ...origin,
              x: Math.round(clamp(origin.x + dx, 0, sheet.width - origin.w)),
              y: Math.round(clamp(origin.y + dy, 0, sheet.height - origin.h)),
            },
          };
        })
      );
      return;
    }
    setRegions((rs) =>
      rs.map((r) => (r.id === drag.id ? { ...r, box: resized(drag.start, drag.handle, p, sheet) } : r))
    );
  };

  const onSurfacePointerUp = () => {
    if (drag?.kind === "draw" && drag.current) {
      const created = newRegion(drag.current);
      setRegions((rs) => [...rs, created]);
      setSelected(new Set([created.id]));
    }
    setDrag(null);
  };

  const onHandlePointerDown = (e: React.PointerEvent, region: Region, handle: Handle) => {
    if (e.button !== 0 || mode !== "select") return;
    e.stopPropagation();
    setSelected(new Set([region.id]));
    setDrag({ kind: "resize", id: region.id, handle, start: region.box });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  // ── Keyboard ───────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape" && mode !== "select") {
        // Taken before the dialog's own Escape layer sees it: the first Escape disarms the split,
        // a second one closes the editor. Closing while aiming a cut would lose the whole cut.
        e.preventDefault();
        e.stopPropagation();
        setMode("select");
        setSplitAt(null);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelected(new Set(regions.map((r) => r.id)));
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomStep(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomStep(1 / ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        fit();
      } else if (e.key === " ") {
        // Held, not toggled: the hand tool is a modifier on the drag that follows it.
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    // A window that loses focus mid-drag would otherwise come back still holding the hand tool.
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [deleteSelected, fit, mode, regions, zoomStep]);

  // ── Render ─────────────────────────────────────────────────────────────────────────────────

  const drawing = drag?.kind === "draw" ? drag.current : null;
  const countMismatch =
    sheet.side === "back" && frontTileCount != null && frontTileCount !== regions.length;

  return (
    <DialogShell
      title={`${sheet.side === "front" ? "Front" : "Back"} of batch ${sheet.batchNo} — review the cut`}
      onClose={onClose}
      maxWidth="min(96vw, 88rem)"
      height="92vh"
      // The editor owns Escape while a split is armed, and a stray backdrop click mid-drag must not
      // throw away a card's worth of boxes.
      dismissable={false}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <Toolbar
          count={regions.length}
          selectedCount={selectedRegions.length}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            setSplitAt(null);
          }}
          onDelete={deleteSelected}
          onMerge={mergeSelected}
          onClear={() => replaceSelection([], [])}
          zoom={view.scale}
          fitted={fitted}
          detailed={detail != null}
          onZoomIn={() => zoomStep(ZOOM_STEP)}
          onZoomOut={() => zoomStep(1 / ZOOM_STEP)}
          onFit={fit}
          onActualSize={actualSize}
        />

        {(countMismatch || error) && (
          <div
            style={{
              padding: "0.625rem 1.25rem",
              fontSize: "0.8125rem",
              background: error ? "var(--color-error-soft)" : "var(--color-warning-soft)",
              color: error ? "var(--color-error)" : "var(--color-warning)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {error ?? (
              <>
                <strong>
                  Front {frontTileCount}, back {regions.length}.
                </strong>{" "}
                A stamp fell out, two were drawn as one, or this is the wrong file. Committing is
                allowed — what pairs, pairs; the rest is reported.
              </>
            )}
          </div>
        )}

        {/* The viewport. It does not scroll — the wheel is the zoom — and the card is placed inside
            it by the transform rather than by the layout, which is what lets one scale serve every
            zoom the same way it served the fitted one. */}
        <div
          ref={viewportRef}
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={onSurfacePointerUp}
          // Middle-button down starts the browser's own autoscroll, which `onPointerDown` is too
          // late to stop.
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            background: "var(--color-bg-subtle)",
            cursor:
              drag?.kind === "pan"
                ? "grabbing"
                : spaceHeld
                  ? "grab"
                  : mode === "select"
                    ? "crosshair"
                    : mode === "split-v"
                      ? "col-resize"
                      : "row-resize",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: view.offsetX,
              top: view.offsetY,
              width: sheet.width * view.scale,
              height: sheet.height * view.scale,
              boxShadow: "0 0 0 1px var(--color-border)",
            }}
          >
            {/* A scan is served by an authenticated route at whatever size the card was, which is
                exactly the case `next/image`'s loader cannot size or optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/collections/${collectionId}/scan-sheets/${sheet.id}/view`}
              alt={`${sheet.side} scan of batch ${sheet.batchNo}`}
              draggable={false}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "fill" }}
            />

            {/* The visible region at full resolution, drawn over the derivative it magnifies. Kept
                underneath the boxes and above the view, and never the only thing on screen: the
                same pixels through the same `.rotate()` and the same `extract` the cut itself uses,
                so it lines up with the card exactly rather than nearly. */}
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

            {regions.map((r) => (
              <RegionRect
                key={r.id}
                region={r}
                position={order.get(r.id) ?? 0}
                selected={selected.has(r.id)}
                scale={view.scale}
                interactive={mode === "select"}
                onHandlePointerDown={onHandlePointerDown}
              />
            ))}

            {drawing && (
              <div
                style={{
                  position: "absolute",
                  left: drawing.x * view.scale,
                  top: drawing.y * view.scale,
                  width: drawing.w * view.scale,
                  height: drawing.h * view.scale,
                  border: "1px dashed var(--color-action-primary)",
                  background: "rgb(59 130 246 / 0.12)",
                  pointerEvents: "none",
                }}
              />
            )}

            {mode !== "select" && soleSelected && splitAt != null && (
              <SplitGuide box={soleSelected.box} axis={mode} at={splitAt} scale={view.scale} />
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <span
          style={{
            marginRight: "auto",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          Drag on the card to draw · click a box to select · shift-click to add · Delete removes ·
          wheel or <kbd>+</kbd>/<kbd>−</kbd> zooms, <kbd>0</kbd> fits · hold space or the middle
          button to pan
        </span>
        <DialogSecondaryButton onClick={onClose} disabled={committing}>
          Cancel
        </DialogSecondaryButton>
        <DialogPrimaryButton
          type="button"
          onClick={() => onCommit(orderedBoxes(regions))}
          disabled={committing || regions.length === 0}
        >
          {committing
            ? "Cutting…"
            : `Cut ${regions.length} ${regions.length === 1 ? "tile" : "tiles"}`}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

/** Boxes in reading order — the order the tiles are created in, and the order the numbers on
 * screen have been promising all along. */
function orderedBoxes(regions: readonly Region[]): Box[] {
  const boxes = regions.map((r) => r.box);
  return readingOrder(boxes).map((i) => boxes[i]);
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────

function Toolbar({
  count,
  selectedCount,
  mode,
  onMode,
  onDelete,
  onMerge,
  onClear,
  zoom,
  fitted,
  detailed,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
}: {
  count: number;
  selectedCount: number;
  mode: Mode;
  onMode: (m: Mode) => void;
  onDelete: () => void;
  onMerge: () => void;
  onClear: () => void;
  zoom: number;
  fitted: boolean;
  detailed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        flexWrap: "wrap",
      }}
    >
      <strong style={{ fontSize: "0.875rem" }}>
        {count} {count === 1 ? "box" : "boxes"}
      </strong>
      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
        {selectedCount > 0 ? `${selectedCount} selected` : "nothing selected"}
      </span>
      <span style={{ flex: 1 }} />
      <ToolButton icon="zoomOut" label="−" hint="Zoom out (−)" onClick={onZoomOut} />
      <span
        style={{
          fontSize: "0.8125rem",
          color: detailed ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          minWidth: "3.25rem",
          textAlign: "center",
        }}
        // The percentage is against the *sheet*, so it says what it is worth saying: whether what
        // is on screen is the card's own resolution. The dot marks the region being served from the
        // retained original rather than magnified out of the display copy.
        title={
          detailed
            ? "Showing the visible region at full resolution from the retained scan"
            : "Showing the display copy of the scan"
        }
      >
        {Math.round(zoom * 100)}%{detailed ? " ·" : ""}
      </span>
      <ToolButton icon="zoomIn" label="+" hint="Zoom in (+)" onClick={onZoomIn} />
      <ToolButton
        icon="zoomFit"
        label="Fit"
        hint="The whole card on screen (0)"
        active={fitted}
        onClick={onFit}
      />
      <ToolButton
        label="1:1"
        hint="One screen pixel per pixel of the scan itself — the size a crop is actually taken at"
        active={!fitted && Math.abs(zoom - 1) < 1e-6}
        onClick={onActualSize}
      />
      <ToolButton
        icon="merge"
        label="Merge"
        hint="Two boxes that halved one stamp become the rectangle holding both"
        disabled={selectedCount < 2}
        onClick={onMerge}
      />
      <ToolButton
        icon="splitColumns"
        label="Split ↔"
        hint="Cut the selected box into a left and a right — click where the seam is"
        disabled={selectedCount !== 1}
        active={mode === "split-v"}
        onClick={() => onMode(mode === "split-v" ? "select" : "split-v")}
      />
      <ToolButton
        icon="splitRows"
        label="Split ↕"
        hint="Cut the selected box into a top and a bottom"
        disabled={selectedCount !== 1}
        active={mode === "split-h"}
        onClick={() => onMode(mode === "split-h" ? "select" : "split-h")}
      />
      <ToolButton
        icon="delete"
        label="Delete"
        hint="Remove the selected boxes — a shadow, a fibre, the card's edge"
        disabled={selectedCount === 0}
        onClick={onDelete}
      />
      <ToolButton
        icon="clear"
        label="Clear all"
        hint="Start the cut again from an empty card"
        disabled={count === 0}
        onClick={onClear}
      />
    </div>
  );
}

function ToolButton({
  icon,
  label,
  hint,
  disabled,
  active,
  onClick,
}: {
  /** Optional: `1:1` is its own picture, and the vocabulary is deliberately not the place to invent
   * a glyph for a ratio that reads perfectly well as two characters. */
  icon?: IconName;
  label: string;
  hint: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.3125rem 0.625rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        border: "1px solid var(--color-border-strong)",
        background: active ? "var(--color-action-primary)" : "var(--color-bg-elevated)",
        color: active ? "#fff" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon && <Icon name={icon} size="sm" />}
      {label}
    </button>
  );
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function RegionRect({
  region,
  position,
  selected,
  scale,
  interactive,
  onHandlePointerDown,
}: {
  region: Region;
  position: number;
  selected: boolean;
  scale: number;
  interactive: boolean;
  onHandlePointerDown: (e: React.PointerEvent, region: Region, handle: Handle) => void;
}) {
  const { box } = region;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x * scale,
        top: box.y * scale,
        width: box.w * scale,
        height: box.h * scale,
        border: `${selected ? 2 : 1}px solid ${
          selected ? "var(--color-action-primary)" : "rgb(255 255 255 / 0.85)"
        }`,
        background: selected ? "rgb(59 130 246 / 0.16)" : "transparent",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          padding: "0 0.25rem",
          fontSize: "0.6875rem",
          fontWeight: 600,
          lineHeight: 1.4,
          background: selected ? "var(--color-action-primary)" : "rgb(0 0 0 / 0.6)",
          color: "#fff",
        }}
      >
        {position}
      </span>
      {selected &&
        interactive &&
        HANDLES.map((h) => (
          <span
            key={h}
            onPointerDown={(e) => onHandlePointerDown(e, region, h)}
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              marginLeft: -5,
              marginTop: -5,
              borderRadius: 2,
              background: "var(--color-action-primary)",
              border: "1px solid #fff",
              cursor: `${h}-resize`,
              pointerEvents: "auto",
              ...handleOffset(h),
            }}
          />
        ))}
    </div>
  );
}

function handleOffset(h: Handle): React.CSSProperties {
  const left = h.includes("w") ? "0%" : h === "n" || h === "s" ? "50%" : "100%";
  const top = h.includes("n") ? "0%" : h === "e" || h === "w" ? "50%" : "100%";
  return { left, top };
}

/** The line the next click will cut along, drawn inside the box it would cut. */
function SplitGuide({
  box,
  axis,
  at,
  scale,
}: {
  box: Box;
  axis: "split-v" | "split-h";
  at: number;
  scale: number;
}) {
  const vertical = axis === "split-v";
  const within =
    vertical
      ? at > box.x + MIN_BOX_EDGE_PX && at < box.x + box.w - MIN_BOX_EDGE_PX
      : at > box.y + MIN_BOX_EDGE_PX && at < box.y + box.h - MIN_BOX_EDGE_PX;
  return (
    <div
      style={{
        position: "absolute",
        left: vertical ? at * scale : box.x * scale,
        top: vertical ? box.y * scale : at * scale,
        width: vertical ? 0 : box.w * scale,
        height: vertical ? box.h * scale : 0,
        // Red where the cut would leave a sliver and so would be refused — the refusal is visible
        // before the click rather than as nothing happening after it.
        borderLeft: vertical ? `2px solid ${within ? "#fff" : "var(--color-error)"}` : undefined,
        borderTop: vertical ? undefined : `2px solid ${within ? "#fff" : "var(--color-error)"}`,
        pointerEvents: "none",
      }}
    />
  );
}

// ── Geometry helpers ─────────────────────────────────────────────────────────────────────────

function inside(box: Box, p: { x: number; y: number }): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A box with one grip dragged to `p`. Each handle moves the edges its name contains; the result
 * goes back through `normalizeBox`, so dragging an edge past its opposite flips the box rather
 * than inverting it, and the sheet's bounds are respected the same way everywhere. */
function resized(
  start: Box,
  handle: Handle,
  p: { x: number; y: number },
  sheet: { width: number; height: number }
): Box {
  let { x, y, w, h } = start;
  if (handle.includes("w")) {
    const right = x + w;
    x = p.x;
    w = right - x;
  }
  if (handle.includes("e")) w = p.x - x;
  if (handle.includes("n")) {
    const bottom = y + h;
    y = p.y;
    h = bottom - y;
  }
  if (handle.includes("s")) h = p.y - y;
  return normalizeBox({ x, y, w, h }, sheet) ?? start;
}
