import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findStampConditionCollisions } from "@/lib/offers";

// Live offers that already list the same **stamp in the same condition** as these copies (#513) —
// the mistake Colnect refuses, caught before the copies go on. Non-blocking: a warning the copies
// list's selection bar and the "create new offer" form surface, never a gate. `platformId` narrows
// to the platform being listed on; `excludeOfferId` skips the offer being composed.
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
  const platformId = sp.get("platformId") || undefined;
  const excludeOfferId = sp.get("excludeOfferId") || undefined;

  if (itemIds.length === 0) {
    return NextResponse.json({ collisions: [] });
  }

  try {
    const collisions = await findStampConditionCollisions(session.user.id, collectionId, itemIds, {
      platformId,
      excludeOfferId,
    });
    return NextResponse.json({ collisions });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
