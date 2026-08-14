import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { FULL_MAX_EDGE } from "@/lib/photos/process";
import { getSheetForServing, renderSheetRegion, ScanValidationError } from "@/lib/scan-sheets";

/**
 * Serve one region of a retained card scan, at display size (#579, ADR-0033).
 *
 * **A sibling of `[variant]`, not a parameter on it.** That route hands back an object that exists
 * in storage: it takes the redirect fork a GCS binding needs, and its `immutable` cache header is
 * true because a sheet's bytes are written once under a key that is never rewritten. A region is
 * none of that — it is computed per request from the original, so there is no URL to redirect a
 * browser to and no stored object to name. Folding it in would have meant a branch skipping the
 * redirect fork on one variant value, which is the kind of quiet exception that later gets a scan
 * served as a signed URL to a crop that was never uploaded. Next resolves the static segment ahead
 * of `[variant]`, so the two cannot collide.
 *
 * The response is still `immutable`: the query names a fixed crop of bytes that are retained and
 * never resampled, so the same URL is the same picture forever. That, plus the editor's own grid
 * snapping, is what keeps a pan from re-deriving nearly the same crop on every frame — each one
 * costs a full decode of a 30 Mpx original.
 *
 * Session only, no Assistant bearer, matching the sibling route: the extension has no business with
 * an intake scan.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; sheetId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, sheetId } = await params;
  const sheet = await getSheetForServing(sheetId);
  // Authorized exactly as the variant route is: by the sheet's real owning collection + owner, with
  // the URL's collection required to match so a scan cannot be addressed through someone else's.
  if (!sheet || sheet.collectionId !== collectionId || sheet.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const q = request.nextUrl.searchParams;
  const box = {
    x: intParam(q.get("x")),
    y: intParam(q.get("y")),
    w: intParam(q.get("w")),
    h: intParam(q.get("h")),
  };
  // Clamped rather than merely validated: `renderWidth` is the one number a client could use to ask
  // the server to encode something enormous, and the ceiling is the pipeline's own.
  const renderWidth = Math.min(intParam(q.get("rw")) ?? 0, FULL_MAX_EDGE);
  if (box.x == null || box.y == null || box.w == null || box.h == null || renderWidth < 1) {
    return NextResponse.json({ error: "Invalid region" }, { status: 400 });
  }

  try {
    const region = await renderSheetRegion(
      sheet,
      { x: box.x, y: box.y, w: box.w, h: box.h },
      renderWidth
    );
    return new Response(new Uint8Array(region.buffer), {
      status: 200,
      headers: {
        "Content-Type": region.mime,
        "Content-Length": String(region.buffer.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    if (err instanceof ScanValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

function intParam(raw: string | null): number | null {
  if (raw == null || !/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
