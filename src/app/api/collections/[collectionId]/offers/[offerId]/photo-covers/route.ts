import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readOfferCoverWalk } from "@/lib/offer-photo-generation";

// The copy photos an offer's images are made from, with their covers (#1665) — what the cover walk
// goes through. A route handler like the photo plan beside it, read by the same card.
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
    return NextResponse.json(await readOfferCoverWalk(session.user.id, offerId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
