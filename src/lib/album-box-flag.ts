// What a box of an album sheet is flagged for (#769), in one place so the page editor's canvas and
// the album screen's summary (#1430) count the same boxes under the same names.
//
// One flag per box, in the order they are worth reading: a box nothing on its checklist has measured
// is drawn degenerate and also has no strip, and calling it a pocket would send the collector to the
// hawid drawer when what is missing is a ruler. `corrected` is not a warning — it says a figure is the
// collector's own — and is the one flag the album screen does not count.

export type AlbumBoxFlag = "unmeasured" | "oversize" | "inherited" | "corrected";

export interface AlbumFlaggableBox {
  sizeSource: "stated" | "inherited" | null;
  /** The strip it is cut from, in words, or null for a pocket. */
  stripLabel: string | null;
  adjustment: unknown;
}

export function albumBoxFlag(box: AlbumFlaggableBox): AlbumBoxFlag | null {
  if (box.sizeSource === null) return "unmeasured";
  if (box.stripLabel === null) return "oversize";
  if (box.sizeSource === "inherited") return "inherited";
  if (box.adjustment) return "corrected";
  return null;
}
