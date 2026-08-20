import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { canServeTradeSharePhoto, verifyTradeShareToken } from "@/lib/trade-share";
import { getPhotoForServing } from "@/lib/photos";
import { getStorage, toWebStream, variantKey } from "@/lib/storage";
import type { PhotoVariant } from "@/lib/storage";

// Scans on the partner's page (#640).
//
// A route of its own rather than a widening of the collection-scoped one. The photo route the app
// already has authorises by *collection* — a session or an Assistant token acting as the owner — and
// what is needed here is the opposite shape: a credential that authorises **one trade** and, through
// it, exactly the pictures hanging on that trade's lines. Teaching the collection route a second kind
// of caller would have put a token check on the hot path of every thumbnail in the app, and one
// mistake in it would be a mistake about the whole collection rather than about one list.
//
// The scoping question is asked by `canServeTradeSharePhoto`, in the domain, beside the read that
// puts the ids on the page. Nothing here trusts the id in the URL: an id for a photo of a copy that
// is not on this trade 404s exactly as an invented one does.

const VALID_VARIANTS = new Set<PhotoVariant>(["full", "thumb"]);

/** Higher than the page's, because one page is many pictures: a list of eighty lines with fronts and
 *  backs asks for a hundred and sixty of these in a burst, and a limit that stopped that would be a
 *  limit on reading the list. */
const PHOTO_LIMIT = 400;
const PHOTO_WINDOW_MS = 60_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; photoId: string; variant: string }> }
) {
  const { token, photoId, variant } = await params;

  const limited = rateLimit(
    `trade-share-photo:${clientAddress(request.headers)}`,
    PHOTO_LIMIT,
    PHOTO_WINDOW_MS
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Not touched: the visit is the page, and a receipt written once per thumbnail would say more
  // about how many pictures a trade carries than about anyone having read it.
  const verified = await verifyTradeShareToken(token, { touch: false });
  if (!verified.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!VALID_VARIANTS.has(variant as PhotoVariant)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canServeTradeSharePhoto(verified.access, photoId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhotoForServing(photoId);
  // The scoping check above already proved the photo is on this trade's lines; this second check is
  // the same belt-and-braces the collection route wears — the trade's own collection must be the one
  // the picture belongs to, whatever a future edit to either query does.
  if (!photo || photo.collectionId !== verified.access.collectionId) {
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
      // Bytes are immutable per key, so a long cache is safe — and **private**, because the token
      // gates every request and a shared cache holding these would be a second copy of the list with
      // no token on it.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
