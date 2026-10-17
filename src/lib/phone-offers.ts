import "server-only";
import { prisma } from "./db";
import { getOfferDetail } from "./offers";
import { readOfferUploadPlan } from "./offer-photo-generation";
import { normalizeRole, sortPhotos } from "./photos";
import { createSaleWithLines, listSellableOffers } from "./sales";
import { resolveSaleHeader } from "./sale-header-input";
import { parsePrice } from "./sale-rules";
import { facebookOfferSaleCurrency } from "./facebook-sales";
import { phoneSaleLine } from "./phone-offer-sale";
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
  /** How many sets the offer still has to sell (#2009) — 0 when it cannot be sold now, being in no
   *  sellable state or every set gone. The phone's *Sell* takes one of them. */
  setsLeft: number;
  /** A Facebook offer's buyer is named by their Facebook profile (#1777), as at the desk. */
  buyerByFacebookProfile: boolean;
}

/** The owner's offer in this collection for the phone, or null when it is not theirs or not here. */
export async function getPhoneOffer(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<PhoneOffer | null> {
  const detail = await getOfferDetail(ownerId, offerId);
  if (!detail || detail.collectionId !== collectionId) return null;
  const [sellable] = await listSellableOffers(ownerId, collectionId, { offerId: detail.id });
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
    setsLeft: sellable?.sets.length ?? 0,
    buyerByFacebookProfile: !!detail.facebookGroupId,
  };
}

/** Who bought and for how much, as the phone's *Sell* form sends it (#2009). */
export interface PhoneOfferSaleInput {
  /** A buyer contact picked from the suggestions, or "" — then `buyerName` is found or created. */
  buyerId: string;
  /** The buyer's name; blank with no `buyerId` is a buyer unknown, as the desk allows. */
  buyerName: string;
  /** A Facebook offer's buyer's profile link (#1777); blank is the name alone. Read only on Facebook. */
  buyerFacebookProfileUrl: string;
  /** The price of the set sold, in the offer's currency. */
  price: string;
}

/**
 * Sell one set of the offer from the phone (#2009): a new sale on the offer's platform, dated today,
 * its buyer and the set at the price given — the desk's *Sell* → *Create new sale* in one act and one
 * transaction, through the desk's own header resolution (`resolveSaleHeader`: the buyer found or
 * created, a Facebook buyer by their profile) and the desk's line guards. The sale lands *Ordered*,
 * and the offer goes *Sold* when its last set does, exactly as at the desk. Everything else on the
 * header — handling, commission, shipping — is the desk's to add.
 *
 * Returns the new sale's id, or the reason nothing was recorded.
 */
export async function sellPhoneOffer(
  ownerId: string,
  collectionId: string,
  offerId: string,
  input: PhoneOfferSaleInput,
  today: string
): Promise<{ ok: true; saleId: string } | { ok: false; message: string }> {
  const [offer] = await listSellableOffers(ownerId, collectionId, { offerId });
  if (!offer) return { ok: false, message: "Nothing left to sell on this offer." };
  const price = parsePrice(input.price);
  if (!price.ok) return { ok: false, message: price.message };
  const line = phoneSaleLine(offer.offerId, offer.sets, price.value);
  if (!line) return { ok: false, message: "Nothing left to sell on this offer." };

  const offerCurrency = await facebookOfferSaleCurrency(ownerId, collectionId, offer.offerId);
  const header = await resolveSaleHeader(collectionId, {
    platformId: offer.platformId,
    platformName: offer.platformName,
    buyerId: offerCurrency ? null : input.buyerId || null,
    buyerName: input.buyerName || null,
    ...(offerCurrency ? { buyerFacebookProfileUrl: input.buyerFacebookProfileUrl } : {}),
    externalRef: "",
    transactionUrl: "",
    soldAt: today,
    currency: offer.currency,
    handlingMode: "direct",
    buyerHandling: "",
    buyerPaidTotal: "",
    commission: "",
  });
  if (!header.ok) return { ok: false, message: header.message };

  const saleId = await createSaleWithLines(
    ownerId,
    collectionId,
    {
      platformId: header.platformId,
      buyerId: header.buyerId,
      externalRef: header.externalRef,
      transactionUrl: header.transactionUrl,
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      buyerPaidTotal: header.buyerPaidTotal,
      commission: header.commission,
      shipping: header.shipping,
    },
    [line],
    offerCurrency ? { offerCurrency } : {}
  );
  return { ok: true, saleId };
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
