/**
 * What *Mark all unmarked* reaches on the card-scans strip — one card's tiles (#1556), or every card
 * of the purchase at once from the section's header (#2456).
 *
 * Both are the same rule, so both read it from here: **the open front tiles in view**. In view is
 * the chip's (#863) — a fold is not a filter, so a card folded shut is still reached; open is the
 * two states a mark can still seed, waiting and parked; and **never an unpaired back**, whose mark
 * meets its front's when it is dragged on, where the one given last wins and a fill given after the
 * exceptions would undo them. Which half each tile is given is still `fillPatch`'s, decided again on
 * the server against the stored marks.
 */

import { tilesInView, type FilterableTile, type TileFilter } from "./scan-tile-filter";
import { isSelectableTile } from "./scan-tile-selection";
import { unmarkedCounts, type TileMark } from "./tile-marks";

export interface FillableTile extends FilterableTile {
  id: string;
  frontBox: unknown;
  mark: TileMark | null;
}

/** One card's tiles a fill reaches: the open fronts the chip is showing. */
export function fillableTiles<T extends FillableTile>(tiles: readonly T[], filter: TileFilter): T[] {
  return tilesInView(tiles, filter).filter((t) => t.frontBox != null && isSelectableTile(t));
}

/** How far one half of a fill reaches: so many tiles, on so many scans. */
export interface FillReach {
  tiles: number;
  scans: number;
}

/** A fill over every card at once (#2456): the tiles it is handed, and how far each half reaches. */
export interface SectionFill {
  tileIds: string[];
  marks: (TileMark | null)[];
  condition: FillReach;
  certificate: FillReach;
}

/**
 * Every card's fillable tiles, gathered for one fill. `batches` are the cards the strip draws — the
 * caller's own list, so a card the chip leaves out entirely is not reached either. A scan still
 * being prepared has no tiles yet and adds nothing; a card still being cut adds the tiles it has.
 */
export function sectionFill<T extends FillableTile>(
  batches: readonly { tiles: readonly T[] }[],
  filter: TileFilter
): SectionFill {
  const tileIds: string[] = [];
  const marks: (TileMark | null)[] = [];
  const condition: FillReach = { tiles: 0, scans: 0 };
  const certificate: FillReach = { tiles: 0, scans: 0 };
  for (const batch of batches) {
    const tiles = fillableTiles(batch.tiles, filter);
    if (tiles.length === 0) continue;
    const counts = unmarkedCounts(tiles.map((t) => t.mark));
    for (const t of tiles) {
      tileIds.push(t.id);
      marks.push(t.mark);
    }
    condition.tiles += counts.condition;
    if (counts.condition > 0) condition.scans += 1;
    certificate.tiles += counts.certificate;
    if (counts.certificate > 0) certificate.scans += 1;
  }
  return { tileIds, marks, condition, certificate };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the header's *Mark all unmarked* (#2456) will reach, as its hint — *Mark 214 unmarked tiles
 * on 9 scans with a condition, or 230 on 10 with a certificate, in one pick*. Said before the pick,
 * with what it leaves out: the tiles a chip is hiding, and the scans still being prepared.
 */
export function sectionUnmarkedHint(
  fill: SectionFill,
  { hiddenByChip, preparing }: { hiddenByChip: boolean; preparing: number }
): string {
  const { condition, certificate } = fill;
  const main =
    fill.tileIds.length === 0
      ? "No tiles to mark"
      : condition.tiles === 0 && certificate.tiles === 0
        ? "Every tile on every scan has a condition and a certificate marked"
        : `Mark ${condition.tiles} unmarked ${condition.tiles === 1 ? "tile" : "tiles"} on ${plural(condition.scans, "scan", "scans")} with a condition, or ${certificate.tiles} on ${certificate.scans} with a certificate, in one pick — tiles already marked keep their mark`;
  return (
    main +
    (hiddenByChip ? " — the tiles the chip is hiding are not reached" : "") +
    (preparing > 0
      ? ` — ${plural(preparing, "scan", "scans")} still being prepared ${preparing === 1 ? "is" : "are"} not reached`
      : "")
  );
}
