"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ZOOM_STEP,
  clampOffsets,
  clampScale,
  fitViewport,
  panBy,
  zoomBy,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";

/**
 * Zoom and pan over one picture, for a surface that draws **more than one** viewport at once — the
 * reference comparison's two landmark panes and its overlay (#1004).
 *
 * The arithmetic is `scan-viewport.ts`'s, as everywhere a picture is zoomed; what this adds is the
 * effects around it — measuring the element, fitting on first measure, re-clamping a chosen zoom on
 * resize, and the wheel bound non-passively so the dialog does not scroll under it. `TileZoomView`
 * carries the same effects inline with its measuring tools woven through them; this is them on their
 * own, because a comparison has two pictures side by side and each needs its own view.
 *
 * `picture` is the stage in the picture's own pixels — a tile's box in scan pixels, or a photo's
 * natural size — and `null` until it is known, which keeps the surface undrawn rather than drawn at
 * the wrong size for a frame.
 */
export function useZoomPan(picture: { width: number; height: number } | null) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 });
  const fittedRef = useRef(true);
  const [fitted, setFitted] = useState(true);
  const width = picture?.width ?? 0;
  const height = picture?.height ?? 0;
  const ready = width > 0 && height > 0 && size.width > 0 && size.height > 0;

  const markFitted = useCallback((value: boolean) => {
    fittedRef.current = value;
    setFitted(value);
  }, []);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    }
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const stage = { width, height };
    setView((v) =>
      fittedRef.current
        ? fitViewport(stage, size)
        : clampOffsets({ ...v, scale: clampScale(v.scale, stage, size) }, stage, size)
    );
  }, [height, ready, size, width]);

  const zoomStep = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      if (!ready) return;
      setView((v) =>
        zoomBy(v, factor, anchor ?? { x: size.width / 2, y: size.height / 2 }, { width, height }, size)
      );
      markFitted(false);
    },
    [height, markFitted, ready, size, width]
  );

  const fit = useCallback(() => {
    if (!ready) return;
    setView(fitViewport({ width, height }, size));
    markFitted(true);
  }, [height, markFitted, ready, size, width]);

  const pan = useCallback(
    (dx: number, dy: number) => {
      if (!ready) return;
      setView((v) => panBy(v, dx, dy, { width, height }, size));
      markFitted(false);
    },
    [height, markFitted, ready, size, width]
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !ready) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomStep(Math.pow(ZOOM_STEP, -delta / 100), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, zoomStep]);

  return { viewportRef, size, view, ready, fitted, zoomStep, fit, pan };
}
