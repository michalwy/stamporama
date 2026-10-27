import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { canServeFacebookPostPreviewPhoto, verifyFacebookPostPreviewToken } from "@/lib/facebook-post-preview";
import { getPhotoForServing } from "@/lib/photos";
import { getStorage, toWebStream, variantKey } from "@/lib/storage";
import type { PhotoVariant } from "@/lib/storage";

// The photos on a shared Facebook post preview (#2212), as a thumbnail or — clicked — full size.
//
// A route of the link's own rather than a widening of the collection-scoped one, `/api/spec/…`'s
// reasoning: the collection route authorises by collection, and this credential authorises **one
// post's preview** — the generated images of its lots, which is what `canServeFacebookPostPreviewPhoto`
// asks. Nothing here trusts the id in the URL: any other photo 404s as an invented id does.

const VALID_VARIANTS = new Set<PhotoVariant>(["full", "thumb"]);

/** Higher than the page's, because a post of twenty lots is a burst of pictures. */
const PHOTO_LIMIT = 600;
const PHOTO_WINDOW_MS = 60_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; photoId: string; variant: string }> }
) {
  const { token, photoId, variant } = await params;

  const limited = rateLimit(`fb-preview-photo:${clientAddress(request.headers)}`, PHOTO_LIMIT, PHOTO_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  if (!VALID_VARIANTS.has(variant as PhotoVariant)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Not touched: the visit is the page, not each of its photos.
  const access = await verifyFacebookPostPreviewToken(token, { touch: false });
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await canServeFacebookPostPreviewPhoto(access, photoId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhotoForServing(photoId);
  // Belt and braces, as the collection route wears: the picture must be the post's collection's.
  if (!photo || photo.collectionId !== access.collectionId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storage = getStorage(photo.storageBackend);
  const key = variantKey(photo.storageKey, variant as PhotoVariant, photo.mime);

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
