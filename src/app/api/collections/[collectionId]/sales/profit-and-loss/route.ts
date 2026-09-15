import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProfitAndLoss } from "@/lib/profit-and-loss";
import { isPeriodGranularity, parseDateRange } from "@/lib/profit-and-loss-rules";

// The profit and loss screen's totals, periods and platforms (#1305) over a range of dates. A
// malformed date or period is dropped rather than refused, so a stale link shows more, not an error.
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
  const range = parseDateRange(sp.get("from"), sp.get("to"));
  const period = sp.get("period");

  try {
    return NextResponse.json(
      await getProfitAndLoss(
        session.user.id,
        collectionId,
        range,
        isPeriodGranularity(period) ? period : "month"
      )
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
