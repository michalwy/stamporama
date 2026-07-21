import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getPurchaseIntakePage,
  type LotCopySort,
  type LotCopyFilter,
} from "@/lib/items";

const VALID_SORT = new Set<LotCopySort>(["added", "year", "catalog", "price", "name"]);
const VALID_FILTER = new Set<LotCopyFilter>(["none", "unpriced", "to-sort", "no-photos"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

/** One page of a whole purchase's copies (across all lots) for the order-level intake view with
 * "By lot" grouping off — a single globally-ordered flat/by-issue stream (#172). */
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
    const result = await getPurchaseIntakePage(session.user.id, collectionId, purchaseId, {
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
