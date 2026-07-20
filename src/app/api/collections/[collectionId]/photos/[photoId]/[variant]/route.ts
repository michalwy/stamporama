import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPhotoForServing } from "@/lib/photos";
import { getStorage, toWebStream, variantKey } from "@/lib/storage";
import type { PhotoVariant } from "@/lib/storage";

const VALID_VARIANTS = new Set<PhotoVariant>(["full", "thumb"]);

// Collection-scoped photo serving (#112). Authorizes by the photo's owning `collectionId`
// (same pattern as the rest of the app) — files never sit under `public/`. Serves both the
// thumbnail and full-size variants. `resolveUrl` returns a discriminated result so a future
// GCS binding can 302 to a signed URL; the filesystem binding streams bytes here. With signed
// URLs the auth check runs at mint time (short TTL).
export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      collectionId: string;
      photoId: string;
      variant: string;
    }>;
  }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, photoId, variant } = await params;
  if (!VALID_VARIANTS.has(variant as PhotoVariant)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhotoForServing(photoId);
  // Authorize by the photo's real owning collection + owner, and require the URL's collection
  // to match so a photo can't be addressed through someone else's collection id.
  if (
    !photo ||
    photo.collectionId !== collectionId ||
    photo.ownerId !== session.user.id
  ) {
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
      // Bytes are immutable per key (permanent keys are content-addressed by photo id); allow
      // long private caching. Auth still gates every request, so keep it private.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
