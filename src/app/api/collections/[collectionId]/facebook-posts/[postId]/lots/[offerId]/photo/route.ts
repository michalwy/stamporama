import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { OfferPhotoGenerationError } from "@/lib/offer-photo-generation";
import { renderFacebookPostLotPhoto } from "@/lib/facebook-lot-photos";

// A lot's one photo in a captioned Facebook post (#1841): what the kit shows above the lot's caption,
// and what one click downloads. Drawn on demand from the offer's stored images — owner-checked, and
// refused for an offer that is not a lot of this post. `?download` asks for it as a file.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId, offerId } = await params;
  let photo;
  try {
    photo = await renderFacebookPostLotPhoto(session.user.id, postId, offerId);
  } catch (err) {
    if (err instanceof OfferPhotoGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  const download = request.nextUrl.searchParams.has("download");
  return new Response(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.mime,
      "Content-Length": String(photo.bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${photo.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
