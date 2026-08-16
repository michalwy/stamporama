import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { getPhotoForServing } from "@/lib/photos";
import { getStorage, toWebStream, variantKey } from "@/lib/storage";
import type { PhotoVariant } from "@/lib/storage";

const VALID_VARIANTS = new Set<PhotoVariant>(["full", "thumb"]);

/** Extension for a stored mime, for the fallback download name. */
const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/**
 * A caller-supplied download name, reduced to something safe to put in a `Content-Disposition`
 * header: no path separators, no quotes, no control characters, and bounded in length. Anything
 * left empty falls back to the photo's own id.
 */
function safeDownloadName(requested: string | null, photoId: string, mime: string): string {
  // Whitelist rather than blacklist: letters, digits and a few separators. That drops path
  // separators, quotes and control characters in one pass, whatever the caller sent.
  const cleaned = (requested ?? "")
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 120);
  if (cleaned && cleaned.replace(/[. ]/g, "")) return cleaned;
  return `${photoId}.${MIME_EXTENSION[mime] ?? "bin"}`;
}

// Collection-scoped photo serving (#112). Authorizes by the photo's owning `collectionId`
// (same pattern as the rest of the app) — files never sit under `public/`. Serves both the
// thumbnail and full-size variants. `resolveUrl` returns a discriminated result so a future
// GCS binding can 302 to a signed URL; the filesystem binding streams bytes here. With signed
// URLs the auth check runs at mint time (short TTL).
export async function GET(
  request: NextRequest,
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
  const { collectionId, photoId, variant } = await params;
  // Session or Assistant bearer token (#253): the extension shows stamp photos beside the Colnect
  // image (#282) and cannot put a token in an `<img src>`, so it fetches the bytes with a header.
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!VALID_VARIANTS.has(variant as PhotoVariant)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhotoForServing(photoId);
  // Authorize by the photo's real owning collection + owner, and require the URL's collection
  // to match so a photo can't be addressed through someone else's collection id.
  if (
    !photo ||
    photo.collectionId !== collectionId ||
    photo.ownerId !== ownerId
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storage = getStorage(photo.storageBackend);
  const key = variantKey(photo.storageKey, variant as PhotoVariant, photo.mime);

  // `?download=<name>` asks for the file rather than a view of it (#324). The `download` attribute
  // on an `<a>` cannot carry this on its own — it is ignored the moment the response is a redirect
  // to another origin, which is exactly what the GCS binding returns — so the disposition has to
  // come from the server. That means streaming the bytes ourselves even on a redirecting backend:
  // a download is a rare, deliberate click, so paying for the proxy hop is the cheaper trade.
  const download = request.nextUrl.searchParams.get("download");
  // `?inline=1` asks for the **bytes from this origin** rather than the fastest route to them
  // (#614). The redirecting backend hands an `<img>` a signed URL on another origin, which is
  // exactly what it is for — but it also taints any canvas the image is drawn into, and the tooth
  // count reads pixels out of one. So the measuring tool asks for the proxied copy.
  //
  // The same trade as the download branch below, and for the same reason: this runs once when a
  // perforation run is measured, not once per thumbnail in a list, so paying for the proxy hop is
  // the cheaper side. It is deliberately **not** what the tile's own `<img>` uses — routing every
  // picture through the app is the cost the redirect exists to avoid.
  const inline = request.nextUrl.searchParams.get("inline");
  if (download === null && inline !== null) {
    let object;
    try {
      object = await storage.get(key, photo.mime, "delivery");
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new Response(toWebStream(object.stream), {
      status: 200,
      headers: {
        "Content-Type": object.mime,
        "Content-Length": String(object.sizeBytes),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  if (download !== null) {
    let object;
    try {
      // `delivery` (#591), and this route is the case the rule was written for: it runs once per
      // thumbnail per list view, so populating the cache from here would evict the handful of large
      // objects it exists for and fill it with pictures nobody will ask the server about again.
      object = await storage.get(key, photo.mime, "delivery");
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const fileName = safeDownloadName(download, photoId, object.mime);
    return new Response(toWebStream(object.stream), {
      status: 200,
      headers: {
        "Content-Type": object.mime,
        "Content-Length": String(object.sizeBytes),
        // Both forms: the plain one for old clients, the RFC 5987 one for anything non-ASCII the
        // whitelist above would otherwise have stripped out of the readable name.
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

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
