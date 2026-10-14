/**
 * The decisions that turn an Allegro order into a pre-filled `Sale` (#463), kept pure — the ones
 * that are **Allegro's own**.
 *
 * Same split as `allegro-sync-rules.ts` beside `allegro-sync.ts`, and for the same reason: which
 * shipping option the buyer picked is a *rule*, and a rule that lives inside the module doing the
 * reads and writes is a rule nobody tests. `allegro-sale.ts` is the half that fetches and writes; it
 * makes no judgement of its own.
 *
 * What an order-shaped sale needs whatever marketplace it came from — which sets a line stands for,
 * what day the sale is dated, how the buyer is filed — moved to `order-sale-rules.ts` when #612
 * asked the same three questions of a Delcampe order. Only the delivery method stayed: a Delcampe
 * sold row states none.
 *
 * The register here is #355's: **a wrong composition is worse than none.**
 */

/** A shipping option as the platform's list (#468) states it, narrowed to what a match needs: its
 * name, and the postage of the carrier service it is linked to (#1909), if any. */
export interface MatchableShippingOption {
  id: string;
  name: string;
  service: { cost: string; currency: string } | null;
}

/** What the sale's shipping block should open with. */
export interface ShippingPrefill {
  /** One of the platform's options, or null for a one-off named below. */
  optionId: string | null;
  /** How the option reads — the list's name where one matched, else Allegro's own wording. */
  optionName: string;
  /** What the collector's own postage normally costs, from the matched option's carrier service
   *  (#1909). Blank where nothing matched, or the option links to no service: Allegro's delivery figure is what the **buyer** paid, which is a different number and
   *  is already inside the order's total. Filling it in here would put the buyer's money in the
   *  column that subtracts from the collector's. */
  cost: string;
  currency: string;
}

/**
 * Which of the platform's shipping options the buyer chose.
 *
 * Matched **by name**, case- and space-insensitively, because that is the only thing the two lists
 * share: the dictionary is the collector's own price list, written in their words, and Allegro's
 * method ids belong to Allegro. A name that matches nothing is a *Custom* option carrying Allegro's
 * wording verbatim — never a new listed option, which is a decision about the list and not
 * something a sale should make on the way past.
 */
export function matchShippingOption(
  options: readonly MatchableShippingOption[],
  deliveryMethodName: string | null
): ShippingPrefill | null {
  const wanted = normalizeMethodName(deliveryMethodName);
  if (!wanted) return null;
  const hit = options.find((option) => normalizeMethodName(option.name) === wanted);
  if (hit) {
    return {
      optionId: hit.id,
      optionName: hit.name,
      cost: hit.service?.cost ?? "",
      currency: hit.service?.currency ?? "",
    };
  }
  return { optionId: null, optionName: deliveryMethodName!.trim(), cost: "", currency: "" };
}

function normalizeMethodName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
