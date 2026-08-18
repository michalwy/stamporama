// Reading Delcampe's own **active-items export** (#611) — pure, no Prisma and no `server-only`, so
// every judgement a reconciliation makes can be asserted against a file's text in a unit test.
//
// This is the **reader's** half of a contract whose two directions are not symmetric (ADR-0034 §5,
// ADR-0037 §2): #610's upload file spells a decimal with a comma (`"0,10"`) and states no time zone
// at all, while the export comes back with a dot (`17.44`) and carries its zone in a **separate
// `GMT` column**. Neither module knows about the other's spelling — one writes an upload, this one
// reads an export, and a shared "Delcampe number" helper would have to be told which direction it
// was in on every call.
//
// What is deliberately **not** here:
//
//   * **Anything about a sale.** A listing leaving the export means it came down — sold, ended, or
//     pulled — and which of those it was is #612's question, asked of the order screens where the
//     answer actually is. This module reports absence and stops.
//   * **A guess between two listings.** Delcampe does not enforce uniqueness on
//     `personal_reference`; the collector's own live listings carry one reference on two different
//     `id_auction` values. Exported references are unique by construction, so a duplicate is a fault
//     to go and fix, and {@link reconcileDelcampeListings} refuses both rows rather than picking the
//     newer, the cheaper or the first.
//   * **Formatting.** Nothing here writes a file.

import {
  CLOSED_OFFER_STATES,
  isAuctionListing,
  normalizeListingType,
  type OfferState,
} from "./offer-rules";

/**
 * The columns Delcampe's active-items export is known to carry, in its own order.
 *
 * Recorded for the record and **not** enforced: rows are read by column *name*
 * ({@link readDelcampeActiveItems}), so an export that gains a column, drops one this app never
 * reads, or reorders them still reads. Only the two the reconciliation cannot work without —
 * `id_auction` and `personal_reference` — are required, and their absence is what "this is not an
 * active-items export" means.
 */
export const DELCAMPE_EXPORT_COLUMNS = [
  "id_auction",
  "title",
  "personal_reference",
  "description",
  "id_category",
  "shipping_model",
  "weight",
  "visits_number",
  "end_date",
  "GMT",
  "present_price",
  "quantity",
  "bids_number",
  "best_bidder",
] as const;

/** The two columns a file has to have for any of this to mean anything. */
export const DELCAMPE_EXPORT_REQUIRED_COLUMNS = ["id_auction", "personal_reference"] as const;

/** The public address of one Delcampe item, composed from its id rather than stored beside it. */
export function delcampeItemUrl(itemId: string): string {
  return `https://www.delcampe.net/en_US/collectibles/item/${encodeURIComponent(itemId)}.html`;
}

/** One row of the export, already read into the app's own words. */
export interface DelcampeActiveItemRow {
  /** Delcampe's own listing id (`id_auction`). */
  itemId: string;
  title: string;
  /** The reference the row came back carrying, verbatim and trimmed; null where the cell was empty. */
  personalReference: string | null;
  /** What that reference resolves to in *this* collection, or null — see
   *  {@link offerNoFromPersonalReference}. */
  referenceOfferNo: number | null;
  categoryId: string | null;
  /** `present_price`, read with the export's own dot. */
  presentPrice: number | null;
  quantity: number | null;
  /** `bids_number`. `0` is "up, nobody has bid", which is not the same as the file not saying. */
  bidsCount: number | null;
  bestBidder: string | null;
  visits: number | null;
  /** `end_date` read against the file's separate `GMT` column. */
  endsAt: Date | null;
  /** Which line of the file this was, 1-based and counting the header — so a refusal names
   *  something the collector can find in a spreadsheet. */
  line: number;
}

/** What reading a file produced: rows, or one sentence about why there are none. */
export type DelcampeExportRead =
  | { ok: true; rows: DelcampeActiveItemRow[] }
  | { ok: false; message: string };

/**
 * Split delimited text into rows of fields (RFC 4180).
 *
 * Written here rather than depended on: the file is a dozen columns of a marketplace's own export,
 * the rules are quotes, doubled quotes and separators-inside-quotes, and a parser that can be
 * asserted against Delcampe's actual sample is worth more than a dependency whose options would have
 * to be settled anyway. `\r\n`, `\n` and a bare `\r` all end a row, since the file travels through
 * whatever the collector's browser and spreadsheet did to it on the way here.
 *
 * A trailing newline does not produce an empty final row, and neither does a blank line anywhere —
 * a spreadsheet's parting gift, and not a listing.
 */
export function parseCsvRows(text: string, separator = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let dirty = false;

  const endField = () => {
    row.push(field);
    field = "";
    dirty = true;
  };
  const endRow = () => {
    if (dirty) rows.push(row);
    row = [];
    dirty = false;
  };

  // A byte-order mark is a spreadsheet's convenience that would otherwise become part of the first
  // column's *name*, which is how a file that looks perfect reads as having no `id_auction`.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      dirty = true;
      continue;
    }
    if (char === separator) {
      endField();
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      if (dirty || field.length > 0) endField();
      endRow();
      continue;
    }
    field += char;
  }
  if (dirty || field.length > 0) endField();
  endRow();

  // A row of nothing but empty fields is a blank line the split above could not tell from a record.
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

/**
 * A figure as the **export** spells it: a dot separator (`17.44`), against the comma the upload file
 * takes (ADR-0034 §5).
 *
 * A comma is accepted too and read as the same separator — Delcampe is a European marketplace and
 * the file is routinely opened in a spreadsheet before it gets here, which is exactly where `17.44`
 * becomes `17,44`. What is *not* accepted is a thousands separator: `1,234.56` would have to be told
 * apart from `1,23` by counting digits, and a price read wrong is worse than a price not read.
 */
export function parseDelcampeDecimal(raw: string | null | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (!/^-?\d+([.,]\d+)?$/.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** A whole number, or null where the cell was empty or not one. */
export function parseDelcampeInteger(raw: string | null | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * `end_date` read against the file's **separate `GMT` column** (`"2026-08-28 14:53:00"` +
 * `"GMT +1.0"`).
 *
 * The zone being its own column is the whole reason this is a function: a local timestamp stored as
 * if it were UTC is off by an hour or two in a way nothing downstream can detect, and an offset of
 * `+1.0` is an hour and not a minute. Half-hour zones are why it is read as a fraction rather than
 * as an integer.
 *
 * An unreadable pair is null rather than an approximation. The closing time raises a flag (#490); a
 * flag raised at the wrong hour is worse than one not raised.
 */
export function parseDelcampeEndDate(
  date: string | null | undefined,
  gmt: string | null | undefined
): Date | null {
  const stamp = (date ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(stamp);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;

  const zone = (gmt ?? "").trim();
  let offsetMinutes = 0;
  if (zone) {
    const offset = /^(?:GMT|UTC)?\s*([+-])\s*(\d{1,2})(?:[.:](\d{1,2}))?$/i.exec(zone);
    if (!offset) return null;
    const [, sign, hours, fraction] = offset;
    // `+1.0` is a decimal fraction of an hour where `+1:30` is minutes, and both spellings have been
    // seen in exports of this kind. `.5` and `:30` therefore have to mean the same half hour.
    const minutes = fraction
      ? zone.includes(":")
        ? Number(fraction)
        : Math.round(Number(`0.${fraction}`) * 60)
      : 0;
    offsetMinutes = (Number(hours) * 60 + minutes) * (sign === "-" ? -1 : 1);
  }

  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0
  );
  const value = new Date(utc - offsetMinutes * 60_000);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * Which offer a `personal_reference` names, or null.
 *
 * #610 writes the offer's own short URL into that column (`https://…/o/<slug>/<offerNo>`, #415/#416),
 * so the reference is read back as an address: the **path** decides which offer, and the collection
 * slug in it has to be this collection's. That last check is what keeps two collections on one
 * instance from claiming each other's listings.
 *
 * The **origin is deliberately not checked**, which is where this parts company with #417's rule for
 * pages the extension reads. There, an origin is what tells our own page from somebody else's; here
 * the file is one the collector downloaded from their own selling account, and the only thing a
 * strict origin would achieve is that every listing stops matching the day the instance moves from
 * a LAN address to a domain name — with the listings already up carrying the old one for ever.
 */
export function offerNoFromPersonalReference(
  reference: string | null | undefined,
  collectionSlug: string
): number | null {
  const text = (reference ?? "").trim();
  if (!text) return null;
  const match = /(?:^|\/)o\/([^/\s]+)\/(\d+)\/?$/.exec(text);
  if (!match) return null;
  const [, slug, offerNo] = match;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // A reference somebody re-typed by hand may not be valid percent-encoding; compare it raw.
  }
  if (decoded !== collectionSlug) return null;
  const value = Number(offerNo);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Read a whole export.
 *
 * By column **name**, never by position: Delcampe's own sample orders the columns one way, a file
 * that has been through a spreadsheet may not, and a reader that counts commas would import a page
 * of listings under the wrong ids without ever failing. A file whose header does not name
 * `id_auction` and `personal_reference` is refused whole and by name — it is almost always the
 * *sold*-items export, which is a different file for a different job (#612).
 */
export function readDelcampeActiveItems(text: string, collectionSlug: string): DelcampeExportRead {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { ok: false, message: "That file is empty." };

  const header = rows[0].map((name) => name.trim().toLowerCase());
  const index = new Map(header.map((name, position) => [name, position]));
  const missing = DELCAMPE_EXPORT_REQUIRED_COLUMNS.filter((name) => !index.has(name.toLowerCase()));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `This does not look like a Delcampe active-items export — it has no ${missing.join(
        " and no "
      )} column.`,
    };
  }

  const cell = (row: string[], column: string): string | null => {
    const position = index.get(column);
    if (position === undefined) return null;
    const value = (row[position] ?? "").trim();
    return value.length > 0 ? value : null;
  };

  const out: DelcampeActiveItemRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const itemId = cell(row, "id_auction");
    // A row with no listing id is not a listing. It is skipped rather than refusing the file: the
    // one thing that reliably produces one is a spreadsheet's own trailing artefact.
    if (!itemId) continue;
    const personalReference = cell(row, "personal_reference");
    out.push({
      itemId,
      title: cell(row, "title") ?? "",
      personalReference,
      referenceOfferNo: offerNoFromPersonalReference(personalReference, collectionSlug),
      categoryId: cell(row, "id_category"),
      presentPrice: parseDelcampeDecimal(cell(row, "present_price")),
      quantity: parseDelcampeInteger(cell(row, "quantity")),
      bidsCount: parseDelcampeInteger(cell(row, "bids_number")),
      bestBidder: cell(row, "best_bidder"),
      visits: parseDelcampeInteger(cell(row, "visits_number")),
      endsAt: parseDelcampeEndDate(cell(row, "end_date"), cell(row, "gmt")),
      line: i + 1,
    });
  }
  return { ok: true, rows: out };
}

// ── The reconciliation ────────────────────────────────────────────────────────────────────────

/** The offer side of a match: the least this decision needs to know. */
export interface ReconcilableOffer {
  id: string;
  offerNo: number;
  state: OfferState;
  /** The listing this offer already names (#611), or null. */
  delcampeItemId: string | null;
}

/** A listing this collection has already recorded, as the last import left it. */
export interface KnownDelcampeListing {
  itemId: string;
  status: string;
  offerId: string | null;
}

/** Why a row could not be attached to an offer. Each is a different thing to go and do. */
export type DelcampeMatchProblem =
  /** No `personal_reference`, or one that is not an offer address of this collection. */
  | "no-reference"
  /** A reference naming an offer number this collection does not have. */
  | "unknown-offer"
  /** Two or more rows in this file name the same offer. */
  | "duplicate-reference"
  /** The offer this row names is already up as a *different* listing that is also in this file. */
  | "offer-already-listed";

/** What the import should do about the offer behind one matched row. */
export type DelcampeMatchAction =
  /** `ready → active`, with the listing id and its URL. The batch has been confirmed by Delcampe. */
  | "activate"
  /** Already `active`: the id and the URL are confirmed, or filled in where they were missing. */
  | "confirm"
  /** Matched, but the offer's state is not one this may move (`preparing`, `paused`, `sold`,
   *  `withdrawn`). The listing is recorded and the state is left exactly as it is — reported
   *  instead, since a listing up against a withdrawn offer is news rather than a transition. */
  | "record";

/** One row of the file, and what it resolved to. */
export interface ReconciledRow {
  row: DelcampeActiveItemRow;
  offerId: string | null;
  offerNo: number | null;
  /** The offer's state at the moment of the import, for the report. Null where nothing matched. */
  offerState: OfferState | null;
  action: DelcampeMatchAction | null;
  problem: DelcampeMatchProblem | null;
}

/** A listing that was up at the last import and is not in this file. */
export interface CameDownListing {
  itemId: string;
  offerId: string | null;
}

export interface DelcampeReconciliation {
  /** Every row of the file, in file order, matched or not. */
  rows: ReconciledRow[];
  /** The rows that reached an offer, in file order. */
  matched: ReconciledRow[];
  /** The rows that did not, in file order. */
  unmatched: ReconciledRow[];
  /** Recorded listings the file no longer carries. */
  cameDown: CameDownListing[];
}

/**
 * Match a file's rows to this collection's offers, and work out what has come down.
 *
 * Three rules, and all three are about refusing to be clever:
 *
 *  • **A reference names one offer, and one offer has one listing.** Two rows resolving to the same
 *    offer are *both* refused (`duplicate-reference`) — neither is applied and the offer is left
 *    alone. Delcampe does not enforce uniqueness on the column and the collector's own live listings
 *    already break it, so this is a real case and not a defensive flourish. Picking the newer or the
 *    dearer one would put a listing id on an offer on the strength of a tie-break nobody agreed to.
 *
 *  • **An offer already up as another listing is not silently re-pointed.** Where the offer names an
 *    item id that is *also* in this file, both are live and it is the same contradiction as above
 *    (`offer-already-listed`). Where the id it names is **absent** from the file, that listing has
 *    come down and this one is its replacement — a relist, which is the ordinary way a Delcampe
 *    listing is renewed by hand, and taking it over is the only reading that is not a guess.
 *
 *  • **Absence is the signal, and only for what was actually recorded.** A row that came down is one
 *    this collection had seen up; a listing that has never been imported cannot go missing from a
 *    file. What it *means* — sold, ended, pulled — is deliberately not decided here (#612).
 */
export function reconcileDelcampeListings(input: {
  rows: readonly DelcampeActiveItemRow[];
  offers: readonly ReconcilableOffer[];
  known: readonly KnownDelcampeListing[];
}): DelcampeReconciliation {
  const { rows, offers, known } = input;
  const byOfferNo = new Map(offers.map((offer) => [offer.offerNo, offer]));
  const idsInFile = new Set(rows.map((row) => row.itemId));

  // Which offer numbers this file names more than once. Counted over the whole file first, because
  // the second row is what makes the *first* one a duplicate — a single pass would have applied it.
  const claims = new Map<number, number>();
  for (const row of rows) {
    if (row.referenceOfferNo === null) continue;
    claims.set(row.referenceOfferNo, (claims.get(row.referenceOfferNo) ?? 0) + 1);
  }

  const reconciled: ReconciledRow[] = rows.map((row) => {
    const base = { row, offerId: null, offerNo: row.referenceOfferNo, offerState: null, action: null };
    if (row.referenceOfferNo === null) return { ...base, problem: "no-reference" as const };

    const offer = byOfferNo.get(row.referenceOfferNo);
    if (!offer) return { ...base, problem: "unknown-offer" as const };
    if ((claims.get(row.referenceOfferNo) ?? 0) > 1) {
      return { ...base, offerState: offer.state, problem: "duplicate-reference" as const };
    }
    if (
      offer.delcampeItemId &&
      offer.delcampeItemId !== row.itemId &&
      idsInFile.has(offer.delcampeItemId)
    ) {
      return { ...base, offerState: offer.state, problem: "offer-already-listed" as const };
    }

    const action: DelcampeMatchAction =
      offer.state === "ready" ? "activate" : offer.state === "active" ? "confirm" : "record";
    return {
      row,
      offerId: offer.id,
      offerNo: offer.offerNo,
      offerState: offer.state,
      action,
      problem: null,
    };
  });

  const cameDown = known
    .filter((listing) => listing.status === "ACTIVE" && !idsInFile.has(listing.itemId))
    .map((listing) => ({ itemId: listing.itemId, offerId: listing.offerId }));

  return {
    rows: reconciled,
    matched: reconciled.filter((entry) => entry.offerId !== null),
    unmatched: reconciled.filter((entry) => entry.offerId === null),
    cameDown,
  };
}

// ── What a row says about the bidding ─────────────────────────────────────────────────────────

/** The offer a row's figures would be written onto. */
export interface DelcampeBiddableOffer {
  listingType: string;
  state: OfferState;
  currency: string;
  inActiveBidding: boolean;
  bidderCount: number | null;
  endsAt: Date | null;
}

/** Only the fields that should actually change — `BidWrite`'s shape (#481), on this platform. */
export interface DelcampeBidWrite {
  inActiveBidding?: true;
  price?: string;
  priceCheckedAt?: Date;
  bidderCount?: number;
  endsAt?: Date;
}

/**
 * What one row of the export means for the offer behind it — #481's rule, on a platform that states
 * less than Allegro does.
 *
 * The differences are two, and both narrow it:
 *
 *  • **The file states no selling format.** Allegro's `bidWriteFor` requires *both* sides to call it
 *    an auction, precisely so a standing bid is never written over a quick-buy's asking price. Here
 *    only one side speaks, so the local `listingType` is the whole test — which is the conservative
 *    half of that rule and not a relaxation of it: an offer recorded as fixed-price is left alone,
 *    and correcting a mis-recorded listing type stays a different claim than this makes.
 *  • **The file states no currency.** It is an account-level setting on Delcampe, so the caller
 *    passes the platform contact's own (#196), and a figure is written only where that matches the
 *    offer's — a number in the wrong currency is not a cheaper listing, it is a wrong one.
 *
 * Everything else is #481 verbatim, deliberately: a bid sets `inActiveBidding` and **nothing ever
 * clears it**, `priceCheckedAt` is restamped on every import that saw a bid (the date says when the
 * figure was last *confirmed*), and a closed offer is never written to at all.
 *
 * A fixed-price listing's `present_price` is **not** written back. It is the collector's own stated
 * asking price coming home again, and a file that disagrees with it is listing drift (#542) — a
 * thing to be shown, not resolved by letting the marketplace's copy win.
 */
export function delcampeBidWriteFor(
  row: Pick<DelcampeActiveItemRow, "presentPrice" | "bidsCount" | "endsAt">,
  offer: DelcampeBiddableOffer,
  fileCurrency: string | null,
  now: Date
): DelcampeBidWrite | null {
  if (!isAuctionListing(normalizeListingType(offer.listingType))) return null;
  if ((CLOSED_OFFER_STATES as readonly string[]).includes(offer.state)) return null;

  const write: DelcampeBidWrite = {};
  if (row.endsAt && row.endsAt.getTime() !== (offer.endsAt?.getTime() ?? 0)) {
    write.endsAt = row.endsAt;
  }

  const bids = row.bidsCount;
  if (bids === null || bids < 0) return write.endsAt ? write : null;

  // `bids_number` counts **bids** where `Offer.bidderCount` counts people, and three bids from one
  // bidder is one bidder. The file does not carry the number the column is named for, so what is
  // stored is what was said — enough for the only two questions it is read for (has anyone bid, and
  // is that more than last time), and stated here rather than papered over.
  if (offer.bidderCount !== bids) write.bidderCount = bids;

  if (bids > 0) {
    if (!offer.inActiveBidding) write.inActiveBidding = true;
    if (row.presentPrice !== null && fileCurrency && fileCurrency === offer.currency) {
      write.price = row.presentPrice.toFixed(2);
      write.priceCheckedAt = now;
    }
  }

  return Object.keys(write).length > 0 ? write : null;
}
