import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listStockCopiesForSale } from "@/lib/sales";

// The copies in stock a set on no offer can be picked from (#2021) — in hand, unsold, not traded
// away or disposed of. Scoped by area here; the picker filters the rest client-side, as the trade
// picker's `offerable-copies` does.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const areaIds = request.nextUrl.searchParams.getAll("areaId");

  try {
    const items = await listStockCopiesForSale(session.user.id, collectionId, {
      areaIds: areaIds.length > 0 ? areaIds : null,
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
