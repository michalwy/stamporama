import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAuctionLotComposition } from "@/lib/auctions";

// What one lot contains, valued (#353). Unpaginated: a lot's composition is what fits in one
// auction lot, and the editor shows every line at once because the total is the point of the screen.
//
// `collectionId` is in the path for consistency with the rest of the auction routes; the lot itself
// is what authorizes the read, resolved against the owner in `getAuctionLotComposition`.
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
    return NextResponse.json(await getAuctionLotComposition(session.user.id, lotId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
