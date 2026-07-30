import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { ListingSkippedField, ListingTaskPhoto } from "../platform/listing";

// Fetching an offer's rendered listing images from the instance (#411).
//
// It runs in the service worker for the reason every instance call does: host_permissions exempt a
// worker fetch from CORS, and the Assistant token belongs nowhere near a marketplace page. The photo
// route already takes that token (#253), so the same bearer the kit was read with fetches the bytes.
//
// The bytes then have to reach the content script, which is the only side with a form to put them
// in — and extension messaging is JSON, so they travel **base64-encoded** and are turned back into
// `File`s in the page. That is also why one run has a byte budget (`LISTING_PHOTO_BUDGET_BYTES`),
// applied before any of this is called.

/** One fetched image, in the shape that survives extension messaging. */
export interface FetchedListingPhoto {
  photoId: string;
  /** The name the file takes on upload — the plan's own (#314/#326), so a picture posted through the
   *  Assistant is named exactly as one unpacked from the offer's ZIP. */
  fileName: string;
  mime: string;
  /** The image's bytes, base64. */
  data: string;
}

export interface FetchedListingPhotos {
  photos: FetchedListingPhoto[];
  /** One entry per image that could not be fetched, named so the collector knows which. */
  skipped: ListingSkippedField[];
}

/**
 * Fetch `images` in order, keeping what arrives and reporting what does not.
 *
 * A failure here is **per image and never fatal**: the form is already filled, and the fallback the
 * scope asks for is dragging the missing picture in from the offer's ZIP — not redoing the listing.
 * They are fetched one at a time rather than all at once, because the run is bounded by a byte budget
 * and a listing's pictures are a handful of files from the collector's own instance.
 */
export async function fetchListingPhotos(
  profile: Profile,
  images: readonly ListingTaskPhoto[]
): Promise<FetchedListingPhotos> {
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const photos: FetchedListingPhoto[] = [];
  const skipped: ListingSkippedField[] = [];
  for (const image of images) {
    try {
      const res = await fetch(`${base}${image.url}`, {
        headers: { Authorization: `Bearer ${profile.token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      photos.push({
        photoId: image.photoId,
        fileName: image.fileName,
        // The response is the authority on what it just served; the plan's own mime is the fallback.
        mime: res.headers.get("content-type")?.split(";")[0]?.trim() || image.mime,
        data: toBase64(await res.arrayBuffer()),
      });
    } catch (e) {
      skipped.push({
        field: `Pictures — ${image.fileName}`,
        reason: `Stamporama would not hand this picture over (${e instanceof Error ? e.message : String(e)}).`,
      });
    }
  }
  return { photos, skipped };
}

/** Base64 for a whole image, in chunks: `String.fromCharCode(...bytes)` over a megabyte-sized array
 *  overruns the argument limit, which is a crash rather than a slow path. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
