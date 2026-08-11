import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listWantYearFacets } from "@/lib/wants";
import { parseWantListFilters } from "../want-filters";

/** Year facets for the want list's left rail (#532), over the wanted stamps' own `issuedYear`.
 * Takes the same filters as the list and drops the year itself, so each count says how many wants
 * *that* year would leave rather than how many survive a year already picked. */
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
    const facets = await listWantYearFacets(
      session.user.id,
      collectionId,
      parseWantListFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json({ facets });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
