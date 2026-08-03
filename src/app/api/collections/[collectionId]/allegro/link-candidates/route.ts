import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listSalesLinkableToAllegroOrder } from "@/lib/allegro-worklist";

// Sales that could be one synced Allegro order (#479) — what the worklist's **Link to existing
// sale** picker offers.
//
// Fetched when the picker opens rather than with the worklist itself: a batch of thirty orders would
// otherwise carry thirty candidate lists nobody has asked for, and the question is only interesting
// for the one order the collector is looking at.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "An order is required." }, { status: 400 });
  }

  try {
    const items = await listSalesLinkableToAllegroOrder(session.user.id, collectionId, orderId);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
