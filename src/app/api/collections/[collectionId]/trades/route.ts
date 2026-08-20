import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listTradesPaginated, type TradeSortBy } from "@/lib/trades";
import { isTradeStatus } from "@/lib/trade-rules";
import { parseEntityNoSearch } from "@/lib/quick-jump";

const VALID_SORT_BY = new Set<TradeSortBy>(["createdAt", "tradeNo"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const sp = request.nextUrl.searchParams;

  const offsetParam = sp.get("offset");
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;
  const statusParam = sp.get("status");
  const status = statusParam && isTradeStatus(statusParam) ? statusParam : undefined;
  const partnerId = sp.get("partnerId") || undefined;
  // One box, two meanings, resolved here rather than by two fields on the toolbar: `#7` (or a bare
  // `7`) is the trade number the quick jump sends, anything else is the partner's name. The number
  // match is *instead of* the name match, not in addition to it — a partner called "7" is not a
  // thing, and the quick jump has to land on exactly one row.
  const search = (sp.get("search") ?? "").trim();
  const tradeNo = search ? (parseEntityNoSearch(search) ?? undefined) : undefined;
  const partnerSearch = search && tradeNo === undefined ? search : undefined;
  const sortByParam = sp.get("sortBy") as TradeSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir =
    sortDirParam && VALID_SORT_DIR.has(sortDirParam)
      ? (sortDirParam as "asc" | "desc")
      : undefined;

  try {
    const result = await listTradesPaginated(session.user.id, collectionId, {
      offset,
      status,
      partnerId,
      tradeNo,
      partnerSearch,
      sortBy,
      sortDir,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
