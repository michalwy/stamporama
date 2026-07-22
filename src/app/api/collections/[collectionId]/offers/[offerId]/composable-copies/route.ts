import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listComposableCopies } from "@/lib/offers";

// Copies eligible to add to an offer's set (ADR-0013): For sale, delivered, not sold, and not
// already in a set of this offer.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, offerId } = await params;
  const sp = request.nextUrl.searchParams;
  const search = sp.get("search") || undefined;
  const areaIds = sp.getAll("areaId");

  try {
    const items = await listComposableCopies(session.user.id, collectionId, {
      offerId,
      search,
      areaIds: areaIds.length > 0 ? areaIds : undefined,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
