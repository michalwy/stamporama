import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readYearFilter } from "@/lib/list-area-year-filter";
import { listStampAreaFacets } from "@/lib/stamps";
import { stampAttributeFiltersFromParams } from "@/lib/stamp-attribute-kinds";
import { tagFilterFromParams } from "@/lib/tag-filter";
import { readSearchParam } from "@/lib/text-input";
import { parseSearchFields, SEARCH_FIELDS_PARAM } from "@/lib/search-fields";
import { STAMP_SEARCH_FIELD_KEYS } from "@/lib/stamp-search-fields";

/** The area rail's counts (#843) — the mirror of `../years`: same filters, except that this one
 *  keeps `year` and drops the area selection, so each row says what selecting it would list. */
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
  const search = readSearchParam(sp);
  // The fields the search box was narrowed to beside it (#2240); absent is every field.
  const searchFields = parseSearchFields(sp.get(SEARCH_FIELDS_PARAM), STAMP_SEARCH_FIELD_KEYS);
  const catalogVendorId = sp.get("catalogVendorId") || undefined;
  const catalogNumber = sp.get("catalogNumber") || undefined;
  const issueId = sp.get("issueId") || undefined;

  try {
    const areas = await listStampAreaFacets(session.user.id, collectionId, {
      search,
      searchFields,
      catalogVendorId,
      catalogNumber,
      issueId,
      // One year, No year, or a span of them (#2258) — the one parser every list route reads it with.
      ...readYearFilter(sp.get("year")),
      // The attribute filters narrow these counts too (#737), for the same reason they narrow the
      // year ones: they are filters, not display axes.
      ...stampAttributeFiltersFromParams(sp),
      // The collector's own labels (#1182) — a filter like any other, so the list and both
      // facet rails narrow by it and their counts answer for it.
      ...tagFilterFromParams(sp),
    });
    return NextResponse.json({ areas });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
