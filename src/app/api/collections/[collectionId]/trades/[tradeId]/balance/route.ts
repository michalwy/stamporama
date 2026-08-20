import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { readTradeBalance } from "@/lib/trade-valuation";

/** What both sides of a trade are worth, and whether it balances (#638).
 *
 * **One endpoint for the whole trade**, not one per section. The sections' verdicts and the trade's
 * are read off the same set of line figures at the same moment, and a screen that assembled them
 * from several calls could show every section balanced and the trade not — two answers from two
 * different instants, with nothing on screen to say so.
 *
 * Separate from the trade's own read (`../route.ts`) because it costs more: valuing every line of
 * both sides against two catalogs is a heavier question than "what are the terms and how many lines
 * are there", and the header should not wait on it. It carries the gate's blockers too, so the
 * screen can say why **Share** would be refused before anyone presses it.
 */
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
    const balance = await readTradeBalance(session.user.id, tradeId);
    if (!balance || balance.collectionId !== collectionId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ balance });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
