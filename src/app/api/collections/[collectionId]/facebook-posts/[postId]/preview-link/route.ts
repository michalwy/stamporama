import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readFacebookPostPreviewShareState } from "@/lib/facebook-post-preview";

// The post's preview link (#2212) as the collector's dialog reads it: the address, when it was made and
// last opened — `link` is `null` when the post has none — what a buyer opening it sees now, and the
// post's language, which the buyer's page speaks.
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
    return NextResponse.json(await readFacebookPostPreviewShareState(session.user.id, postId, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
