// Pure cost-basis resolution (ADR-0009 §2/§3, #123). No Prisma / server-only, so it is
// unit-testable in isolation and shared by both the server read models and client rows.
//
// A copy's cost-basis is the base-currency snapshot frozen when its owning `PurchaseLot`
// closes (`Item.costBasis`). It is deliberately null in three distinct situations that a
// raw null cannot tell apart — this accessor turns `(costBasis, lotId, lotStatus)` into a
// single explicit state so views render consistently and downstream profit/loss has one
// documented entry point rather than re-deriving the rules:
//
//   - **known**   — a snapshot has been frozen (`costBasis` is set). The amount is the
//                   acquisition cost in the collection's base currency.
//   - **pending** — the copy belongs to a lot that is still `open`; its cost-basis will be
//                   frozen when the lot closes (ADR-0009 §5). Shown as a pending indicator.
//   - **none**    — no cost-basis applies: the copy has no acquisition lot (added by hand
//                   or via a channel that records no cost), or it was dropped from a closed
//                   lot as not-delivered (ADR-0009 §5) and so carries no frozen cost.
//
// Profit/loss (out of scope for #123) is `sale proceeds − cost-basis`, defined only when
// the state is `known`; a `pending` or `none` copy has no basis to compute against yet.

/** Resolved cost-basis of a copy: a frozen amount, pending on an open lot, or not
 * applicable. See the module header for when each arises. */
export type CostBasisState =
  | { state: "known"; amount: string }
  | { state: "pending" }
  | { state: "none" };

/** The minimal copy projection needed to resolve cost-basis: the frozen snapshot plus the
 * owning lot's id and lifecycle status (`"open" | "closed"`, or null when there is no lot). */
export interface CostBasisInput {
  /** Base-currency snapshot frozen at lot close, or null when not yet frozen. */
  costBasis: string | null;
  /** Owning `PurchaseLot` id, or null when the copy came from no purchase lot. */
  lotId: string | null;
  /** Owning lot's status (`"open" | "closed"`), or null when there is no lot. */
  lotStatus: string | null;
}

/** Resolve a copy's cost-basis into an explicit {@link CostBasisState}. A frozen snapshot
 * always wins (`known`); otherwise a copy on an `open` lot is `pending`, and everything
 * else — no lot, or a closed lot that left this copy without a snapshot — is `none`. This
 * is the documented accessor downstream profit/loss should read cost-basis through. */
export function resolveCostBasis(input: CostBasisInput): CostBasisState {
  if (input.costBasis != null) {
    return { state: "known", amount: input.costBasis };
  }
  if (input.lotId != null && input.lotStatus === "open") {
    return { state: "pending" };
  }
  return { state: "none" };
}

/** Aggregate actual purchase cost-basis over a set of copies (#134), mirroring the shape
 * of a holdings valuation total. Cost-basis snapshots are already frozen in the base
 * currency, so the sum needs no conversion. Copies are split by their {@link CostBasisState}:
 * `known` amounts sum into the total, `pending` (open lot) and `none` (no cost recorded)
 * are counted but never summed. Pure. */
export interface CostBasisTotal {
  baseCurrency: string;
  /** Sum of frozen cost-basis snapshots in the base currency, 2-dp string. */
  totalCostBasis: string;
  /** Copies with a frozen cost-basis contributing to the total. */
  knownCount: number;
  /** Copies whose cost-basis is pending — they belong to a still-open purchase lot. */
  pendingCount: number;
  /** Copies with no cost-basis recorded (added by hand, or dropped from a closed lot). */
  noneCount: number;
}

/** Aggregate per-copy cost-basis into a {@link CostBasisTotal}. See the module header for
 * the per-copy state rules; see the interface for how each state contributes. Pure. */
export function aggregateCostBasis(
  inputs: CostBasisInput[],
  baseCurrency: string
): CostBasisTotal {
  let total = 0;
  let knownCount = 0;
  let pendingCount = 0;
  let noneCount = 0;
  for (const input of inputs) {
    const resolved = resolveCostBasis(input);
    if (resolved.state === "known") {
      knownCount++;
      total += Number(resolved.amount);
    } else if (resolved.state === "pending") {
      pendingCount++;
    } else {
      noneCount++;
    }
  }
  return {
    baseCurrency,
    totalCostBasis: total.toFixed(2),
    knownCount,
    pendingCount,
    noneCount,
  };
}

/** The axes a purchase-cost figure sits at (#560) — the same `condition × certificate × format`
 * key market value is grouped on (ADR-0022 §1), so the Valuation dialog can lay the two grids out
 * against each other cell for cell. Ids only: this half is pure, and the labels are the server
 * read's to attach. */
export interface PurchaseCostKey {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}

/** One copy as the purchase-cost aggregation reads it: its key, its cost-basis inputs, and the
 * date of the order it came in on (null for a copy that came from no purchase). */
export interface PurchaseCostInput extends PurchaseCostKey, CostBasisInput {
  purchasedAt: Date | null;
}

/**
 * What the collector paid at one key (#560).
 *
 * The figures cover the `known` copies **only**. A `pending` copy sits in an open purchase lot, so
 * its share of the pool is not final (ADR-0009 §5) — averaging it in at nothing would understate
 * what was paid, and averaging it in at a guess would state a figure that does not exist yet. It
 * is counted instead, on a line of its own, and so is a copy with no cost recorded at all.
 *
 * A key whose copies are *all* pending or unrecorded therefore has counts and **no figures**, and
 * that is a cell worth drawing: "two of these, cost not settled" is an answer, and an absent row
 * would read as "no copies held".
 */
export interface PurchaseCostCell extends PurchaseCostKey {
  /** Null when no copy at this key has a frozen cost basis. 2-dp strings otherwise. */
  average: string | null;
  min: string | null;
  max: string | null;
  /** Copies with a frozen cost basis — what the three figures above are over. */
  knownCount: number;
  /** Copies whose cost basis is still pending on an open lot. */
  pendingCount: number;
  /** Copies with no cost basis recorded at all. */
  noneCount: number;
  /** Most recent order date among the **priced** copies, i.e. the ones the figures describe.
   * Null when none of them came from a purchase. */
  latestPurchasedAt: Date | null;
}

function purchaseCostKeyOf(key: PurchaseCostKey): string {
  return `${key.conditionId}~${key.certificateStatusId ?? ""}~${key.formatId ?? ""}`;
}

/**
 * Group copies by `condition × certificate × format` and aggregate each group's purchase cost.
 * Pure — the caller has already narrowed to the copies it means (#560 reads the held, unsold ones
 * of one stamp exactly, no rollup from variant children, on #348's rule).
 *
 * Cost-basis snapshots are frozen in the base currency, so nothing is converted here, exactly as
 * {@link aggregateCostBasis} has it.
 */
export function aggregatePurchaseCostsByKey(inputs: PurchaseCostInput[]): PurchaseCostCell[] {
  const groups = new Map<string, { key: PurchaseCostKey; amounts: number[]; dates: Date[]; pending: number; none: number }>();

  for (const input of inputs) {
    const id = purchaseCostKeyOf(input);
    let group = groups.get(id);
    if (!group) {
      group = {
        key: {
          conditionId: input.conditionId,
          certificateStatusId: input.certificateStatusId,
          formatId: input.formatId,
        },
        amounts: [],
        dates: [],
        pending: 0,
        none: 0,
      };
      groups.set(id, group);
    }

    const resolved = resolveCostBasis(input);
    if (resolved.state === "known") {
      group.amounts.push(Number(resolved.amount));
      if (input.purchasedAt) group.dates.push(input.purchasedAt);
    } else if (resolved.state === "pending") {
      group.pending++;
    } else {
      group.none++;
    }
  }

  return [...groups.values()].map((group) => {
    const n = group.amounts.length;
    const sum = group.amounts.reduce((total, amount) => total + amount, 0);
    return {
      ...group.key,
      average: n === 0 ? null : (sum / n).toFixed(2),
      min: n === 0 ? null : Math.min(...group.amounts).toFixed(2),
      max: n === 0 ? null : Math.max(...group.amounts).toFixed(2),
      knownCount: n,
      pendingCount: group.pending,
      noneCount: group.none,
      latestPurchasedAt:
        group.dates.length === 0
          ? null
          : group.dates.reduce((latest, date) => (date > latest ? date : latest)),
    };
  });
}
