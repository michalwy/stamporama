import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssueYearFacets } from "@/lib/issues";
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
  const searchCatalogVendorId = sp.get("searchCatalogVendorId") || undefined;
  const searchCatalogNumber = sp.get("searchCatalogNumber") || undefined;
  const catalogVendorId = sp.get("catalogVendorId") || undefined;
  const catalogNumber = sp.get("catalogNumber") || undefined;

  try {
    const years = await listIssueYearFacets(session.user.id, collectionId, {
      areaIds,
      search,
      searchCatalogVendorId,
      searchCatalogNumber,
      catalogVendorId,
      catalogNumber,
      // The collector's own labels (#1182) — a filter like any other, so the list and both
      // facet rails narrow by it and their counts answer for it.
      ...tagFilterFromParams(sp),
    });
    return NextResponse.json({ years });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
