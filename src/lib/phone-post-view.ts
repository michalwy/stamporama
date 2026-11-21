// A Facebook post on the phone (#2626, ADR-0072): what the list's select narrows by, and what each lot
// of a post's phone screen says — its number, picture, title, price and state.
//
// Pure — no Prisma import — so the unit suite holds it; `phone-posts.ts` reads the post as the desk's
// post screen reads it and hands it here.

import type { FacebookKitLot } from "./facebook-auctions";
import type { FacebookPostPhotos } from "./facebook-lot-photos";
import {
  FACEBOOK_POST_STAGE_LABEL,
  FACEBOOK_POST_STAGES,
  facebookLotPrice,
  isFacebookPostStage,
  type FacebookPostStage,
} from "./facebook-post-rules";
import type { OfferState } from "./offer-rules";

/** What the phone's list of posts shows (#2626): the posts not over by default, every post, or one stage. */
export type PhonePostsShow = "notOver" | "all" | FacebookPostStage;

/** The address's `show` values beside the default, which is the address without one. */
export const PHONE_POSTS_ALL = "all";

/** The list's select, in its order: the default first, then each stage as a post passes through them,
 *  then every post. */
export const PHONE_POSTS_SHOW_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "Not over" },
  ...FACEBOOK_POST_STAGES.map((stage) => ({ value: stage, label: FACEBOOK_POST_STAGE_LABEL[stage] })),
  { value: PHONE_POSTS_ALL, label: "Every post" },
];

/** The address's `show` as the list reads it: anything it does not know is the default. */
export function parsePhonePostsShow(value: string | null | undefined): PhonePostsShow {
  if (value === PHONE_POSTS_ALL) return "all";
  if (value && isFacebookPostStage(value)) return value;
  return "notOver";
}

/** The list's narrowing as the desk's list of posts is asked for it. */
export function phonePostsFilters(show: PhonePostsShow): { stage?: FacebookPostStage; notOver?: boolean } {
  if (show === "notOver") return { notOver: true };
  if (show === "all") return {};
  return { stage: show };
}

/** One lot as the post's phone screen draws it. */
export interface PhonePostLot {
  offerId: string;
  offerNo: number;
  /** The lot's number in the post — its place in it for a post of one, whose lot carries none. */
  lotNo: number;
  title: string;
  state: OfferState;
  /** The lot's picture, or null while it has none to show — see {@link phonePostLotPhotoId}. */
  photoId: string | null;
  /** The desk's post screen's price (`facebookLotPrice`): an auction's recorded bid once there is one,
   *  else its starting price; a quick buy's asking price. `amount` null for an auction with no start. */
  price: { label: "Price" | "Bid" | "Start"; amount: string | null; currency: string };
}

/**
 * A lot's picture (decided in writing #2626): **the lot's photo as it goes into the post**, the one the
 * desk's post screen shows — a captioned post's one photo per lot once it is drawn, else the first of
 * the lot's upload set. Null while a captioned photo is still being drawn or there is none.
 */
export function phonePostLotPhotoId(photos: FacebookPostPhotos, offerId: string): string | null {
  if (photos.layout === "captions") {
    const lot = photos.lots.find((l) => l.offerId === offerId);
    return lot?.state.status === "ready" ? lot.state.photoId : null;
  }
  return photos.lots.find((l) => l.offerId === offerId)?.images[0]?.photoId ?? null;
}

/** The post's lots in lot order, as its phone screen draws them. */
export function phonePostLots(lots: readonly FacebookKitLot[], photos: FacebookPostPhotos): PhonePostLot[] {
  return lots.map((lot, index) => ({
    offerId: lot.offerId,
    offerNo: lot.offerNo,
    lotNo: lot.lotNo ?? index + 1,
    title: lot.title,
    state: lot.state,
    photoId: phonePostLotPhotoId(photos, lot.offerId),
    price: { ...facebookLotPrice(lot), currency: lot.currency },
  }));
}
