import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { withCompletenessSwitch } from "@/lib/specialised-checklists-preference";
import { countItemsByHoldingState } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/**
 * How many copies the filters hold in each holding state — held, sold & traded, written off — for
 * the state chips of a stamp's and an issue's Copies card (#2281). Reads the filters through the
 * same {@link readItemFilters} the list endpoint uses, so a chip's count and the rows it brings into
 * view are counting the same copies.
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
    const counts = await countItemsByHoldingState(
      session.user.id,
      collectionId,
      await withCompletenessSwitch(collectionId, readItemFilters(request.nextUrl.searchParams))
    );
    return NextResponse.json({ counts });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
