import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listReadyOffersForListing } from "@/lib/offers";

// Every `ready` offer on one platform, for the bulk listing workspace (#322). Unpaginated: this is
// one posting session's batch, and the screen groups and filters it client-side so the area/year rail
// faceting is instant.
//
// `platformId` is required, not defaulted — the workspace exists to post to one marketplace, and a
// list spanning platforms would mix listings whose titles, formats and photo limits differ.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const platformId = request.nextUrl.searchParams.get("platformId");
  if (!platformId) {
    return NextResponse.json({ error: "A platform is required." }, { status: 400 });
  }

  try {
    const items = await listReadyOffersForListing(session.user.id, collectionId, platformId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
