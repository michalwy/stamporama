import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSellableCopies } from "@/lib/sales";

// Enriched copies across a platform's sellable offers, for the add-sold-sets picker's expandable
// set details (ADR-0013).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const platformId = request.nextUrl.searchParams.get("platformId") || undefined;

  try {
    const items = await listSellableCopies(session.user.id, collectionId, { platformId });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
