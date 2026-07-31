import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  findOpenAuctionSale,
  getAuctionSellerDefaults,
  getNewAuctionSaleCurrency,
} from "@/lib/auctions";

// What the add-lot dialog needs to attach a lot without asking for a sale (#352): the seller's own
// defaults — including the platform they were last tracked on — the open sale proposed for the
// seller + platform pair, and the currency a new sale would open in. A static segment ahead of
// `[saleId]`, like the offers routes.
//
// **Nothing is required.** Each answer is given for as much as is known: the defaults pre-fill the
// platform, so they must be answerable before a platform exists; the proposal needs a pair; and the
// currency has to be answerable with neither party resolved yet, because a seller typed in for the
// first time has no id until the lot is saved.
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

  try {
    const [proposal, sellerDefaults, newSaleCurrency] = await Promise.all([
      sellerId && platformId
        ? findOpenAuctionSale(session.user.id, collectionId, sellerId, platformId)
        : Promise.resolve(null),
      sellerId
        ? getAuctionSellerDefaults(session.user.id, collectionId, sellerId)
        : Promise.resolve(null),
      getNewAuctionSaleCurrency(session.user.id, collectionId, sellerId, platformId),
    ]);
    return NextResponse.json({ proposal, sellerDefaults, newSaleCurrency });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
