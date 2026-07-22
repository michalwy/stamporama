import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findOfferCollisions } from "@/lib/offers";

// Live collision check for the compose picker (ADR-0013): other active offers on the same
// platform that already list one of these copies. Non-blocking — surfaced as a warning, the user
// may proceed. `excludeOfferId` skips the offer being composed.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;
  const itemIds = sp.getAll("itemId");
  const platformId = sp.get("platformId");
  const excludeOfferId = sp.get("excludeOfferId") || undefined;

  if (itemIds.length === 0 || !platformId) {
    return NextResponse.json({ collisions: [] });
  }

  try {
    const collisions = await findOfferCollisions(
      session.user.id,
      collectionId,
      itemIds,
      platformId,
      excludeOfferId
    );
    return NextResponse.json({ collisions });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
