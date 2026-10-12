import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { OfferPhotoGenerationError } from "@/lib/offer-photo-generation";
import { readFacebookPostLotPhotos } from "@/lib/facebook-lot-photos";
import { kickOfferPhotoWorker } from "@/lib/offer-photo-worker";

// A captioned Facebook post's lot photos, as its screen shows them (#1861): per lot, the stored photo
// to show, or that it is still being generated, failed, or has nothing to be drawn from. Reading it
// queues whatever is missing or stale, so the screen polls it until every lot is ready. Owner-checked;
// empty for a post laid out in its text.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await params;
  let lots;
  try {
    lots = await readFacebookPostLotPhotos(session.user.id, postId);
  } catch (err) {
    if (err instanceof OfferPhotoGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
  if (lots.some((lot) => lot.state.status === "generating")) kickOfferPhotoWorker();
  return NextResponse.json({ lots });
}
