// The pure half of price observations through the agent API (#1635): how one observation is spelled
// in a batch, and what a recorded or listed one reads back as.
//
// **One observation is one string of `name=value` pairs**, `"stamp=Mi 5; condition=MNH; price=120;
// currency=EUR; sold_on=2024-03-14; platform=Philasearch; house=Köhler; auction=412; lot=1234"` —
// the cell grammar `set_catalog_prices` and the lot lines already use, because a parameter on this
// surface is a scalar or a string list and nothing richer (#706). The bidding assistant reads realised
// prices off a results page by the hundred, and a batch is how it hands them over.
//
// **A batch answers per observation and never fails whole over one** (#1540's rule, which #1635 asks
// for): a page with one misread number is one row to send again. Each row is *recorded*, a
// *duplicate* of a source lot already recorded, or *refused* with the reason.
//
// **What is not established is said, never guessed.** `condition=?` and `certificate=?` record that
// the listing did not establish them, and a stamp named only as an umbrella has not established its
// variant (ADR-0063 §3): each is recorded and kept as a hint, out of every figure. A number that
// names several stamps, or none, is refused — the API never picks one.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { compact } from "./collection-reads";

// -- One observation, as sent ----------------------------------------------------------------

/** The most observations one call records — the list cap, so the answer always fits. */
export const MAX_OBSERVATIONS = 100;

/** The names an observation may carry, in the order the description lists them. */
export const OBSERVATION_FIELDS = [
  "stamp",
  "condition",
  "certificate",
  "format",
  "price",
  "currency",
  "basis",
  "premium",
  "fee",
  "sold_on",
  "platform",
  "house",
  "auction",
  "lot",
  "url",
] as const;

export type ObservationField = (typeof OBSERVATION_FIELDS)[number];

/** The word for *the listing did not establish this*, on a condition or a certificate. */
export const NOT_ESTABLISHED = "?";

/** One observation as sent, split into its fields — nothing resolved yet. */
export interface ObservationSpec {
  readonly stamp: string;
  /** A grade's name; null when the listing did not establish it (`?`, or not sent). */
  readonly condition: string | null;
  /** A status's name, `none`, or null when not sent (none). */
  readonly certificate: string | null;
  /** `certificate=?`: whether there is one was not established. */
  readonly certificateUncertain: boolean;
  readonly format: string | null;
  readonly price: string;
  readonly currency: string | null;
  readonly basis: string | null;
  readonly premium: string | null;
  readonly fee: string | null;
  readonly soldOn: string;
  readonly platform: string;
  readonly house: string | null;
  readonly auction: string | null;
  readonly lot: string | null;
  readonly url: string | null;
}

const EXAMPLE =
  "`stamp=Mi 5; condition=MNH; price=120; currency=EUR; sold_on=2024-03-14; platform=Philasearch; house=Köhler; auction=412; lot=1234`";

/**
 * One observation's `name=value` pairs, separated by `;`, or the reason it is not one.
 *
 * An address may itself carry a `;` — `;jsessionid=…` — so a piece after `url` that does not start
 * with an observation field's name is the address continuing, not a malformed field.
 */
export function parseObservationSpec(
  entry: string
): { ok: true; spec: ObservationSpec } | { ok: false; reason: string } {
  const fields = new Map<ObservationField, string>();
  let last: ObservationField | null = null;
  for (const part of entry.split(";")) {
    const eq = part.indexOf("=");
    const named = eq < 0 ? "" : part.slice(0, eq).trim().toLocaleLowerCase();
    if (part.trim() === "") continue;
    if (last === "url" && !(OBSERVATION_FIELDS as readonly string[]).includes(named)) {
      fields.set("url", `${fields.get("url")};${part.trim()}`);
      continue;
    }
    const name = named;
    const value = eq < 0 ? "" : part.slice(eq + 1).trim();
    if (!name || !value) {
      return { ok: false, reason: `"${part.trim()}" is not \`name=value\`. Write the observation as ${EXAMPLE}.` };
    }
    if (!(OBSERVATION_FIELDS as readonly string[]).includes(name)) {
      return {
        ok: false,
        reason: `"${name}" is not an observation field; an observation takes ${OBSERVATION_FIELDS.join(", ")}.`,
      };
    }
    if (fields.has(name as ObservationField)) {
      return { ok: false, reason: `The observation names "${name}" twice.` };
    }
    fields.set(name as ObservationField, value);
    last = name as ObservationField;
  }
  const missing = (["stamp", "price", "sold_on", "platform"] as const).filter((name) => !fields.has(name));
  if (missing.length > 0) {
    return { ok: false, reason: `The observation has no ${missing.join(" and no ")}. Write it as ${EXAMPLE}.` };
  }
  const condition = fields.get("condition") ?? null;
  const certificate = fields.get("certificate") ?? null;
  return {
    ok: true,
    spec: {
      stamp: fields.get("stamp")!,
      condition: condition === NOT_ESTABLISHED ? null : condition,
      certificate: certificate === NOT_ESTABLISHED ? null : certificate,
      certificateUncertain: certificate === NOT_ESTABLISHED,
      format: fields.get("format") ?? null,
      price: fields.get("price")!,
      currency: fields.get("currency") ?? null,
      basis: fields.get("basis") ?? null,
      premium: fields.get("premium") ?? null,
      fee: fields.get("fee") ?? null,
      soldOn: fields.get("sold_on")!,
      platform: fields.get("platform")!,
      house: fields.get("house") ?? null,
      auction: fields.get("auction") ?? null,
      lot: fields.get("lot") ?? null,
      url: fields.get("url")?.trim() ?? null,
    },
  };
}

/** Refuse a call that carries no observations or more than one call records. */
export function observationCountProblem(count: number): string | null {
  if (count === 0) return `"observations" must carry at least one observation, such as ${EXAMPLE}.`;
  if (count > MAX_OBSERVATIONS) {
    return `"observations" carries ${count} observations; one call records at most ${MAX_OBSERVATIONS}. Send the rest in a second call.`;
  }
  return null;
}

// -- What an observation reads back as -------------------------------------------------------

/** Why an observation is not in the market value — `PriceObservationView.notCounted`. */
export type ObservationNotCounted = "uncertain" | "no-rate" | "no-hammer" | "other-market";

/** What the agent is told about one reason, so it does not have to know the codes. */
export const NOT_COUNTED_REASON: Record<ObservationNotCounted, string> = {
  uncertain: "it does not establish everything a valuation is keyed on (see `doubts`), so it is a hint",
  "no-rate": "no exchange rate of the sale's day could be found for its currency; correcting it tries again",
  "no-hammer": "its fee is more than its all-in price, so no hammer price produces it",
  "other-market": "it was sold in a market that does not anchor this stamp's area, so it is a hint",
};

/** The fields an observation is read from — `PriceObservationView`'s, structurally. */
export interface ObservationViewSource {
  readonly id: string;
  readonly stampId: string;
  readonly conditionName: string | null;
  readonly certificateStatusName: string | null;
  readonly certificateUncertain: boolean;
  readonly formatName: string | null;
  readonly price: string;
  readonly currency: string;
  readonly priceBasis: string;
  readonly premiumPercent: string | null;
  readonly premiumFixed: string | null;
  readonly hammer: string | null;
  readonly allIn: string | null;
  readonly soldOn: string;
  readonly fxRateToBase: string | null;
  readonly baseCurrency: string;
  readonly countedAmount: string | null;
  readonly doubts: readonly string[];
  readonly notCounted: ObservationNotCounted | null;
  readonly market: string | null;
  readonly platformName: string;
  readonly auctionHouseName: string | null;
  readonly auctionName: string | null;
  readonly lotNo: string | null;
  readonly url: string | null;
}

/** One observation, as the agent reads it. */
export interface AgentPriceObservation {
  readonly id: string;
  readonly stampId: string;
  readonly stampNo?: number;
  /** The stamp's leading catalogue number, as the collector reads it. */
  readonly stamp?: string;
  /** Absent when the listing did not establish it. */
  readonly condition?: string;
  /** Absent for *no certificate*; `?` when whether there is one was not established. */
  readonly certificate?: string;
  /** Absent for *single*. */
  readonly format?: string;
  /** As observed, in {@link currency}. */
  readonly price: string;
  readonly currency: string;
  /** `hammer` or `all_in`. */
  readonly basis: string;
  readonly premium?: string;
  readonly fee?: string;
  /** The price both ways, in {@link currency}; absent where the fee makes it impossible. */
  readonly hammer?: string;
  readonly allIn?: string;
  /** `YYYY-MM-DD`. */
  readonly soldOn: string;
  /** The ECB rate of the sale's day into the base currency, frozen at the write. */
  readonly rateToBase?: string;
  /** Whether it counts in the stamp's market value. */
  readonly counted: boolean;
  /** What it counts as: the hammer in {@link baseCurrency}. Only on a counted one. */
  readonly countedAmount?: string;
  readonly baseCurrency: string;
  /** On one not counted: why, as a code and as a sentence. */
  readonly notCounted?: ObservationNotCounted;
  readonly notCountedReason?: string;
  /** What it does not establish: `variant`, `condition`, `certificate`. */
  readonly doubts?: readonly string[];
  /** The country it was sold in — its house's, else its platform's; absent when neither names one,
   *  which counts as the home market. */
  readonly market?: string;
  readonly platform: string;
  readonly house?: string;
  readonly auction?: string;
  readonly lot?: string;
  readonly url?: string;
}

/** The projection. A stamp's label rides beside it, so a list reads without a second call. */
export function agentObservation(
  view: ObservationViewSource,
  label?: { stampNo: number; catalogNumber?: string | null }
): AgentPriceObservation {
  return compact({
    id: view.id,
    stampId: view.stampId,
    stampNo: label?.stampNo,
    stamp: label?.catalogNumber ?? undefined,
    condition: view.conditionName ?? undefined,
    certificate: view.certificateUncertain ? NOT_ESTABLISHED : (view.certificateStatusName ?? undefined),
    format: view.formatName ?? undefined,
    price: view.price,
    currency: view.currency,
    basis: view.priceBasis,
    premium: view.premiumPercent ?? undefined,
    fee: view.premiumFixed ?? undefined,
    hammer: view.hammer ?? undefined,
    allIn: view.allIn ?? undefined,
    soldOn: view.soldOn,
    rateToBase: view.fxRateToBase ?? undefined,
    counted: view.notCounted === null,
    countedAmount: view.countedAmount ?? undefined,
    baseCurrency: view.baseCurrency,
    notCounted: view.notCounted ?? undefined,
    notCountedReason: view.notCounted ? NOT_COUNTED_REASON[view.notCounted] : undefined,
    doubts: view.doubts.length > 0 ? view.doubts : undefined,
    market: view.market ?? undefined,
    platform: view.platformName,
    house: view.auctionHouseName ?? undefined,
    auction: view.auctionName ?? undefined,
    lot: view.lotNo ?? undefined,
    url: view.url ?? undefined,
  }) as AgentPriceObservation;
}

// -- What a batch answers --------------------------------------------------------------------

export type ObservationOutcome = "recorded" | "duplicate" | "refused";

/** One row of a batch's answer. */
export interface AgentObservationAnswer {
  /** The observation as it was sent. */
  readonly entry: string;
  readonly outcome: ObservationOutcome;
  /** On `recorded`: the observation as it now stands. */
  readonly observation?: AgentPriceObservation;
  /** On `duplicate`: the observation already recording this source lot. */
  readonly duplicateOf?: string;
  /** Why a row was refused, or what it duplicates, in a sentence an agent can act on. */
  readonly reason?: string;
}

/** What `record_price_observations` answers. */
export interface AgentObservationBatch {
  readonly recorded: number;
  readonly duplicate: number;
  readonly refused: number;
  /** Of the recorded ones, how many count in a market value now. */
  readonly counted: number;
  readonly observations: readonly AgentObservationAnswer[];
}

export function summarizeObservations(answers: readonly AgentObservationAnswer[]): AgentObservationBatch {
  const count = (outcome: ObservationOutcome) => answers.filter((answer) => answer.outcome === outcome).length;
  return {
    recorded: count("recorded"),
    duplicate: count("duplicate"),
    refused: count("refused"),
    counted: answers.filter((answer) => answer.observation?.counted === true).length,
    observations: answers,
  };
}
