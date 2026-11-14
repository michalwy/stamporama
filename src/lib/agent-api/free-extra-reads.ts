// A sale's free extras through the agent API (#2532) — the pure half of `find_free_extras`: the
// limits the proposal is made within, and what it says. The candidates and their values are
// `listFreeExtraCandidates`' (`sales.ts`), the very read *Add free extras* (#2408) is drawn from, and
// the proposal is the dialog's own `proposeFreeExtras` — so the agent is proposed what the collector
// would be, within the same count and budget.
//
// **The limits are the dialog's as it opens**: no count, and the budget the sale's terms give the
// order — the platform's (#2409) and the buyer's own (#2416), each field the better for the buyer
// (`combineFreeExtraTerms`), the percentage capped at the maximum (`prefillFreeExtras`). The call may
// state either limit instead, as the collector types one: `count`, and `budget` as an amount or
// `budget_percent` of the order — or `budget: "none"` to drop the terms' budget and propose by count
// alone. Below the terms' minimum, as with no terms at all, no budget applies and nothing is proposed
// unless the call states a limit: the dialog then opens empty, and *Propose* asks for one.
//
// **The agent chooses from the proposal, not the API**: nothing here writes. `add_free_extras` adds
// exactly the copies named.

import { formatItemNo } from "../item-number";
import {
  combineFreeExtraTerms,
  fromCents,
  parseFreeExtraLimits,
  prefillFreeExtras,
  proposeFreeExtras,
  toCents,
  type FreeExtraCandidate,
  type FreeExtraLimits,
  type FreeExtraPlatformDefaults,
  type FreeExtraTermSources,
} from "../free-extra-rules";
import { invalidRequest } from "./errors";

/** The word that drops the terms' budget. */
export const NO_BUDGET = "none";

/** The limits as a call states them — each null where it was left out. */
export interface FreeExtraLimitParams {
  readonly count: number | null;
  readonly budget: string | null;
  readonly budgetPercent: string | null;
}

/** One side's terms as `listFreeExtraCandidates` reads them, in the sale's currency. */
export interface FreeExtraTermsSource {
  readonly minimumOrder: string | null;
  readonly budgetPercent: string | null;
  readonly maximumBudget: string | null;
  readonly convertedFrom: string | null;
}

/** One copy of the read, as `listFreeExtraCandidates` returns it — the fields this projection reads. */
export interface FreeExtraCopySource {
  readonly item: {
    readonly id: string;
    readonly itemNo: number;
    readonly stampName: string | null;
    readonly issueName: string | null;
    readonly issueYear: number | null;
    readonly conditionName: string | null;
    readonly certificateStatusName: string | null;
    readonly formatName: string | null;
  };
  readonly value: string;
  readonly listed: boolean;
}

/** `listFreeExtraCandidates`' answer, as far as this projection reads it. */
export interface FreeExtraCandidatesSource {
  readonly currency: string;
  readonly orderValue: string;
  readonly series: readonly { readonly key: string; readonly title: string; readonly value: string; readonly copies: readonly FreeExtraCopySource[] }[];
  readonly candidates: readonly FreeExtraCopySource[];
  readonly unvaluedCount: number;
  readonly truncated: boolean;
  readonly platformDefaults: (FreeExtraTermsSource & { readonly platformName: string }) | null;
  readonly contactTerms: (FreeExtraTermsSource & { readonly contactName: string }) | null;
}

/** One copy proposed. */
export interface AgentFreeExtraCopy {
  readonly copyId: string;
  readonly copyNo: string;
  readonly stamp?: string;
  readonly issue?: string;
  readonly issueYear?: number;
  /** Absent for a piece, which has no condition (#2383). */
  readonly condition?: string;
  readonly certificate?: string;
  readonly format?: string;
  /** Its catalogue value in the sale's currency. */
  readonly value: string;
  /** On an open offer somewhere — giving it away flags that offer, as any copy sold elsewhere does. */
  readonly listed: boolean;
}

/** A complete set of a series proposed whole (#2422): its copies go together or not at all. */
export interface AgentFreeExtraSeries {
  readonly title: string;
  readonly value: string;
  readonly copies: readonly AgentFreeExtraCopy[];
}

/** One side's terms, in the sale's currency. */
export interface AgentFreeExtraTermsSide {
  readonly name: string;
  readonly minimumOrder: string | null;
  readonly budgetPercent: string | null;
  readonly maximumBudget: string | null;
  /** The amounts were converted into the sale's currency from this one; null where they are in it. */
  readonly convertedFrom: string | null;
}

/** The sale's free-extras terms and what they give this order. */
export interface AgentFreeExtraTerms {
  readonly platform: AgentFreeExtraTermsSide | null;
  readonly buyer: AgentFreeExtraTermsSide | null;
  /** `none` — neither states terms; `below-minimum` — the order is under the minimum, so none is
   *  due; `due` — free extras are due, `budget` saying how much. */
  readonly due: "none" | "below-minimum" | "due";
  /** The budget the terms give this order, in the sale's currency — null where they give none. */
  readonly budget: string | null;
  /** The maximum cut the percentage's figure down. */
  readonly capped: boolean;
  /** Which side each combined field came from. */
  readonly sources: FreeExtraTermSources | null;
}

/** What `find_free_extras` answers. */
export interface AgentFreeExtraProposal {
  readonly saleId: string;
  readonly currency: string;
  readonly orderValue: string;
  readonly terms: AgentFreeExtraTerms;
  /** The limits the proposal was made within; null where none applies — nothing is then proposed. */
  readonly limits: { readonly count: number | null; readonly budget: string | null } | null;
  /** Whole series first, then loose copies, each list in the proposal's order. */
  readonly series: readonly AgentFreeExtraSeries[];
  readonly copies: readonly AgentFreeExtraCopy[];
  /** Every proposed copy, the series' included. */
  readonly count: number;
  readonly value: string;
  /** Copies that could be given away but have no value, so are never proposed. */
  readonly unvaluedCount: number;
  /** More candidates exist than were read — the 500 cheapest are, far more than a parcel takes. */
  readonly truncated: boolean;
}

function termsInCents(side: FreeExtraTermsSource | null): FreeExtraPlatformDefaults | null {
  return (
    side && {
      minimumOrderCents: side.minimumOrder != null ? toCents(side.minimumOrder) : null,
      budgetPercent: side.budgetPercent != null ? Number(side.budgetPercent) : null,
      maximumBudgetCents: side.maximumBudget != null ? toCents(side.maximumBudget) : null,
    }
  );
}

function termsSide(side: FreeExtraTermsSource | null, name: string | undefined): AgentFreeExtraTermsSide | null {
  return side && name !== undefined
    ? {
        name,
        minimumOrder: side.minimumOrder,
        budgetPercent: side.budgetPercent,
        maximumBudget: side.maximumBudget,
        convertedFrom: side.convertedFrom,
      }
    : null;
}

/** The sale's terms combined, and what they give an order of `orderCents`. */
export function freeExtraTerms(
  source: Pick<FreeExtraCandidatesSource, "platformDefaults" | "contactTerms">,
  orderCents: number
): { terms: AgentFreeExtraTerms; budgetCents: number | null } {
  const combined = combineFreeExtraTerms(termsInCents(source.platformDefaults), termsInCents(source.contactTerms));
  const prefill = prefillFreeExtras(combined?.terms ?? null, orderCents);
  const budgetCents = prefill.kind === "due" ? prefill.budgetCents : null;
  return {
    budgetCents,
    terms: {
      platform: termsSide(source.platformDefaults, source.platformDefaults?.platformName),
      buyer: termsSide(source.contactTerms, source.contactTerms?.contactName),
      due: prefill.kind,
      budget: budgetCents != null ? fromCents(budgetCents) : null,
      capped: prefill.kind === "due" && prefill.capped,
      sources: combined?.sources ?? null,
    },
  };
}

/**
 * The limits the proposal is made within: what the call states, each in place of the terms' — the
 * count beside the terms' budget, as the collector types a count into the dialog the budget was
 * filled in. `budget: "none"` drops the terms' budget. Null where no limit applies. A figure the
 * dialog would refuse is refused with its sentence.
 */
export function resolveFreeExtraLimits(
  params: FreeExtraLimitParams,
  termsBudgetCents: number | null,
  orderCents: number
): FreeExtraLimits | null {
  if (params.budget !== null && params.budgetPercent !== null) {
    throw invalidRequest('Send "budget" or "budget_percent", not both — one budget applies.');
  }
  let count: number | null = null;
  if (params.count !== null) {
    const parsed = parseFreeExtraLimits({ count: String(params.count), budget: "", budgetKind: "amount" }, orderCents);
    if (!parsed.ok) throw invalidRequest(`"count": ${parsed.message}`);
    count = parsed.limits.count;
  }
  let budgetCents = termsBudgetCents;
  const stated = params.budget ?? params.budgetPercent;
  if (params.budget !== null && params.budget.trim().toLowerCase() === NO_BUDGET) {
    budgetCents = null;
  } else if (stated !== null) {
    const parameter = params.budget !== null ? "budget" : "budget_percent";
    const parsed = parseFreeExtraLimits(
      { count: "", budget: stated, budgetKind: params.budget !== null ? "amount" : "percent" },
      orderCents
    );
    if (!parsed.ok) throw invalidRequest(`"${parameter}": ${parsed.message}`);
    budgetCents = parsed.limits.budgetCents;
  }
  return count === null && budgetCents === null ? null : { count, budgetCents };
}

function copyOf(row: FreeExtraCopySource): AgentFreeExtraCopy {
  const { item } = row;
  return {
    copyId: item.id,
    copyNo: formatItemNo(item.itemNo),
    ...(item.stampName != null ? { stamp: item.stampName } : {}),
    ...(item.issueName != null ? { issue: item.issueName } : {}),
    ...(item.issueYear != null ? { issueYear: item.issueYear } : {}),
    ...(item.conditionName != null ? { condition: item.conditionName } : {}),
    ...(item.certificateStatusName != null ? { certificate: item.certificateStatusName } : {}),
    ...(item.formatName != null ? { format: item.formatName } : {}),
    value: row.value,
    listed: row.listed,
  };
}

function candidateOf(row: FreeExtraCopySource): FreeExtraCandidate {
  return { itemId: row.item.id, itemNo: row.item.itemNo, valueCents: toCents(row.value), listed: row.listed };
}

/** What the sale proposes within `params`' limits, or the terms' where the call states none. */
export function freeExtraProposal(
  saleId: string,
  source: FreeExtraCandidatesSource,
  params: FreeExtraLimitParams
): AgentFreeExtraProposal {
  const orderCents = toCents(source.orderValue);
  const { terms, budgetCents } = freeExtraTerms(source, orderCents);
  const limits = resolveFreeExtraLimits(params, budgetCents, orderCents);
  const picked = new Set(
    limits === null
      ? []
      : proposeFreeExtras(
          source.candidates.map(candidateOf),
          limits,
          source.series.map((s) => ({ key: s.key, copies: s.copies.map(candidateOf) }))
        )
  );
  const series = source.series
    .filter((s) => s.copies.length > 0 && s.copies.every((c) => picked.has(c.item.id)))
    .map((s) => ({ title: s.title, value: s.value, copies: s.copies.map(copyOf) }));
  const copies = source.candidates.filter((c) => picked.has(c.item.id)).map(copyOf);
  const everyCopy = [...series.flatMap((s) => s.copies), ...copies];
  return {
    saleId,
    currency: source.currency,
    orderValue: source.orderValue,
    terms,
    limits: limits && {
      count: limits.count,
      budget: limits.budgetCents != null ? fromCents(limits.budgetCents) : null,
    },
    series,
    copies,
    count: everyCopy.length,
    value: fromCents(everyCopy.reduce((sum, c) => sum + toCents(c.value), 0)),
    unvaluedCount: source.unvaluedCount,
    truncated: source.truncated,
  };
}
