import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listIssueAreaFacets } from "@/lib/issues";
import { tagFilterFromParams } from "@/lib/tag-filter";

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
  const search = sp.get("search") || undefined;
  const searchCatalogVendorId = sp.get("searchCatalogVendorId") || undefined;
  const searchCatalogNumber = sp.get("searchCatalogNumber") || undefined;
  const catalogVendorId = sp.get("catalogVendorId") || undefined;
  const catalogNumber = sp.get("catalogNumber") || undefined;
  const yearParam = sp.get("year");
  const year =
    yearParam === null || yearParam === ""
      ? undefined
      : yearParam === "none"
        ? ("none" as const)
        : Number.isFinite(Number(yearParam))
          ? Number(yearParam)
          : undefined;

  try {
    const areas = await listIssueAreaFacets(session.user.id, collectionId, {
      search,
      searchCatalogVendorId,
      searchCatalogNumber,
      catalogVendorId,
      catalogNumber,
      year,
      // The collector's own labels (#1182) — a filter like any other, so the list and both
      // facet rails narrow by it and their counts answer for it.
      ...tagFilterFromParams(sp),
    });
    return NextResponse.json({ areas });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
