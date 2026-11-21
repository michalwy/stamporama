import type { FacebookPostPhotos } from "./facebook-lot-photos";
import { lotPhotosNotReady } from "./facebook-lot-photo-rules";
import { lotPhotosDrawing } from "./facebook-post-lot-refresh";
import {
  facebookLotPhotoFileName,
  isFacebookLotClosed,
  isFacebookLotLeftOut,
  type FacebookLotStanding,
} from "./facebook-post-rules";

// What a Facebook post's publishing shares between the desk's post screen (#1842) and the post's phone
// screen (#2629): the photos it puts up, when they are not ready to be taken, which lot the post is
// published through and what is said once it is. Pure, so both screens read one rule.

/** A post's lot, as these rules read it — a kit's lot. */
export type PublishLot = FacebookLotStanding & { offerId: string; lotNo: number | null };

/** One photo the post puts up, in post order: the file the ZIP holds under the same name. */
export interface FacebookPostPhotoFile {
  /** Unique within the post: the lot's offer id captioned, else the offer id and the photo id. */
  key: string;
  offerId: string;
  lotNo: number;
  photoId: string;
  /** `lot-01-<offer>.jpg`… — the name it has in the post's ZIP, so the lot order survives a folder. */
  fileName: string;
  /** Laid out as text, its place among its lot's photos (1-based) and how many the lot has. */
  index: number;
  of: number;
}

/**
 * Every photo the post puts up, in lot order (#1848, #1865): captioned, each lot's one stored photo
 * once it is drawn (#1861); laid out as text, each lot's upload set. A lot sold or withdrawn before
 * the post went up puts nothing up (#2560). A lot whose photos are not read yet — or, captioned, not
 * drawn yet — is simply not in the list.
 */
export function facebookPostPhotoFiles(
  lots: readonly PublishLot[],
  photos: FacebookPostPhotos | undefined
): FacebookPostPhotoFile[] {
  if (!photos) return [];
  const files: FacebookPostPhotoFile[] = [];
  lots.forEach((lot, position) => {
    if (isFacebookLotLeftOut(lot)) return;
    if (photos.layout === "captions") {
      const stored = photos.lots.find((l) => l.offerId === lot.offerId);
      if (stored?.state.status !== "ready") return;
      files.push({
        key: lot.offerId,
        offerId: lot.offerId,
        lotNo: stored.lotNo,
        photoId: stored.state.photoId,
        fileName: stored.fileName,
        index: 1,
        of: 1,
      });
      return;
    }
    const lotNo = lot.lotNo ?? position + 1;
    const images = photos.lots.find((l) => l.offerId === lot.offerId)?.images ?? [];
    images.forEach((image, i) => {
      files.push({
        key: `${lot.offerId}:${image.photoId}`,
        offerId: lot.offerId,
        lotNo,
        photoId: image.photoId,
        fileName: facebookLotPhotoFileName(lotNo, image.fileName),
        index: i + 1,
        of: images.length,
      });
    });
  });
  return files;
}

/**
 * Why the post's photos cannot be taken yet, naming the lots — null when they can. Captioned, a lot's
 * photo still being drawn or failed (#1861, the ZIP's own refusal); laid out as text, a lot whose own
 * photos are being made again (#2114), which *Publish…* waits for too. Only the lots that go up count.
 */
export function facebookPostPhotosHeld(
  lots: readonly PublishLot[],
  photos: FacebookPostPhotos | undefined
): string | null {
  if (!photos) return null;
  const goingUp = lots.filter((l) => !isFacebookLotLeftOut(l));
  if (photos.layout === "captions") {
    const ids = new Set(goingUp.map((l) => l.offerId));
    return lotPhotosNotReady(photos.lots.filter((l) => ids.has(l.offerId)));
  }
  const drawing = new Set(lotPhotosDrawing(photos));
  return lotPhotosNotReady(
    goingUp
      .filter((l) => drawing.has(l.offerId))
      .map((l) => ({ lotNo: l.lotNo ?? lots.indexOf(l) + 1, state: { status: "generating" as const } }))
  );
}

/** The lot a post's publish is asked through — the whole post moves whichever lot is asked: approving,
 *  a pending one, so the closing-time question reads the post's pending auctions (#1779); otherwise one
 *  that goes up (#2560). */
export function facebookPostPublishVia(lots: readonly PublishLot[], approving: boolean): string | undefined {
  const pending = lots.find((l) => l.state === "pending");
  if (approving && pending) return pending.offerId;
  return (lots.find((l) => !isFacebookLotLeftOut(l)) ?? lots[0])?.offerId;
}

/** What is said once a post is published, submitted or approved. A lot sold or withdrawn while the post
 *  waited stays as it is (#2290); one sold before it went up is left out (#2560). */
export function facebookPostPublishedMessage(
  postNo: number,
  lots: readonly PublishLot[],
  { approving, target }: { approving: boolean; target: "active" | "pending" }
): string {
  if (approving) {
    return lots.some((l) => isFacebookLotClosed(l.state))
      ? `Post #${postNo} approved — the lots that were waiting are up`
      : `Post #${postNo} approved — all its lots are up`;
  }
  if (target === "pending") return `Post #${postNo} submitted — waiting for the group's approval`;
  const goingUp = lots.filter((l) => !isFacebookLotLeftOut(l)).length;
  if (goingUp < lots.length) {
    return `Post #${postNo} is up — ${goingUp} of its ${lots.length} lots active, the sold ones left out`;
  }
  return lots.length > 1 ? `Post #${postNo} is up — all ${lots.length} lots active` : `Post #${postNo} is up`;
}
