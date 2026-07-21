import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLotIntakeSummary } from "@/lib/items";

/** Whole-lot aggregates for the paginated intake view (#172): header counts, the live
 * cost-estimate denominator, the derived label, and the issue-group headers. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, lotId } = await params;
  try {
    const summary = await getLotIntakeSummary(session.user.id, collectionId, lotId);
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
