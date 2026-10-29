import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readYearFilter } from "@/lib/list-area-year-filter";
import { listIssuesPaginated, type IssueSortBy } from "@/lib/issues";
import { tagFilterFromParams } from "@/lib/tag-filter";
import { readSearchParam } from "@/lib/text-input";
import { parseSearchFields, SEARCH_FIELDS_PARAM } from "@/lib/search-fields";
import { ISSUE_SEARCH_FIELD_KEYS } from "@/lib/issue-search-fields";
import { readIncludeSpecialised } from "@/lib/specialised-checklists-preference";

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
  const search = readSearchParam(sp);
  const searchCatalogVendorId = sp.get("searchCatalogVendorId") || undefined;
  const searchCatalogNumber = sp.get("searchCatalogNumber") || undefined;
  // The fields the search box was narrowed to beside it (#2239); absent is every field.
  const searchFields = parseSearchFields(sp.get(SEARCH_FIELDS_PARAM), ISSUE_SEARCH_FIELD_KEYS);
  const catalogVendorId = sp.get("catalogVendorId") || undefined;
  const catalogNumber = sp.get("catalogNumber") || undefined;
  const displayConditionId = sp.get("displayConditionId") || undefined;
  const displayFormatId = sp.get("displayFormatId") || undefined;
  const sortByParam = sp.get("sortBy") as IssueSortBy | null;
  const sortBy = sortByParam && VALID_SORT_BY.has(sortByParam) ? sortByParam : undefined;
  const sortDirParam = sp.get("sortDir");
  const sortDir = sortDirParam && VALID_SORT_DIR.has(sortDirParam) ? (sortDirParam as "asc" | "desc") : undefined;

  try {
    const result = await listIssuesPaginated(session.user.id, collectionId, {
      offset,
      areaIds,
      search,
      searchCatalogVendorId,
      searchCatalogNumber,
      searchFields,
      catalogVendorId,
      catalogNumber,
      // The collector's own labels (#1182) — a filter like any other, so the list and both
      // facet rails narrow by it and their counts answer for it.
      ...tagFilterFromParams(sp),
      // One year, No year, or a span of them (#2258) — the one parser every list route reads it with.
      ...readYearFilter(sp.get("year")),
      displayConditionId,
      displayFormatId,
      sortBy,
      sortDir,
      pageSize: 50,
      includeSpecialised: await readIncludeSpecialised(collectionId),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
