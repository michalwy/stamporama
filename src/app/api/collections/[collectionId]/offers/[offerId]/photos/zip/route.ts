import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { buildOfferPhotoArchive, OfferPhotoGenerationError } from "@/lib/offer-photo-generation";

// The offer's whole photo plan as one ZIP (#314), files numbered in plan order so a marketplace's
// bulk upload takes them in the right sequence. There is no Delcampe API (#154 is still open), so
// delivery is a manual upload and this archive is the deliverable.
//
// The stored bytes are handed over unchanged — nothing is rendered on download (#311), so the file a
// buyer already sees in a live listing stays byte-identical to the one downloaded again here.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { offerId } = await params;
  let archive;
  try {
    archive = await buildOfferPhotoArchive(session.user.id, offerId);
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
      // Regenerating replaces every image, so an archive is only good for the plan it was built from.
      "Cache-Control": "no-store",
    },
  });
}
