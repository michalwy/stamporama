import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import {
  canServeOfferSpecificationPhoto,
  verifyOfferSpecificationShareToken,
} from "@/lib/offer-specification-share";
import { getPhotoForServing } from "@/lib/photos";
import { getStorage, toWebStream, variantKey } from "@/lib/storage";

// The thumbnails on a shared specification (#1760).
//
// A route of the link's own rather than a widening of the collection-scoped one, `/api/s/…`'s and
// `/api/t/…`'s reasoning: the collection route authorises by collection, and this credential
// authorises **one offer's specification** — exactly the thumbnails that page shows, which is what
// `canServeOfferSpecificationPhoto` asks. Nothing here trusts the id in the URL: any other photo,
// including another scan of a listed copy, 404s as an invented id does.
//
// Thumbnails only: the specification shows nothing larger.

/** Higher than the page's, because one page is a picture per copy. */
const PHOTO_LIMIT = 600;
const PHOTO_WINDOW_MS = 60_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; photoId: string }> }
) {
  const { token, photoId } = await params;

  const limited = rateLimit(
    `offer-spec-share-photo:${clientAddress(request.headers)}`,
    PHOTO_LIMIT,
    PHOTO_WINDOW_MS
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Not touched: the visit is the page, not each of its thumbnails.
  const access = await verifyOfferSpecificationShareToken(token, { touch: false });
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await canServeOfferSpecificationPhoto(access, photoId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhotoForServing(photoId);
  // Belt and braces, as the collection route wears: the picture must be the offer's collection's.
  if (!photo || photo.collectionId !== access.collectionId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storage = getStorage(photo.storageBackend);
  const key = variantKey(photo.storageKey, "thumb", photo.mime);

  let resolved;
  try {
    resolved = await storage.resolveUrl(key, photo.mime);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (resolved.kind === "redirect") {
    return NextResponse.redirect(resolved.url);
  }

  return new Response(toWebStream(resolved.object.stream), {
    status: 200,
    headers: {
      "Content-Type": resolved.object.mime,
      "Content-Length": String(resolved.object.sizeBytes),
      // Private: the token gates every request, and a shared cache holding these would be a second
      // copy with no token on it.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
