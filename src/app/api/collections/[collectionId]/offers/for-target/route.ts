import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listOffersForTarget, type OfferLookupTarget } from "@/lib/offers";

// Every offer referencing a copy of one target — a copy, a stamp, or an issue (#276, #349) — across
// all platforms and all states, for the read-only "View offers" popup. Unpaginated: a target sits on
// a handful of listings at most. A static segment, so it takes precedence over `[offerId]`.
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
  const itemId = sp.get("itemId");
  const stampId = sp.get("stampId");
  const issueId = sp.get("issueId");

  // Exactly one target, narrowest first. No target at all is answered as "nothing to show" rather
  // than as an error — the popup is a read.
  const target: OfferLookupTarget | null = itemId
    ? { kind: "item", itemId }
    : stampId
      ? { kind: "stamp", stampId }
      : issueId
        ? { kind: "issue", issueId }
        : null;
  if (!target) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await listOffersForTarget(session.user.id, collectionId, target);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
