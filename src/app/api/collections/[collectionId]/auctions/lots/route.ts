import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listAuctionLots } from "@/lib/auctions";
import { isAuctionLotOutcome } from "@/lib/auction-rules";
import type { AuctionClosingWindow } from "@/lib/auctions";
import { LOT_SIGNALS, type LotSignal } from "@/lib/auction-lot";

/** A derived-state filter (`bid-possible`, `outbid`, …), ignored when it says anything else. */
function lotSignal(raw: string | null): LotSignal | undefined {
  return LOT_SIGNALS.includes(raw as LotSignal) ? (raw as LotSignal) : undefined;
}

/** `closing=ended|today|week`, ignored when it says anything else. */
function closingWindow(raw: string | null): AuctionClosingWindow | undefined {
  return raw === "ended" || raw === "today" || raw === "week" ? raw : undefined;
}

// The flat list of auction lots across all sales — the primary auction screen (ADR-0021 §9).
// Filters by outcome status, seller, platform, or a single sale.
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
  const offsetParam = sp.get("offset");
  const outcomeParam = sp.get("outcome");

  try {
    const result = await listAuctionLots(session.user.id, collectionId, {
      offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
      outcome: outcomeParam && isAuctionLotOutcome(outcomeParam) ? outcomeParam : undefined,
      closing: closingWindow(sp.get("closing")),
      signal: lotSignal(sp.get("signal")),
      undescribed: sp.get("undescribed") === "1" || undefined,
      sellerId: sp.get("sellerId") || undefined,
      platformId: sp.get("platformId") || undefined,
      saleId: sp.get("saleId") || undefined,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
