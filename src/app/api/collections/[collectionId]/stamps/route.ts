import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listStampsPaginated, type StampSortBy } from "@/lib/stamps";

const VALID_SORT_BY = new Set<StampSortBy>(["issueDate", "catalogNumber", "name", "issueName"]);
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
  const issueId = sp.get("issueId") || undefined;
  const displayConditionId = sp.get("displayConditionId") || undefined;
  const yearParam = sp.get("year");
  const year =
    yearParam === "none"
      ? ("none" as const)
      : yearParam && /^\d+$/.test(yearParam)
        ? parseInt(yearParam, 10)
        : undefined;
  const sortByParam = sp.get("sortBy") as StampSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir = sortDirParam && VALID_SORT_DIR.has(sortDirParam) ? (sortDirParam as "asc" | "desc") : undefined;

  try {
    const result = await listStampsPaginated(session.user.id, collectionId, {
      offset,
      areaIds,
      search,
      catalogVendorId,
      catalogNumber,
      issueId,
      year,
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
