import { NextRequest, NextResponse } from "next/server";
import { resolveCollectionOwner } from "@/lib/route-auth";
import { DelcampeOrderError, importDelcampeOrder } from "@/lib/delcampe-order";
import type { DelcampeOrderInput, DelcampeOrderLineInput } from "@/lib/delcampe-order-rules";

// Record one Delcampe order as a sale, from the row the collector is standing on (#612).
//
// Session **or** Assistant token (`resolveCollectionOwner`), like the capture and the lookup beside
// it: the extension reaches us cross-site from delcampe.net. A write, and deliberately one the
// extension only ever *asks* for — #409's contract, kept exactly: the page reports what it printed
// and the instance decides what that means, which offers it is, and whether it can be recorded at
// all.
//
// The endpoint validates **shape** and nothing else. What `US$3.00` is worth, what day
// `Sun 22 Mar 2026 at 22:25` was, and whether an order can be recorded whole are
// `delcampe-order-rules.ts`, where they are unit-tested — a route that re-decided any of it would be
// a second answer to a question that already has one.

interface OrderLineBody {
  platformItemId?: unknown;
  title?: unknown;
  reference?: unknown;
  priceText?: unknown;
  soldAtText?: unknown;
}

interface OrderBody {
  orderId?: unknown;
  orderUrl?: unknown;
  buyerLogin?: unknown;
  buyerName?: unknown;
  totalTexts?: unknown;
  lines?: unknown;
}

/** A field the page either printed or did not. Blank reads as **not printed**, which every rule
 *  downstream already has an answer for — there is no difference here between a cell Delcampe left
 *  empty and one the reader could not find. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** How many rows one order may carry. Delcampe groups a buyer's purchases into one bill and the
 *  largest seen is a handful; the cap is here so a malformed body cannot ask for an unbounded read. */
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
    return NextResponse.json({ error: "That row states no Delcampe order number." }, { status: 400 });
  }
  const rawLines = Array.isArray(body.lines) ? (body.lines as OrderLineBody[]) : [];
  // `platformItemId` on the way in, `itemId` from here on: the wire carries the Assistant's own
  // vocabulary for a marketplace's id (as `ExtractedItem` and `CapturedLot` do), and inside the app
  // it is `itemId` — the column #611 stores it in. One rename, in the one place the two meet.
  const lines: DelcampeOrderLineInput[] = rawLines.slice(0, MAX_ORDER_LINES).flatMap((line) => {
    const itemId = text(line?.platformItemId);
    if (!itemId) return [];
    return [
      {
        itemId,
        title: text(line?.title) ?? "",
        reference: text(line?.reference),
        priceText: text(line?.priceText),
        soldAtText: text(line?.soldAtText),
      },
    ];
  });
  if (lines.length === 0) {
    return NextResponse.json({ error: "That order lists no items." }, { status: 400 });
  }

  const order: DelcampeOrderInput = {
    orderId,
    orderUrl: text(body.orderUrl) ?? "",
    buyerLogin: text(body.buyerLogin),
    buyerName: text(body.buyerName),
    totalTexts: Array.isArray(body.totalTexts)
      ? body.totalTexts.flatMap((value) => {
          const printed = text(value);
          return printed ? [printed] : [];
        })
      : [],
    lines,
  };

  try {
    return NextResponse.json(await importDelcampeOrder(ownerId, collectionId, order));
  } catch (e) {
    // A refusal is the collector's to read and act on — it names the item to go and fix, and the way
    // through is that offer's own sell flow. `409`, as the capture's domain refusals are: the request
    // was fine and the answer is that this order cannot be recorded as it stands.
    if (e instanceof DelcampeOrderError) {
      return NextResponse.json({ error: e.message, problems: e.problems }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
