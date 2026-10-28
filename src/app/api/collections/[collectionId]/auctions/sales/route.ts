import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listAuctionSales } from "@/lib/auctions";
import { isAuctionSaleStatus } from "@/lib/auction-rules";
import { readSearchParam } from "@/lib/text-input";
import { parseSearchFields, SEARCH_FIELDS_PARAM } from "@/lib/search-fields";
import { AUCTION_SALE_SEARCH_FIELD_KEYS } from "@/lib/auction-sale-search-fields";

// Every auction sale with its parcel totals — the settlement list. Unpaginated by design: a sale is
// one parcel from one seller, and the screen answers "what do I owe whom".
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
  const statusParam = sp.get("status");

  try {
    const items = await listAuctionSales(session.user.id, collectionId, {
      status: statusParam && isAuctionSaleStatus(statusParam) ? statusParam : undefined,
      search: readSearchParam(sp),
      // The fields the search box was narrowed to beside it (#2245); absent is every field.
      searchFields: parseSearchFields(sp.get(SEARCH_FIELDS_PARAM), AUCTION_SALE_SEARCH_FIELD_KEYS),
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
