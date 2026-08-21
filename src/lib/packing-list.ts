import type { CollectionAreaData } from "./areas";
import type { LocationData } from "./locations";
import { catalogLabel, type AreaVendorMaps, type CatalogLabelSubject } from "./area-vendor";
import { buildAreaPath } from "./area-path";
import { buildLocationPath } from "./location-path";
import { compareLocationRef } from "./location-ref";

// The printable packing list (#330): copies flattened into paper rows. Pure (no React / Prisma) so
// the print views are plain server renders and the shaping is unit-testable.
//
// **It is not a sale's list any more** (#643). It was coupled to sales through exactly one thing —
// its input type — and a trade's give side is copies too, so what it takes is now the structural
// projection below. Three printouts are built from it: a sale's packing list, a trade's packing
// checklist, and the parcel enclosure that goes in the envelope. What differs between them is the
// column set, the grouping and the row order, all of which are stated by the caller; the shaping is
// one function, because a second copy of it would be a second walk-order to keep in step.
//
// The default order is a **packing walk-order**: one section per storage location, and within a
// section the copies ordered by their in-location ref (`A234`) — the identifier you actually read
// off the shelf. Copies that are indistinguishable while packing (same stamp, same condition, same
// shelf ref, same ticked state) collapse into one row with a quantity, so a run of duplicates is one
// line to tick rather than five identical ones.
//
// A sheet the partner reads is the same shaping with the shelf taken out of it: the divisions are the
// transaction's own (a trade's sections), and the rows inside them read by catalogue number, because
// a walk along somebody else's shelves is not a thing the reader can do.

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Label used for the section holding copies that are not filed anywhere. */
export const NO_LOCATION_LABEL = "No location";

/** Label used for rows the transaction's own grouping does not place. */
export const NO_GROUP_LABEL = "Ungrouped";

/**
 * One figure a printed row carries — the value of **one piece**, in the transaction's own unit.
 *
 * Shaped like the partner page's `TradeShareValueView` and for its reasons (#640): a converted figure
 * with no book beside it cannot be checked, an unknown-variant rollup (#238) is a real figure *and*
 * an estimate, and a typed figure must never be printed as a published price.
 */
export interface PackingValue {
  amount: number;
  currency: string;
  /** The book behind this one figure, printed only where the header cannot say it for every line. */
  attribution: string | null;
  /** An unknown-variant rollup — a real figure, and an estimate, and says so. */
  uncertain: boolean;
  /** The collector's own typed figure rather than a published price. */
  manual: boolean;
}

/**
 * The transaction line a copy sits on, where the printout is **per line** rather than per copy.
 *
 * Carrying one makes the row *that line*: two otherwise identical copies stay two rows, because what
 * is recorded from the sheet is recorded against a line and a merged row of three could not be
 * answered for one piece at a time. This is the whole reason a trade's checklist does not merge while
 * a sale's does — a sale ticks copies, a trade answers for lines (#642).
 */
export interface PackingLine {
  id: string;
  /** The transaction's own division this line sits in (a trade section), or null. Printed as a
   *  column on the shelf-ordered sheet, and as the heading on the sheet divided by it. */
  group: string | null;
  /** The verdict as stored, carried through **opaque**: nothing here reads its spelling for meaning,
   *  and the surface that records it parses it with its own vocabulary. */
  verdict: string;
  /** What became of the line, in words, or null when there is nothing to say. Written by the caller
   *  because the two sheets word it differently — the collector's own checklist says *I withdrew it*,
   *  the partner's enclosure the neutral *Withdrawn*. */
  verdictLabel: string | null;
  /** Why, for the collector's own memory of the parcel. */
  note: string | null;
  /** What one piece of this line was agreed to be worth, or null when no figure is printed. */
  value: PackingValue | null;
}

/**
 * What a printable row is built from — satisfied by a sale's sold copies (`SaleCopyItem`) and by a
 * trade's give lines alike, structurally and without either side naming the other.
 *
 * Everything here is read; nothing is stored. The number a row is called by is formatted through
 * `catalogLabel`, the one rule every other stamp surface formats it by (#357/#377), which is why the
 * area, the issue and the numbers are all on it.
 */
export interface PackingCopy {
  stampId: string;
  stampName: string | null;
  areaId: string | null;
  issueId: string | null;
  catalogNumbers: readonly { catalogVendorId: string; number: string }[];
  issueName: string | null;
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  locationId: string | null;
  locationRef: string | null;
  /** Internal copy number (#268), printed as the collection writes it. */
  itemNo: number;
  photos: readonly { id: string }[];
  /** Already ticked at source: **packed** on a sale (#192), **fulfilled** on a trade give line
   *  (#642). One flag, because on paper it is one box either way. */
  packed: boolean;
  /** The offer a sold copy left through (#416), or absent where the printout has no listings. */
  offerNo?: number | null;
  /** The line this copy is promised on, where the sheet is per-line. Absent for a sale. */
  line?: PackingLine | null;
}

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
  /** Full location path of the copies behind the row, or null when they are filed nowhere. Carried
   * on the row as well as on the group because a sheet divided by something *else* still wants to
   * say where the piece is — and one divided by location does not print it twice. */
  location: string | null;
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
  /** True when every copy behind the row is already ticked at source. */
  packed: boolean;
  /** The line this row **is**, or null on a per-copy sheet. A row carrying one always stands for a
   * single copy — see {@link PackingLine}. */
  line: PackingLine | null;
}

/** One printed division of the sheet, with what it holds tallied. */
export interface PackingListGroup {
  /** Location id, `__none__` for the unfiled section, or the group name on a sheet divided by the
   *  transaction's own structure. */
  key: string;
  /** Heading: the full location path (`Szafa 1 › Klaser A`), the group's name, or the label for the
   *  rows neither places. */
  location: string;
  rows: PackingListRow[];
  copyCount: number;
  packedCount: number;
  /** What this division was agreed to be worth, over the rows that carry a figure. */
  value: number;
  /** Rows with no figure. **Counted, never summed as zero** — the partner page's rule (#640): a
   *  missing price is a gap in the list, and adding nothing for it would print a total nobody could
   *  reproduce. */
  valueMissing: number;
}

export interface PackingListData {
  groups: PackingListGroup[];
  totalCopies: number;
  packedCopies: number;
  /** The whole sheet's figure, and the rows it could not be read for. */
  totalValue: number;
  valueMissing: number;
  /** The unit every figure on the sheet is in, or null when none of them carry one. Taken from the
   *  rows rather than passed in, so a sheet without figures cannot print a currency for nothing. */
  currency: string | null;
}

/** What divides the sheet and how its rows read. */
export interface PackingListOptions {
  /**
   * What divides the sheet.
   *
   * `location` is the packing walk: one division per shelf, the unfiled ones trailing, headings in
   * shelf order. `group` is the transaction's own division (a trade section) — used where the reader
   * has never seen the shelves, so the headings keep the caller's own order rather than being
   * collated, because that order is the agreement's.
   */
  grouping?: "location" | "group";
  /** Heading for the rows the grouping does not place. Defaults to {@link NO_LOCATION_LABEL} under
   *  `location` and {@link NO_GROUP_LABEL} under `group`. */
  ungroupedLabel?: string;
  /**
   * Row order inside a division: `shelf` by in-location ref (the identifier read off the shelf),
   * `catalog` by catalogue number. A sheet that prints no refs must not be ordered by them — a
   * reader cannot follow an order they cannot see.
   */
  rowOrder?: "shelf" | "catalog";
}

interface Bucket {
  key: string;
  location: string;
  rows: Map<string, PackingListRow>;
}

/** Shape a set of copies into printable, sectioned rows. */
export function buildPackingList(
  copies: readonly PackingCopy[],
  areas: CollectionAreaData[],
  locations: LocationData[],
  maps: AreaVendorMaps,
  options: PackingListOptions = {}
): PackingListData {
  const grouping = options.grouping ?? "location";
  const byGroup = grouping === "group";
  const ungrouped = options.ungroupedLabel ?? (byGroup ? NO_GROUP_LABEL : NO_LOCATION_LABEL);
  const rowOrder = options.rowOrder ?? "shelf";

  const buckets = new Map<string, Bucket>();
  let currency: string | null = null;

  for (const copy of copies) {
    const locationPath = buildLocationPath(locations, copy.locationId);
    const group = byGroup ? (copy.line?.group ?? null) : null;
    const bucketKey = byGroup ? (group ?? "__none__") : (copy.locationId ?? "__none__");
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        key: bucketKey,
        location: (byGroup ? group : locationPath) ?? ungrouped,
        rows: new Map(),
      };
      buckets.set(bucketKey, bucket);
    }
    // Copies only merge when nothing distinguishes them on paper — a half-packed pair stays two
    // rows so each half can be ticked on its own. A copy that carries a **line** never merges: the
    // line is what a verdict is recorded against, and its id in the key is what says so.
    const rowKey = [
      copy.line?.id ?? "",
      copy.stampId,
      copy.conditionId,
      copy.certificateStatusId ?? "",
      copy.locationRef ?? "",
      copy.packed ? "1" : "0",
    ].join("|");
    currency ??= copy.line?.value?.currency ?? null;
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
      catalog: catalogLabel(catalogSubject(copy), maps),
      stampName: copy.stampName,
      issueName: copy.issueName,
      areaPath: buildAreaPath(areas, copy.areaId),
      condition: copy.conditionAbbreviation || copy.conditionName,
      conditionName: copy.conditionName,
      certificateStatusName: copy.certificateStatusName,
      locationRef: copy.locationRef,
      location: locationPath,
      photoId: copy.photos[0]?.id ?? null,
      itemNos: [copy.itemNo],
      offerNos: copy.offerNo == null ? [] : [copy.offerNo],
      quantity: 1,
      packed: copy.packed,
      line: copy.line ?? null,
    });
  }

  const compareRows = rowOrder === "catalog" ? compareByCatalog : compareByShelf;
  const groups: PackingListGroup[] = Array.from(buckets.values()).map((bucket) => {
    const rows = Array.from(bucket.rows.values()).sort(compareRows);
    // The numbers a row carries read as a list on paper, so they read ascending (#474) — the copy
    // order inside a merged row is an accident of how the transaction was assembled.
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
      // Per piece × how many pieces, the same arithmetic the balance engine sums a side by, so a
      // division's figure and the trade's own total can never disagree about what a row is worth.
      value: rows.reduce((sum, r) => sum + (r.line?.value ? r.line.value.amount * r.quantity : 0), 0),
      valueMissing: rows.reduce((sum, r) => sum + (r.line && !r.line.value ? 1 : 0), 0),
    };
  });
  // Shelf order is the collation; the transaction's own order is the caller's, and is left alone.
  if (!byGroup) groups.sort(compareGroups);

  return {
    groups,
    totalCopies: groups.reduce((sum, g) => sum + g.copyCount, 0),
    packedCopies: groups.reduce((sum, g) => sum + g.packedCount, 0),
    totalValue: groups.reduce((sum, g) => sum + g.value, 0),
    valueMissing: groups.reduce((sum, g) => sum + g.valueMissing, 0),
    currency,
  };
}

/** A copy as `catalogLabel` reads it: where it sits, and what it is numbered and called. The one
 *  place the projection's `stampName` and the labeller's `name` are bridged. */
function catalogSubject(copy: PackingCopy): CatalogLabelSubject {
  return {
    areaId: copy.areaId,
    issueId: copy.issueId,
    catalogNumbers: copy.catalogNumbers,
    name: copy.stampName,
  };
}

/** Sections in shelf order; the unfiled section always trails. */
function compareGroups(a: PackingListGroup, b: PackingListGroup): number {
  if (a.key === "__none__") return b.key === "__none__" ? 0 : 1;
  if (b.key === "__none__") return -1;
  return COLLATOR.compare(a.location, b.location);
}

/** Rows by in-location ref (prefix then number, blanks last), then catalog label, then condition. */
function compareByShelf(a: PackingListRow, b: PackingListRow): number {
  const byRef = compareLocationRef(a.locationRef, b.locationRef);
  if (byRef !== 0) return byRef;
  return compareByCatalog(a, b);
}

/** Rows by catalog label, then condition — the order of a sheet that prints no shelf refs. */
function compareByCatalog(a: PackingListRow, b: PackingListRow): number {
  const byCatalog = COLLATOR.compare(a.catalog, b.catalog);
  if (byCatalog !== 0) return byCatalog;
  return COLLATOR.compare(a.condition, b.condition);
}
