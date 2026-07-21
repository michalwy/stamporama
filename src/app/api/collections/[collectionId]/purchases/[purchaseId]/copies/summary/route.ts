import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPurchaseIntakeSummary } from "@/lib/items";

/** Whole-purchase aggregates for the order-level intake view (#172): the per-lot cost-estimate
 * denominator and the issue groups merged across every lot. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; purchaseId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, purchaseId } = await params;
  try {
    const summary = await getPurchaseIntakeSummary(session.user.id, collectionId, purchaseId);
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
