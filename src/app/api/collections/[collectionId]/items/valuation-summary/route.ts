import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getHoldingsValuation } from "@/lib/items";

/** Holdings valuation total over every copy matching the current filters (whole set,
 * not one page). Mirrors the list endpoint's disposition/condition/certificate filters
 * so the Copies screen total tracks what is being shown. */
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

  try {
    const total = await getHoldingsValuation(session.user.id, collectionId, {
      conditionId: sp.get("conditionId") || undefined,
      certificateStatusId: sp.get("certificateStatusId") || undefined,
      inCollection: boolParam(sp.get("inCollection")),
      forSale: boolParam(sp.get("forSale")),
      forTrade: boolParam(sp.get("forTrade")),
    });
    return NextResponse.json(total);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** Only an explicit "true" narrows to that disposition; absence / any other value
 * means the filter is off (show all), matching the list endpoint. */
function boolParam(value: string | null): boolean | undefined {
  return value === "true" ? true : undefined;
}
