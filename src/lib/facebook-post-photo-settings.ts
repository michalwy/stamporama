import "server-only";
import type { PostPhotoSettingsPatch } from "./facebook-post-photo-settings-rules";
import { getLotGroupPhotoSettings, updateLotGroupPhotoSettings, type LotGroupPhotoSettings } from "./offer-lot-groups";

// A post's *Photo settings…* (#2032): every lot's photo settings changed in one go from the post's
// screen, while the post is not yet up. The post holds no settings of its own — each lot is an offer
// keeping its own, written exactly as its own dialog writes them (`updateOfferPhotoConfig`) — so a
// lot added later keeps whatever it had. Once the post is up its photos are the ones posted, and the
// dialog is refused. A proposal's lots are worked on the same way (#2313): the implementation is
// `offer-lot-groups.ts`, and this is the post's door into it. Pure rules in
// `facebook-post-photo-settings-rules.ts`.

/** What the post's dialog opens on. */
export type FacebookPostPhotoSettings = LotGroupPhotoSettings;

/** Every lot's photo settings, as one dialog shows them: shared, or differing by lot. */
export function getFacebookPostPhotoSettings(ownerId: string, postId: string): Promise<FacebookPostPhotoSettings> {
  return getLotGroupPhotoSettings(ownerId, { kind: "post", id: postId });
}

/** Write the changed settings to every lot of the post; answers the lots whose settings changed. */
export function updateFacebookPostPhotoSettings(
  ownerId: string,
  postId: string,
  patch: PostPhotoSettingsPatch
): Promise<string[]> {
  return updateLotGroupPhotoSettings(ownerId, { kind: "post", id: postId }, patch);
}
