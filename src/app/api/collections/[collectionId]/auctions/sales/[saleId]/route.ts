import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAuctionSaleDetail } from "@/lib/auctions";

// One auction sale with its own fields and its lots — the settlement / shipping view (ADR-0021 §9).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; saleId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { saleId } = await params;
  try {
    return NextResponse.json(await getAuctionSaleDetail(session.user.id, saleId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
