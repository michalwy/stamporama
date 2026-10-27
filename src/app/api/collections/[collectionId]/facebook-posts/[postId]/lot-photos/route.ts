import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { OfferPhotoGenerationError } from "@/lib/offer-photo-generation";
import { readFacebookPostPhotos } from "@/lib/facebook-lot-photos";
import { lotPhotosDrawing } from "@/lib/facebook-post-lot-refresh";
import { kickOfferPhotoWorker } from "@/lib/offer-photo-worker";

// A post's lots' photos, as its screen shows them (#2222): captioned (#1861), per lot the stored photo
// to show, or that it is still being generated, failed, or has nothing to be drawn from — reading it
// queues whatever is missing or stale; laid out as text, each lot's upload set and where its own photo
// run stands. The screen reads them with the post and asks here only after the lots still being drawn:
// `?lots=` (offer ids, comma-separated) answers for those lots alone (#2221). Owner-checked.
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
  let photos;
  try {
    photos = await readFacebookPostPhotos(session.user.id, postId, only);
  } catch (err) {
    if (err instanceof OfferPhotoGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
  if (lotPhotosDrawing(photos).length > 0) kickOfferPhotoWorker();
  return NextResponse.json({ photos });
}
