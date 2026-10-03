import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  buildFacebookPostPhotoArchive,
  OfferPhotoGenerationError,
} from "@/lib/offer-photo-generation";

// A Facebook post's photos as one ZIP, in lot order (#1544; ADR-0061 §3) — the photos half of the
// kit, downloaded in one click and uploaded to the album in the order the post numbers its lots.
// Owner-checked lot by lot through the photo read model, as the per-offer archive is.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await params;
  let archive;
  try {
    archive = await buildFacebookPostPhotoArchive(session.user.id, postId);
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
      "Cache-Control": "no-store",
    },
  });
}
