"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Box } from "@/lib/scan-boxes";
import { visibleRegion, type Viewport, type ViewportSize } from "@/lib/scan-viewport";
import {
  enhanceWatermark,
  type WatermarkChannel,
} from "@/lib/scan-watermark";

/**
 * The visible part of a tile, redrawn through `scan-watermark.ts` (#625) — the effects around the
 * chain, kept away from both the arithmetic and the viewer.
 *
 * Same split as `use-sheet-region.ts`, and for the same reason: what is delicate here is not the
 * filter but *when it runs and where its output is put*. Three rules carry it.
 *
 * - **Pinned to the picture, not to the screen.** The processed crop is held with the box it was
 *   computed from, in scan pixels, and the viewer draws it inside the same transformed layer as the
 *   photo. So a pan or a zoom moves it with the pixels it belongs to instead of sliding a stale
 *   picture across the stamp, and the only thing a stale crop can be is *smaller than the window* —
 *   raw scan at the edges until the next one lands, which reads as processing rather than as a lie.
 * - **Debounced, and snapped to a grid with a margin** (`visibleRegion`). The chain is a few hundred
 *   milliseconds of main-thread work on a megapixel; running it per frame of a drag would make the
 *   viewer unusable, and running it for a pan of four pixels would redo it for the same rectangle.
 * - **A crop belongs to the side it was taken from.** The tile dialog swaps the picture underneath
 *   (front → back) while everything else stays, so the held render names its photo and is read
 *   against the one asking for it — clearing it from an effect would leave the front's watermark
 *   over the back for the render in between.
 *
 * The pixels come from the **tile's own photo**, the same proxied fetch #614's tooth count uses, and
 * not from the retained card scan. A watermark is a feature a millimetre across: the resolution that
 * would buy is spent on nothing, while the fetch and the decode would be paid on every crop.
 */

/** How long the view must be still before the chain runs. Longer than `use-sheet-region.ts`'s: that
 * one starts a fetch the network overlaps with a drag, this one takes the main thread. */
const WATERMARK_DEBOUNCE_MS = 250;

/** The grid the crop is snapped out to, and how far past the visible edges it reaches — both in
 * `visibleRegion`'s terms. The margin does a second job here that it does not do for a fetched
 * region: the band-pass has to invent values beyond the border of what it is given, so its estimate
 * is worst at the edges, and a margin puts those edges outside the viewport. */
const WATERMARK_GRID_PX = 64;
const WATERMARK_MARGIN = 0.3;

/** The working buffer's ceiling, in pixels across. The chain is O(pixels) with a median in the
 * middle of it, and this runs on the main thread — a megapixel is a few hundred milliseconds, which
 * is a pause after a drag rather than a stutter during one. Nothing is lost by the cap: the signal
 * being recovered spans millimetres, so the crop can be resampled well below the scan's own
 * resolution and still carry all of it. */
const MAX_WORK_PX = 1024;

/** …and its floor, so a crop seen at fit still gives the tiles and the blurs something to work with
 * (bounded by the source, which may itself be smaller). */
const MIN_WORK_PX = 320;

/** What the tool is doing, for the bar to say. `no-picture` is the same failure #614 names rather
 * than swallows: a chain that quietly does nothing is indistinguishable from one that is not wired
 * up. */
export type WatermarkStatus = "off" | "working" | "shown" | "no-picture";

/** A processed crop: the pixels, and where on the picture they belong. */
export interface WatermarkRender {
  box: Box;
  image: ImageData;
  /** Which photo it was taken from — see the third rule above. */
  owner: string;
}

export interface WatermarkViewParams {
  enabled: boolean;
  /** The tile photo's pixels, proxied same-origin. Shared with the tooth count, which is why it is
   * passed in rather than fetched here: one decode per tile side, however many readers it has. */
  loadPixels: () => Promise<ImageBitmap | null>;
  /** The photo the pixels will be of. Names the held render, and re-runs the chain on a flip. */
  photoId: string | null;
  /** The picture's size in **scan** pixels, which is the space `box` is in. */
  pictureWidth: number;
  pictureHeight: number;
  view: Viewport;
  size: ViewportSize;
  /** Scan pixels per millimetre, from the stated resolution (#598). Null when none has been stated,
   * and then the chain assumes a stamp-sized crop rather than refusing — unlike the ruler, a wrong
   * scale here costs a picture filtered at slightly the wrong band, never a number quoted as fact. */
  scanPixelsPerMm: number | null;
  channel: WatermarkChannel;
  strength: number;
}

export function useWatermarkView({
  enabled,
  loadPixels,
  photoId,
  pictureWidth,
  pictureHeight,
  view,
  size,
  scanPixelsPerMm,
  channel,
  strength,
}: WatermarkViewParams): {
  render: WatermarkRender | null;
  status: WatermarkStatus;
  /** A callback ref for the canvas the crop is drawn into. A callback rather than a ref object so
   * that React re-runs it whenever the crop changes — the paint then happens as the node attaches,
   * in the same commit the canvas appears in, rather than a paint later. */
  paint: (node: HTMLCanvasElement | null) => void;
} {
  const [render, setRender] = useState<WatermarkRender | null>(null);
  const [status, setStatus] = useState<WatermarkStatus>("off");
  /** The crop last asked for, so a chain that finishes after the view has moved on is dropped. */
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    // Nothing to do, and deliberately nothing to *undo*: the held crop is read against what is
    // asking for it below rather than cleared here, so turning the tool off and straight back on
    // puts the same crop back instead of reprocessing it.
    if (!enabled || !photoId || pictureWidth <= 0 || pictureHeight <= 0 || size.width === 0) return;
    const box = visibleRegion(
      view,
      { width: pictureWidth, height: pictureHeight },
      size,
      WATERMARK_MARGIN,
      WATERMARK_GRID_PX
    );
    if (!box) return;

    const key = [
      photoId,
      box.x,
      box.y,
      box.w,
      box.h,
      channel,
      strength.toFixed(2),
      scanPixelsPerMm ?? "—",
      Math.round(view.scale * 100),
    ].join(":");
    if (key === wanted.current) return;

    const timer = setTimeout(() => {
      wanted.current = key;
      setStatus("working");
      void (async () => {
        const bitmap = await loadPixels();
        if (wanted.current !== key) return;
        if (!bitmap || bitmap.width <= 0) {
          setStatus("no-picture");
          return;
        }

        // Scan pixels → this photo's own pixels. One ratio, exactly as the tooth count does it: the
        // crop is the same rectangle either way, so the photo is the picture at some scale and
        // never a different framing of it.
        const ratio = bitmap.width / pictureWidth;
        const sx = Math.max(0, Math.min(bitmap.width, box.x * ratio));
        const sy = Math.max(0, Math.min(bitmap.height, box.y * ratio));
        const sw = Math.max(1, Math.min(bitmap.width - sx, box.w * ratio));
        const sh = Math.max(1, Math.min(bitmap.height - sy, box.h * ratio));

        // Enough pixels for what is on screen, never more than the source has, and never more than
        // the cap — see {@link MAX_WORK_PX}.
        const cap = Math.min(MAX_WORK_PX, Math.round(sw));
        const workW = Math.max(1, Math.min(Math.max(MIN_WORK_PX, Math.round(box.w * view.scale)), cap));
        const workH = Math.max(1, Math.round((workW * sh) / sw));

        let image: ImageData;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = workW;
          canvas.height = workH;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            setStatus("no-picture");
            return;
          }
          ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, workW, workH);
          const source = ctx.getImageData(0, 0, workW, workH);
          const enhanced = enhanceWatermark(source, {
            channel,
            strength,
            // The working buffer's own scale: scan pixels per millimetre, carried through the
            // resampling this crop has just been through. The chain's radii are in millimetres of
            // paper, so this is what keeps them there.
            pixelsPerMm:
              scanPixelsPerMm === null ? null : (workW / box.w) * scanPixelsPerMm,
          });
          // Written back into the buffer the crop was read into rather than wrapped in a second
          // `ImageData`: same pixels, one allocation, and no dependence on which `ArrayBuffer`
          // flavour a `Uint8ClampedArray` happens to be carrying.
          source.data.set(enhanced.data);
          image = source;
        } catch {
          // Said rather than swallowed, for #614's reason: silence here reads as a feature that is
          // not wired up.
          setStatus("no-picture");
          return;
        }

        if (wanted.current !== key) return;
        setRender({ box, image, owner: photoId });
        setStatus("shown");
      })();
    }, WATERMARK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    enabled,
    loadPixels,
    photoId,
    pictureWidth,
    pictureHeight,
    view,
    size,
    scanPixelsPerMm,
    channel,
    strength,
  ]);

  // What is actually shown: a crop belongs to the photo it was taken from, and to a tool that is
  // still down. Read here rather than cleared in an effect — the tile dialog swaps the picture
  // underneath while everything else stays, and a crop cleared by an effect would still be on
  // screen for the render in between.
  const held = enabled && render && render.owner === photoId ? render : null;

  const paint = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node || !held) return;
      node.width = held.image.width;
      node.height = held.image.height;
      node.getContext("2d")?.putImageData(held.image, 0, 0);
    },
    [held]
  );

  return { render: held, status: enabled ? status : "off", paint };
}
