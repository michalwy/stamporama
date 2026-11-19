/**
 * Fixing ticked *Needs action* offers **in bulk** from the offers list (#2581) — pure, Prisma-free.
 *
 * Two selection-bar actions, both made only of what one offer's own actions already do:
 *
 * - **Remove sets sold elsewhere from N** — the offer's own *Remove N sets sold elsewhere* (#1805),
 *   on every ticked offer it suits.
 * - **Fix everything (N)** — each ticked offer gets the one action its situation calls for: closed or
 *   updated through the Assistant on Colnect (#1969), its sets sold elsewhere removed, or — never
 *   listed and nothing left to sell — withdrawn.
 *
 * Every ticked offer neither suits is **left alone**, stays ticked, and carries the reason on its row.
 */

import type { AssistantRunAct, OfferAssistantFacts } from "./offer-assistant-runs";
import { soldElsewhereRemovalVia } from "./offer-needs-action-remedy";
import { isPreparedState, type OfferState } from "./offer-rules";

/** The sets of an offer sold elsewhere (#1805), as the list row carries them: what the removal takes
 *  off, and how many sets are still for sale without them. Null where no set has sold elsewhere. */
export interface OfferSoldElsewhereFacts {
  setIds: string[];
  leftToSell: number;
}

/** What the two actions read of a list row — `OfferListItem`, structurally. */
export interface FixableOffer {
  id: string;
  offerNo: number;
  state: OfferState;
  platformName: string;
  needsAction: boolean;
  needsResolution: boolean;
  platformSale: unknown;
  listingOutOfDate: unknown;
  listingToClose: unknown;
  assistant: OfferAssistantFacts | null;
  soldElsewhere: OfferSoldElsewhereFacts | null;
}

export interface LeftAlone<O> {
  offer: O;
  reason: string;
}

// ── Remove sets sold elsewhere ───────────────────────────────────────────────

/** Why the removal leaves a ticked offer alone, or null when it runs on it. Exactly the offer's own
 *  action: offered while a set has sold elsewhere and not folded into Update via Assistant (#1835),
 *  refused when nothing would be left to sell. */
export function soldElsewhereRemovalRefusal(o: FixableOffer): string | null {
  const se = o.soldElsewhere;
  if (!se || se.setIds.length === 0) return "No set sold elsewhere";
  const via = soldElsewhereRemovalVia({
    state: o.state,
    assistantUpdate: o.assistant?.update ?? false,
    sets: se.setIds.map(() => ({ soldElsewhere: true })),
  });
  if (via === "update") return "Update via Assistant removes them with the update";
  if (se.leftToSell === 0) {
    return isPreparedState(o.state)
      ? "Nothing would be left: withdraw it instead"
      : "Nothing would be left: close the listing instead";
  }
  return null;
}

/** The ticked offers the removal runs on, and those it leaves alone with the reason. */
export function planSoldElsewhereRemoval<O extends FixableOffer>(
  offers: readonly O[]
): { run: O[]; leftAlone: LeftAlone<O>[] } {
  const run: O[] = [];
  const leftAlone: LeftAlone<O>[] = [];
  for (const offer of offers) {
    const reason = soldElsewhereRemovalRefusal(offer);
    if (reason === null) run.push(offer);
    else leftAlone.push({ offer, reason });
  }
  return { run, leftAlone };
}

// ── Fix everything ───────────────────────────────────────────────────────────

/** The one action Fix everything gives an offer: an Assistant run, or one of the two done here. */
export type OfferFix = AssistantRunAct | "remove" | "withdraw";

export interface PlannedFix<O> {
  offer: O;
  fix: OfferFix;
}

/** The Assistant's half of an Active listing on a platform it drives (#1969): the remedy the offer's
 *  screen highlights where both buttons are offered (#1804), otherwise whichever of the two the offer
 *  has and its situation calls for. Null where neither applies. */
function assistantFix(o: FixableOffer): AssistantRunAct | null {
  const a = o.assistant;
  if (!a || o.state !== "active") return null;
  if (a.remedy) return a.remedy.action;
  const sold = o.soldElsewhere !== null && o.soldElsewhere.setIds.length > 0;
  const nothingLeft = sold && o.soldElsewhere!.leftToSell === 0;
  if (nothingLeft) return a.closeSaleId ? "close" : null;
  if (a.update && (o.needsAction || o.listingOutOfDate !== null)) return "update";
  return null;
}

/** What Fix everything does to one ticked offer — a fix, or the reason it leaves the offer alone. */
export function fixFor(
  o: FixableOffer,
  ctx: {
    /** Why the Assistant cannot be asked right now (not installed, not connected), or null. */
    assistantUnavailable: string | null;
    /** Offers already queued or running in the Assistant queue. */
    queued: ReadonlySet<string>;
  }
): { fix: OfferFix } | { reason: string } {
  if (ctx.queued.has(o.id)) return { reason: "Already in the Assistant queue" };

  const viaAssistant = assistantFix(o);
  if (viaAssistant) {
    return ctx.assistantUnavailable === null
      ? { fix: viaAssistant }
      : { reason: ctx.assistantUnavailable };
  }

  const se = o.soldElsewhere;
  if (se && se.setIds.length > 0) {
    if (se.leftToSell > 0) return { fix: "remove" };
    // Never listed, so nothing to close: withdrawing is the whole of it. A live listing elsewhere can
    // only come down by hand on its platform.
    if (isPreparedState(o.state)) return { fix: "withdraw" };
    return { reason: `Nothing left to sell: take the listing down on ${o.platformName} by hand, then withdraw it` };
  }

  if (o.platformSale) return { reason: `Sold on ${o.platformName}: record the sale` };
  if (o.listingToClose) return { reason: `Close the listing on ${o.platformName} by hand` };
  if (o.needsResolution) return { reason: "Auction ended: say whether it sold" };
  if (o.listingOutOfDate) return { reason: `Listing changed: update it on ${o.platformName} by hand` };
  if (o.needsAction) return { reason: `A copy is in bidding elsewhere: update it on ${o.platformName} by hand` };
  return { reason: "Nothing here needs fixing" };
}

/** Every ticked offer's fix, and the offers left alone with why. */
export function planFixEverything<O extends FixableOffer>(
  offers: readonly O[],
  ctx: Parameters<typeof fixFor>[1]
): { fixes: PlannedFix<O>[]; leftAlone: LeftAlone<O>[] } {
  const fixes: PlannedFix<O>[] = [];
  const leftAlone: LeftAlone<O>[] = [];
  for (const offer of offers) {
    const r = fixFor(offer, ctx);
    if ("fix" in r) fixes.push({ offer, fix: r.fix });
    else leftAlone.push({ offer, reason: r.reason });
  }
  return { fixes, leftAlone };
}

/** The plan by action, in the issue's words: *3 closed on Colnect · 2 updated on Colnect · 4 sets
 *  removed from 2 offers · 1 withdrawn*. */
export function fixEverythingSummary(fixes: readonly PlannedFix<FixableOffer>[]): string {
  const of = (fix: OfferFix) => fixes.filter((f) => f.fix === fix).map((f) => f.offer);
  const where = (offers: FixableOffer[]) => {
    const names = [...new Set(offers.map((o) => o.platformName))];
    return names.length === 1 ? `on ${names[0]}` : "via the Assistant";
  };
  const closed = of("close");
  const updated = of("update");
  const removed = of("remove");
  const withdrawn = of("withdraw");
  const sets = removed.reduce((n, o) => n + (o.soldElsewhere?.setIds.length ?? 0), 0);
  return [
    ...(closed.length > 0 ? [`${closed.length} closed ${where(closed)}`] : []),
    ...(updated.length > 0 ? [`${updated.length} updated ${where(updated)}`] : []),
    ...(removed.length > 0
      ? [`${sets} ${sets === 1 ? "set" : "sets"} removed from ${removed.length} ${removed.length === 1 ? "offer" : "offers"}`]
      : []),
    ...(withdrawn.length > 0 ? [`${withdrawn.length} withdrawn`] : []),
  ].join(" · ");
}
