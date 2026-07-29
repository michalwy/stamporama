import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listComposeTargets } from "@/lib/offers";

// Offer picker for the inventory "Add to offer" action (#188): the collection's non-terminal
// offers (preparing / active / paused) with their sets, plus the enriched copies each set holds.
// Repeated `itemId` params name the copies being added; the sets/offers already holding any of
// them report which, so the picker can disable a destination with nothing left to gain (#372/#373).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const itemIds = request.nextUrl.searchParams.getAll("itemId").filter(Boolean);

  try {
    const targets = await listComposeTargets(session.user.id, collectionId, itemIds);
    return NextResponse.json(targets);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
