import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getHoldingsValuation } from "@/lib/items";
import { readItemFilters } from "../item-filters";

/** Holdings valuation total over every copy matching the current filters (whole set, not one
 * page). The filters are read by the list routes' own parser, so the Copies screen's total values
 * exactly the copies it shows — it read its own subset once and lost the tag filter and the
 * location switch the list applies, so a tagged list stated the value of every tag's copies
 * (#1402, whose structure screen links each value to the list). */
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
    const total = await getHoldingsValuation(
      session.user.id,
      collectionId,
      readItemFilters(request.nextUrl.searchParams)
    );
    return NextResponse.json(total);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
