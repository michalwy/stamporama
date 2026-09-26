import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemAreaFacets } from "@/lib/items";
import { readAreaFacetFilters } from "../item-filters";

/** The area rail's counts (#843) — the mirror of `../years`: the list's own filters, except that
 *  this one keeps `year` and drops the area selection, so each row says what selecting it would
 *  list. Both rails read the list's parser, so a filter the list learns reaches them too (#1404). */
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
    const areas = await listItemAreaFacets(
      session.user.id,
      collectionId,
      readAreaFacetFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json({ areas });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
