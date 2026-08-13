import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getStampHoldings } from "@/lib/stamp-holdings";

// What the collection already holds of one stamp, and what it is still after (#562) — read by the
// purchase-lot intake dialog the moment a stamp is picked, so the keep-or-sell call is taken there
// rather than in Inventory and back.
//
// **One stamp**, named by `stampId`: this answers a question about the stamp just identified, and
// the page-shaped counts every catalogue list already loads (`loadStampCopyCounts`) are the other
// reader. No stamp named is answered as "nothing to show" rather than as an error, as
// `market-value` beside it does — this is a read.
//
// A static segment, so it takes precedence over the dynamic stamp routes beside it.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const stampId = request.nextUrl.searchParams.get("stampId");
  if (!stampId) {
    return NextResponse.json({ holdings: null });
  }

  try {
    const holdings = await getStampHoldings(session.user.id, collectionId, stampId);
    return NextResponse.json({ holdings });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
