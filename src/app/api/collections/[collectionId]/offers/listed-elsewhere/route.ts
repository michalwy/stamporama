import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readListedElsewhere } from "@/lib/listed-elsewhere";

// The copies an offer is being made from that are already in an open offer elsewhere (#2339), each
// with a twin listed nowhere where there is one. `platformId` is the new offer's, when it is known.
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
  const itemIds = sp.getAll("itemId");
  if (itemIds.length === 0) return NextResponse.json({ copies: [] });

  try {
    const copies = await readListedElsewhere(session.user.id, collectionId, itemIds, {
      platformId: sp.get("platformId") || null,
    });
    return NextResponse.json({ copies });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
