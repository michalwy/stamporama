import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getTrade } from "@/lib/trades";
import { readTradeReservation } from "@/lib/trade-reservations";
import { readTradeFeedback } from "@/lib/trade-feedback";
import { readTradeRealisation } from "@/lib/trade-realisation";

/** One trade with its sections (#637) — the trade screen's header read.
 *
 * The **lines are not here**: each side of each section pages on its own (`./lines`), because a
 * trade list can run long and the two columns are searched and filtered independently. What the
 * sections do carry is their counts, so a section heading states its size without waiting for a
 * page to arrive.
 *
 * It carries the **reservation** too (#639): which promised copies are live on a marketplace, and
 * which have left the collection since. Here rather than on the balance read because it costs two
 * light queries over the give side's ids, and because the screen has to be able to say why **Agree**
 * would be refused before anyone presses it — the same reason the valuation gate's blockers ride
 * along with the figures they are computed from.
 *
 * And it carries the **partner's feedback** (#641), for the third time the same reason: it is one
 * small read over the trade's own rows, and *Partner has responded* is derived from it rather than
 * being a status somebody keeps up to date — a badge that arrived on a second fetch would be a badge
 * the screen renders once without.
 *
 * And the **realisation** (#642), for the same reason a fourth time: one light read over the trade's
 * own lines, and it is what the row draws its verdict from and what says why **Close** would be
 * refused — met while the list is being read rather than by pressing the button. */
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
    const [reservation, feedback, realisation] = await Promise.all([
      readTradeReservation(tradeId),
      readTradeFeedback(session.user.id, tradeId),
      readTradeRealisation(tradeId),
    ]);
    return NextResponse.json({ trade, reservation, feedback, realisation });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
