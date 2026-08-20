import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { verifyTradeShareToken } from "@/lib/trade-share";
import { savePartnerTradeFeedback } from "@/lib/trade-feedback";

// What the partner says back, on its way in (#641).
//
// A route of the token's own, beside the photo route, for the same reason that one exists: the
// credential here authorises **one trade**, and every check it makes is about that trade's own lines.
// Nothing in the body names a trade — the id comes from the token's row — so the worst a tampered
// request can do is name a line that is not on this exchange, which is refused in the domain before
// anything is written.
//
// The one write in the app reachable without a session, so it is rate limited like the two reads
// beside it: a link that has escaped is a link that can be typed into.

/** Per address per minute. A partner working down a list ticks and types on line after line, so this
 *  is well above a person's pace and well below a script's. */
const FEEDBACK_LIMIT = 120;
const FEEDBACK_WINDOW_MS = 60_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const limited = rateLimit(
    `trade-share-feedback:${clientAddress(request.headers)}`,
    FEEDBACK_LIMIT,
    FEEDBACK_WINDOW_MS
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many changes at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Not touched: `lastUsedAt` is the receipt for the list having been **opened**, and a save is not
  // a visit. The page the partner is typing on already wrote one.
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

  const { lineId, note, rejected } = body as {
    lineId?: unknown;
    note?: unknown;
    rejected?: unknown;
  };
  if (lineId !== null && typeof lineId !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const entry = await savePartnerTradeFeedback(verified.access, lineId, {
      note: typeof note === "string" ? note : null,
      rejected: rejected === true,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    // Stated rather than swallowed: the reasons this refuses are all things the partner can act on —
    // the exchange has finished, the note is too long, the line is not on this list.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That could not be saved." },
      { status: 400 }
    );
  }
}
