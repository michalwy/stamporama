import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { auctionLotFilterCounts } from "@/lib/auctions";
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

// Faceted counts for the lot list's filter controls (#332): every count ignores its own dimension
// and respects the rest, so a badge says how many lots clicking it would show. Same params as the
// list route.
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
    const counts = await auctionLotFilterCounts(session.user.id, collectionId, {
      outcome: outcomeParam && isAuctionLotOutcome(outcomeParam) ? outcomeParam : undefined,
      closing: closingWindow(sp.get("closing")),
      signal: lotSignal(sp.get("signal")),
      undescribed: sp.get("undescribed") === "1" || undefined,
      duplicate: sp.get("duplicate") === "1" || undefined,
      sellerId: sp.get("sellerId") || undefined,
      platformId: sp.get("platformId") || undefined,
      saleId: sp.get("saleId") || undefined,
    });
    return NextResponse.json(counts);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
