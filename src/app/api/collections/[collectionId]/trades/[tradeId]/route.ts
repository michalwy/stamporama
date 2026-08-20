import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getTrade } from "@/lib/trades";

/** One trade with its sections (#637) — the trade screen's header read.
 *
 * The **lines are not here**: each side of each section pages on its own (`./lines`), because a
 * trade list can run long and the two columns are searched and filtered independently. What the
 * sections do carry is their counts, so a section heading states its size without waiting for a
 * page to arrive. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collectionId: string; tradeId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, tradeId } = await params;

  try {
    const trade = await getTrade(session.user.id, tradeId);
    if (!trade || trade.collectionId !== collectionId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ trade });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
