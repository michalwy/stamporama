import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getFacebookPostCatalogueFill } from "@/lib/facebook-post-catalogue-fill";

// A post's copies as *Fill catalogue values* lines (#2220), keyed by the lot's offer id — what its
// screen counts the missing values from and types them down; `lots` is null once the post is up.
// Owner-checked through the collection, and refused for a post of another collection.
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
    const lots = await getFacebookPostCatalogueFill(session.user.id, collectionId, postId);
    return NextResponse.json({ lots });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
