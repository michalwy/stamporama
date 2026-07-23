import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemYearFacets } from "@/lib/items";

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

  try {
    const years = await listItemYearFacets(session.user.id, collectionId, {
      conditionId: sp.get("conditionId") || undefined,
      certificateStatusId: sp.get("certificateStatusId") || undefined,
      areaIds: areaIdsParam ? areaIdsParam.split(",") : undefined,
      search: sp.get("search") || undefined,
      catalogVendorId: sp.get("catalogVendorId") || undefined,
      catalogNumber: sp.get("catalogNumber") || undefined,
      stampId: sp.get("stampId") || undefined,
      issueId: sp.get("issueId") || undefined,
      locationId: sp.get("locationId") || undefined,
      inCollection: boolParam(sp.get("inCollection")),
      forSale: boolParam(sp.get("forSale")),
      forTrade: boolParam(sp.get("forTrade")),
      noPhotos: boolParam(sp.get("noPhotos")),
      missingCatalogValue: boolParam(sp.get("missingCatalogValue")),
    });
    return NextResponse.json({ years });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** Only an explicit "true" narrows to that disposition; mirrors the list endpoint. */
function boolParam(value: string | null): boolean | undefined {
  return value === "true" ? true : undefined;
}
