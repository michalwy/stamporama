"use client";

import { useEffect, useRef, useState } from "react";
import type { Box } from "@/lib/scan-boxes";
import {
  regionKey,
  regionOnSheet,
  regionRequest,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";

/**
 * The visible region of a retained card scan, fetched at full resolution and drawn over the
 * derivative it magnifies (#579, ADR-0033 §6).
 *
 * Shared by the two surfaces that zoom into a scan — the cut editor over a whole card, the
 * identification dialog over one tile (#585) — because the *effects* around `regionRequest` are as
 * particular as the arithmetic inside it, and a second copy of them is a second set of ways to
 * paint a stale crop over a card. What differs between the two callers is a rectangle: the picture's
 * size in scan pixels, and where on the sheet it was taken from.
 *
 * Three rules, each learned the hard way:
 *
 * - **Debounced, including the clearing.** Each region costs a full decode of a 30 Mpx original
 *   server-side, so a pan must not ask for one per frame — this, plus the grid `regionRequest`
 *   snaps to, keeps a drag across a card to a handful of fetches. Dropping back below the
 *   threshold waits out the same delay, so a wheel spun past it and back does not blink the detail
 *   away and fetch it again.
 * - **Preloaded, never swapped into a live `<img>`.** Setting `src` blanks the element while the
 *   next image decodes, which at 8× would flash the picture away exactly when the collector is
 *   looking hardest at it. A repeat comes from the browser's cache: the route marks these
 *   immutable, a sheet's bytes never changing.
 * - **A load that lands after the view has moved on is dropped**, against the region last wanted.
 *
 * A failure is soft in both callers: the derivative underneath is still a picture of the stamp.
 * `sheetId` of null is the same case stated ahead of time — a scan the retention sweep has taken
 * (#578), or a picture with no retained original behind it at all.
 */

/** A crop currently drawn over the derivative: where it sits **on the picture** (not on the sheet —
 * that is the URL's business), and where it came from. Held only once loaded. */
export interface SheetRegionDetail {
  key: string;
  box: Box;
  url: string;
}

interface HeldRegion extends SheetRegionDetail {
  /** Which picture this crop belongs to. A crop is only ever right for the picture it was taken
   * from, so it is named rather than cleaned up: the tile dialog swaps the picture underneath (front
   * → back) while everything else stays, and a crop cleared by an effect would still be on screen
   * for the render in between. */
  owner: string;
}

const ownerOf = (sheetId: string | null, x: number, y: number) => `${sheetId}:${x},${y}`;

/** How long the viewport must be still before a region is fetched. */
const REGION_DEBOUNCE_MS = 200;

export interface SheetRegionParams {
  collectionId: string;
  /** The scan to ask, or null when there is none to ask. */
  sheetId: string | null;
  /** The picture on screen: its size in the scan's own pixels, and the width of the derivative
   * standing in for it. A `viewWidth` of 0 — a photo whose natural size is not measured yet —
   * asks for nothing, which is right: nothing is being magnified until it is on screen. */
  width: number;
  height: number;
  viewWidth: number;
  /** Where the picture's top-left corner sits on the sheet. Zero for a whole card. */
  originX?: number;
  originY?: number;
  view: Viewport;
  size: ViewportSize;
}

export function useSheetRegion({
  collectionId,
  sheetId,
  width,
  height,
  viewWidth,
  originX = 0,
  originY = 0,
  view,
  size,
}: SheetRegionParams): SheetRegionDetail | null {
  const [detail, setDetail] = useState<HeldRegion | null>(null);
  const owner = ownerOf(sheetId, originX, originY);
  /** The region last asked for, so a slow fetch cannot paint a stale crop. */
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    if (size.width === 0) return;
    const request =
      sheetId && viewWidth > 0
        ? regionRequest(view, { width, height, viewWidth }, size, window.devicePixelRatio || 1)
        : null;
    // Keyed by the **sheet** as well as the crop: front and back are two scans, and a paired tile
    // sits at close enough to the same place on both that one grid-snapped region can name the same
    // rectangle on each. Without the id, flipping sides would read as "already showing that" and
    // leave the front's detail standing in for the back's.
    const key = request
      ? `${sheetId}:${regionKey(regionOnSheet(request, { x: originX, y: originY }))}`
      : null;
    if (key === wanted.current) return;

    const timer = setTimeout(() => {
      wanted.current = key;
      if (!request || !sheetId) {
        // Back below the derivative's own scale — it has every pixel the screen can show, and
        // leaving a crop up would keep one part of the picture sharper than the rest for no reason.
        setDetail(null);
        return;
      }
      const onSheet = regionOnSheet(request, { x: originX, y: originY });
      const loaded = `${sheetId}:${regionKey(onSheet)}`;
      const { box, renderWidth } = onSheet;
      const url =
        `/api/collections/${collectionId}/scan-sheets/${sheetId}/region` +
        `?x=${box.x}&y=${box.y}&w=${box.w}&h=${box.h}&rw=${renderWidth}`;
      const image = new Image();
      image.onload = () => {
        // Placed by the picture's own box, served by the sheet's — the two differ by the origin,
        // and mixing them up is a crop drawn a tile's width away from where it belongs.
        if (wanted.current === loaded)
          setDetail({ key: loaded, box: request.box, url, owner: ownerOf(sheetId, originX, originY) });
      };
      image.src = url;
    }, REGION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [collectionId, sheetId, width, height, viewWidth, originX, originY, size, view]);

  // A picture swapped underneath (front → back) must not keep the other side's crop on screen while
  // the next one is fetched — and the answer is to *read* the held crop against the picture asking
  // for it rather than to clear it in an effect, which would leave it up for the render in between.
  return detail && detail.owner === owner ? detail : null;
}
