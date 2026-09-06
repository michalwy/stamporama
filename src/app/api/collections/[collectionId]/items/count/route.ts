import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { countItems } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/**
 * How many copies match the current filters — the whole set, not one page (#845). Reads the filters
 * through the same {@link readItemFilters} the list endpoint uses, so the figure the summary bar
 * states and the rows under it can never be counting different things.
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

  try {
    const count = await countItems(
      session.user.id,
      collectionId,
      readItemFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
