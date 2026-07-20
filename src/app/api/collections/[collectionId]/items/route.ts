import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemsPaginated, type ItemSortBy } from "@/lib/items";

const VALID_SORT_BY = new Set<ItemSortBy>(["created"]);
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
  const conditionId = sp.get("conditionId") || undefined;
  const certificateStatusId = sp.get("certificateStatusId") || undefined;
  const areaIdsParam = sp.get("areaIds");
  const areaIds = areaIdsParam ? areaIdsParam.split(",") : undefined;
  const search = sp.get("search") || undefined;
  const stampId = sp.get("stampId") || undefined;
  const issueId = sp.get("issueId") || undefined;
  const locationId = sp.get("locationId") || undefined;
  const inCollection = boolParam(sp.get("inCollection"));
  const forSale = boolParam(sp.get("forSale"));
  const forTrade = boolParam(sp.get("forTrade"));
  const sortByParam = sp.get("sortBy") as ItemSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir =
    sortDirParam && VALID_SORT_DIR.has(sortDirParam)
      ? (sortDirParam as "asc" | "desc")
      : undefined;

  try {
    const result = await listItemsPaginated(session.user.id, collectionId, {
      offset,
      conditionId,
      certificateStatusId,
      areaIds,
      search,
      stampId,
      issueId,
      locationId,
      inCollection,
      forSale,
      forTrade,
      sortBy,
      sortDir,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** Only an explicit "true" narrows to that disposition; absence / any other value
 * means the filter is off (show all), matching the default "show all copies". */
function boolParam(value: string | null): boolean | undefined {
  return value === "true" ? true : undefined;
}
