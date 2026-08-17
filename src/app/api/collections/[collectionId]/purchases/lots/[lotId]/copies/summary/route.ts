import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLotIntakeSummary } from "@/lib/items";
import { parseDispositionFilter, parseLotCopyFilter } from "@/lib/intake-filter-params";

/** Whole-lot aggregates for the paginated intake view (#172): header counts, the live
 * cost-estimate denominator, the derived label, and the issue-group headers.
 *
 * Takes the list's own filters (#622/#623): the groups are the one part of the view that is not
 * paged, so they are counted here, and a summary blind to the filters would draw a heading over
 * every group the filter emptied. The header chip counts stay whole-lot. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; lotId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, lotId } = await params;
  const sp = request.nextUrl.searchParams;
  try {
    const summary = await getLotIntakeSummary(session.user.id, collectionId, lotId, {
      filter: parseLotCopyFilter(sp.get("filter")),
      disposition: parseDispositionFilter(sp.get("disposition")),
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
