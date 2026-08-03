import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAllegroOrderSalePrefill, AllegroSaleError } from "@/lib/allegro-sale";

// What a `Sale` created from one synced Allegro order would be (#463) — everything the worklist's
// **Record sale from order** flow opens on.
//
// Its own request rather than part of the worklist, exactly like the link-candidate picker beside
// it (#479): it re-reads the order from Allegro and expands the matched offers into their sellable
// sets, which is real work to do thirty times over for a page of cards nobody has clicked.
//
// It **writes nothing**. Recording the sale is a second, explicit act.
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
    return NextResponse.json(
      await getAllegroOrderSalePrefill(session.user.id, collectionId, orderId)
    );
  } catch (err) {
    // The domain layer's own sentence where it has one — "that order is not in this collection"
    // tells the collector something, and a bare 404 does not.
    if (err instanceof AllegroSaleError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
