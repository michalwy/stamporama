import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { ColnectOrderError, importColnectOrder } from "@/lib/colnect-order";
import type { ColnectOrderInput, ColnectOrderLineInput } from "@/lib/colnect-order-rules";

// Record one Colnect transaction as a sale, from the screen the collector is standing on (#698).
//
// Session **or** Assistant token (`resolveCollectionOwner`), like the capture and the lookup beside
// it: the extension reaches us cross-site from colnect.com. A write, and deliberately one the
// extension only ever *asks* for — #409's contract, kept exactly: the page reports what it printed
// and the instance decides what that means, which offers those listings are, and whether the
// transaction can be recorded at all.
//
// The endpoint validates **shape** and nothing else. What `€ 0.46` is worth, what day
// `August 23, 2026 2:21 PM` was, how many copies `Item count: 1` is and whether a transaction can be
// recorded whole are `colnect-order-rules.ts`, where they are unit-tested — a route that re-decided
// any of it would be a second answer to a question that already has one.

interface OrderLineBody {
  platformItemId?: unknown;
  title?: unknown;
  priceText?: unknown;
  quantityText?: unknown;
}

interface OrderBody {
  orderId?: unknown;
  orderUrl?: unknown;
  buyerLogin?: unknown;
  buyerName?: unknown;
  soldAtText?: unknown;
  shippingMethodText?: unknown;
  totalTexts?: unknown;
  lines?: unknown;
}

/** A field the page either printed or did not. Blank reads as **not printed**, which every rule
 *  downstream already has an answer for — there is no difference here between a line Colnect left
 *  empty and one the reader could not find. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** How many rows one transaction may carry. The observed one holds fifteen; the cap is here so a
 *  malformed body cannot ask for an unbounded read. */
const MAX_ORDER_LINES = 200;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const { collectionId } = await params;
  const ownerId = await resolveCollectionOwner(request, collectionId);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as OrderBody;
  const orderId = text(body.orderId);
  if (!orderId) {
    return NextResponse.json({ error: "That screen states no Colnect transaction id." }, { status: 400 });
  }
  const rawLines = Array.isArray(body.lines) ? (body.lines as OrderLineBody[]) : [];
  // `platformItemId` on the way in, `saleCode` from here on: the wire carries the Assistant's own
  // vocabulary for a marketplace's id (as `ExtractedItem` and `CapturedLot` do), and inside the app
  // it is the sale code — the column #696 stores it in. One rename, in the one place the two meet.
  const lines: ColnectOrderLineInput[] = rawLines.slice(0, MAX_ORDER_LINES).flatMap((line) => {
    const saleCode = text(line?.platformItemId);
    if (!saleCode) return [];
    return [
      {
        saleCode,
        title: text(line?.title) ?? "",
        priceText: text(line?.priceText),
        quantityText: text(line?.quantityText),
      },
    ];
  });
  if (lines.length === 0) {
    return NextResponse.json({ error: "That transaction lists no items." }, { status: 400 });
  }

  const order: ColnectOrderInput = {
    orderId,
    orderUrl: text(body.orderUrl) ?? "",
    buyerLogin: text(body.buyerLogin),
    buyerName: text(body.buyerName),
    soldAtText: text(body.soldAtText),
    shippingMethodText: text(body.shippingMethodText),
    totalTexts: Array.isArray(body.totalTexts)
      ? body.totalTexts.flatMap((value) => {
          const printed = text(value);
          return printed ? [printed] : [];
        })
      : [],
    lines,
  };

  try {
    return NextResponse.json(await importColnectOrder(ownerId, collectionId, order));
  } catch (e) {
    // A refusal is the collector's to read and act on — it names the listing to go and fix, and the
    // way through is that offer's own screen. `409`, as the capture's domain refusals are: the
    // request was fine and the answer is that this transaction cannot be recorded as it stands.
    if (e instanceof ColnectOrderError) {
      return NextResponse.json({ error: e.message, problems: e.problems }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
