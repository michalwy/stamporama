import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { auctionLotExposure } from "@/lib/auctions";
import { isAuctionLotOutcome } from "@/lib/auction-rules";
import type { AuctionClosingWindow } from "@/lib/auctions";
import { LOT_SIGNALS, type LotSignal } from "@/lib/auction-lot";

/** A derived-state filter (`bid-possible`, `outbid`, …), ignored when it says anything else. */
function lotSignal(raw: string | null): LotSignal | undefined {
  return LOT_SIGNALS.includes(raw as LotSignal) ? (raw as LotSignal) : undefined;
}

function closingWindow(raw: string | null): AuctionClosingWindow | undefined {
  return raw === "ended" || raw === "today" || raw === "week" ? raw : undefined;
}

// What the filtered watchlist can cost (#523), in the collection's base currency: what is already
// committed, and what bidding every open lot up to its ceiling would come to. Same params as the
// list and the facet counts, so the bar answers for exactly the rows on screen (#151).
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
  const outcomeParam = sp.get("outcome");

  try {
    const exposure = await auctionLotExposure(session.user.id, collectionId, {
      outcome: outcomeParam && isAuctionLotOutcome(outcomeParam) ? outcomeParam : undefined,
      includeClosed: sp.get("includeClosed") === "1" || undefined,
      closing: closingWindow(sp.get("closing")),
      signal: lotSignal(sp.get("signal")),
      undescribed: sp.get("undescribed") === "1" || undefined,
      duplicate: sp.get("duplicate") === "1" || undefined,
      search: sp.get("search") || undefined,
      sellerId: sp.get("sellerId") || undefined,
      platformId: sp.get("platformId") || undefined,
      saleId: sp.get("saleId") || undefined,
    });
    return NextResponse.json(exposure);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
