import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readOfferSpecificationShareState } from "@/lib/offer-specification-share";

// The offer's specification link (#1760) as the collector's dialog reads it: the address, when it
// was made, when a buyer last opened it and whether it still shows what it was made from — `link` is
// `null` when the offer has none — and the offer's language, which the buyer's page speaks.
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
    return NextResponse.json(
      await readOfferSpecificationShareState(session.user.id, offerId, collectionId)
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
