import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getFacebookPostLot } from "@/lib/facebook-posts";

// One lot of a post as its screen shows it (#2221) — what a price, a title or the lot's own state saved
// from its row refreshes, instead of the whole post. Owner-checked through the collection; 404 for an
// offer that is not a lot of this post.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, postId, offerId } = await params;
  try {
    const lot = await getFacebookPostLot(session.user.id, collectionId, postId, offerId);
    if (!lot) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(lot);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
