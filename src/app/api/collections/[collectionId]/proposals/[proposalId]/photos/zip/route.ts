import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { OfferPhotoGenerationError } from "@/lib/offer-photo-generation";
import { buildProposalPhotoArchive } from "@/lib/proposal-handout";

// A proposal's lots' photos as one ZIP, in lot order (#2288), each file named for its lot — for sending
// over Messenger in one go. The screen marks the proposal sent when the collector downloads it.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; proposalId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, proposalId } = await params;
  let archive;
  try {
    archive = await buildProposalPhotoArchive(session.user.id, proposalId, collectionId);
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
