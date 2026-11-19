"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { coverStrength, DEFAULT_PHOTO_COVER_COLOR, sameOriginPhotoUrl, type PhotoCover } from "@/lib/photo-cover-rules";
import { coverPixelBox, paintCover, PIXELATE_BLOCKS_BY_STRENGTH, type Rgba } from "@/lib/photo-cover-render";

// A cover drawn on screen as it comes out on the offer images (#2586; ADR-0066): a bar in its colour, a
// pixelation as its real blocks, a blur at its real strength (#2587) — painted from the photo's own pixels with
// the numbers the server draws with (`photo-cover-render.ts`). The editor and the copy's page both draw
// covers through this.

/** The photo's pixels, fetched from this origin and decoded; null when they cannot be had. The `<img>`
 *  on screen may come from the storage provider's origin, whose pixels a page cannot read (#2585). */
export async function loadPhotoPixels(src: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(sameOriginPhotoUrl(src), { credentials: "same-origin" });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/** The photo's pixels for drawing its covers, once per photo; null until they arrive, or when not
 *  `wanted`, or when they cannot be had. */
export function usePhotoPixels(src: string, wanted: boolean): ImageBitmap | null {
  const [held, setHeld] = useState<{ src: string; pixels: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    let loaded: ImageBitmap | null = null;
    void loadPhotoPixels(src).then((pixels) => {
      if (!live) {
        pixels?.close();
        return;
      }
      loaded = pixels;
      if (pixels) setHeld({ src, pixels });
    });
    return () => {
      live = false;
      loaded?.close();
    };
  }, [src, wanted]);
  return wanted && held?.src === src ? held.pixels : null;
}

/** Whether any of these covers is drawn from the photo's pixels rather than in a colour of its own. */
export function needsPhotoPixels(covers: readonly (PhotoCover | null)[]): boolean {
  return covers.some((cover) => cover != null && cover.style !== "bar");
}

/** The largest a box is read at, across its shorter side, before it is worked on: even the finest
 *  pixelation's blocks are averaged from a couple of dozen pixels each, a blur is worked at far less. */
const READ_SIDE = Math.max(...PIXELATE_BLOCKS_BY_STRENGTH) * 24;

let scratch: HTMLCanvasElement | null = null;

/** The box's pixels, read from the photo at its own size or less. */
function readRegion(pixels: ImageBitmap, box: { left: number; top: number; width: number; height: number }): Rgba | null {
  const scale = Math.min(1, READ_SIDE / Math.min(box.width, box.height));
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  scratch ??= document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.imageSmoothingQuality = "high";
    context.drawImage(pixels, box.left, box.top, box.width, box.height, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } catch {
    return null;
  }
}

/** Paints a pixelated or blurred cover onto its canvas from the photo's pixels; false when it cannot. */
function paint(
  canvas: HTMLCanvasElement,
  kind: "pixelate" | "blur",
  share: { x: number; y: number; width: number; height: number },
  strength: number,
  pixels: ImageBitmap | null
): boolean {
  if (!pixels) return false;
  const box = coverPixelBox(share, pixels.width, pixels.height);
  const region = readRegion(pixels, box);
  if (!region) return false;
  const out = paintCover(kind, region, box, strength);
  canvas.width = out.width;
  canvas.height = out.height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  return true;
}

/** A cover's place over the photo, in shares of it, so it lands on the same pixels at any size. */
export function coverBoxStyle(cover: PhotoCover): CSSProperties {
  return {
    position: "absolute",
    left: `${cover.x * 100}%`,
    top: `${cover.y * 100}%`,
    width: `${cover.width * 100}%`,
    height: `${cover.height * 100}%`,
    borderRadius: cover.shape === "ellipse" ? "50%" : 0,
    boxSizing: "border-box",
  };
}

/**
 * One cover over its photo. Until the photo's pixels are in, a pixelation or blur is a plain neutral
 * box — it hides what is under it and pretends to be no style. `style` and the other props go on the
 * box (the editor puts its outline, cursor and `data-cover` there).
 */
export function CoverView({
  cover,
  pixels,
  style,
  children,
  ...rest
}: {
  cover: PhotoCover;
  pixels: ImageBitmap | null;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "children">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { style: kind, x, y, width, height } = cover;
  const strength = coverStrength(cover);

  // Painted straight onto the canvas, which stays hidden until it holds the cover, over the neutral box.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (kind === "bar" || !canvas) return;
    canvas.style.visibility = paint(canvas, kind, { x, y, width, height }, strength, pixels) ? "visible" : "hidden";
  }, [kind, x, y, width, height, strength, pixels]);

  const look: CSSProperties =
    kind === "bar"
      ? { background: cover.color ?? DEFAULT_PHOTO_COVER_COLOR }
      : { background: "var(--color-bg-subtle)", overflow: "hidden" };

  return (
    <span {...rest} style={{ ...coverBoxStyle(cover), ...look, ...style }}>
      {kind !== "bar" && (
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            visibility: "hidden",
            // A pixelation's blocks are stretched without smoothing, as the server blows them up.
            imageRendering: kind === "pixelate" ? "pixelated" : "auto",
            pointerEvents: "none",
          }}
        />
      )}
      {children}
    </span>
  );
}

/** A photo with its covers laid over it as they come out on the offer images, read-only — the copy's
 *  page draws its thumbnails with it. */
export function CoveredPhoto({
  src,
  covers,
  alt,
  style,
}: {
  src: string;
  covers: readonly PhotoCover[];
  alt: string;
  style?: CSSProperties;
}) {
  const pixels = usePhotoPixels(src, needsPhotoPixels(covers));
  return (
    <span style={{ position: "relative", display: "inline-block", lineHeight: 0, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- collection-scoped bytes, as every photo here */}
      <img src={src} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }} />
      {covers.map((cover, i) => (
        <CoverView key={i} aria-hidden cover={cover} pixels={pixels} />
      ))}
    </span>
  );
}
