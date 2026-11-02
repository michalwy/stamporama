// The four reserved formats that carry a stamp's prices on cover and on piece (#2356). Pure, so the
// price grid and the lists' switcher — client components — can tell them from a copy's formats.
//
// Catalogues price a stamp on a genuinely posted cover by franking: **EF** (Einzelfrankatur, the
// stamp alone), **MeF** (Mehrfachfrankatur, the same stamp several times), **MiF** (Mischfrankatur,
// with other stamps) — and **on piece** (Briefstück). A catalogue printing a single ⊠ price (Fischer)
// has it typed into MiF. They are stored as rows of the format dictionary so every price path reads
// them as it reads a block's price; they are never what a copy is.

export const COVER_KINDS = ["cover_ef", "cover_mef", "cover_mif", "on_piece"] as const;

export type CoverKind = (typeof COVER_KINDS)[number];

/** Each reserved row as seeded, in the order the price grid's tabs show them. The abbreviation is
 *  the name: `EF` or `Piece` alone says little on a tab beside `Blk4`, and could equal a copy format
 *  the collector added, which the agent API would then fail to tell apart. */
export const COVER_FORMATS: ReadonlyArray<{ coverKind: CoverKind; name: string; abbreviation: string }> = [
  { coverKind: "cover_ef", name: "Cover EF", abbreviation: "Cover EF" },
  { coverKind: "cover_mef", name: "Cover MeF", abbreviation: "Cover MeF" },
  { coverKind: "cover_mif", name: "Cover MiF", abbreviation: "Cover MiF" },
  { coverKind: "on_piece", name: "On piece", abbreviation: "On piece" },
];

export function isCoverKind(value: unknown): value is CoverKind {
  return typeof value === "string" && (COVER_KINDS as readonly string[]).includes(value);
}

/** A copy's formats first in the collector's order, then the four cover prices in theirs — the order
 *  of the price grid's tabs and of the lists' price switcher. */
export function sortPriceFormats<T extends { coverKind: CoverKind | null; sortOrder: number }>(
  formats: readonly T[]
): T[] {
  const rank = (f: T) => (f.coverKind ? COVER_KINDS.indexOf(f.coverKind) : -1);
  return [...formats].sort((a, b) => {
    if (!a.coverKind !== !b.coverKind) return a.coverKind ? 1 : -1;
    return a.coverKind ? rank(a) - rank(b) : a.sortOrder - b.sortOrder;
  });
}
