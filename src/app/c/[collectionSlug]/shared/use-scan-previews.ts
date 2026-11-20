"use client";

import { useEffect, useState } from "react";
import { scanPreviewSize } from "@/lib/scan-preview";

/** A file's picture: its address, or `failed` when the browser could not draw it. Absent while it is
 * still being made. */
export type ScanPreview = string | "failed";

/**
 * Small pictures of scans still on this computer (#2599), made in the browser before anything is
 * uploaded.
 *
 * Each scan is decoded **one at a time**, drawn at {@link scanPreviewSize} and let go, so a stack of
 * forty full-size scans never sits decoded in memory at once — the picture kept is a few tens of
 * kilobytes. One that cannot be drawn is `failed`, and the caller shows a plain frame instead; the
 * pairs list works the same either way. The addresses are released when the files change or the
 * caller goes away.
 */
export function useScanPreviews(files: readonly File[]): ReadonlyMap<File, ScanPreview> {
  const [previews, setPreviews] = useState<ReadonlyMap<File, ScanPreview>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      for (const file of files) {
        if (cancelled) return;
        let preview: ScanPreview;
        try {
          preview = await drawPreview(file);
          made.push(preview);
        } catch {
          preview = "failed";
        }
        if (cancelled) {
          if (preview !== "failed") URL.revokeObjectURL(preview);
          return;
        }
        setPreviews((prev) => new Map(prev).set(file, preview));
      }
    })();
    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [files]);

  return previews;
}

async function drawPreview(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scanPreviewSize(bitmap.width, bitmap.height);
    if (width === 0) throw new Error("empty image");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) throw new Error("no picture");
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}
