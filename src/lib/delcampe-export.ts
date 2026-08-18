import "server-only";
import { prisma } from "./db";
import { zip, type ZipEntry } from "./zip";
import { offerScreenUrl } from "./app-url";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import { readOfferUploadSet } from "./offer-photo-generation";
import { resolveDelcampeListingProfileForOffer } from "./delcampe-listing-profile";
import { delcampeAuctionGaps } from "./delcampe-listing-profile-rules";
import { normalizeListingType } from "./offer-rules";
import {
  DELCAMPE_UPLOAD_CSV_NAME,
  type DelcampeUploadRow,
  delcampeListedPrice,
  delcampeRowRefusals,
  delcampeUploadRow,
  disambiguateBundleNames,
  toDelcampeCsv,
} from "./delcampe-export-rules";

// The Easy Uploader bundle (#610): a batch of `ready` Delcampe offers as one CSV and the pictures it
// names, which is how a listing gets onto Delcampe at all — there is a REST API and it sits behind
// the paid API Pass, so the file's columns are the contract (ADR-0034).
//
// **Nothing here decides what a row says.** The four groups of columns that describe a way of selling
// are the offer's resolved profile (#608), the category is the offer's own (#609), the texts and the
// price are the offer's (#210/#266/#449) — including which of the two prices an auction states, which
// is the rules module's (#620) — and the pictures are the photo plan's — the same read the
// per-offer ZIP and the bulk archive are built from (#314/#323), so a file in this bundle is
// byte-identical to, and named exactly as, the same file downloaded on its own. What this module
// does is *gather* those, refuse what cannot be written, and pack the result.
//
// **The archive is flat**, unlike the batch photo ZIP's folder per offer (#323): the CSV names its
// pictures by file name and nothing else, so a folder would leave `images` naming files Easy
// Uploader cannot find. The plan already names every file for its offer (#326), which is what makes
// flat safe; the one case it does not cover — two offers whose titles slug the same — is suffixed
// per offer rather than per file, so one listing's pictures stay a run of one stem.
//
// **A refusal is the whole batch, not a skipped row.** The bulk photo ZIP skips an offer with
// nothing to upload, because a missing folder in a download is visible and costs nothing. A missing
// *row* is not: the file goes up once, and the offer it left out stays `ready` looking exactly like
// one waiting for the next batch, so the listing that never happened is discovered whenever somebody
// next counts. Every `ready` offer is one the collector has said is ready to be listed, so one that
// cannot be written is a fault to fix rather than a row to drop — and the export says which offers
// and why, all of them at once, so the fixing is one pass.

/** Why one offer could not be written, for a list the workspace prints verbatim. */
export interface DelcampeExportRefusal {
  offerId: string;
  offerNo: number;
  /** The listing's title, or its number where it has none — what the collector will look for. */
  label: string;
  /** Every reason at once, so a second export does not surface a second fault. */
  reasons: string[];
}

/** The bundle itself: one archive, and what went into it. */
export interface DelcampeUploadBundle {
  fileName: string;
  bytes: Buffer;
  rowCount: number;
  imageCount: number;
}

export type DelcampeExportResult =
  | { ok: true; bundle: DelcampeUploadBundle }
  | { ok: false; message: string; refusals: DelcampeExportRefusal[] };

/** A refusal about the export rather than about a listing — an unowned collection, a batch that is
 *  not Delcampe's, an instance with no address. Thrown, because none of them is something the
 *  collector fixes offer by offer. */
export class DelcampeExportError extends Error {}

/**
 * The same rail the bulk photo archive carries (#323): the bundle is buffered in memory, and a
 * bounded batch is what makes that safe. Past it the honest answer is to narrow the session with the
 * area or year filter rather than to build a gigabyte inside one request.
 */
export const DELCAMPE_EXPORT_MAX_OFFERS = 100;

const OFFER_SELECT = {
  id: true,
  offerNo: true,
  name: true,
  description: true,
  price: true,
  startingPrice: true,
  state: true,
  listingType: true,
  collectionId: true,
  delcampeCategoryId: true,
  platform: {
    select: {
      id: true,
      name: true,
      platformModule: true,
      maxTitleLength: true,
      maxDescriptionLength: true,
    },
  },
  sets: { select: { id: true, items: { select: { itemId: true } } } },
} as const;

/**
 * Build the Easy Uploader bundle for a batch of offers, or report why it cannot be built.
 *
 * Owner-checked against the collection, and every offer is re-read against **it** rather than
 * trusted from the caller: the ids arrive from a screen, and an id from somewhere else must not
 * become a row in somebody's upload.
 *
 * @throws {DelcampeExportError} for a refusal about the batch as a whole.
 */
export async function buildDelcampeUploadBundle(
  ownerId: string,
  collectionId: string,
  offerIds: readonly string[]
): Promise<DelcampeExportResult> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { slug: true },
  });
  if (!collection) throw new DelcampeExportError("Collection not found.");

  if (offerIds.length === 0) throw new DelcampeExportError("No offers to export.");
  if (offerIds.length > DELCAMPE_EXPORT_MAX_OFFERS) {
    throw new DelcampeExportError(
      `Too many offers for one bundle (${offerIds.length}, limit ${DELCAMPE_EXPORT_MAX_OFFERS}). Narrow the batch with the area or year filter.`
    );
  }

  const rows = await prisma.offer.findMany({
    where: { id: { in: [...offerIds] }, collectionId },
    select: OFFER_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  // The batch keeps the order it was asked for, which is the order the workspace shows and the order
  // the collector reads their own file in.
  const offers = offerIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  if (offers.length === 0) throw new DelcampeExportError("None of these offers is in this collection.");

  const notDelcampe = offers.find(
    (offer) => offer.platform.platformModule !== DELCAMPE_PLATFORM_MODULE
  );
  if (notDelcampe) {
    throw new DelcampeExportError(
      `${notDelcampe.platform.name} is not the platform this collection lists on Delcampe — the Easy Uploader file is Delcampe's own format.`
    );
  }
  const notReady = offers.filter((offer) => offer.state !== "ready");
  if (notReady.length > 0) {
    throw new DelcampeExportError(
      `${notReady.length === 1 ? "One offer is" : `${notReady.length} offers are`} not ready — an upload file lists what has been prepared, nothing else.`
    );
  }

  // `personal_reference` carries the offer's own address (#154's decision, #415's token), which is
  // what makes the reconciliation coming back exact (#611). An instance that does not know its own
  // address cannot write one, and that is one sentence about the deployment rather than forty about
  // the listings.
  if (!offerScreenUrl(collection.slug, offers[0].offerNo)) {
    throw new DelcampeExportError(
      "This instance does not know its own address (BETTER_AUTH_URL), so no row could carry a personal_reference back to its offer."
    );
  }

  // Each offer's own two reads, in parallel across the batch: the profile that applies to it, and
  // the upload set the photo plan produced for it.
  const assembled = await Promise.all(
    offers.map(async (offer) => {
      const [profile, uploadSet] = await Promise.all([
        resolveDelcampeListingProfileForOffer(offer.id),
        readOfferUploadSet(ownerId, offer.id),
      ]);
      return { offer, profile, uploadSet };
    })
  );

  const refusals: DelcampeExportRefusal[] = [];
  const rowsOut: DelcampeUploadRow[] = [];
  const entries: ZipEntry[] = [];
  const slugsTaken = new Map<string, number>();
  let imageCount = 0;

  for (const { offer, profile, uploadSet } of assembled) {
    // Null where the plan has nothing to upload; its own sentence joins the refusals below.
    const upload = "reason" in uploadSet ? null : uploadSet;
    const images = upload?.images ?? [];
    const listingType = normalizeListingType(offer.listingType);
    const price = Number(offer.price);
    const startingPrice = offer.startingPrice === null ? null : Number(offer.startingPrice);
    // An auction's row states what the seller opened at, never what the bidding has reached (#477).
    const listedPrice = delcampeListedPrice({ listingType, price, startingPrice });
    // How many of this listing there are: the offer's sets that still hold copies, which is the
    // number the listing kit reports for every other platform (#405) — one set is what one buyer
    // takes.
    const quantity = offer.sets.filter((set) => set.items.length > 0).length;
    const personalReference = offerScreenUrl(collection.slug, offer.offerNo);

    const reasons = delcampeRowRefusals(
      {
        title: offer.name,
        description: offer.description,
        categoryId: offer.delcampeCategoryId,
        listingType,
        price,
        startingPrice,
        imageCount: images.length,
        hasProfile: profile !== null,
        auctionProfileGaps: profile ? delcampeAuctionGaps(profile) : [],
        personalReference,
      },
      {
        maxTitleLength: offer.platform.maxTitleLength,
        maxDescriptionLength: offer.platform.maxDescriptionLength,
      }
    );
    // The photo half's own sentence, kept as it wrote it: "every generated image is held back" and
    // "no images generated yet" are two different things to go and do.
    if ("reason" in uploadSet) reasons.push(uploadSet.reason.toLowerCase().replace(/\.$/, ""));
    if (quantity === 0) reasons.push("no sets — there is nothing to sell");

    if (reasons.length > 0 || !profile || !personalReference || !upload || listedPrice === null) {
      refusals.push({
        offerId: offer.id,
        offerNo: offer.offerNo,
        label: offer.name?.trim() || `Offer ${offer.offerNo}`,
        reasons,
      });
      continue;
    }

    // The flat archive's one collision rule (see the header): a slug already taken means this whole
    // offer's set is renamed, so the CSV and the archive keep naming the same files.
    const taken = slugsTaken.get(upload.slug);
    slugsTaken.set(upload.slug, (taken ?? 0) + 1);
    const names =
      taken === undefined
        ? images.map((image) => image.fileName)
        : disambiguateBundleNames(
            images.map((image) => image.fileName),
            upload.slug,
            offer.id.slice(-6)
          );

    names.forEach((name, index) => entries.push({ name, contents: images[index].bytes }));
    imageCount += names.length;
    rowsOut.push(
      delcampeUploadRow({
        title: offer.name!.trim(),
        personalReference,
        description: offer.description ?? "",
        categoryId: offer.delcampeCategoryId!.trim(),
        listingType,
        price: listedPrice,
        quantity,
        imageNames: names,
        profile,
      })
    );
  }

  if (refusals.length > 0) {
    return {
      ok: false,
      message: `${refusals.length === 1 ? "One offer" : `${refusals.length} offers`} cannot be written as an upload row, so nothing was exported. Fix them and export again.`,
      refusals,
    };
  }

  // The file the collector opens first goes in first — the pictures are what it names.
  entries.unshift({
    name: DELCAMPE_UPLOAD_CSV_NAME,
    contents: Buffer.from(toDelcampeCsv(rowsOut), "utf8"),
  });

  return {
    ok: true,
    bundle: {
      fileName: `delcampe-upload-${rowsOut.length}.zip`,
      bytes: zip(entries),
      rowCount: rowsOut.length,
      imageCount,
    },
  };
}
