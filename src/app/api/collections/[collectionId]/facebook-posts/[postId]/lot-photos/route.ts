import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { OfferPhotoGenerationError } from "@/lib/offer-photo-generation";
import { readFacebookPostLotPhotos } from "@/lib/facebook-lot-photos";
import { kickOfferPhotoWorker } from "@/lib/offer-photo-worker";

// A captioned Facebook post's lot photos, as its screen shows them (#1861): per lot, the stored photo
// to show, or that it is still being generated, failed, or has nothing to be drawn from. Reading it
// queues whatever is missing or stale, so the screen polls it until every lot is ready. `?lots=` (offer
// ids, comma-separated) answers for those lots alone (#2221): the poll asks after the lots still being
// drawn, not every lot of the post. Owner-checked; empty for a post laid out in its text.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await params;
  const only = request.nextUrl.searchParams.get("lots")?.split(",").filter(Boolean);
  let lots;
  try {
    lots = await readFacebookPostLotPhotos(session.user.id, postId, only);
  } catch (err) {
    if (err instanceof OfferPhotoGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
  if (lots.some((lot) => lot.state.status === "generating")) kickOfferPhotoWorker();
  return NextResponse.json({ lots });
}
