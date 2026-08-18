import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { findSalesForDelcampeOrders } from "@/lib/delcampe-order";

// "Which of these Delcampe orders are already recorded here?" (#612) — the one question a My Sold
// Items row cannot answer about itself, asked by the Assistant while the collector is standing on
// the screen they pack from.
//
// The selling-side sibling of `…/offers/by-listing` (#466) one level up: the page states *which
// order* it is (`payment-request/<id>`) and the **instance** states whether that order is a sale
// here. Session **or** Assistant token (`resolveCollectionOwner`), because the extension reaches us
// cross-site from delcampe.net; a static segment ahead of `[saleId]`, as `platforms` and `lines` are.
//
// It takes **many** ids in one call (`?orderId=…&orderId=…`): a phase screen is a list of orders, and
// asking per row would be a request per row.
//
// Read-only, and a miss is an **absent row** rather than an error. An order that is not recorded yet
// is the ordinary case — it is the one the *Import* affordance exists for.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orderIds = request.nextUrl.searchParams
    .getAll("orderId")
    .map((id) => id.trim())
    .filter(Boolean);
  if (orderIds.length === 0) {
    return NextResponse.json({ error: "No order ids given." }, { status: 400 });
  }

  try {
    const matches = await findSalesForDelcampeOrders(ownerId, collectionId, orderIds);
    return NextResponse.json({ matches });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
