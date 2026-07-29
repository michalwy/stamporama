import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listItemDuplicateGroups } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/**
 * The Copies list collapsed to one row per duplicate key (#372). A static segment ahead of
 * `[itemId]`, like the offers list's own sub-routes. Takes the flat list's whole filter set — the
 * same copies, grouped — plus which optional axes join the key.
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
    const result = await listItemDuplicateGroups(session.user.id, collectionId, {
      ...readItemFilters(sp),
      axes: {
        format: sp.get("groupByFormat") === "true",
        certificate: sp.get("groupByCertificate") === "true",
      },
      offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
      pageSize: 50,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
