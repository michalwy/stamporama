import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getTrade } from "@/lib/trades";
import { readTradeReservation } from "@/lib/trade-reservations";
import { readTradeFeedback } from "@/lib/trade-feedback";
import { readTradeRealisation } from "@/lib/trade-realisation";
import { readTradeIntake } from "@/lib/trade-intake";
import { readTradeActions } from "@/lib/trade-line-actions";
import { readTradeCandidates } from "@/lib/trade-candidates";

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
 * refused — met while the list is being read rather than by pressing the button.
 *
 * And the **intake** (#644), a fifth: where the incoming material is being identified, which line
 * came as something else, and why the cost is not settled yet. All three are things about *this
 * trade* that a collector wonders about while looking at it, and a screen that had to be left to
 * find them would be a screen that never says them.
 *
 * And the **candidate pools** (#657): how many other copies of the collector's own would answer each
 * give line exactly, and how many they have held back. Here for the same reason as the rest — it is
 * one question about one trade, and counting it per page would be one query per column per scroll,
 * each answering about fifty rows out of the same set. It returns nothing at all from `agreed` on,
 * where the choice is settled with everything else the lock covers.
 *
 * And finally **what is waiting for the collector** (#663), which is a reading *of* the four above
 * rather than a sixth read: it is counted here, once for the trade, so that each column's toggle can
 * say how many of its lines are waiting before anyone applies it — a count fetched per column would
 * be eight reads of the same four answers. Three of those four are handed straight to it, which is
 * why it costs two queries rather than seven. */
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
    const [reservation, feedback, realisation, intake, candidates] = await Promise.all([
      readTradeReservation(tradeId),
      readTradeFeedback(session.user.id, tradeId),
      readTradeRealisation(tradeId),
      readTradeIntake(tradeId),
      readTradeCandidates(session.user.id, tradeId),
    ]);
    // Handed the three reads it would otherwise make again: what is waiting is a reading of those
    // same answers, and reading them twice on one request would be this route disagreeing with
    // itself the moment a line changed between the two.
    const actions = await readTradeActions(session.user.id, tradeId, {
      feedback,
      reservation,
      realisation,
    });
    return NextResponse.json({
      trade,
      reservation,
      feedback,
      realisation,
      intake,
      candidates,
      actions,
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
