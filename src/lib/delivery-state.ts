/** The physical delivery axis of a copy (ADR-0009 §5, #121) — orthogonal to disposition.
 *
 * Lifecycle for a purchased copy: `ordered` (intake default) → `in_transit` → `to_sort`
 * (arrived, awaiting sorting) → `delivered` (sorted / in hand), with `not_delivered` and
 * `damaged` as outcomes found while sorting. A copy added by hand starts `delivered`.
 *
 * This module is the single vocabulary for the axis: the valid set, the display labels, the
 * tint token each state carries, and the lifecycle order. Pure — no Prisma, no React — so
 * both the domain layer and every screen that renders or filters the axis read the same list
 * instead of restating it. */

/** Lifecycle progression first, then the exception outcomes — the order the states are
 * offered in every select and chip legend. */
export const DELIVERY_STATES = [
  "ordered",
  "in_transit",
  "to_sort",
  "delivered",
  "not_delivered",
  "damaged",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** Membership test for untrusted input (form fields, query params). */
export function isDeliveryState(value: string | null | undefined): value is DeliveryState {
  return !!value && (DELIVERY_STATES as readonly string[]).includes(value);
}

/** Short display label + the semantic color token the state's chip is tinted with. `muted`
 * means "no tint" — used as the fallback for a value written before this vocabulary. */
export const DELIVERY_STATE_META: Record<DeliveryState, { label: string; token: string }> = {
  ordered: { label: "Ordered", token: "accent" },
  in_transit: { label: "In transit", token: "accent" },
  to_sort: { label: "To sort", token: "warning" },
  delivered: { label: "Delivered", token: "success" },
  not_delivered: { label: "Not delivered / missing", token: "error" },
  damaged: { label: "Damaged", token: "error" },
};

/** Label for a stored value, falling back to the raw string so an unknown value is still
 * legible rather than blank. */
export function deliveryStateLabel(state: string): string {
  return DELIVERY_STATE_META[state as DeliveryState]?.label ?? state;
}

/** Tint token for a stored value; `muted` for anything outside the vocabulary. */
export function deliveryStateToken(state: string): string {
  return DELIVERY_STATE_META[state as DeliveryState]?.token ?? "muted";
}

/** The two exception outcomes — the copy was paid for but is not in the collector's hands and
 * never will be. Nothing that asks "what can still be listed for sale?" should surface them
 * (#259's not-offered-on-platform filter), unlike the in-flight states, which are copies on
 * their way in. */
export const UNAVAILABLE_DELIVERY_STATES = ["not_delivered", "damaged"] as const;

/** A copy is *in hand* only when it is delivered — the precondition for listing it for sale
 * (#188) and the reason the offer actions are unavailable otherwise (#273). */
export function isDelivered(state: string): boolean {
  return state === "delivered";
}


/**
 * How a count of copies you have *bought* splits by where each one is (#532, #562).
 *
 * A purchased copy that has not arrived is bought, and every count of what the collection has
 * therefore includes it — but *"you hold 1"* is the wrong sentence about a copy still in the post,
 * and a copy sitting unsorted on the desk is a third answer again. So the states collapse to four
 * buckets, and every surface that says what the collection has of a stamp says it through these:
 * the want list and the catalogue chip's popover (#532), and the intake step's *what you already
 * hold* line (#562).
 *
 * Declared here, in the module that already owns the delivery vocabulary, rather than privately in
 * each: two surfaces answering "have I got this" must not be able to disagree about which states
 * count as having it.
 *
 * **Lifecycle order, furthest away last**, so the eye meets what you *have* first. `to_sort` stands
 * apart from `held` deliberately — a copy in an unsorted parcel has arrived but is not filed, which
 * is both the other parcel on the desk and the one just entered from this stockbook.
 *
 * Two labels each, because the axis is read in two grammars and neither is a home for the other's
 * wording: a bare tally (`1 held · 1 in transit`) and a clause inside a sentence (`You hold none ·
 * 1 on its way`). `held` has no clause form — it *is* the sentence the others hang off.
 */
export const COPY_BUCKETS = [
  { key: "held", state: "delivered", tally: "held", clause: null },
  { key: "toSort", state: "to_sort", tally: "to sort", clause: "being sorted" },
  { key: "inTransit", state: "in_transit", tally: "in transit", clause: "in the post" },
  { key: "ordered", state: "ordered", tally: "ordered", clause: "on its way" },
] as const satisfies readonly {
  key: string;
  state: DeliveryState;
  tally: string;
  clause: string | null;
}[];

export type CopyDeliveryBucket = (typeof COPY_BUCKETS)[number]["key"];

/**
 * The buckets holding a copy that is **in hand** — physically with the collector, whether or not it
 * has been filed (#563).
 *
 * A third reading of the same declaration, beside the headline/in-flight split below: *you hold N*
 * counts `held` alone because a copy on the desk is not yet filed, but a figure claiming *this set
 * can go out* counts it, since the stamp is there to put in the envelope. What both readings refuse
 * is a copy still `ordered` or `in_transit` — bought, rightly counted by every other figure in the
 * app (ADR-0032 §7), and not something that can be listed.
 *
 * Named off the buckets rather than by restating two delivery states, so the one place that decides
 * what `to_sort` means stays the one place.
 */
export const IN_HAND_COPY_BUCKETS = COPY_BUCKETS.filter(
  (b) => b.key === "held" || b.key === "toSort"
);

/** The delivery states {@link IN_HAND_COPY_BUCKETS} covers, for a query's `where`. An **`in`**
 *  rather than `copy-counts.ts`'s `notIn` of the two unavailable outcomes: this is the narrower
 *  claim, and listing what counts is what keeps a future delivery state from silently joining it. */
export const IN_HAND_DELIVERY_STATES: readonly DeliveryState[] = IN_HAND_COPY_BUCKETS.map(
  (b) => b.state
);

/**
 * The same judgement as {@link isDelivered}, as a list for a query's `deliveryStates` — the reads
 * that narrow a *set* of copies to the ones that may actually be listed, rather than testing one.
 *
 * It sits between the two neighbours above and is narrower than both, which is the whole reason it
 * is named. The `notOfferedPlatformId` clause keeps the **in-flight** states, because a listing is
 * something one writes ahead of the parcel arriving. {@link IN_HAND_DELIVERY_STATES} adds `to_sort`,
 * because a stamp on the desk is there to put in an envelope. A **bulk lot** can take neither: it is
 * a hundred pieces counted into one envelope now, and the offer it commits to refuses to go live
 * around anything this predicate rejects — so admitting a copy here would only build a lot that
 * could not be posted.
 */
export const LISTABLE_DELIVERY_STATES: readonly DeliveryState[] = COPY_BUCKETS.filter((b) =>
  isDelivered(b.state)
).map((b) => b.state);

/** The buckets a copy that has **not** arrived and been filed falls in — everything the headline
 *  *you hold N* does not cover, in the order above. */
export const IN_FLIGHT_COPY_BUCKETS = COPY_BUCKETS.filter((b) => b.key !== "held") as readonly {
  key: Exclude<CopyDeliveryBucket, "held">;
  state: DeliveryState;
  tally: string;
  clause: string;
}[];

/** Which bucket a copy's delivery state falls in. Anything outside the vocabulary counts as held
 *  rather than being dropped: the copy exists whatever a future migration called its state. The two
 *  unavailable outcomes never reach here — they are excluded before anything is counted. */
export function copyDeliveryBucket(deliveryState: string): CopyDeliveryBucket {
  if (deliveryState === "ordered") return "ordered";
  if (deliveryState === "in_transit") return "inTransit";
  if (deliveryState === "to_sort") return "toSort";
  return "held";
}
