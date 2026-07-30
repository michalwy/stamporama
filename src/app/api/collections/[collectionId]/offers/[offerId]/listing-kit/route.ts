import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { getOfferListingKit } from "@/lib/listing-kit";

// The offer's listing kit (#405, part of #155): everything one offer wants filled into a marketplace
// sale form, in a single read-only call — catalog item-IDs, graded conditions, quantity, price, the
// two texts and the photo plan in upload order.
//
// Session **or** Assistant bearer token, like the matcher endpoints (#250): the extension reaches us
// cross-site from colnect.com, where the session cookie is not sent. Nothing is written here; the
// write-back (listing URL, activation) is its own issue (#412).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const { collectionId, offerId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let kit;
  try {
    kit = await getOfferListingKit(ownerId, collectionId, offerId);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!kit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A failing precondition is a **refusal**, not a payload with holes in it (#406): posting a wrong
  // grade or a quantity over sets that are not interchangeable misdescribes the goods. The reasons
  // travel with the 409 so the caller can show them without a vocabulary of its own.
  if (kit.blockers.length > 0) {
    return NextResponse.json(
      { error: "preconditions", blockers: kit.blockers },
      { status: 409 }
    );
  }

  return NextResponse.json(kit);
}
