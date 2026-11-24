import type { CollectionAreaData } from "./areas";
import type { LocationData } from "./locations";
import { catalogLabel, type AreaVendorMaps, type CatalogLabelSubject } from "./area-vendor";
import { buildAreaPath } from "./area-path";
import { buildLocationCode } from "./location-code";
import { buildLocationPath } from "./location-path";
import { compareLocationRef } from "./location-ref";
import type { PieceKind } from "./piece-valuation";

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
// off the shelf. **Every copy is its own row** (#2708): copies of one stamp are never collapsed into
// one row with a quantity, even when nothing tells them apart on paper. A merged row read as one
// piece and carried one photo, so the second and third copy were easy to miss while packing and their
// pictures were not on the sheet at all — each copy is a line to pick and tick, with its own photo.
//
// A sale's sheet can instead be divided by **sold set** (#2187): one division per set the buyer took,
// so a parcel packed down the sheet goes out with its sets apart. The set's copies still read in shelf
// order — by location, then ref — so a set is picked down the shelf all the same.
//
// A sale's sheet names a location by its **full code** (#2191, #2192; `A.B.1`, its levels' codes
// joined, since #2235), not its path: the sheet goes into the parcel, and the path is the
// collector's own storage names. The codes are explained by a legend printed apart from it ({@link packingLocationLegend}). Shelf order is still the order of the
// paths — a code is a label, and collating the labels would reorder the walk.
//
// Every row carries its stamp's **issue format** (#2444) — a souvenir sheet and a stamp taken out of
// one are different things to pull off the shelf — and the sheet prints it only when the collector
// switches it on.
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
 * The transaction line a copy sits on, where the printout is **per line** (a trade's checklist,
 * #642): what is recorded from the sheet is recorded against a line. A give line is one copy, so the
 * row is the copy and the line alike.
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
 * The sold set a copy left in, on a sheet divided by set (#2187).
 *
 * Named as the sale's own line names it — the offer it went through and its title, the set's
 * catalogue numbers under it (#2189), and its price — so a packed set can be matched to the buyer's
 * order. The price arrives **formatted** with its currency, because the sheet prints it as the sale
 * screen does and has no currency of its own to add.
 */
export interface PackingSet {
  /** The sale line's id — a set is a line. */
  id: string;
  /** The line's heading (`#2848 · <offer title>`), or the set's own label where it names no offer. */
  title: string;
  /** The set's catalogue numbers, printed muted under the heading; null where the heading says them. */
  numbers: string | null;
  /** Sold off no offer (#2021) — not merely an offer since deleted, which has no number either. */
  onNoOffer: boolean;
  /** A free extra (#2408) — given away on top of the order. */
  freeExtra: boolean;
  /** The line's price as printed (`25.00 PLN`). */
  price: string;
  /** Where the set's section sits on the sheet — the caller's order (see {@link packingSetOrder}). */
  position: number;
}

/**
 * The order a sale's sets are printed in (#2187): the sale's line order, except that sets sold
 * through one offer sit one after another — where that offer's first set falls. A set on no offer is
 * a run of its own.
 */
export function packingSetOrder(
  lines: readonly { id: string; offerId: string | null }[]
): Map<string, number> {
  const runs = new Map<string, string[]>();
  for (const line of lines) {
    const run = line.offerId ?? `line:${line.id}`;
    const ids = runs.get(run);
    if (ids) ids.push(line.id);
    else runs.set(run, [line.id]);
  }
  return new Map([...runs.values()].flat().map((id, position) => [id, position]));
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
  /** The stamp's issue format (#2439), or null — an ordinary stamp. Absent reads as null. The id
   *  places it in the dictionary's order on the sheet's summary by issue format (#2571). */
  issueFormat?: { id?: string; name: string; abbreviation: string } | null;
  /** Null for a piece, which has no condition (#2383); its row prints none. */
  conditionId: string | null;
  conditionName: string | null;
  conditionAbbreviation: string | null;
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
  /** The sold set this copy left in, read by the sheet divided by set. Absent elsewhere. */
  set?: PackingSet | null;
  /** Given away as a free extra (#2408), which its row says. Absent outside a sale. */
  freeExtra?: boolean;
}

export interface PackingListRow {
  /** Stable identity of the row — one copy (#2708). */
  key: string;
  /** Catalog number with vendor prefix (e.g. `Mi·PL 200`), or the stamp name when it has none. */
  catalog: string;
  stampName: string | null;
  /** Name of the issue (series) the stamp belongs to, or null when it is in none. */
  issueName: string | null;
  /** Full path of the collection area the stamp sits in (`Polska › II RP`), or null. */
  areaPath: string | null;
  /** The stamp's issue format abbreviation (#2444, `Bl`), or null for an ordinary stamp — printed
   *  beside the catalogue number when the sheet's switch is on. */
  issueFormat: string | null;
  /** The issue format's full name, for the hover hint. */
  issueFormatName: string | null;
  /** Condition abbreviation (e.g. `**`), falling back to the full name. Null for a piece (#2383). */
  condition: string | null;
  /** Full condition name, for the printed legend / tooltip. */
  conditionName: string | null;
  /** Certificate status of the copy, or null when it has none. Printed beside the condition. */
  certificateStatusName: string | null;
  /** In-location identifier, or null when the copy has none. */
  locationRef: string | null;
  /** Where the copy is, as the sheet prints it — the full location path, or the
   * location's code on a sheet that prints codes ({@link PackingListOptions.locationLabel}) — or null
   * when they are filed nowhere. Carried on the row as well as on the group because a sheet divided
   * by something *else* still wants to say where the piece is — and one divided by location does not
   * print it twice. */
  location: string | null;
  /** The full location path whatever the sheet prints: what shelf order collates. */
  locationPath: string | null;
  /** Id of the copy's first photo (#112), or null when it has none — the thumbnail column renders
   * it. Each copy's own (#2708): two copies of one stamp are two pieces, and each is pulled by its
   * own picture. */
  photoId: string | null;
  /** The copy's number (#268), written on the piece itself. */
  itemNo: number;
  /** The offer number (#416) the copy left through, or null when no listing is on record. */
  offerNo: number | null;
  /** True when the copy is already ticked at source. */
  packed: boolean;
  /** The copy is a free extra (#2408). */
  freeExtra: boolean;
  /** The line this row **is**, or null on a per-copy sheet — see {@link PackingLine}. */
  line: PackingLine | null;
}

/** One printed division of the sheet, with what it holds tallied. */
export interface PackingListGroup {
  /** Location id, `__none__` for the unfiled section, or the group name on a sheet divided by the
   *  transaction's own structure. */
  key: string;
  /** Heading: the full location path (`Szafa 1 › Klaser A`) or its code, the group's name, the set's
   *  title, or the label for the rows none of them places. */
  location: string;
  /** What the divisions of a sheet by location are collated by — the full path even where the
   *  heading is a code. */
  order: string;
  /** The sold set this division is, on a sheet divided by set; null on any other. */
  set: PackingSet | null;
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
   * collated, because that order is the agreement's. `set` is a sale's sold sets (#2187), in the
   * order the copies' {@link PackingSet.position} gives, each set's rows by location then ref.
   */
  grouping?: "location" | "group" | "set";
  /** Heading for the rows the grouping does not place. Defaults to {@link NO_LOCATION_LABEL} under
   *  `location` and {@link NO_GROUP_LABEL} under `group`. */
  ungroupedLabel?: string;
  /**
   * Row order inside a division: `shelf` by in-location ref (the identifier read off the shelf),
   * `catalog` by catalogue number. A sheet that prints no refs must not be ordered by them — a
   * reader cannot follow an order they cannot see. A sheet divided by set always reads by location,
   * then ref — its divisions are not shelves, so the location is part of the walk. `given` keeps the
   * order the copies came in, under any division — the caller has already put them in the order the
   * reader expects (a sold set's own order, #2512).
   */
  rowOrder?: "shelf" | "catalog" | "given";
  /**
   * How a location is printed, in headings and rows alike: `path` (`Szafa 1 › Klaser A`), or `code`
   * — the location's full code (#2192, #2235), for a sheet whose names are explained by a legend kept apart
   * from it. The order is the paths' either way.
   */
  locationLabel?: "path" | "code";
}

/** One line of a sheet's location legend (#2192): a code beside the path it stands for. */
export interface PackingLegendEntry {
  code: string;
  path: string;
}

interface Bucket {
  key: string;
  location: string;
  order: string;
  set: PackingSet | null;
  rows: PackingListRow[];
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
  const bySet = grouping === "set";
  const ungrouped =
    options.ungroupedLabel ?? (byGroup || bySet ? NO_GROUP_LABEL : NO_LOCATION_LABEL);
  const rowOrder = options.rowOrder ?? "shelf";
  const byCode = options.locationLabel === "code";

  const buckets = new Map<string, Bucket>();
  let currency: string | null = null;

  for (const copy of copies) {
    const locationPath = buildLocationPath(locations, copy.locationId);
    const locationLabel =
      byCode && copy.locationId
        ? (buildLocationCode(locations, copy.locationId) ?? locationPath)
        : locationPath;
    const group = byGroup ? (copy.line?.group ?? null) : null;
    const set = bySet ? (copy.set ?? null) : null;
    const bucketKey = bySet
      ? (set?.id ?? "__none__")
      : byGroup
        ? (group ?? "__none__")
        : (copy.locationId ?? "__none__");
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      const heading = (bySet ? (set?.title ?? null) : byGroup ? group : locationLabel) ?? ungrouped;
      bucket = {
        key: bucketKey,
        location: heading,
        order: (bySet || byGroup ? null : locationPath) ?? heading,
        set,
        rows: [],
      };
      buckets.set(bucketKey, bucket);
    }
    // Every copy is its own row (#2708) — never merged with another copy of the same stamp.
    currency ??= copy.line?.value?.currency ?? null;
    bucket.rows.push({
      key: `${copy.line?.id ?? ""}|${copy.itemNo}`,
      catalog: catalogLabel(catalogSubject(copy), maps),
      stampName: copy.stampName,
      issueName: copy.issueName,
      areaPath: buildAreaPath(areas, copy.areaId),
      issueFormat: copy.issueFormat?.abbreviation || copy.issueFormat?.name || null,
      issueFormatName: copy.issueFormat?.name ?? null,
      condition: copy.conditionAbbreviation || copy.conditionName,
      conditionName: copy.conditionName,
      certificateStatusName: copy.certificateStatusName,
      locationRef: copy.locationRef,
      location: locationLabel,
      locationPath,
      photoId: copy.photos[0]?.id ?? null,
      itemNo: copy.itemNo,
      offerNo: copy.offerNo ?? null,
      packed: copy.packed,
      freeExtra: copy.freeExtra ?? false,
      line: copy.line ?? null,
    });
  }

  const compareRows =
    rowOrder === "given"
      ? null
      : bySet
        ? compareByLocation
        : rowOrder === "catalog"
          ? compareByCatalog
          : compareByShelf;
  const groups: PackingListGroup[] = Array.from(buckets.values()).map((bucket) => {
    const rows = bucket.rows;
    if (compareRows) rows.sort(compareRows);
    return {
      key: bucket.key,
      location: bucket.location,
      order: bucket.order,
      set: bucket.set,
      rows,
      copyCount: rows.length,
      packedCount: rows.filter((r) => r.packed).length,
      // One piece per row, the same arithmetic the balance engine sums a side by, so a division's
      // figure and the trade's own total can never disagree about what a row is worth.
      value: rows.reduce((sum, r) => sum + (r.line?.value?.amount ?? 0), 0),
      valueMissing: rows.reduce((sum, r) => sum + (r.line && !r.line.value ? 1 : 0), 0),
    };
  });
  // Shelf order is the collation; the transaction's own order is the caller's, and is left alone;
  // a sale's sets go where the caller placed them, a copy on no set trailing.
  if (bySet) groups.sort(compareSets);
  else if (!byGroup) groups.sort(compareGroups);

  return {
    groups,
    totalCopies: groups.reduce((sum, g) => sum + g.copyCount, 0),
    packedCopies: groups.reduce((sum, g) => sum + g.packedCount, 0),
    totalValue: groups.reduce((sum, g) => sum + g.value, 0),
    valueMissing: groups.reduce((sum, g) => sum + g.valueMissing, 0),
    currency,
  };
}

/**
 * The legend to a sheet that prints location codes (#2192): every location the copies are filed in,
 * its code beside its full path, in shelf order. Unfiled copies add nothing — *No location* is
 * printed as itself.
 */
export function packingLocationLegend(
  copies: readonly Pick<PackingCopy, "locationId">[],
  locations: readonly LocationData[]
): PackingLegendEntry[] {
  const entries = new Map<string, PackingLegendEntry>();
  for (const { locationId } of copies) {
    if (!locationId || entries.has(locationId)) continue;
    const code = buildLocationCode(locations, locationId);
    const path = buildLocationPath(locations, locationId);
    if (code && path) entries.set(locationId, { code, path });
  }
  return Array.from(entries.values()).sort((a, b) => COLLATOR.compare(a.path, b.path));
}

// ── The summary by issue format (#2571) ──────────────────────────────────────
//
// What kinds of pieces go into the parcel, so the packing supplies can be judged before packing
// starts: loose stamps go in a stock card, while a souvenir sheet, a booklet pane or a cover each want
// a sleeve or a bigger envelope of their own. Counted in **pieces** — one per copy — and over **every** copy on the sheet, packed or not and free extras included, so it
// describes the whole parcel and its total is the sheet's own copy count.
//
// A **piece** (#744, #2383) is counted as itself and never by the stamps on it: by its format's kind
// — *Covers* for on cover, *Fragments* for on piece — and a carrier of several stamps whose format has
// no kind as *Pieces*. Everything else is counted by its stamp's issue format, and a stamp with none
// is an ordinary *Stamp*.

/** Label of the line counting copies of stamps with no issue format. */
export const FORMAT_SUMMARY_STAMPS = "Stamps";
/** Labels of the lines counting pieces, by the kind of the copy's format. */
export const FORMAT_SUMMARY_COVERS = "Covers";
export const FORMAT_SUMMARY_FRAGMENTS = "Fragments";
/** Label of the line counting carriers of several stamps whose format has no kind. */
export const FORMAT_SUMMARY_PIECES = "Pieces";

/** What the summary reads off a copy — a sale's sold copies and a trade's give lines alike. */
export interface PackingFormatSubject {
  issueFormat?: { id?: string; name: string; abbreviation: string } | null;
  /** The copy's own physical format (a multiple, a cover…), whose kind makes the copy a piece. */
  formatId?: string | null;
  /** More than one stamp on one indivisible piece (#745). */
  multiStamp?: boolean;
}

/** One line of the summary: a kind of piece and how many of it the sheet holds. */
export interface PackingFormatLine {
  key: string;
  /** The issue format's name as the dictionary writes it, or one of the fixed labels above. */
  label: string;
  /** Printed beside the name (`Bl`), or null where there is none or it would repeat the name. */
  abbreviation: string | null;
  count: number;
}

export interface PackingFormatSummary {
  lines: PackingFormatLine[];
  /** Every piece counted — the sheet's copy count. */
  total: number;
}

/**
 * Count a sheet's copies by issue format (#2571). Lines in the dictionary's order
 * (`issueFormatOrder`, ids by `sortOrder`), *Stamps* first and the pieces last; only what is present
 * prints. `formatKinds` maps a copy format's id to its kind (`StampFormat.pieceKind`).
 */
export function packingFormatSummary(
  copies: readonly PackingFormatSubject[],
  issueFormatOrder: readonly string[],
  formatKinds: ReadonlyMap<string, PieceKind | null>
): PackingFormatSummary {
  const rank = new Map(issueFormatOrder.map((id, i) => [id, i]));
  const lines = new Map<string, PackingFormatLine & { order: number }>();
  const add = (key: string, label: string, abbreviation: string | null, order: number) => {
    const line = lines.get(key);
    if (line) line.count += 1;
    else lines.set(key, { key, label, abbreviation, count: 1, order });
  };
  // Stamps first, the issue formats after in the dictionary's order (one it no longer lists after
  // those), then the pieces.
  const pieceOrder = issueFormatOrder.length + 2;
  for (const copy of copies) {
    const kind = copy.formatId ? (formatKinds.get(copy.formatId) ?? null) : null;
    if (kind === "on_cover") add("piece:on_cover", FORMAT_SUMMARY_COVERS, null, pieceOrder);
    else if (kind === "on_piece") add("piece:on_piece", FORMAT_SUMMARY_FRAGMENTS, null, pieceOrder + 1);
    else if (copy.multiStamp) add("piece:several", FORMAT_SUMMARY_PIECES, null, pieceOrder + 2);
    else if (copy.issueFormat) {
      const { id, name, abbreviation } = copy.issueFormat;
      const order = id !== undefined && rank.has(id) ? rank.get(id)! + 1 : issueFormatOrder.length + 1;
      add(
        `format:${id ?? name}`,
        name,
        abbreviation && abbreviation !== name ? abbreviation : null,
        order
      );
    } else add("stamps", FORMAT_SUMMARY_STAMPS, null, 0);
  }
  const sorted = Array.from(lines.values()).sort(
    (a, b) => a.order - b.order || COLLATOR.compare(a.label, b.label)
  );
  return {
    lines: sorted.map(({ key, label, abbreviation, count }) => ({ key, label, abbreviation, count })),
    total: copies.length,
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
  return COLLATOR.compare(a.order, b.order);
}

/** Sets in the caller's order; copies on no set trail. */
function compareSets(a: PackingListGroup, b: PackingListGroup): number {
  if (!a.set) return b.set ? 1 : 0;
  if (!b.set) return -1;
  return a.set.position - b.set.position;
}

/** Rows by location path (unfiled last), then as {@link compareByShelf}. */
function compareByLocation(a: PackingListRow, b: PackingListRow): number {
  if (a.locationPath !== b.locationPath) {
    if (a.locationPath === null) return 1;
    if (b.locationPath === null) return -1;
    const byLocation = COLLATOR.compare(a.locationPath, b.locationPath);
    if (byLocation !== 0) return byLocation;
  }
  return compareByShelf(a, b);
}

/** Rows by in-location ref (prefix then number, blanks last), then catalog label, then condition. */
function compareByShelf(a: PackingListRow, b: PackingListRow): number {
  const byRef = compareLocationRef(a.locationRef, b.locationRef);
  if (byRef !== 0) return byRef;
  return compareByCatalog(a, b);
}

/** Rows by catalog label, then condition, then copy number — the order of a sheet that prints no
 *  shelf refs. The copy number settles two copies of one stamp (#2708), so they read ascending. */
function compareByCatalog(a: PackingListRow, b: PackingListRow): number {
  const byCatalog = COLLATOR.compare(a.catalog, b.catalog);
  if (byCatalog !== 0) return byCatalog;
  const byCondition = COLLATOR.compare(a.condition ?? "", b.condition ?? "");
  if (byCondition !== 0) return byCondition;
  return a.itemNo - b.itemNo;
}

/**
 * A sale's packing-list *Copies* line (#2573): the parcel's total first, then its parts adding up to
 * it — *61 (56 in 14 sold sets + 5 free extras)*. The total includes the free extras (#2408); written
 * as *61 in 14 sold sets + 5 free extras* it read as 66 pieces. Without free extras the line is
 * *61 in 14 sold sets*.
 */
export function salePackingCopiesLabel(totalCopies: number, soldSets: number, freeExtras: number): string {
  const sets = `${soldSets} sold ${soldSets === 1 ? "set" : "sets"}`;
  if (freeExtras <= 0) return `${totalCopies} in ${sets}`;
  const extras = `${freeExtras} free ${freeExtras === 1 ? "extra" : "extras"}`;
  return `${totalCopies} (${totalCopies - freeExtras} in ${sets} + ${extras})`;
}
