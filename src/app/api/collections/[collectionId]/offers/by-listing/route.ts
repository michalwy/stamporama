import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { findOffersForListings } from "@/lib/offers";

// "Which of these listings are offers of this collection?" (#466) — the one question a marketplace
// page cannot answer about itself, asked by the Assistant while the collector is standing on it.
//
// Session **or** Assistant token (`resolveCollectionOwner`), like the matcher, the listing kit and
// the capture: the extension reaches us cross-site from allegro.pl, where the session cookie is not
// sent. A static segment ahead of `[offerId]`, as `for-target` and `listing` are.
//
// It takes **many** ids in one call (`?platformOfferId=…&platformOfferId=…`) because the seller's
// own assortment page is a list: asking per row would be a request per row. A single listing page is
// simply the batch of one.
//
// Read-only, and a miss is an **absent row**, not an error: most listings a collector opens are
// somebody else's, and an error status for that would turn every ordinary page view into something
// that looks broken.
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
    const matches = await findOffersForListings(ownerId, collectionId, platformOfferIds);
    return NextResponse.json({ matches });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
