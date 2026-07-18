import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listAllIssues } from "@/lib/issues";

/** Full issues (with embedded stamp members + catalog numbers) for the inventory
 * stamp-picker popup browser (#104). `areaIds` (comma-separated) scopes to a set of
 * areas — the caller passes a selected area together with its descendants so a parent
 * selection includes child areas. Omitted ("All areas") returns every issue. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;
  const areaIdsParam = request.nextUrl.searchParams.get("areaIds");
  const areaIds = areaIdsParam ? areaIdsParam.split(",").filter(Boolean) : undefined;

  try {
    const items = await listAllIssues(session.user.id, collectionId, areaIds);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
