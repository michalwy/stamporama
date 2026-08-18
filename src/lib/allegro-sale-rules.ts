/**
 * The decisions that turn an Allegro order into a pre-filled `Sale` (#463), kept pure — the ones
 * that are **Allegro's own**.
 *
 * Same split as `allegro-sync-rules.ts` beside `allegro-sync.ts`, and for the same reason: which
 * shipping method the buyer picked is a *rule*, and a rule that lives inside the module doing the
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

/** A shipping method as the platform's dictionary (#468) states it, narrowed to what a match needs. */
export interface MatchableShippingMethod {
  id: string;
  name: string;
  cost: string;
  currency: string;
}

/** What the sale's shipping block should open with. */
export interface ShippingPrefill {
  /** A dictionary row's id, or null for a one-off named below. */
  methodId: string | null;
  /** How the method reads — the dictionary's name where one matched, else Allegro's own wording. */
  methodName: string;
  /** What the collector's own postage normally costs, from the dictionary row. Blank where nothing
   *  matched: Allegro's delivery figure is what the **buyer** paid, which is a different number and
   *  is already inside the order's total. Filling it in here would put the buyer's money in the
   *  column that subtracts from the collector's. */
  cost: string;
  currency: string;
}

/**
 * Which of the platform's shipping methods the buyer chose.
 *
 * Matched **by name**, case- and space-insensitively, because that is the only thing the two lists
 * share: the dictionary is the collector's own price list, written in their words, and Allegro's
 * method ids belong to Allegro. A method that matches nothing is a *Custom* one carrying Allegro's
 * wording verbatim — never a new dictionary row, which is a decision about a price list and not
 * something a sale should make on the way past.
 */
export function matchShippingMethod(
  methods: readonly MatchableShippingMethod[],
  deliveryMethodName: string | null
): ShippingPrefill | null {
  const wanted = normalizeMethodName(deliveryMethodName);
  if (!wanted) return null;
  const hit = methods.find((method) => normalizeMethodName(method.name) === wanted);
  if (hit) {
    return { methodId: hit.id, methodName: hit.name, cost: hit.cost, currency: hit.currency };
  }
  return { methodId: null, methodName: deliveryMethodName!.trim(), cost: "", currency: "" };
}

function normalizeMethodName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
