/**
 * What the collection has of one stamp, broken down by disposition, by condition **and by where
 * each copy is** (#562).
 *
 * Pure, and deliberately not part of `copy-counts.ts`: that module is `server-only` and this shape
 * is drawn by a client component, which is the whole reason the intake step can state it at the
 * moment the stamp is identified rather than after the copies exist.
 *
 * The condition axis is the part that makes the figure actionable — two copies mean nothing until
 * you know what they are — and it is **listed, never ranked**. `StampCondition.sortOrder` is display
 * order, not a quality scale (ADR-0032: `U` and `MNG` are cancellation and gum, not two points on
 * one line), so nothing here derives a "better" or a "worse" copy. The collector reads the
 * conditions and judges.
 *
 * The delivery axis is here because the counting set and the *sentence* are two different questions.
 * Every count of what a collection has includes copies bought and not yet arrived — a copy in the
 * post is bought, and ADR-0032 settled that for the want counts — but **"you hold 1" is the wrong
 * sentence about it**, and it is wrong in exactly the two cases the intake step meets first: a lot
 * won at auction whose only identified copy is still travelling (settlement creates them `ordered`),
 * and the copy entered from this very stockbook ten minutes ago, which would otherwise read as
 * existing stock. So the headline counts **delivered copies only**, and everything else is stated
 * after it in its own clause through `COPY_BUCKETS` — the same four buckets the want list splits by,
 * lifted into `delivery-state.ts` rather than restated here.
 */

import {
  copyDeliveryBucket,
  IN_FLIGHT_COPY_BUCKETS,
  type CopyDeliveryBucket,
  type DeliveryState,
} from "./delivery-state";

/** A condition and how many copies of the clause it accounts for. */
export interface HeldConditionCount {
  conditionId: string;
  count: number;
}

/** One `(condition × delivery state × disposition-combination)` bucket of counted copies, as the
 *  database groups them. The three flags are the combination a copy carries, so a copy that is both
 *  in the collection and for sale is one row with two flags set — never two rows. */
export interface HeldCopyRow {
  conditionId: string;
  /** Where the copy is. A copy that has been bought but has not arrived is counted — it is bought —
   *  but it is **not** part of what you *hold*, which is what {@link summarizeHeldCopies} splits. */
  deliveryState: string;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  count: number;
}

/** The disposition markers, plus the copies carrying none. `unmarked` is counted rather than
 *  subtracted, for `StampCopyCounts.unmarked`'s reason: the markers overlap, so the total tells you
 *  nothing about how many copies carry no marker at all. */
export const HELD_MARKERS = [
  { key: "inCollection", token: "collection", label: "in collection" },
  { key: "forSale", token: "sale", label: "for sale" },
  { key: "forTrade", token: "trade", label: "for trade" },
  { key: "unmarked", token: null, label: "with no disposition" },
] as const;

export type HeldMarkerKey = (typeof HELD_MARKERS)[number]["key"];

/** One marker's figure and the conditions behind it. */
export interface HeldMarker {
  key: HeldMarkerKey;
  /** The disposition colour vocabulary the copy rows use; null for the unmarked copies, which have
   *  no disposition to be coloured by. */
  token: "collection" | "sale" | "trade" | null;
  label: string;
  count: number;
  /** The conditions those copies are in, in the collection's own dictionary order. */
  conditions: HeldConditionCount[];
}

/** One clause about copies that are bought but not yet filed — count and conditions, and
 *  deliberately no disposition markers. An in-flight copy's disposition is unset (auction
 *  settlement writes all three flags false) or provisional, so listing markers there would dress a
 *  blank up as a decision. */
export interface InFlightCopies {
  key: Exclude<CopyDeliveryBucket, "held">;
  state: DeliveryState;
  /** The clause's own wording, from `COPY_BUCKETS` — *being sorted*, *in the post*, *on its way*. */
  label: string;
  count: number;
  conditions: HeldConditionCount[];
}

export interface HeldCopiesSummary {
  /** Copies **delivered** — filed, in hand, what "hold" means. The markers overlap and do not sum
   *  to it, so it is counted from the rows rather than added up from them. */
  total: number;
  /** Only the markers something is held under, in {@link HELD_MARKERS} order. Delivered copies
   *  only: the disposition of a copy still in the post says nothing yet. */
  markers: HeldMarker[];
  /** The other buckets, in lifecycle order and only where something sits — each its own clause,
   *  because *you hold 1* is the wrong sentence about a copy that has not arrived. */
  inFlight: InFlightCopies[];
}

export const NO_HELD_COPIES: HeldCopiesSummary = { total: 0, markers: [], inFlight: [] };

/**
 * Roll the buckets up into the line the intake step draws.
 *
 * `conditionOrder` is the collection's condition dictionary, in display order — the caller already
 * holds it (the intake dialog fills its Condition select from it), so the ordering is the one the
 * collector sees everywhere else rather than a second one invented here. A condition missing from
 * it (deleted while copies still reference it) sorts last rather than being dropped: the copy is
 * held whatever became of the dictionary row.
 */
export function summarizeHeldCopies(
  rows: readonly HeldCopyRow[],
  conditionOrder: readonly string[]
): HeldCopiesSummary {
  const rank = new Map(conditionOrder.map((id, i) => [id, i]));
  /** Conditions in the collection's own display order; an unknown one (deleted while copies still
   *  reference it) sorts last rather than being dropped, the copy being there all the same. */
  const ordered = (byCondition: Map<string, number>): HeldConditionCount[] =>
    [...byCondition.entries()]
      .map(([conditionId, count]) => ({ conditionId, count }))
      .sort(
        (a, b) =>
          (rank.get(a.conditionId) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.conditionId) ?? Number.MAX_SAFE_INTEGER)
      );

  const perMarker = new Map<HeldMarkerKey, Map<string, number>>();
  const perBucket = new Map<CopyDeliveryBucket, Map<string, number>>();
  let total = 0;

  for (const row of rows) {
    const bucket = copyDeliveryBucket(row.deliveryState);
    if (bucket !== "held") {
      // Count and conditions only. The disposition of a copy that has not arrived is unset or
      // provisional, so a marker on it would be a blank dressed up as a decision.
      let byCondition = perBucket.get(bucket);
      if (!byCondition) {
        byCondition = new Map();
        perBucket.set(bucket, byCondition);
      }
      byCondition.set(row.conditionId, (byCondition.get(row.conditionId) ?? 0) + row.count);
      continue;
    }

    total += row.count;
    const carried = HELD_MARKERS.filter((m) =>
      m.key === "unmarked"
        ? !row.inCollection && !row.forSale && !row.forTrade
        : row[m.key as "inCollection" | "forSale" | "forTrade"]
    );
    for (const marker of carried) {
      let byCondition = perMarker.get(marker.key);
      if (!byCondition) {
        byCondition = new Map();
        perMarker.set(marker.key, byCondition);
      }
      byCondition.set(row.conditionId, (byCondition.get(row.conditionId) ?? 0) + row.count);
    }
  }

  const markers: HeldMarker[] = [];
  for (const marker of HELD_MARKERS) {
    const byCondition = perMarker.get(marker.key);
    if (!byCondition) continue;
    const conditions = ordered(byCondition);
    markers.push({
      key: marker.key,
      token: marker.token,
      label: marker.label,
      count: conditions.reduce((sum, c) => sum + c.count, 0),
      conditions,
    });
  }

  const inFlight: InFlightCopies[] = [];
  for (const bucket of IN_FLIGHT_COPY_BUCKETS) {
    const byCondition = perBucket.get(bucket.key);
    if (!byCondition) continue;
    const conditions = ordered(byCondition);
    inFlight.push({
      key: bucket.key,
      state: bucket.state,
      label: bucket.clause,
      count: conditions.reduce((sum, c) => sum + c.count, 0),
      conditions,
    });
  }

  return { total, markers, inFlight };
}

/**
 * One clause's conditions as words — `MNH`, or `3 MNH, 1 U` once the clause spans more than one.
 * Takes any clause on the summary: a disposition marker and an in-flight bucket word their
 * conditions identically, because it is the same question about a different set of copies.
 *
 * The per-condition figures appear **only when there is more than one condition**, not when there
 * is more than one copy. With one condition the clause's own count has already said it — `2 being
 * sorted (2 MNH)` states the same figure twice — while with two, `4 in collection (MNH, U)` leaves
 * the split, which is the thing being asked about, unsaid.
 */
export function heldConditionsText(
  clause: { conditions: readonly HeldConditionCount[] },
  nameFor: (conditionId: string) => string
): string {
  const split = clause.conditions.length > 1;
  return clause.conditions
    .map((c) => (split ? `${c.count} ${nameFor(c.conditionId)}` : nameFor(c.conditionId)))
    .join(", ");
}
