import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listPreparingOffers } from "@/lib/offers";

// The collection's `preparing` offers for the Prepare screen (#1894), a page at a time: what each
// holds, its price table's figures and what still blocks Ready. `areaIds` is the area selection
// already expanded to its subtree on the client, comma-separated like the stamps list's.
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
  const areaIdsParam = sp.get("areaIds");

  try {
    const result = await listPreparingOffers(session.user.id, collectionId, {
      offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
      platformId: sp.get("platformId") || undefined,
      facebookGroupId: sp.get("groupId") || undefined,
      areaIds: areaIdsParam ? areaIdsParam.split(",").filter(Boolean) : undefined,
      noPrice: sp.get("noPrice") === "1",
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
