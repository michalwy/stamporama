import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listWantIssueGroups } from "@/lib/wants";
import { parseWantListFilters } from "../want-filters";

/** The want list as one row per series (#532). Grouped on the server for the reason inventory's
 * issue groups are (#424): the list is offset-paginated, and grouping in the browser would split a
 * group at a page boundary and report two half-counts. */
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
    const result = await listWantIssueGroups(
      session.user.id,
      collectionId,
      parseWantListFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
