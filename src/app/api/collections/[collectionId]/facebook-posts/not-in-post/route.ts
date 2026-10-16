import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listFacebookOffersNotInPost } from "@/lib/facebook-posts";
import { isOfferState } from "@/lib/offer-rules";

// The Facebook offers in no post and not yet up (#1989) — the list of posts' *Not in a post yet*.
// `group` is a comma-separated set of group ids and `state` a comma-separated set of states; a state
// that is not one an offer in no post can be in is dropped. The static segment shadows `[postId]`.
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
  const groupIds = (sp.get("group") || "").split(",").filter(Boolean);
  const stateParam = sp.get("state");
  const states = stateParam === null ? undefined : stateParam.split(",").filter(isOfferState);

  try {
    return NextResponse.json(await listFacebookOffersNotInPost(session.user.id, collectionId, { groupIds, states }));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
