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
