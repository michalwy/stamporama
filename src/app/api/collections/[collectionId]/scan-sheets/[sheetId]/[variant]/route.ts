import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getSheetForServing } from "@/lib/scan-sheets";
import { getStorage, sheetVariantKey, toWebStream } from "@/lib/storage";
import type { SheetVariant } from "@/lib/storage";

const VALID_VARIANTS = new Set<SheetVariant>(["original", "view"]);

/**
 * Serve a retained card scan (#566, ADR-0033).
 *
 * A route of its own rather than a variant on the photo route: a sheet is not a `Photo` — no owner
 * column points at it, `getPhotoForServing` would resolve nothing, and its two variants are not a
 * photo's two. Everything else is deliberately identical to the photo route, including the
 * redirect/stream fork a GCS binding needs, so a scan on a signed-URL backend behaves like every
 * other image.
 *
 * `view` is what the review editor displays. `original` is the retained upload — the thing the cut
 * is taken from — and is served for the collector to download the scan they can no longer re-make.
 *
 * Session only, no Assistant bearer: the extension has no business with an intake scan.
 */
export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ collectionId: string; sheetId: string; variant: string }>;
  }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, sheetId, variant } = await params;
  if (!VALID_VARIANTS.has(variant as SheetVariant)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sheet = await getSheetForServing(sheetId);
  // Authorize by the sheet's real owning collection + owner, and require the URL's collection to
  // match so a scan cannot be addressed through someone else's collection id.
  if (
    !sheet ||
    sheet.collectionId !== collectionId ||
    sheet.ownerId !== session.user.id
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storage = getStorage(sheet.storageBackend);
  const key = sheetVariantKey(sheet.storageKey, variant as SheetVariant, sheet.mime);

  let resolved;
  try {
    resolved = await storage.resolveUrl(key, sheet.mime);
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
      // Immutable per key: a replaced sheet is a new id under a new prefix, never a rewrite.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
