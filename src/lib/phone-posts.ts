import "server-only";
import { getFacebookPostKit, type FacebookOfferKit } from "./facebook-auctions";
import { readFacebookPostPhotos, type FacebookPostPhotos } from "./facebook-lot-photos";
import { facebookPostAuctionsEnd } from "./facebook-post-list-figures";
import { facebookPostStage, type FacebookPostStage } from "./facebook-post-rules";
import { findFacebookPostId, readPostProposal, type FacebookPostProposal } from "./facebook-posts";
import { isAuctionListing } from "./offer-rules";
import { phonePostLots, type PhonePostLot } from "./phone-post-view";

/**
 * A Facebook post on the phone (#2626, ADR-0072): its group, stage and closing time, every lot, and the
 * proposal made from it. Read as the desk's post screen reads it — the post's kit, its photos and its
 * proposal — taking less of it: none of the translations or titles the desk prepares a post with. The
 * kit and the photos go to the screen whole, since publishing (#2629) copies the post's text and takes
 * its photos exactly as the desk's kit gives them.
 */
export interface PhonePost {
  postId: string;
  postNo: number;
  /** The post's title (#1862); null on a post made before titles until it is given one. */
  title: string | null;
  group: { name: string; archived: boolean };
  stage: FacebookPostStage;
  /** When a post that is up closes — its running auctions' end, ISO-8601, `from === to` where they share
   *  one (`facebookPostAuctionsEnd`). Null before the post is up, once it is over, and on a post of
   *  quick buys, which do not close by themselves. */
  closes: { from: string; to: string } | null;
  lots: PhonePostLot[];
  /** The proposal made from the post (#2602) — the open one, else the latest — or null. */
  proposal: FacebookPostProposal | null;
  /** The post's kit, as the desk's post screen reads it (#2629): what the text and captions are rendered
   *  from — in the browser, for the collector's zone (#490) — and the lots the post's moves are read off. */
  kit: FacebookOfferKit;
  /** The lots' photos, as the desk's post screen reads them (#2222): what the phone shares or saves. */
  photos: FacebookPostPhotos;
}

/** The owner's post numbered `postNo` in this collection, or null when there is none. */
export async function getPhonePost(ownerId: string, collectionId: string, postNo: number): Promise<PhonePost | null> {
  // Owner-checked here: the kit is read by the post alone.
  const postId = await findFacebookPostId(ownerId, collectionId, postNo);
  if (!postId) return null;
  const [kit, photos, proposal] = await Promise.all([
    getFacebookPostKit(postId),
    readFacebookPostPhotos(ownerId, postId),
    readPostProposal(postId),
  ]);
  if (!kit || !kit.post) return null;
  const stage = facebookPostStage(kit.lots);
  return {
    postId,
    postNo: kit.post.postNo,
    title: kit.post.title,
    group: { name: kit.group.name, archived: kit.group.archived },
    stage,
    closes:
      stage === "up"
        ? facebookPostAuctionsEnd(
            kit.lots.map((lot) => ({
              state: lot.state,
              auction: isAuctionListing(lot.listingType),
              endsAt: lot.endsAt ? new Date(lot.endsAt) : null,
            }))
          )
        : null,
    // Whether a lot's auction has closed is decided here, at the read, so the server render and
    // hydration agree — as the offer's phone screen decides it (#2010).
    lots: phonePostLots(kit.lots, photos, new Date()),
    proposal,
    kit,
    photos,
  };
}
