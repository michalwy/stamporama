import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getOfferPhotoPlanState } from "@/lib/offer-photo-generation";

// The offer's photo plan (#311): the generation job's state, the stored images in upload order, the
// staleness signal, and what a Generate right now would produce. A route handler rather than a server
// action because the Photos card **polls** it while a run is queued or in flight, and the photos panel
// (#314) will read the very same payload. The bytes themselves are served by the shared
// `/photos/[photoId]/[variant]` route, unchanged.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { offerId } = await params;
  try {
    return NextResponse.json(await getOfferPhotoPlanState(session.user.id, offerId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
