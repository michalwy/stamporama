import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { withCompletenessSwitch } from "@/lib/specialised-checklists-preference";
import { listSelectableItemIds } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/**
 * Every copy matching the Copies list's filters that its select-all would tick (#2538), as ids —
 * the count the selection bar names when it offers to extend a select-all past what is loaded, and
 * the set taking that offer selects. Reads the filters through the same {@link readItemFilters}
 * the list does, so the offer and the rows can never be about different copies. `duplicates=true`
 * with the `groupBy*` axes applies the duplicate grouping's outlier rule (#398).
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
  const axes =
    sp.get("duplicates") === "true"
      ? {
          condition: sp.get("groupByCondition") === "true",
          format: sp.get("groupByFormat") === "true",
          certificate: sp.get("groupByCertificate") === "true",
        }
      : null;

  try {
    const ids = await listSelectableItemIds(
      session.user.id,
      collectionId,
      await withCompletenessSwitch(collectionId, readItemFilters(sp)),
      axes
    );
    return NextResponse.json({ ids });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
