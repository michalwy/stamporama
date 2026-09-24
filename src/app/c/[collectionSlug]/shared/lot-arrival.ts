/** What a `?lot=` deep link resolves to, on the two screens that draw lot cards: a purchase order
 * (#911) and an auction sale (#1015, #1356).
 *
 * A link lands on the screen with `?lot=<id>`, meaning *this is the lot you came for* (#374, #387),
 * and the screen answers by opening that lot's card, scrolling to it and flashing it once (#850,
 * #876). Both of those need a lot card to exist, and only the **by-lot** view draws any — so the
 * arrival used to do nothing at all in the other views while the param was consumed regardless:
 * latched, stripped from the address bar, released on the timer. Grouping is remembered on both
 * screens, so whether the link did anything depended on how the collector last left that screen —
 * **behaviour that depends on state the collector cannot see before they act**, which is the defect
 * #885 was reverted for.
 *
 * Shared rather than copied (#1015), so the two screens cannot drift: the rules are the two answers
 * each screen needs and neither is about rendering — which lot is being pointed at, and how the
 * lots are grouped while that is true. What the auction sale adds on top — the lot asked for stays
 * on screen past a remembered filter (#1356) — is its own and lives in its `sale-view-params.ts`.
 */

/** The lot the collector arrived to see, or null when there is nothing to point at.
 *
 * A param naming a lot this screen does not hold — the copy was moved, the lot was deleted, a link
 * was hand-edited — resolves to null, and **null is what keeps the param in the address bar**. The
 * panel consumes the param only when it answered it; consuming one that pointed at nothing would
 * tidy the address bar over a screen that did not react, which is exactly the silent no-op this
 * whole rule is about. It costs a stale parameter sitting in the bar, and that is the honest side
 * of the trade: nothing happened, and the link that asked for it is still visible.
 */
export function arrivalLotId(
  requestedLotId: string | null | undefined,
  lotIds: readonly string[]
): string | null {
  if (!requestedLotId) return null;
  return lotIds.includes(requestedLotId) ? requestedLotId : null;
}

/** Whether the lots are drawn as cards while an arrival is live.
 *
 * An arrival forces **Group by lot** on, because the link names a lot and no other view can show
 * one. That overrides a preference the collector set deliberately (#382, #1353), which is the one
 * real objection to it — so the override is **transient for that visit and is never written to the
 * stored preference**: it holds while the panel is mounted, and it ends the moment the collector
 * touches *Group by* themselves. Reopen the screen from its list and the remembered view is back,
 * unchanged.
 *
 * It deliberately does not survive the flash. The arrival mark is released after ~2s (#876) and
 * the view must not snap back under the collector at that moment — this is a different question
 * from *is the flash still running*, and each panel holds a separate flag for it.
 */
export function byLotWithArrival(storedByLot: boolean, arrivalHoldsView: boolean): boolean {
  return storedByLot || arrivalHoldsView;
}
