import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPurchaseIntakeSummary } from "@/lib/items";
import { parseDispositionFilter, parseLotCopyFilter } from "@/lib/intake-filter-params";

/** Whole-purchase aggregates for the order-level intake view (#172): the per-lot cost-estimate
 * denominator and the issue groups merged across every lot — the groups over the copies the list's
 * filters show (#622/#623), the denominator over the whole lot whatever is filtered. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, purchaseId } = await params;
  const sp = request.nextUrl.searchParams;
  try {
    const summary = await getPurchaseIntakeSummary(session.user.id, collectionId, purchaseId, {
      filter: parseLotCopyFilter(sp.get("filter")),
      disposition: parseDispositionFilter(sp.get("disposition")),
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
