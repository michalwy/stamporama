import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listWantAreaFacets } from "@/lib/wants";
import { parseWantListFilters } from "../want-filters";

/** Area facets for the want list's left rail (#843) — the mirror of `../years`. Same filters as the
 * list, keeping the year and dropping the area selection (the domain layer does that), so each
 * count says how many wants *that* area would leave. */
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
    const facets = await listWantAreaFacets(
      session.user.id,
      collectionId,
      parseWantListFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json({ facets });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
