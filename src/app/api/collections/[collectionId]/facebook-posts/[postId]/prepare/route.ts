import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getFacebookPostLotsPrepare } from "@/lib/facebook-posts";

// A post's lots as Prepare rows (#2031) — what its screen prices and readies them from while the post
// is not up; `lots` is null once it is. `?lots=` (offer ids, comma-separated) answers for those lots
// alone (#2222): what the screen asks after while their photos are being made. Owner-checked through the
// collection, and refused for a post of another collection.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, postId } = await params;
  const only = request.nextUrl.searchParams.get("lots")?.split(",").filter(Boolean);
  try {
    const lots = await getFacebookPostLotsPrepare(session.user.id, collectionId, postId, only);
    return NextResponse.json({ lots });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
