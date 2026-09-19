import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findOfferListingDuplicates } from "@/lib/offers";

// The live offers on this offer's platform that list the same thing it does (#1347) — same stamps,
// same conditions, read by what each is listed as. What the offer's own screen flags so a pair made
// before the collision check could see it can be found and merged. A read, never a gate.
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
    const duplicates = await findOfferListingDuplicates(session.user.id, collectionId, offerId);
    return NextResponse.json({ duplicates });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
