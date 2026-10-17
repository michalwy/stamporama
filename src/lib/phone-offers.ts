import "server-only";
import { prisma } from "./db";
import { getOfferDetail } from "./offers";
import { readOfferUploadPlan } from "./offer-photo-generation";
import { normalizeRole, sortPhotos } from "./photos";
import type { OfferListingType, OfferState } from "./offer-rules";

/**
 * What the phone offer screen shows (#2008, ADR-0072): the offer's picture, title, price and
 * platform, and its state — what the collector needs to tell it is the right one before pausing,
 * resuming or withdrawing it.
 *
 * Read off the desk's own read model (`getOfferDetail`), so the title, the price and its conversion
 * are the desk's to the letter; the phone only takes less of it.
 */
export interface PhoneOffer {
  id: string;
  offerNo: number;
  /** The listing title, or the label derived from its sets when none was generated — as the desk. */
  title: string;
  platformName: string;
  state: OfferState;
  listingType: OfferListingType;
  price: string;
  currency: string;
  priceBase: string | null;
  baseCurrency: string;
  /** The offer's picture, or null when there is none to show — see {@link readPhoneOfferPhotoId}. */
  photoId: string | null;
  /** A withdrawal takes the whole post back from the group (#1779): a lot of a multi-lot Facebook post
   *  still waiting for approval. The confirmation says so, as the desk's does. */
  withdrawTakesPost: boolean;
}

/** The owner's offer in this collection for the phone, or null when it is not theirs or not here. */
export async function getPhoneOffer(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<PhoneOffer | null> {
  const detail = await getOfferDetail(ownerId, offerId);
  if (!detail || detail.collectionId !== collectionId) return null;
  return {
    id: detail.id,
    offerNo: detail.offerNo,
    title: detail.name ?? detail.label,
    platformName: detail.platformName,
    state: detail.state,
    listingType: detail.listingType,
    price: detail.price,
    currency: detail.currency,
    priceBase: detail.priceBase,
    baseCurrency: detail.baseCurrency,
    photoId: await readPhoneOfferPhotoId(
      ownerId,
      detail.id,
      detail.sets.flatMap((set) => set.itemIds)
    ),
    withdrawTakesPost:
      detail.state === "pending" && !!detail.facebook?.post && detail.facebook.lots.length > 1,
  };
}

/**
 * The offer's picture (decided with the collector on 2026-10-17, #2008): **the first listing image**
 * — the first of the generated images that go up, in upload order, which is what a buyer sees first.
 * An offer with none of them yet (still being prepared, on a platform without listing photos, or one
 * whose images were cleared after it closed) shows **the first copy's photo** instead: its copies in
 * set order, the first that has one, its front before its back.
 */
async function readPhoneOfferPhotoId(
  ownerId: string,
  offerId: string,
  itemIds: readonly string[]
): Promise<string | null> {
  const upload = await readOfferUploadPlan(ownerId, offerId);
  if (!("reason" in upload)) return upload.images[0].photoId;
  if (itemIds.length === 0) return null;
  const photos = await prisma.photo.findMany({
    where: { itemId: { in: [...itemIds] } },
    select: { id: true, itemId: true, role: true, sortOrder: true },
  });
  for (const itemId of itemIds) {
    const own = photos
      .filter((photo) => photo.itemId === itemId)
      .map((photo) => ({ id: photo.id, role: normalizeRole(photo.role), sortOrder: photo.sortOrder }))
      .sort(sortPhotos);
    if (own.length > 0) return own[0].id;
  }
  return null;
}
