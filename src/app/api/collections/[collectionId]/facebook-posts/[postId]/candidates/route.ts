import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listFacebookLotCandidates } from "@/lib/facebook-posts";

// The offers that could join a multi-lot post as further lots (#1870) — what its screen's *Add lots…*
// picks from. Owner-checked through the collection, and refused for a post of another collection.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, postId } = await params;
  try {
    const offers = await listFacebookLotCandidates(session.user.id, collectionId, postId);
    return NextResponse.json({ offers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
