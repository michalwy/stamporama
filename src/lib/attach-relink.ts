/**
 * *Which orders a selection would take copies off* (#1079) — the re-link warning's arithmetic, read
 * off the **selection** rather than off the page currently fetched.
 *
 * The attach picker's area rail is resolved **server-side**, so a copy ticked under *Poland* is
 * simply absent from the fetched list once the rail moves to *France*. Deriving the warning from
 * that list therefore answered *no copies belong to another purchase* for exactly the collector who
 * had ticked across areas — the warning never appeared, the checkbox never appeared, and
 * `confirmRelink` went to the server as `false`. `attachItemsToLot` guards independently and
 * refuses the move, so nothing was ever re-linked without consent; what the collector met was a
 * partial attach citing a confirmation they had never been offered, with no way to grant it short
 * of navigating back to the area they ticked in. That guard stays exactly as it is — this makes the
 * client honest, it does not move the authority.
 *
 * **So the selection carries what the warning needs.** A tick records the order the copy is on at
 * the moment it is made, which is the moment the collector can see it; nothing here re-derives it
 * from a later fetch, because a later fetch is precisely what may no longer contain the row.
 *
 * **Named, never counted.** The comment this replaces said why in as many words: the question a
 * collector needs answered before agreeing is *which* order loses them, and a bare *2 copies belong
 * to another purchase* cannot tell them whether this is the mistake they are correcting. So the
 * count and the names come out of **one** pass, and cannot drift apart the way two derivations
 * over two lists did.
 */

/** What the picker remembers about a ticked copy: the order it was on when it was ticked, or null
 * for a copy that belonged to no purchase. That is the whole of what the warning needs, and
 * deliberately not the row — a row would go stale in a way nobody could see, where a label taken at
 * tick time is a record of what the collector was looking at when they agreed. */
export type TickedCopy = { relinkFrom: string | null };

/** The re-link warning, over the whole selection.
 *
 * `orders` is de-duplicated and keeps **tick order**, which is the order the collector built the
 * selection in; the previous derivation kept fetch order, which is an order nobody chose. */
export function summarizeRelink(
  selection: ReadonlyMap<string, TickedCopy>
): { count: number; orders: string[] } {
  let count = 0;
  const orders: string[] = [];
  const seen = new Set<string>();
  for (const { relinkFrom } of selection.values()) {
    if (relinkFrom === null) continue;
    count += 1;
    if (seen.has(relinkFrom)) continue;
    seen.add(relinkFrom);
    orders.push(relinkFrom);
  }
  return { count, orders };
}
