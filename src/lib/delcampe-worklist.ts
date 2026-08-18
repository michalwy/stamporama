import "server-only";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import { CLOSED_OFFER_STATES } from "./offer-rules";
import { delcampeItemUrl, type DelcampeMatchProblem } from "./delcampe-import-rules";

// What the last active-items import left to do (#611) — the read behind *On Delcampe*.
//
// It is a **worklist and not a listings browser**: what is up and matched needs nothing from anybody
// and appears here only as a count, because the offers list already shows those listings with their
// addresses. What is on the screen is the two things an import can leave behind that somebody has to
// go and do something about —
//
//   * a listing that has **come down** while the offer here is still open: sold, ended or pulled,
//     which of those being #612's question and deliberately not this screen's guess;
//   * a listing that matched **no offer**: posted outside Stamporama, carrying a reference this
//     collection does not have, or one of two rows claiming the same offer — which Delcampe permits
//     and the reconciliation refuses to break a tie on.
//
// Nothing here writes. What to do about a row is the collector's, through the screens that already
// exist for it.

/** The offer behind a row, shaped so the row can link to it and say what state it is in. */
export interface DelcampeWorklistOffer {
  id: string;
  offerNo: number;
  /** The stored listing title, or the offer's own number where it has none. */
  label: string;
  state: string;
  price: string;
  currency: string;
}

/** A listing that was up at an earlier import and is not in the newest file. */
export interface DelcampeCameDownListing {
  itemId: string;
  title: string;
  url: string;
  /** When the listing was last seen **up** — the only date an ended listing has. */
  lastSeenAt: string;
  endsAt: string | null;
  presentPrice: string | null;
  currency: string | null;
  bidsCount: number | null;
  offer: DelcampeWorklistOffer;
}

/** A listing in the newest file that reached no offer. */
export interface DelcampeUnmatchedListing {
  itemId: string;
  title: string;
  url: string;
  personalReference: string | null;
  referenceOfferNo: number | null;
  problem: DelcampeMatchProblem | null;
  observedAt: string;
  presentPrice: string | null;
  currency: string | null;
}

export interface DelcampeWorklist {
  /** The platform contact marked as Delcampe, or null — with none there is nothing to import
   *  against, and the screen says so rather than showing an empty worklist that looks settled. */
  platform: { id: string; name: string } | null;
  import: {
    lastImportedAt: string | null;
    lastFileName: string | null;
    lastRowCount: number | null;
  };
  counts: {
    /** Listings the newest import carried. */
    up: number;
    /** …of which reached an offer here. */
    matched: number;
    /** …of which did not. */
    unmatched: number;
  };
  cameDown: DelcampeCameDownListing[];
  unmatched: DelcampeUnmatchedListing[];
}

function label(name: string | null, offerNo: number): string {
  return name?.trim() || `Offer #${offerNo}`;
}

function problemOf(value: string | null): DelcampeMatchProblem | null {
  return value === "no-reference" ||
    value === "unknown-offer" ||
    value === "duplicate-reference" ||
    value === "offer-already-listed"
    ? value
    : null;
}

/** Everything *On Delcampe* shows, in one read. */
export async function getDelcampeWorklist(
  ownerId: string,
  collectionId: string
): Promise<DelcampeWorklist> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");

  const [platform, state, listings] = await Promise.all([
    getModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE),
    prisma.delcampeImportState.findUnique({
      where: { collectionId },
      select: { lastImportedAt: true, lastFileName: true, lastRowCount: true },
    }),
    prisma.delcampeListing.findMany({
      where: { collectionId },
      orderBy: { observedAt: "desc" },
      select: {
        itemId: true,
        title: true,
        status: true,
        personalReference: true,
        referenceOfferNo: true,
        problem: true,
        presentPrice: true,
        currency: true,
        bidsCount: true,
        endsAt: true,
        observedAt: true,
        offer: {
          select: { id: true, offerNo: true, name: true, state: true, price: true, currency: true },
        },
      },
    }),
  ]);

  const active = listings.filter((listing) => listing.status === "ACTIVE");

  const cameDown: DelcampeCameDownListing[] = listings
    .filter(
      (listing) =>
        listing.status === "ENDED" &&
        listing.offer !== null &&
        // A closed offer needs nothing: the listing came down and the collector has already said
        // what happened to it. An ended listing with **no** offer is reported nowhere at all — the
        // action would be "correct an offer" and there is no offer to point at (#467's rule).
        !(CLOSED_OFFER_STATES as readonly string[]).includes(listing.offer.state)
    )
    .map((listing) => ({
      itemId: listing.itemId,
      title: listing.title,
      url: delcampeItemUrl(listing.itemId),
      lastSeenAt: listing.observedAt.toISOString(),
      endsAt: listing.endsAt?.toISOString() ?? null,
      presentPrice: listing.presentPrice?.toFixed(2) ?? null,
      currency: listing.currency,
      bidsCount: listing.bidsCount,
      offer: {
        id: listing.offer!.id,
        offerNo: listing.offer!.offerNo,
        label: label(listing.offer!.name, listing.offer!.offerNo),
        state: listing.offer!.state,
        price: listing.offer!.price.toFixed(2),
        currency: listing.offer!.currency,
      },
    }));

  const unmatched: DelcampeUnmatchedListing[] = active
    .filter((listing) => listing.offer === null)
    .map((listing) => ({
      itemId: listing.itemId,
      title: listing.title,
      url: delcampeItemUrl(listing.itemId),
      personalReference: listing.personalReference,
      referenceOfferNo: listing.referenceOfferNo,
      problem: problemOf(listing.problem),
      observedAt: listing.observedAt.toISOString(),
      presentPrice: listing.presentPrice?.toFixed(2) ?? null,
      currency: listing.currency,
    }));

  return {
    platform,
    import: {
      lastImportedAt: state?.lastImportedAt?.toISOString() ?? null,
      lastFileName: state?.lastFileName ?? null,
      lastRowCount: state?.lastRowCount ?? null,
    },
    counts: {
      up: active.length,
      matched: active.length - unmatched.length,
      unmatched: unmatched.length,
    },
    cameDown,
    unmatched,
  };
}
