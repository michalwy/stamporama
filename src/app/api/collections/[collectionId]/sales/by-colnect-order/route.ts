import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { findSalesForColnectOrders } from "@/lib/colnect-order";

// "Which of these Colnect transactions are already recorded here?" (#698) — the one question a
// transaction screen cannot answer about itself, asked by the Assistant while the collector is
// standing on the screen they pack from.
//
// The Delcampe lookup's twin (`by-delcampe-order`, #612) and #466's split once more: the page states
// *which transaction* it is (`transaction/show/id/<id>`) and the **instance** states whether that
// transaction is a sale here. A separate address rather than a field on that one because the two are
// matched against different platforms — an id means nothing without the site that issued it — and
// because the extension addresses each marketplace's endpoint from its own module id.
//
// Session **or** Assistant token (`resolveCollectionOwner`), the extension reaching us cross-site
// from colnect.com; a static segment ahead of `[saleId]`, as `platforms` and `lines` are.
//
// It takes **many** ids in one call (`?orderId=…&orderId=…`): the transaction list is a list, and
// asking per row would be a request per row.
//
// Read-only, and a miss is an **absent row** rather than an error. A transaction that is not
// recorded yet is the ordinary case — it is the one the *Import* affordance exists for.
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
    return NextResponse.json({ error: "No transaction ids given." }, { status: 400 });
  }

  try {
    const matches = await findSalesForColnectOrders(ownerId, collectionId, orderIds);
    return NextResponse.json({ matches });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
