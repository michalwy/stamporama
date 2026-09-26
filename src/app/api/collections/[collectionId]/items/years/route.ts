import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemYearFacets } from "@/lib/items";
import { readYearFacetFilters } from "../item-filters";

/** The year rail's counts (#142) — the list's own filters less the year, read through the list's
 *  parser so the rail cannot lag behind a filter the list learns (#1404). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;

  try {
    const years = await listItemYearFacets(
      session.user.id,
      collectionId,
      readYearFacetFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json({ years });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
