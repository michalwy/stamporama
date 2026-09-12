import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listStampYearFacets } from "@/lib/stamps";
import { stampAttributeFiltersFromParams } from "@/lib/stamp-attribute-kinds";
import { tagFilterFromParams } from "@/lib/tag-filter";

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
  const areaIdsParam = sp.get("areaIds");
  const areaIds = areaIdsParam ? areaIdsParam.split(",") : undefined;
  const search = sp.get("search") || undefined;
  const catalogVendorId = sp.get("catalogVendorId") || undefined;
  const catalogNumber = sp.get("catalogNumber") || undefined;
  const issueId = sp.get("issueId") || undefined;

  try {
    const years = await listStampYearFacets(session.user.id, collectionId, {
      areaIds,
      search,
      catalogVendorId,
      catalogNumber,
      issueId,
      // The attribute filters narrow the year counts too (#737): they are filters, not display
      // axes like the condition and format switchers, so the counts have to answer for them.
      ...stampAttributeFiltersFromParams(sp),
      // The collector's own labels (#1182) — a filter like any other, so the list and both
      // facet rails narrow by it and their counts answer for it.
      ...tagFilterFromParams(sp),
    });
    return NextResponse.json({ years });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
