import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findOfferCollisions } from "@/lib/offers";

// Live collision check for the offer dialog (ADR-0012, #165): other active offers on the same
// platform that share a physical copy with the target lot. Non-blocking — the dialog surfaces
// this as a warning and lets the user proceed. `excludeOfferId` skips the offer being edited.
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
  const lotId = sp.get("lotId");
  const platformId = sp.get("platformId");
  const excludeOfferId = sp.get("excludeOfferId") || undefined;

  if (!lotId || !platformId) {
    return NextResponse.json({ collisions: [] });
  }

  try {
    const collisions = await findOfferCollisions(
      session.user.id,
      collectionId,
      lotId,
      platformId,
      excludeOfferId
    );
    return NextResponse.json({ collisions });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
