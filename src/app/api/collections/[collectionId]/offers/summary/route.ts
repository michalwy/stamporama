import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { offersSummary } from "@/lib/offers";
import { isOfferState } from "@/lib/offer-rules";

// Aggregate figures for the offer list's summary bar (#317). Takes the same params as the list
// route so the totals cover exactly the offers being shown, not the whole collection.
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
  // A comma-separated set since the state chips became multi-select (#475); unknown tokens are
  // dropped rather than refused, the chips being the authority on what exists.
  const states = (sp.get("state") || "").split(",").filter(isOfferState);

  try {
    const summary = await offersSummary(session.user.id, collectionId, {
      platformId: sp.get("platformId") || undefined,
      states,
      search: sp.get("search") || undefined,
      needsAction: sp.get("needsAction") === "1",
      bidding: sp.get("bidding") === "1",
      endedAuction: sp.get("endedAuction") === "1",
      platformSale: sp.get("platformSale") === "1",
      includeClosed: sp.get("includeClosed") === "1",
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
