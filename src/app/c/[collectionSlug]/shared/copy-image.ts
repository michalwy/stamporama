"use client";

// Copying a picture to the clipboard — a collage (#2052), a proposal's lot photo (#2288) — for pasting
// into a chat.

/** A clipboard takes PNG, not JPEG, so the picture is redrawn as one on its way there. */
export async function asPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG"))), "image/png")
  );
}

/** Whether this browser lets a page put a picture on the clipboard — not over plain HTTP on a
 *  non-localhost origin, which a self-hosted instance may well be. */
export function canCopyImages(): boolean {
  return typeof navigator !== "undefined" && !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined";
}

/**
 * Put the picture at `url` on the clipboard as a PNG. The item is made at once with the picture still
 * to come: Safari allows a clipboard write only within the click, and the fetch and the conversion take
 * longer than that. Call {@link canCopyImages} first.
 */
export function copyImageAt(url: string): Promise<void> {
  const png = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob().then(asPng);
  });
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
