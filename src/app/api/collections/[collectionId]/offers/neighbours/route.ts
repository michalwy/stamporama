import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { offerListNeighbours } from "@/lib/offers";
import { isOfferState } from "@/lib/offer-rules";

// Where one offer sits in the filtered offer list, for the detail screen's next/previous links
// (#429). Takes the same filter params as the list route, plus the offer being looked at.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;
  const offerId = sp.get("offerId");
  if (!offerId) {
    return NextResponse.json({ error: "offerId is required" }, { status: 400 });
  }
  // A comma-separated set since the state chips became multi-select (#475); unknown tokens are
  // dropped rather than refused, the chips being the authority on what exists.
  const states = (sp.get("state") || "").split(",").filter(isOfferState);

  try {
    const result = await offerListNeighbours(session.user.id, collectionId, offerId, {
      platformId: sp.get("platformId") || undefined,
      states,
      search: sp.get("search") || undefined,
      needsAction: sp.get("needsAction") === "1",
      bidding: sp.get("bidding") === "1",
      endedAuction: sp.get("endedAuction") === "1",
      includeClosed: sp.get("includeClosed") === "1",
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
