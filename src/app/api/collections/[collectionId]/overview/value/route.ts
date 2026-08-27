import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getOverviewValue } from "@/lib/overview";

// The Overview screen's Value section (#650): holdings vs. cost, capital on the market, realized
// P/L and purchase ROI, each an aggregate over the whole collection. Unfiltered by design — the
// tiles are entry points into the list screens, which own the filtered detail.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;

  try {
    return NextResponse.json(await getOverviewValue(session.user.id, collectionId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
