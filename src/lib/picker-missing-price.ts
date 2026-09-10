/**
 * *Which of a picker's ticks cannot be submitted, and what the control naming them says* (#1080) —
 * the other half of the question `picker-hidden-ticks.ts` answers.
 *
 * That module is about a submit that **acts on more than the collector can see**; this one is about
 * a submit that **refuses to act because of something the collector cannot see**. Same broken
 * relationship between a selection and a viewport, arriving from the opposite side, and arguably
 * the worse of the two: a wrong action is visible afterwards, and a dead button explains nothing at
 * all.
 *
 * The sale-line picker is the only one of the four with a **per-row input** — a price on each
 * ticked set, rendered only on the visible row — so it is the only one whose submit can be gated on
 * something a filter can hide. The other three gate on `isPending`, an empty selection, and (in
 * *Attach copies*) a re-link confirmation drawn as a banner over the whole dialog rather than on a
 * row. Nothing here reaches them, and the rule in `docs/agents/ui-patterns.md` says why that is a
 * property of the surface rather than an omission.
 *
 * **One predicate, read by the button and by the control alike.** `canSubmit` and *how many are
 * missing* are the same question asked twice, and two spellings of it would let a picker disable
 * its submit over a set its own control does not list — which is this project's *the number and the
 * write cannot disagree* on the smallest surface it has.
 *
 * Nothing here writes, and nothing here filters: it answers *which ids*, and the dialog decides
 * what to do with them.
 */

/** A tick carrying the price typed against it. The picker's own `Picked` is wider; this is the
 *  half the question is about. */
export interface PricedPick {
  offerSetId: string;
  price: string;
}

/**
 * Is this a price a sale line can carry?
 *
 * Blank is invalid rather than zero: an empty field is a collector **mid-edit**, and reading it as
 * free would record a sale at nothing. Zero itself is allowed — a set thrown in with another sells
 * for nothing and that is a real line — so the bound is `>= 0` and not `> 0`.
 *
 * `Number` rather than the app's decimal parser on purpose: `NumericInput` has already sanitised
 * the keystrokes and `normalizeDecimalInput` evaluates any arithmetic server-side, so what this
 * sees is a plain decimal string. What it is guarding is the empty field and the half-typed one.
 */
export function priceValid(price: string): boolean {
  const t = price.trim();
  if (!t) return false;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0;
}

/**
 * The ticked sets that cannot be submitted, in the order they were given.
 *
 * Ids rather than a count, because the control that names them has to **show** them: the count
 * alone is bare option (a) from #1080, which leaves the collector with a number and no route to
 * the rows.
 */
export function setsMissingPrice(picks: Iterable<PricedPick>): string[] {
  const out: string[] = [];
  for (const p of picks) if (!priceValid(p.price)) out.push(p.offerSetId);
  return out;
}

/**
 * What the control says, and it says it **only when there is something to say**.
 *
 * The empty string for zero is `hiddenTicksSuffix`'s rule one control along: a footer carrying
 * *0 picked sets have no price* on every ordinary use is noise, and ordinary use is most uses. A
 * caller may render on the count and let this spell it, or spell it unconditionally and let the
 * empty answer draw nothing.
 */
export function missingPriceLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 picked set has no price" : `${count} picked sets have no price`;
}
