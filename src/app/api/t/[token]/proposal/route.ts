import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { verifyTradeShareToken } from "@/lib/trade-share";
import { saveTradeCopyProposal } from "@/lib/trade-proposals";

// Which copy the partner would rather have, on its way in (#658).
//
// A route of the token's own, beside the feedback and photo routes, for the reason those exist: the
// credential authorises **one trade**, and every check it makes is about that trade's own lines.
// Nothing in the body names a trade — the id comes from the token's row — so the worst a tampered
// request can do is name a line that is not on this exchange or a copy that is not offered against
// it, and both are refused in the domain before anything is written.
//
// What it writes is **advisory**: `TradeLine.proposedItemId` and nothing else. No figure, no
// reservation and no packing row moves until the collector accepts it on their own screen.

/** Per address per minute. A partner comparing scans down a list picks and re-picks, so this sits
 *  well above a person's pace and well below a script's — the feedback route's own figure, for the
 *  same reason. */
const PROPOSAL_LIMIT = 120;
const PROPOSAL_WINDOW_MS = 60_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const limited = rateLimit(
    `trade-share-proposal:${clientAddress(request.headers)}`,
    PROPOSAL_LIMIT,
    PROPOSAL_WINDOW_MS
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many changes at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Not touched: `lastUsedAt` is the receipt for the list having been **opened**, and a pick is not
  // a visit. The page the partner is choosing on already wrote one.
  const verified = await verifyTradeShareToken(token, { touch: false });
  if (!verified.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { lineId, itemId } = body as { lineId?: unknown; itemId?: unknown };
  if (typeof lineId !== "string" || (itemId !== null && typeof itemId !== "string")) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const saved = await saveTradeCopyProposal(verified.access, lineId, itemId);
    return NextResponse.json(saved);
  } catch (error) {
    // Stated rather than swallowed: every reason this refuses is something the partner can act on —
    // the copy has gone, they have already asked for it on another line, the exchange has moved on.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That could not be saved." },
      { status: 400 }
    );
  }
}
