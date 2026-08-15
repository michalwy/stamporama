import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { findLotsForListings } from "@/lib/auctions";

// "Which of these listings am I already tracking as auction lots?" (#575) — the buying-side twin of
// `…/offers/by-listing` (#466), and the one question a marketplace page cannot answer about itself.
//
// Session **or** Assistant token (`resolveCollectionOwner`), like the matcher, the listing kit and
// the capture: the extension reaches us cross-site from allegro.pl, where the session cookie is not
// sent. A static segment ahead of `[lotId]`, as `counts` and `exposure` are.
//
// It takes **many** ids in one call (`?platformOfferId=…&platformOfferId=…`) for the offer lookup's
// reason, even though the listing page that asks is a batch of one: a caller that annotates a list
// must not become a request per row.
//
// Read-only, and a miss is an **absent row**, not an error: nearly every listing a collector opens
// is one they have never bid on, and an error status for that would turn an ordinary page view into
// something that looks broken.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const platformOfferIds = request.nextUrl.searchParams
    .getAll("platformOfferId")
    .map((id) => id.trim())
    .filter(Boolean);
  if (platformOfferIds.length === 0) {
    return NextResponse.json({ error: "No listing ids given." }, { status: 400 });
  }

  try {
    const matches = await findLotsForListings(ownerId, collectionId, platformOfferIds);
    return NextResponse.json({ matches });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
