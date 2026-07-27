import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildOffersPhotoArchive, OfferPhotoGenerationError } from "@/lib/offer-photo-generation";

// A whole posting session's photos as one ZIP, a folder per offer (#323) — the bulk counterpart of
// the per-offer archive (#314), for the batch the listing workspace is currently showing.
//
// POST rather than GET because the batch *is* the request: which offers are shown follows from the
// screen's filters, and a query string carrying forty ids is a URL-length gamble. The download is
// therefore driven from the client (fetch → blob) rather than a plain link.
//
// The archive is capped at MAX_OFFERS. It is buffered in memory like the single-offer one, and a
// bounded batch is the assumption that makes that safe; past the cap the honest answer is to narrow
// the session rather than to build a gigabyte in the request.
const MAX_OFFERS = 100;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const offerIds = (body as { offerIds?: unknown })?.offerIds;
  if (!Array.isArray(offerIds) || offerIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "offerIds must be an array of ids." }, { status: 400 });
  }
  if (offerIds.length === 0) {
    return NextResponse.json({ error: "No offers to download." }, { status: 400 });
  }
  if (offerIds.length > MAX_OFFERS) {
    return NextResponse.json(
      {
        error: `Too many offers for one archive (${offerIds.length}, limit ${MAX_OFFERS}). Narrow the batch with the area or year filter.`,
      },
      { status: 400 }
    );
  }

  let archive;
  try {
    archive = await buildOffersPhotoArchive(session.user.id, offerIds as string[]);
  } catch (err) {
    if (err instanceof OfferPhotoGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  return new Response(new Uint8Array(archive.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(archive.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${archive.fileName}"`,
      // What the caller could not see from the bytes: offers left out because they have nothing to
      // upload, so the screen can say so instead of silently handing over a shorter archive.
      "X-Offer-Count": String(archive.offerCount),
      "X-Image-Count": String(archive.imageCount),
      "X-Skipped-Count": String(archive.skipped.length),
      // Regenerating replaces every image, so an archive is only good for the plan it was built from.
      "Cache-Control": "no-store",
    },
  });
}
