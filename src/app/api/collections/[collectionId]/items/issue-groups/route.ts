import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemIssueGroups } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/**
 * The Copies list collapsed to one row per issue (#424). A static segment ahead of `[itemId]`,
 * beside the duplicate (#372) and filing (#421) groups, and taking the same filter set: the same
 * copies, grouped by the series they belong to rather than by what they are or where they sit.
 */
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

  try {
    const result = await listItemIssueGroups(session.user.id, collectionId, {
      ...readItemFilters(sp),
      offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
