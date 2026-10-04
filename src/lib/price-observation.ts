// **A realised price from someone else's auction** (#1633; ADR-0063). No Prisma import — the rules
// here are what a unit test holds, exactly as `market-value.ts` beside it.
//
// An observation is stored **as observed**: the price a page showed, in its own currency, either the
// hammer or what a buyer paid all-in, with the premium it was subject to. Market value stays on hammer
// prices (ADR-0022 §2), so an all-in figure is reduced by its premium before it counts — the same
// inversion a bid typed into an all-in cell goes through (`bidCosting`), so the two can never round a
// figure differently. Shipping never enters: it is the parcel's, not the stamp's.
//
// Whether an observation **counts** is decided here too, from what it establishes. Two of the three
// doubts are read off the record rather than typed: an unknown-variant umbrella has not established
// its variant, and a missing condition has not established the condition. Only the certificate needs
// its own flag, because null already means *none*.

import { allIn, bidCosting, type Amount, type AuctionFees } from "./auction-lot";

/** How the observed price was stated. */
export const PRICE_BASES = ["hammer", "all_in"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = {
  hammer: "Hammer",
  all_in: "All-in",
};

export function isPriceBasis(value: unknown): value is PriceBasis {
  return typeof value === "string" && (PRICE_BASES as readonly string[]).includes(value);
}

/** What an observation has not established — any one of them and it is a hint, never evidence. */
export type ObservationDoubt = "variant" | "condition" | "certificate";

export const OBSERVATION_DOUBT_LABEL: Record<ObservationDoubt, string> = {
  variant: "variant not established",
  condition: "condition not established",
  certificate: "certificate not established",
};

/**
 * The doubts an observation carries, in a fixed order. Empty means the match is **exact**.
 *
 * `umbrella` is read live off the stamp (`isUnknownVariantStamp`), so a stamp that grows variants
 * after the observation was recorded turns it into a hint without anything being rewritten.
 */
export function observationDoubts(observation: {
  umbrella: boolean;
  conditionId: string | null;
  certificateUncertain: boolean;
}): ObservationDoubt[] {
  const doubts: ObservationDoubt[] = [];
  if (observation.umbrella) doubts.push("variant");
  if (observation.conditionId === null) doubts.push("condition");
  if (observation.certificateUncertain) doubts.push("certificate");
  return doubts;
}

/** The premium an observation was subject to — the per-lot terms, never shipping. */
export interface ObservationPremium {
  premiumPercent: Amount;
  premiumFixed: Amount;
}

function fees(premium: ObservationPremium): AuctionFees {
  return { premiumPercent: premium.premiumPercent, premiumFixed: premium.premiumFixed };
}

/**
 * The observation's price as a **hammer**, in its own currency, 2-dp.
 *
 * A hammer figure is itself. An all-in one is reduced by its premium, rounded to the nearest cent
 * (`bidCosting`); with no premium the two are the same figure, which is the Allegro case. Null when
 * the price is unreadable, and null when the premium alone exceeds an all-in figure — no hammer
 * produces that total, so it states nothing about the stamp.
 */
export function observationHammer(
  price: Amount,
  basis: PriceBasis,
  premium: ObservationPremium
): string | null {
  if (basis === "hammer") return allIn(price, {});
  return bidCosting(price, fees(premium));
}

/** The observation's price **all-in**, in its own currency, 2-dp — the other way round. */
export function observationAllIn(
  price: Amount,
  basis: PriceBasis,
  premium: ObservationPremium
): string | null {
  if (basis === "all_in") return allIn(price, {});
  return allIn(price, fees(premium));
}
