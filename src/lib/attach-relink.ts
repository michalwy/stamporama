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
 * **Named, and counted per order.** The comment this replaces said why in as many words: the
 * question a collector needs answered before agreeing is *which* order loses them, and a bare *2
 * copies belong to another purchase* cannot tell them whether this is the mistake they are
 * correcting. So the count, the names and each order's share of the count (#1770) come out of
 * **one** pass, and cannot drift apart the way two derivations over two lists did.
 */

/** The order a ticked copy would be taken off: its id, so two orders that happen to share a supplier
 * and a date are never merged into one line (#1770), and its label, taken at tick time. */
export type RelinkSource = { id: string; label: string };

/** What the picker remembers about a ticked copy: the order it was on when it was ticked, or null
 * for a copy that belonged to no purchase. That is the whole of what the warning needs, and
 * deliberately not the row — a row would go stale in a way nobody could see, where a label taken at
 * tick time is a record of what the collector was looking at when they agreed. */
export type TickedCopy = { relinkFrom: RelinkSource | null };

/** One line of the warning: an order being left and how many of the ticked copies come off it. */
export type RelinkOrder = RelinkSource & { count: number };

/** The re-link warning, over the whole selection.
 *
 * `orders` has one entry per order with **its own count** (#1770) — a collector looking at *442
 * copies* off two orders cannot otherwise tell whether this is the mistake they are correcting, nor
 * which order to untick. The per-order counts add up to `count` by construction, because they come
 * out of the same pass. `orders` keeps **tick order**, which is the order the collector built the
 * selection in; the previous derivation kept fetch order, which is an order nobody chose. */
export function summarizeRelink(
  selection: ReadonlyMap<string, TickedCopy>
): { count: number; orders: RelinkOrder[] } {
  let count = 0;
  const byId = new Map<string, RelinkOrder>();
  for (const { relinkFrom } of selection.values()) {
    if (relinkFrom === null) continue;
    count += 1;
    const order = byId.get(relinkFrom.id);
    if (order) order.count += 1;
    else byId.set(relinkFrom.id, { ...relinkFrom, count: 1 });
  }
  return { count, orders: [...byId.values()] };
}

/** *Untick these* on one line of the warning (#1770): the selection without any copy coming off
 * `orderId`. It reaches **every** such tick, including those made under an area or year that is no
 * longer on screen — the warning counts the whole selection, so the action that answers it has to
 * as well, and this is a picker dialog, the named exception to a bulk action never reaching a row
 * the collector cannot see. Returns a new map; the one passed in is left alone. */
export function untickOrder(
  selection: ReadonlyMap<string, TickedCopy>,
  orderId: string
): Map<string, TickedCopy> {
  const next = new Map<string, TickedCopy>();
  for (const [id, tick] of selection) {
    if (tick.relinkFrom?.id !== orderId) next.set(id, tick);
  }
  return next;
}
