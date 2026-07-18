import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssuesPaginated, type IssueSortBy } from "@/lib/issues";

const VALID_SORT_BY = new Set<IssueSortBy>(["year", "name", "catalogNumber"]);
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
  const areaIdsParam = sp.get("areaIds");
  const areaIds = areaIdsParam ? areaIdsParam.split(",") : undefined;
  const search = sp.get("search") || undefined;
  const catalogVendorId = sp.get("catalogVendorId") || undefined;
  const catalogNumber = sp.get("catalogNumber") || undefined;
  const displayConditionId = sp.get("displayConditionId") || undefined;
  const sortByParam = sp.get("sortBy") as IssueSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir = sortDirParam && VALID_SORT_DIR.has(sortDirParam) ? (sortDirParam as "asc" | "desc") : undefined;

  try {
    const result = await listIssuesPaginated(session.user.id, collectionId, {
      offset,
      areaIds,
      search,
      catalogVendorId,
      catalogNumber,
      displayConditionId,
      sortBy,
      sortDir,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
