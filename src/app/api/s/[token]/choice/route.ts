import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { verifySaleShareToken } from "@/lib/sale-share";
import { saveBuyerSetChoice } from "@/lib/sale-share-choice";

// Which copy the buyer wants, on its way in (#699).
//
// A route of the token's own, beside the photo route, for the reason that one exists: the credential
// authorises **one sale**, and every check it makes is about that sale's own lines. Nothing in the
// body names a sale — the id comes from the token's row — so the worst a tampered request can do is
// name a line that is not on this order or a set that is not offered against it, and both are
// refused in the domain before anything is written.
//
// Unlike the trade page's proposal (#658), what this writes is **the swap itself**: the copies move,
// `setChoicePending` clears and the line is stamped as the buyer's answer. That is the issue's own
// decision — the person who is going to own the stamp is the one with an opinion about which copy —
// and the seller can override it afterwards, the parcel still being theirs to pack.

/** Per address per minute. A buyer comparing scans picks and re-picks across a couple of lines, so
 *  this sits well above a person's pace and well below a script's — the trade routes' own figure. */
const CHOICE_LIMIT = 120;
const CHOICE_WINDOW_MS = 60_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const limited = rateLimit(
    `sale-share-choice:${clientAddress(request.headers)}`,
    CHOICE_LIMIT,
    CHOICE_WINDOW_MS
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many changes at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Not touched: `lastUsedAt` is the receipt for the question having been **opened**, and a pick is
  // not a visit. The page the buyer is choosing on already wrote one.
  const verified = await verifySaleShareToken(token, { touch: false });
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

  const { lineId, offerSetId } = body as { lineId?: unknown; offerSetId?: unknown };
  if (typeof lineId !== "string" || typeof offerSetId !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const saved = await saveBuyerSetChoice(verified.access, lineId, offerSetId);
    return NextResponse.json(saved);
  } catch (error) {
    // Stated rather than swallowed: every reason this refuses is something the buyer can act on —
    // the parcel has been packed, the copy has gone, the seller has settled that line themselves.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That could not be saved." },
      { status: 400 }
    );
  }
}
