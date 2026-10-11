import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readOfferSpecificationShareLink } from "@/lib/offer-specification-share";

// The offer's specification link (#1760) as the collector's dialog reads it: the address, when it
// was made and when a buyer last opened it — or `null` when the offer has none.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, offerId } = await params;
  try {
    const link = await readOfferSpecificationShareLink(session.user.id, offerId, collectionId);
    return NextResponse.json({ link });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
