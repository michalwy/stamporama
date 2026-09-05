// The pure rules of printing an album (#768) — which sheets, and what the file is called.
//
// Split off from `album-pdf.ts` for the reason `album-template-rules.ts` is split off from
// `album-templates.ts`: everything here is decidable from plain values, so it belongs where
// `test:unit` can reach it, while the renderer next door pulls in pdf-lib, sharp, Prisma and the
// storage backend. These are conventions rather than geometry — the geometry is all in
// `album-layout.ts` and none of it is here.

/** Thrown for a selection that names nothing printable. Its message is shown to the collector, so
 *  it says what the album has rather than what the parser wanted. */
export class AlbumPageSelectionError extends Error {}

/**
 * Which sheets to render.
 *
 * **Positions, not identities.** A page's identity is its catalog range and deliberately never a
 * number (ADR-0045 §1) — but *asking for* a page is a different act from *naming* one. The numbers
 * below are typed by the screen that has just listed the sheets, are true only for that listing,
 * and are never printed onto anything. Reprinting one card after an insertion is the ordinary case,
 * so the cheapest thing that survives is a position into the plan the collector is looking at.
 *
 * Accepts `3`, `3-5`, and comma-separated combinations of the two, one-based because the list the
 * collector is reading is. Returns zero-based positions in plan order with duplicates dropped, so
 * `5,3,3-4` and `3-5` render the same file.
 *
 * Blank or absent selects the whole album — the common request, and the one a bare download link
 * makes.
 *
 * **This is for a live plan, and only for one.** A position means something only against the plan
 * that produced it: change the album and the same URL selects different cards. Harmless for a render
 * triggered and consumed in one breath, and the reason one must never be stored. #778's *reprint
 * this card* must **not** reach for this — a printed page does have an identity, its catalog range,
 * and reprinting is exactly the operation where selecting the wrong card is expensive.
 */
export function parseAlbumPageSelection(
  raw: string | null | undefined,
  pageCount: number
): number[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i);

  const chosen = new Set<number>();
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    const single = /^(\d+)$/.exec(piece);
    if (!range && !single) {
      throw new AlbumPageSelectionError(`"${piece}" is not a sheet number or a range of them.`);
    }
    const from = Number(range ? range[1] : single![1]);
    const to = Number(range ? range[2] : single![1]);
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      throw new AlbumPageSelectionError(
        pageCount === 0
          ? "This album has no sheets to print."
          : `This album has sheets 1 to ${pageCount}; "${piece}" is outside that.`
      );
    }
    // A reversed range is a typed mistake with one obvious reading, not an empty selection.
    for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) chosen.add(n - 1);
  }
  if (chosen.size === 0) throw new AlbumPageSelectionError("No sheets were chosen.");
  return [...chosen].sort((a, b) => a - b);
}

/**
 * What the browser saves the file as: the album's name, and the sheets when it is not all of them.
 *
 * Naming the sheets matters more here than it looks — reprinting is the ordinary case, so two
 * reprints of different cards would otherwise land in a downloads folder as `Polska.pdf` and
 * `Polska (1).pdf` with nothing to tell them apart.
 */
export function albumPdfFileName(
  albumName: string,
  pageCount: number,
  indices: readonly number[]
): string {
  const base = albumName.trim().replace(/[^\p{L}\p{N}\-_. ]+/gu, " ").replace(/\s+/g, " ").trim();
  const name = base || "Album";
  if (indices.length === pageCount) return `${name}.pdf`;
  const numbers = indices.map((i) => i + 1);
  const span =
    numbers.length === 1
      ? `sheet ${numbers[0]}`
      : `sheets ${numbers[0]}-${numbers[numbers.length - 1]}`;
  return `${name} ${span}.pdf`;
}
