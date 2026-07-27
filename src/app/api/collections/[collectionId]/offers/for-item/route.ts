import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listOffersForItem } from "@/lib/offers";

// Every offer referencing one copy, across all platforms and all states (#276) — the Copies list's
// read-only "View offers" popup. Unpaginated: a copy sits on a handful of listings at most. A
// static segment, so it takes precedence over `[offerId]`.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const itemId = request.nextUrl.searchParams.get("itemId");
  if (!itemId) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await listOffersForItem(session.user.id, collectionId, itemId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
