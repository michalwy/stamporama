import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getFacebookPostScreen } from "@/lib/facebook-posts";

// A multi-lot Facebook post as its own screen reads it (#1842): the kit, the lots in lot order and
// each lot's sale. Owner-checked through the collection, and refused for a post of another collection.
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
    const screen = await getFacebookPostScreen(session.user.id, postId);
    if (!screen || screen.collectionId !== collectionId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(screen);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
