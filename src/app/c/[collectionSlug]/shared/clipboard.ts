/**
 * Put a text on the clipboard (#327) — with `html` beside it on `text/html` where one is given and the
 * browser takes both, so a rich-text editor pastes it formatted and a plain field still gets readable
 * text (#1772). Rejects when there is no clipboard — `navigator.clipboard` is absent over plain HTTP on
 * a non-localhost origin, which a self-hosted instance may well be — or the browser refuses it.
 * The desk's `CopyButton` and the phone's copy buttons (#2629) both write through it.
 */
export async function writeClipboardText(plain: string, html?: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard) throw new Error("No clipboard in this browser.");
  if (html === undefined || typeof ClipboardItem === "undefined" || !clipboard.write) {
    await clipboard.writeText(plain);
    return;
  }
  await clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    }),
  ]);
}
