import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  COLNECT_REPORT_PAGE_SIZE,
  getColnectReportCountries,
  getColnectReportCounts,
  listColnectReportRows,
  type ColnectReportFilters,
} from "@/lib/colnect-list-report";
import { isColnectListBucket } from "@/lib/colnect-list-sync-rules";

// One page of the Colnect discrepancy report (#686), and the two facets beside it.
//
// The report is tens of thousands of rows on a Wish list, so every filter is a `WHERE` on the
// server and the screen scrolls it — the rule every large list in this app follows. The counts and
// the countries ride on the same request rather than on two more: the screen draws all three at
// once, and asking them separately would run the same comparison three times over 25,000 rows.

/** The report's filters off the query string. Unknown bucket names are dropped rather than
 *  refused — a stale tab asking for a bucket this build no longer has should show the report, not
 *  an error. */
function parseFilters(params: URLSearchParams): ColnectReportFilters {
  const buckets = (params.get("buckets") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => isColnectListBucket(value));
  const countries = (params.get("countries") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return {
    buckets: buckets.length ? buckets : undefined,
    countries: countries.length ? countries : undefined,
    includeHidden: params.get("includeHidden") === "1",
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { collectionId } = await params;
  const search = request.nextUrl.searchParams;
  const lt = Number(search.get("lt"));
  if (!Number.isFinite(lt)) {
    return NextResponse.json({ error: "Which list?" }, { status: 400 });
  }
  const offset = Math.max(0, Number(search.get("offset") ?? 0) || 0);
  const filters = parseFilters(search);

  try {
    const [page, counts, countries] = await Promise.all([
      listColnectReportRows(
        session.user.id,
        collectionId,
        lt,
        filters,
        offset,
        COLNECT_REPORT_PAGE_SIZE
      ),
      getColnectReportCounts(session.user.id, collectionId, lt, filters),
      getColnectReportCountries(session.user.id, collectionId, lt, filters),
    ]);
    return NextResponse.json({ ...page, counts, countries });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
