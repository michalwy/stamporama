import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSellableOffers } from "@/lib/sales";

// Sellable-offer picker for the record-sale dialog (ADR-0012, #166): active/paused offers with
// their still-available units, optionally scoped to one platform.
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
    const items = await listSellableOffers(session.user.id, collectionId, { platformId });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
