import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getLotIntakePage,
  type LotCopySort,
  type LotCopyFilter,
} from "@/lib/items";

const VALID_SORT = new Set<LotCopySort>(["added", "year", "catalog", "price", "name"]);
const VALID_FILTER = new Set<LotCopyFilter>(["none", "unpriced", "to-sort"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

/** One page of a lot's copies for the paginated intake view (#172). Ordered/filtered
 * server-side so scrolling never silently drops copies past a 1000-item cap. */
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

  const offsetParam = sp.get("offset");
  const offset = offsetParam && /^\d+$/.test(offsetParam) ? parseInt(offsetParam, 10) : undefined;
  const sortParam = sp.get("sort") as LotCopySort | null;
  const sort = sortParam && VALID_SORT.has(sortParam) ? sortParam : undefined;
  const filterParam = sp.get("filter") as LotCopyFilter | null;
  const filter = filterParam && VALID_FILTER.has(filterParam) ? filterParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir =
    sortDirParam && VALID_SORT_DIR.has(sortDirParam)
      ? (sortDirParam as "asc" | "desc")
      : undefined;
  const issueKey = sp.get("issueKey") || undefined;

  try {
    const result = await getLotIntakePage(session.user.id, collectionId, lotId, {
      sort,
      sortDir,
      filter,
      issueKey,
      offset,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
