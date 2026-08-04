import "server-only";
import { AllegroApiError, allegroUploadImage } from "./allegro-api";
import { allegroImageRejection, describeAllegroImageRefusal } from "./allegro-image-rules";
import { getAllegroAccessToken, type AllegroCallCredentials } from "./allegro-connection";
import { readOfferUploadImages } from "./offer-photo-generation";

// An offer's photo plan, pushed to Allegro's image store (#487).
//
// An Allegro offer carries `images[]` as **URLs**, not as bytes, so a listing (#477) cannot be
// published until the pictures exist somewhere Allegro can read them. Ours cannot simply be linked:
// they are private bytes behind the Assistant token (#253), an instance on `localhost` has no
// address Allegro could fetch from, and one on a VPS should not be publishing an authenticated route
// to a marketplace. So the server uploads the bytes itself — which it is well placed to do, since
// unlike the Assistant path (#411) it already has the file.
//
// **The set and its order are not decided here.** `getOfferPhotoPlanState` (#311/#313) already
// dropped what the collector marked do-not-publish and what falls past the platform's photo limit,
// and the order it returns is the collector's own (#313's `photoPlanOrder`). This uploads exactly
// that list, in exactly that order — first image first, because the first is the listing's
// thumbnail — and re-deriving any of it here is how two surfaces come to disagree about which
// pictures a listing has.
//
// **Nothing is cached.** Allegro states an `expiresAt` on every upload and removes an image no
// listing has used, so a URL stored on the photo row is a value that goes stale on its own with
// nothing here to observe it going. A re-publish re-uploads. The cost is one request per image on a
// path that already makes one per image; the alternative is an expiry column plus an invalidation on
// every regeneration, for a set the collector publishes once.

/** One uploaded picture: which of ours it was, and the URL a listing references it by. */
export interface AllegroOfferImage {
  photoId: string;
  /** The plan's own name for it (#326) — carried so a caller can say which picture it is talking
   *  about without going back to the plan. */
  fileName: string;
  /** Allegro's URL, which is what `images[]` on the offer holds. */
  url: string;
  /** When Allegro will remove it again unless a listing uses it. Null where Allegro stated none. */
  expiresAt: string | null;
}

/**
 * One picture that did not upload — raised instead of a generic failure so that the caller reports
 * *the image*, never "publishing failed". `position` is 1-based over the upload run, which is how
 * the plan numbers the files the collector is looking at.
 */
export class AllegroImageUploadError extends Error {
  readonly photoId: string;
  readonly fileName: string;
  readonly position: number;
  /** Allegro's status where there was one; null for a local refusal or an unreachable store. */
  readonly status: number | null;

  constructor(opts: {
    message: string;
    photoId: string;
    fileName: string;
    position: number;
    status: number | null;
  }) {
    super(opts.message);
    this.name = "AllegroImageUploadError";
    this.photoId = opts.photoId;
    this.fileName = opts.fileName;
    this.position = opts.position;
    this.status = opts.status;
  }
}

/**
 * Upload an offer's publishable images to Allegro and return their URLs **in plan order**.
 *
 * Owner-checked through the plan read. Sequential on purpose: sixteen parallel uploads against a
 * rate-limited API is how an account earns a 429 in the middle of a publication, and the pictures of
 * one listing are a handful of files — there is nothing to win by racing them.
 *
 * The first failure **stops the run**. A listing published with fewer pictures than the collector
 * prepared is precisely what this must not produce, so a refusal is raised as
 * {@link AllegroImageUploadError} naming the image, and the images already uploaded are left to
 * expire on Allegro's side by themselves — which is what they do, and why there is nothing to clean
 * up.
 *
 * @throws {AllegroImageUploadError} when one image is refused, locally or by Allegro.
 * @throws {OfferPhotoGenerationError} when the offer has nothing to upload.
 * @throws {AllegroNotConnectedError} when the collection has no usable grant.
 */
export async function uploadOfferPhotosToAllegro(opts: {
  ownerId: string;
  collectionId: string;
  offerId: string;
  /** The connection to upload through. Resolved here when the caller has not already got one — a
   *  publication (#477) will have, since it makes several calls under the one token. */
  credentials?: AllegroCallCredentials;
  signal?: AbortSignal;
}): Promise<AllegroOfferImage[]> {
  const images = await readOfferUploadImages(opts.ownerId, opts.offerId);
  const credentials =
    opts.credentials ?? (await getAllegroAccessToken(opts.ownerId, opts.collectionId));

  const uploaded: AllegroOfferImage[] = [];
  for (const [index, image] of images.entries()) {
    const position = index + 1;
    const fail = (message: string, status: number | null) =>
      new AllegroImageUploadError({
        message,
        photoId: image.photoId,
        fileName: image.fileName,
        position,
        status,
      });

    // What Allegro cannot take at all is refused before a request is spent on it — and, more to the
    // point, reported as this picture's format rather than as an unexplained 415 mid-run.
    const rejection = allegroImageRejection(image);
    if (rejection) throw fail(rejection, null);

    let result;
    try {
      result = await allegroUploadImage({
        sandbox: credentials.sandbox,
        accessToken: credentials.accessToken,
        userAgent: credentials.userAgent,
        bytes: image.bytes,
        contentType: image.mime,
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof AllegroApiError) {
        // A permission or a dead token is about the *connection* and is re-raised as it arrived: it
        // is not this picture's fault, and the caller latches needs-reconnect off exactly this type.
        if (err.unauthorized || err.insufficientScope) throw err;
        throw fail(
          describeAllegroImageRefusal({
            fileName: image.fileName,
            status: err.status,
            detail: err.message,
          }),
          err.status
        );
      }
      throw err;
    }

    // The store answers 201 with a location. Anything else — a 202, or a success stating nowhere —
    // is not a URL, and recording one that is not there would publish a listing pointing at nothing.
    const url = result.body?.location ?? result.location;
    if (!url) {
      throw fail(
        `Allegro accepted ${image.fileName} but did not say where it stored it.`,
        result.status
      );
    }

    uploaded.push({
      photoId: image.photoId,
      fileName: image.fileName,
      url,
      expiresAt: result.body?.expiresAt ?? null,
    });
  }

  return uploaded;
}
