import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readTradeLineCandidates } from "@/lib/trade-candidates";

/** One give line's alternatives (#657) — the copies that answer it exactly, each drawn as the give
 * side already draws a copy, with the collector's own decision about it on this trade.
 *
 * A **line** read rather than a trade one, and unpaginated: a set of interchangeable duplicates is a
 * handful, and the whole point of opening it is to compare them side by side. The counts the rows
 * draw their chip from come with the trade's header read instead — one question about one trade,
 * asked once.
 *
 * The line id is a query parameter rather than a path segment because it is what the *dialog* has in
 * its hand; the trade in the path is what scopes the request, and the guard behind this checks the
 * line belongs to it. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; tradeId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tradeId } = await params;
  const lineId = request.nextUrl.searchParams.get("lineId");
  if (!lineId) {
    return NextResponse.json({ error: "Which line?" }, { status: 400 });
  }

  try {
    const read = await readTradeLineCandidates(session.user.id, lineId);
    if (read.tradeId !== tradeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(read);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
