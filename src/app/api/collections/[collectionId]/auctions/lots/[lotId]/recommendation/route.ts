import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAuctionLotBidEvidence } from "@/lib/bid-recommendations";

// Why a lot is worth what the recommendation says (#511; ADR-0029 §8) — one row per composition
// line with what anchored it, the evidence behind that, and the ownership counts.
//
// Read **only while the popover is open**, on the rule the composition editor already follows
// (#353): the three figures themselves ride on the lot list, but a forty-lot watchlist must not
// pull forty lots' worth of market evidence to draw forty collapsed rows.
//
// Computed on demand and stored nowhere (ADR-0029 §10). `collectionId` is in the path for
// consistency with the rest of the auction routes; the lot itself is what authorizes the read.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lotId } = await params;
  try {
    return NextResponse.json(await getAuctionLotBidEvidence(session.user.id, lotId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
