import type { ScanBatchData, ScanTileData } from "./scan-sheets";
import { candidateLabel, candidateShortLabel } from "./tile-candidates";

/**
 * The identifications already made on a scans screen (#757) — the last few, newest first, so the
 * tile in hand can be identified the way one of them was in a press.
 *
 * Pure, and derived from the batches the screen already holds rather than fetched: a consumed tile
 * carries the whole of what it became (`ScanTileData.item`), so a second read would be a second
 * answer to a question already on the client. It is also what makes the history survive a reload —
 * #595's one-deep memory was screen state and died with the screen, which is precisely the sitting
 * a collector returns to.
 */

/** How many identifications back the dialog offers. Ten is "the last stretch of the card" — far
 * enough to cover a run of duplicates interleaved with other stamps, short enough that the column
 * beside the piece stays a list to glance down rather than one to search. */
export const IDENTIFY_HISTORY_LIMIT = 10;

/** Everything the condition step needs to be opened on a previous identification's answers.
 *
 * The same set of fields #595's `TileIdentification` carried in screen state, rebuilt from the copy
 * the tile became. The catalogue value is deliberately absent for the same reason it always was: it
 * is a fact about the stamp that prefills itself from what was recorded for this stamp × condition
 * × certificate × format (#593). */
export interface IdentifyHistoryAnswers {
  stampId: string;
  /** The pick as the condition step's summary box words it. */
  label: string;
  /** The pick in one catalogue number, for a row that has a column's width to say it in. */
  shortLabel: string;
  conditionId: string;
  certificateStatusId: string;
  formatId: string;
  locationId: string;
  locationRef: string;
  disposition: { inCollection: boolean; forSale: boolean; forTrade: boolean };
  lotId: string;
}

/** One row of the history: the picture, enough words to recognise the decision, and the decision
 * itself. The **picture is the point** — a short label and an abbreviation say what was recorded,
 * and the thumbnail says what the piece looked like, which is what the tile on screen is being
 * compared against. */
export interface IdentifyHistoryEntry {
  /** The tile this identification was made on — the row's key, and the one id that is stable. */
  tileId: string;
  /** The copy's front, which **is** the tile's old front row under its new owner (consuming a tile
   * reassigns its photos). Null only for a copy that has since lost its pictures. */
  photoId: string | null;
  /** The copy's internal number, for the collector who wants to be sure which one this was. */
  itemNo: number;
  /** The condition's abbreviation, as the copy states it. */
  conditionAbbreviation: string;
  /** When the copy was created — the identification's own time, and what this list is ordered by. */
  at: string;
  answers: IdentifyHistoryAnswers;
}

/** A consumed tile that still has its copy is an identification; anything else is not.
 *
 * A copy deleted afterwards leaves the tile consumed with `item` null — it has neither a picture to
 * show nor an answer to repeat, so it drops out of the history by itself, which is the whole reason
 * this is derived from the tiles rather than remembered as it happens. */
function entryOf(tile: ScanTileData): IdentifyHistoryEntry | null {
  if (tile.state !== "consumed" || !tile.item) return null;
  const item = tile.item;
  return {
    tileId: tile.id,
    photoId: item.frontPhotoId ?? item.backPhotoId ?? null,
    itemNo: item.itemNo,
    conditionAbbreviation: item.conditionAbbreviation,
    at: item.createdAt,
    answers: {
      stampId: item.stampId,
      label: candidateLabel(item),
      shortLabel: candidateShortLabel(item),
      conditionId: item.conditionId,
      // The condition step reads "not chosen" as the empty string, which is where every one of
      // these lands when the copy answers a field with null.
      certificateStatusId: item.certificateStatusId ?? "",
      formatId: item.formatId ?? "",
      locationId: item.locationId ?? "",
      locationRef: item.locationRef ?? "",
      disposition: {
        inCollection: item.inCollection,
        forSale: item.forSale,
        forTrade: item.forTrade,
      },
      lotId: item.lotId ?? "",
    },
  };
}

/**
 * The screen's last identifications, newest first.
 *
 * Across **every batch** of the owner, not one card's: a card is a unit of scanning and not of
 * sorting, the same stamp arrives on the next sheet of the same lot, and a history that reset at
 * the batch boundary would forget exactly where the collector has not.
 */
export function identifyHistory(
  batches: readonly ScanBatchData[],
  limit: number = IDENTIFY_HISTORY_LIMIT
): IdentifyHistoryEntry[] {
  const entries: IdentifyHistoryEntry[] = [];
  for (const batch of batches) {
    for (const tile of batch.tiles) {
      const entry = entryOf(tile);
      if (entry) entries.push(entry);
    }
  }
  // Ties broken by tile id so the order is total: several tiles identified in one pass (#596) share
  // a copy-creation instant to the millisecond, and a list that reshuffled them between renders
  // would move a row out from under the hand about to press it.
  entries.sort((a, b) => (a.at === b.at ? a.tileId.localeCompare(b.tileId) : a.at < b.at ? 1 : -1));
  return entries.slice(0, limit);
}
