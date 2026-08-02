import type { CollectionAreaData } from "./areas";
import type { LocationData } from "./locations";
import type { SaleCopyItem } from "./sales";
import { copyCatalogLabel, type AreaVendorMaps } from "./area-vendor";
import { buildAreaPath } from "./area-path";
import { buildLocationPath } from "./location-path";
import { compareLocationRef } from "./location-ref";

// The printable packing list (#330): a sale's sold copies flattened into paper rows. Pure (no
// React / Prisma) so the print view is a plain server render and the shaping is unit-testable.
//
// The order is a **packing walk-order**: one section per storage location, and within a section
// the copies ordered by their in-location ref (`A234`) — the identifier you actually read off the
// shelf. Copies that are indistinguishable while packing (same stamp, same condition, same shelf
// ref, same packed state) collapse into one row with a quantity, so a run of duplicates is one
// line to tick rather than five identical ones.

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Label used for the section holding copies that are not filed anywhere. */
export const NO_LOCATION_LABEL = "No location";

export interface PackingListRow {
  /** Stable identity of the merged row (grouping key). */
  key: string;
  /** Catalog number with vendor prefix (e.g. `Mi·PL 200`), or the stamp name when it has none. */
  catalog: string;
  stampName: string | null;
  /** Name of the issue (series) the stamp belongs to, or null when it is in none. Constant across
   * a merged row — the merge key pins the stamp, and the issue is the stamp's. */
  issueName: string | null;
  /** Full path of the collection area the stamp sits in (`Polska › II RP`), or null. Like the
   * issue, it is a property of the stamp, so it is constant across a merged row. */
  areaPath: string | null;
  /** Condition abbreviation (e.g. `**`), falling back to the full name. */
  condition: string;
  /** Full condition name, for the printed legend / tooltip. */
  conditionName: string;
  /** Certificate status of the copy, or null when it has none. Printed beside the condition,
   * and part of the merge key — a certified copy is not interchangeable with an uncertified one. */
  certificateStatusName: string | null;
  /** In-location identifier, or null when the copy has none. */
  locationRef: string | null;
  /** Id of the first photo of the first copy behind the row (#112), or null when it has none —
   * the thumbnail column renders it. Merged copies share one thumbnail: they are the same stamp
   * in the same condition, so any of their photos identifies the piece to pull. */
  photoId: string | null;
  /** Every copy number (#268) behind the row, ascending (#474). A merged row stands for several
   * physical copies, and the number is written on the piece itself — so all of them are carried;
   * one of them would name a copy the collector cannot tell from its neighbours. */
  itemNos: number[];
  /** The distinct offer numbers (#416) the row's copies left through, ascending. Usually one — a
   * merged row is one stamp in one grade — but two identical copies can have been listed on two
   * offers of the same sale. Empty when no listing is on record. */
  offerNos: number[];
  /** How many copies this row stands for. */
  quantity: number;
  /** True when every copy behind the row is already packed (#192). */
  packed: boolean;
}

export interface PackingListGroup {
  /** Location id, or `__none__` for the unfiled section. */
  key: string;
  /** Full location path (`Szafa 1 › Klaser A`), or {@link NO_LOCATION_LABEL}. */
  location: string;
  rows: PackingListRow[];
  copyCount: number;
  packedCount: number;
}

export interface PackingListData {
  groups: PackingListGroup[];
  totalCopies: number;
  packedCopies: number;
}

interface Bucket {
  key: string;
  location: string;
  rows: Map<string, PackingListRow>;
}

/** Shape a sale's sold copies into printable, location-sectioned packing rows. */
export function buildPackingList(
  copies: SaleCopyItem[],
  areas: CollectionAreaData[],
  locations: LocationData[],
  maps: AreaVendorMaps
): PackingListData {
  const buckets = new Map<string, Bucket>();

  for (const copy of copies) {
    const bucketKey = copy.locationId ?? "__none__";
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        key: bucketKey,
        location: buildLocationPath(locations, copy.locationId) ?? NO_LOCATION_LABEL,
        rows: new Map(),
      };
      buckets.set(bucketKey, bucket);
    }
    // Copies only merge when nothing distinguishes them on paper — a half-packed pair stays two
    // rows so each half can be ticked on its own.
    const rowKey = [
      copy.stampId,
      copy.conditionId,
      copy.certificateStatusId ?? "",
      copy.locationRef ?? "",
      copy.packed ? "1" : "0",
    ].join("|");
    const existing = bucket.rows.get(rowKey);
    if (existing) {
      existing.quantity += 1;
      existing.itemNos.push(copy.itemNo);
      if (copy.offerNo != null && !existing.offerNos.includes(copy.offerNo)) {
        existing.offerNos.push(copy.offerNo);
      }
      // A later copy can carry the photo an earlier one lacks.
      existing.photoId ??= copy.photos[0]?.id ?? null;
      continue;
    }
    bucket.rows.set(rowKey, {
      key: rowKey,
      catalog: copyCatalogLabel(copy, maps),
      stampName: copy.stampName,
      issueName: copy.issueName,
      areaPath: buildAreaPath(areas, copy.areaId),
      condition: copy.conditionAbbreviation || copy.conditionName,
      conditionName: copy.conditionName,
      certificateStatusName: copy.certificateStatusName,
      locationRef: copy.locationRef,
      photoId: copy.photos[0]?.id ?? null,
      itemNos: [copy.itemNo],
      offerNos: copy.offerNo == null ? [] : [copy.offerNo],
      quantity: 1,
      packed: copy.packed,
    });
  }

  const groups: PackingListGroup[] = Array.from(buckets.values())
    .map((bucket) => {
      const rows = Array.from(bucket.rows.values()).sort(compareRows);
      // The numbers a row carries read as a list on paper, so they read ascending (#474) — the copy
      // order inside a merged row is an accident of how the sale was assembled.
      for (const row of rows) {
        row.itemNos.sort((a, b) => a - b);
        row.offerNos.sort((a, b) => a - b);
      }
      return {
        key: bucket.key,
        location: bucket.location,
        rows,
        copyCount: rows.reduce((sum, r) => sum + r.quantity, 0),
        packedCount: rows.reduce((sum, r) => sum + (r.packed ? r.quantity : 0), 0),
      };
    })
    .sort(compareGroups);

  return {
    groups,
    totalCopies: groups.reduce((sum, g) => sum + g.copyCount, 0),
    packedCopies: groups.reduce((sum, g) => sum + g.packedCount, 0),
  };
}

/** Sections in shelf order; the unfiled section always trails. */
function compareGroups(a: PackingListGroup, b: PackingListGroup): number {
  if (a.key === "__none__") return b.key === "__none__" ? 0 : 1;
  if (b.key === "__none__") return -1;
  return COLLATOR.compare(a.location, b.location);
}

/** Rows by in-location ref (prefix then number, blanks last), then catalog label, then condition. */
function compareRows(a: PackingListRow, b: PackingListRow): number {
  const byRef = compareLocationRef(a.locationRef, b.locationRef);
  if (byRef !== 0) return byRef;
  const byCatalog = COLLATOR.compare(a.catalog, b.catalog);
  if (byCatalog !== 0) return byCatalog;
  return COLLATOR.compare(a.condition, b.condition);
}
