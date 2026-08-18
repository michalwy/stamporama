import "server-only";
import { prisma } from "./db";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import { getModulePlatform } from "./module-platform";
import { publishOffer, patchOffer } from "./offers";
import { isOfferState, type OfferState } from "./offer-rules";
import {
  delcampeBidWriteFor,
  delcampeItemUrl,
  readDelcampeActiveItems,
  reconcileDelcampeListings,
  type DelcampeActiveItemRow,
  type DelcampeMatchProblem,
  type ReconciledRow,
} from "./delcampe-import-rules";

// Reconciling this collection's offers against Delcampe's own **active-items export** (#611;
// ADR-0037) — the return half of #610, and the moment a listing this app wrote a row for becomes a
// listing it knows the address of.
//
// **The transition happens on confirmation from the platform, never at export time.** A CSV that
// left the app is not a listing: Easy Uploader can refuse it, the collector can upload half of it,
// and an offer moved to `active` on the strength of a download would read as live while nothing was
// ever posted. So the export writes nothing about state, and this is where `ready → active` happens
// — because the listing is in Delcampe's own file, with Delcampe's own id.
//
// **The file is whole by nature**, which is why absence can be trusted here in a way #467 has to be
// careful about: an Allegro sweep is paged and a half-finished one would report everything it had
// not reached yet as ended, hence `listingsSweptAt`. A file has no pages. Every listing the account
// has up is in it, so a recorded listing that is *not* has come down.
//
// **What it never does is decide why.** Sold, ended, or pulled by the collector — the file does not
// say, and inventing a sale from an absence is the one thing that would make this feature dangerous
// rather than useful. #612 records the sale, from the order screens where the buyer and the amount
// actually are.
//
// The pure half is `delcampe-import-rules.ts`: the CSV reader, the two asymmetries of the contract
// (dot decimals, the separate `GMT` column), the matching and every refusal it can carry. This
// module is the I/O and decides nothing.

/** A refusal about the import as a whole — an unowned collection, no Delcampe platform, a file that
 *  is not an active-items export. Thrown, because none of them is fixed listing by listing. */
export class DelcampeImportError extends Error {}

/** One row the import could not attach to an offer, as the screen reports it. */
export interface DelcampeImportUnmatched {
  itemId: string;
  title: string;
  personalReference: string | null;
  /** The offer number the reference names, where it names one this collection does not have or one
   *  a second row claims too. */
  referenceOfferNo: number | null;
  problem: DelcampeMatchProblem;
  line: number;
}

/** One offer the import moved, or found in a state it would not move. */
export interface DelcampeImportTouched {
  offerId: string;
  offerNo: number;
  itemId: string;
  /** The state the offer was in when the file was read. */
  state: OfferState;
}

/** One listing that has come down: recorded as up by an earlier import, absent from this file. */
export interface DelcampeImportCameDown {
  itemId: string;
  title: string;
  offerNo: number | null;
  offerId: string | null;
}

/** What one import did, in the words the dialog reports it in. */
export interface DelcampeImportOutcome {
  fileName: string | null;
  rowsRead: number;
  /** Rows that reached an offer. */
  matched: number;
  /** Offers moved `ready → active` — the batch being confirmed by the platform. */
  activated: DelcampeImportTouched[];
  /** Matched rows whose offer was left exactly as it was, because its state is not one an import
   *  may move. A listing up against a `withdrawn` offer is news, not a transition. */
  recorded: DelcampeImportTouched[];
  /** Offers whose auction figures were refreshed from the file (#481's rule). */
  bidsRefreshed: number;
  /** Offers flagged as in active bidding by this import. */
  biddingFlagged: number;
  unmatched: DelcampeImportUnmatched[];
  cameDown: DelcampeImportCameDown[];
}

/** How large an export this will read in one request. Delcampe's own ongoing-sales ceilings are in
 *  the low thousands on the largest package, so this is head-room rather than a policy — and it is a
 *  refusal rather than a truncation, a file read halfway being one whose *absences* are lies. */
export const DELCAMPE_IMPORT_MAX_ROWS = 5_000;

/** How many listing rows are written per statement. The snapshot is rewritten wholesale rather than
 *  row by row (see {@link recordListings}), and one statement per listing is what makes a file of a
 *  few thousand a request nobody waits through. */
const LISTING_WRITE_CHUNK = 500;

/**
 * Read one Delcampe active-items export and reconcile it against this collection's offers.
 *
 * @throws {DelcampeImportError} for a refusal about the file or the collection as a whole.
 */
export async function importDelcampeActiveItems(
  ownerId: string,
  collectionId: string,
  text: string,
  fileName: string | null
): Promise<DelcampeImportOutcome> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { slug: true },
  });
  if (!collection) throw new DelcampeImportError("Collection not found.");

  const platform = await getModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE);
  if (!platform) {
    throw new DelcampeImportError(
      "No platform is marked as Delcampe yet, so there are no listings here to match this file against. Settings → Delcampe."
    );
  }
  // The currency the file's figures are in. Delcampe states it nowhere in the export — it is an
  // account-level setting — so it is the platform contact's own (#196), and a figure is carried onto
  // an offer only where the two agree.
  const contact = await prisma.contact.findFirst({
    where: { id: platform.id, collectionId },
    select: { platformCurrency: true },
  });
  const fileCurrency = contact?.platformCurrency ?? null;

  const read = readDelcampeActiveItems(text, collection.slug);
  if (!read.ok) throw new DelcampeImportError(read.message);
  if (read.rows.length === 0) {
    throw new DelcampeImportError(
      "That export has no listings in it. An account with nothing up produces an empty file, and an empty file cannot be told apart from one that failed to download."
    );
  }
  if (read.rows.length > DELCAMPE_IMPORT_MAX_ROWS) {
    throw new DelcampeImportError(
      `That export carries ${read.rows.length} listings, more than this reads in one go (${DELCAMPE_IMPORT_MAX_ROWS}).`
    );
  }

  // Every offer of the Delcampe platform, closed ones included: a listing still up against an offer
  // recorded as sold or withdrawn is exactly the disagreement worth reporting, and an offer left out
  // of the candidates would be reported as an *unknown* offer instead, which names the wrong fault.
  const offers = await prisma.offer.findMany({
    where: { collectionId, platformId: platform.id },
    select: {
      id: true,
      offerNo: true,
      state: true,
      url: true,
      delcampeItemId: true,
      listingType: true,
      currency: true,
      inActiveBidding: true,
      bidderCount: true,
      endsAt: true,
    },
  });
  const known = await prisma.delcampeListing.findMany({
    where: { collectionId },
    select: { itemId: true, status: true, offerId: true, title: true, offer: { select: { offerNo: true } } },
  });

  const plan = reconcileDelcampeListings({
    rows: read.rows,
    offers: offers.map((offer) => ({
      id: offer.id,
      offerNo: offer.offerNo,
      state: readState(offer.state),
      delcampeItemId: offer.delcampeItemId,
    })),
    known,
  });

  const now = new Date();
  const outcome: DelcampeImportOutcome = {
    fileName,
    rowsRead: read.rows.length,
    matched: plan.matched.length,
    activated: [],
    recorded: [],
    bidsRefreshed: 0,
    biddingFlagged: 0,
    unmatched: [],
    cameDown: [],
  };

  // ── What the platform says, listing by listing ──────────────────────────────────────────────
  // A row is written for every listing in the file, matched or not: an unmatched listing still has a
  // title, a price and a reference to correct on Delcampe, and an observation with nowhere to live
  // is one the collector never gets to see.
  await recordListings(collectionId, plan.rows, fileCurrency, now);
  for (const entry of plan.rows) {
    if (entry.problem) {
      outcome.unmatched.push({
        itemId: entry.row.itemId,
        title: entry.row.title,
        personalReference: entry.row.personalReference,
        referenceOfferNo: entry.row.referenceOfferNo,
        problem: entry.problem,
        line: entry.row.line,
      });
    }
  }

  // ── What that means for the offers behind them ──────────────────────────────────────────────
  for (const entry of plan.matched) {
    const offer = offers.find((candidate) => candidate.id === entry.offerId);
    if (!offer || !entry.offerId) continue;
    const state = readState(offer.state);
    const touched: DelcampeImportTouched = {
      offerId: offer.id,
      offerNo: offer.offerNo,
      itemId: entry.row.itemId,
      state,
    };

    if (entry.action === "activate") {
      // The transition first and the URL after, exactly as `publishOffer` does it everywhere else
      // (#246/#320): a refused publication must leave no listing URL behind.
      await publishOffer(ownerId, offer.id, delcampeItemUrl(entry.row.itemId));
      await prisma.offer.update({
        where: { id: offer.id },
        data: { delcampeItemId: entry.row.itemId },
      });
      outcome.activated.push(touched);
    } else if (entry.action === "confirm") {
      // Already live here. The id is written (it is what #612 will match an order's items on) and a
      // **blank** URL is filled in — one already recorded is left alone, being either the
      // collector's own or this same import's.
      //
      // Both are guarded on the value actually differing, which is what makes re-importing the same
      // export cost nothing: the ordinary import is a handful of new listings among hundreds of rows
      // that have not moved, and an offer rewritten with what it already says is an `updatedAt` that
      // claims something happened.
      if (offer.delcampeItemId !== entry.row.itemId) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: { delcampeItemId: entry.row.itemId },
        });
      }
      if (!offer.url) await patchOffer(ownerId, offer.id, { url: delcampeItemUrl(entry.row.itemId) });
    } else {
      // `preparing`, `paused`, `sold`, `withdrawn`. The listing is recorded against the offer and
      // **nothing about the offer changes** — least of all a terminal one, whose price, URL and
      // platform are frozen by the lifecycle itself. It is reported instead.
      outcome.recorded.push(touched);
    }

    const write = delcampeBidWriteFor(entry.row, { ...offer, state }, fileCurrency, now);
    if (write) {
      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          ...write,
          // The flag *is* the news, so the notice is raised in the same write that raises it and
          // never on a refresh of a bid already flagged (#481).
          ...(write.inActiveBidding ? { biddingNoticeAt: now } : {}),
        },
      });
      if (write.inActiveBidding) outcome.biddingFlagged += 1;
      if (write.price !== undefined) outcome.bidsRefreshed += 1;
    }
  }

  // ── What is no longer there ─────────────────────────────────────────────────────────────────
  // Marked `ENDED` rather than deleted, and `observedAt` is deliberately **not** restamped: an ended
  // row's only date is when the listing was last seen up.
  if (plan.cameDown.length > 0) {
    await prisma.delcampeListing.updateMany({
      where: { collectionId, itemId: { in: plan.cameDown.map((listing) => listing.itemId) } },
      data: { status: "ENDED" },
    });
    const byItemId = new Map(known.map((listing) => [listing.itemId, listing]));
    outcome.cameDown = plan.cameDown.map((listing) => {
      const previous = byItemId.get(listing.itemId);
      return {
        itemId: listing.itemId,
        title: previous?.title ?? "",
        offerId: listing.offerId,
        offerNo: previous?.offer?.offerNo ?? null,
      };
    });
  }

  await prisma.delcampeImportState.upsert({
    where: { collectionId },
    create: { collectionId, lastImportedAt: now, lastFileName: fileName, lastRowCount: read.rows.length },
    update: { lastImportedAt: now, lastFileName: fileName, lastRowCount: read.rows.length },
  });

  return outcome;
}

/**
 * Write the file's own side of the story: one row per listing it carries.
 *
 * Rewritten wholesale — the rows in the file are deleted and re-created — rather than upserted one
 * by one. A listing that is *in* the file has every one of its columns restated by it, including the
 * two that would otherwise be worth preserving (`status` is `ACTIVE` by definition, `observedAt` is
 * now), so there is nothing an update would keep that a re-create loses. What is deliberately **not**
 * touched is everything the file does not mention: that is {@link importDelcampeActiveItems}'s
 * came-down pass, and those rows are marked, never removed.
 */
async function recordListings(
  collectionId: string,
  entries: readonly ReconciledRow[],
  fileCurrency: string | null,
  now: Date
): Promise<void> {
  const data = entries.map((entry) => rowData(collectionId, entry, fileCurrency, now));
  for (let i = 0; i < data.length; i += LISTING_WRITE_CHUNK) {
    const chunk = data.slice(i, i + LISTING_WRITE_CHUNK);
    await prisma.delcampeListing.deleteMany({
      where: { collectionId, itemId: { in: chunk.map((row) => row.itemId) } },
    });
    await prisma.delcampeListing.createMany({ data: chunk });
  }
}

/** One row as the platform currently states it. */
function rowData(
  collectionId: string,
  entry: ReconciledRow,
  fileCurrency: string | null,
  now: Date
) {
  const row: DelcampeActiveItemRow = entry.row;
  return {
    collectionId,
    itemId: row.itemId,
    title: row.title,
    personalReference: row.personalReference,
    referenceOfferNo: row.referenceOfferNo,
    status: "ACTIVE",
    endsAt: row.endsAt,
    presentPrice: row.presentPrice === null ? null : row.presentPrice.toFixed(2),
    // The currency is the platform contact's (#196) and travels only with a figure: a currency
    // beside no price is a claim about a number that is not there.
    currency: row.presentPrice === null ? null : fileCurrency,
    quantity: row.quantity,
    bidsCount: row.bidsCount,
    bestBidder: row.bestBidder,
    visits: row.visits,
    categoryId: row.categoryId,
    offerId: entry.offerId,
    matchedBy: entry.offerId ? "reference" : null,
    problem: entry.problem,
    observedAt: now,
  };
}

/** A stored state string as the lifecycle's own type. Anything unrecognised reads as `preparing`,
 *  which is the state nothing may be done to. */
function readState(value: string): OfferState {
  return isOfferState(value) ? value : "preparing";
}
