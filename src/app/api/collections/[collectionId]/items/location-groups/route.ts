import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemLocationGroups } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/**
 * The Copies list collapsed to one row per storage location, or per `(location, ref)` pair (#421).
 * A static segment ahead of `[itemId]`, beside the duplicate groups (#372), and taking the same
 * filter set: the same copies, grouped by where they are filed rather than by what they are.
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
    const result = await listItemLocationGroups(session.user.id, collectionId, {
      ...readItemFilters(sp),
      // Anything but the explicit ref mode groups by location alone, so a stale link falls back to
      // the coarser reading rather than to an empty screen.
      by: sp.get("by") === "ref" ? "ref" : "location",
      offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
