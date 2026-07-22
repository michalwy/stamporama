import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSaleLineCopies } from "@/lib/sales";

// The physical copies that left on one sale line, enriched for the packing view (ADR-0012, #166).
// Loaded lazily per sold unit so a large sale never enriches every copy up front.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lineId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lineId } = await params;
  try {
    const items = await listSaleLineCopies(session.user.id, lineId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
