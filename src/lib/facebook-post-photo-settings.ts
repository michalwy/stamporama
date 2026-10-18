import "server-only";
import { prisma } from "./db";
import { isFacebookLotPosted } from "./facebook-post-rules";
import {
  applyPostPhotoSettingsPatch,
  isEmptyPostPhotoSettingsPatch,
  samePhotoConfig,
  sharedPhotoSettings,
  type PostPhotoSettingsPatch,
  type SharedPhotoSettings,
} from "./facebook-post-photo-settings-rules";
import { OFFER_PHOTO_CONFIG_SELECT, offerPhotoConfigFromRow, type PlatformPhotoLimits } from "./offer-photo-config";
import { OfferActionBlockedError, updateOfferPhotoConfig } from "./offers";

// A post's *Photo settings…* (#2032): every lot's photo settings changed in one go from the post's
// screen, while the post is not yet up. The post holds no settings of its own — each lot is an offer
// keeping its own, written here exactly as its own dialog writes them (`updateOfferPhotoConfig`) — so a
// lot added later keeps whatever it had. Once the post is up its photos are the ones posted, and the
// dialog is refused. Pure rules in `facebook-post-photo-settings-rules.ts`.

/** What the post's dialog opens on. */
export interface FacebookPostPhotoSettings {
  lotCount: number;
  settings: SharedPhotoSettings;
  /** The lots' platform — one for every lot of a post — whose limits and cover rule the dialog states. */
  platformName: string;
  platformCoverSymbols: boolean;
  limits: PlatformPhotoLimits;
}

async function readPostLots(ownerId: string, postId: string) {
  const post = await prisma.facebookPost.findUnique({
    where: { id: postId },
    select: { collection: { select: { ownerId: true } } },
  });
  if (!post || post.collection.ownerId !== ownerId) throw new Error("Post not found.");
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: postId },
    select: {
      id: true,
      state: true,
      ...OFFER_PHOTO_CONFIG_SELECT,
      platform: {
        select: { name: true, coverSymbols: true, maxPhotos: true, maxPhotoEdge: true, maxPhotoFileSizeMib: true },
      },
    },
    orderBy: { facebookLotNo: "asc" },
  });
  if (lots.length === 0) throw new Error("Post not found.");
  if (lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError("facebook-group", "The post is up, so its photos stay as they were posted.");
  }
  return lots;
}

/** Every lot's photo settings, as one dialog shows them: shared, or differing by lot. */
export async function getFacebookPostPhotoSettings(ownerId: string, postId: string): Promise<FacebookPostPhotoSettings> {
  const lots = await readPostLots(ownerId, postId);
  const { platform } = lots[0];
  return {
    lotCount: lots.length,
    settings: sharedPhotoSettings(lots.map(offerPhotoConfigFromRow)),
    platformName: platform.name,
    platformCoverSymbols: platform.coverSymbols,
    limits: {
      maxPhotos: platform.maxPhotos,
      maxPhotoEdge: platform.maxPhotoEdge,
      maxPhotoFileSizeMib: platform.maxPhotoFileSizeMib,
    },
  };
}

/**
 * Write the changed settings to every lot of the post. A lot the patch leaves as it was is not
 * written. Answers the lots whose settings changed, in lot order — the ones whose photos are now out
 * of date, and so the ones *Regenerate photos after saving* goes through.
 */
export async function updateFacebookPostPhotoSettings(
  ownerId: string,
  postId: string,
  patch: PostPhotoSettingsPatch
): Promise<string[]> {
  const lots = await readPostLots(ownerId, postId);
  if (isEmptyPostPhotoSettingsPatch(patch)) return [];
  const changed: string[] = [];
  for (const lot of lots) {
    const before = offerPhotoConfigFromRow(lot);
    const after = applyPostPhotoSettingsPatch(before, patch);
    if (samePhotoConfig(before, after)) continue;
    await updateOfferPhotoConfig(ownerId, lot.id, after);
    changed.push(lot.id);
  }
  return changed;
}
