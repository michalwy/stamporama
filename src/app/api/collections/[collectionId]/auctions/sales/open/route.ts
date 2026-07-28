import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findOpenAuctionSale, getAuctionSellerDefaults } from "@/lib/auctions";

// What the add-lot dialog needs to attach a lot without asking for a sale (#352): the seller's own
// defaults — including the platform they were last tracked on — and the open sale proposed for the
// seller + platform pair. A static segment ahead of `[saleId]`, like the offers routes.
//
// Only `sellerId` is required. The defaults are what pre-fills the platform, so they have to be
// answerable *before* a platform exists; the proposal is added once there is a pair to propose for.
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
  const sellerId = sp.get("sellerId");
  const platformId = sp.get("platformId");
  if (!sellerId) {
    return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
  }

  try {
    const [proposal, sellerDefaults] = await Promise.all([
      platformId
        ? findOpenAuctionSale(session.user.id, collectionId, sellerId, platformId)
        : Promise.resolve(null),
      getAuctionSellerDefaults(session.user.id, collectionId, sellerId),
    ]);
    return NextResponse.json({ proposal, sellerDefaults });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
