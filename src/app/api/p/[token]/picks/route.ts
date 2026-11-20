import { NextRequest, NextResponse } from "next/server";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { saveProposalBuyerPick, verifyProposalShareToken } from "@/lib/proposal-handout";

// A lot the proposal's buyer ticks or unticks on their page (#2601), on its way in.
//
// A route of the token's own, beside the photo route, as a sale's copy choice is (#699): the credential
// authorises **one proposal**, and nothing in the body names one — the id comes from the token's row.
// The lot is named by its number, the only key the page has, so the worst a tampered request can do is
// tick another lot of the same proposal, which the buyer could do anyway.

/** Per address per minute. A buyer ticks and unticks a few lots in a row, so this sits well above a
 *  person's pace and well below a script's — the sale choice's own figure. */
const PICK_LIMIT = 120;
const PICK_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const limited = rateLimit(`proposal-share-pick:${clientAddress(request.headers)}`, PICK_LIMIT, PICK_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many changes at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // Not touched: a tick is not a visit — the page it is made on already recorded one.
  const access = await verifyProposalShareToken(token, { touch: false });
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const { lotNo, picked } = (typeof body === "object" && body !== null ? body : {}) as { lotNo?: unknown; picked?: unknown };
  if (typeof lotNo !== "number" || !Number.isSafeInteger(lotNo) || lotNo < 1 || typeof picked !== "boolean") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    return NextResponse.json(await saveProposalBuyerPick(access, lotNo, picked));
  } catch (error) {
    // Stated: every refusal is something the buyer can read — the offer closed, the lot gone.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That could not be saved." },
      { status: 400 }
    );
  }
}
