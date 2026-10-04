import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getCollectionBaseCurrency } from "./pricing";
import { fetchEcbRateOn } from "./exchange-rates";
import { resolvePurchaseContact } from "./contacts";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import {
  normalizeAuctionText,
  normalizeAuctionUrl,
  parseAuctionAmount,
  parsePremiumPercent,
} from "./auction-rules";
import {
  isPriceBasis,
  observationAllIn,
  observationDoubts,
  observationHammer,
  type ObservationDoubt,
  type PriceBasis,
} from "./price-observation";
import type { MarketObservationInput } from "./market-value";
import { resultMarket, type AnchoringResolver, type MarketCode } from "./market-anchoring";
import { loadAnchoring } from "./market-anchorings";

// **Realised prices from other people's auctions** (#1633; ADR-0063) — recorded, corrected, deleted
// and read back. The rules about what an observation *means* are in the pure `price-observation.ts`;
// this module is what needs a database or the network.
//
// An observation is **never** a lot, a sale or a purchase. Nothing here touches those tables, and
// none of their reads touches this one, which is the whole of how an observation stays off the
// watchlist, out of exposure and out of purchase history.
//
// **The rate is the ECB's of the sale's day**, read from the ECB's data API at the write and frozen
// on the row (`fetchEcbRateOn`). The collection's own rate table is today's alone, and a 2021 result
// valued at today's rate would state something that was never true — ADR-0022 §2's argument for a
// lot's frozen rate, applied to a date the collector did not live through. Best-effort, as a lot's
// is: a lookup that fails stores no rate, the observation is kept, and it does not count until a
// later edit finds one.

/** A refusal worth showing as it stands — the form's own wording, not a stack trace. */
export class PriceObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceObservationError";
  }
}

/** The fields as the form submits them. Platform and house are each an id or a typed name. */
export interface PriceObservationRaw {
  conditionId: string | null;
  certificateStatusId: string | null;
  certificateUncertain: boolean;
  formatId: string | null;
  price: string;
  currency: string;
  priceBasis: string;
  premiumPercent: string;
  premiumFixed: string;
  /** `YYYY-MM-DD`. */
  soldOn: string;
  platformId: string | null;
  platformName: string | null;
  auctionHouseId: string | null;
  auctionHouseName: string | null;
  auctionName: string;
  lotNo: string;
  url: string;
}

/** One observation as the Valuation dialog lists it: as observed, as counted, and why not. */
export interface PriceObservationView {
  id: string;
  stampId: string;
  conditionId: string | null;
  conditionName: string | null;
  conditionAbbreviation: string | null;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  certificateUncertain: boolean;
  formatId: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  /** As observed, in its own currency. */
  price: string;
  currency: string;
  priceBasis: PriceBasis;
  premiumPercent: string | null;
  premiumFixed: string | null;
  /** The observed price both ways, in its own currency (ADR-0063 §4). Null where the premium makes
   * the conversion impossible — a premium larger than an all-in price. */
  hammer: string | null;
  allIn: string | null;
  /** `YYYY-MM-DD`. */
  soldOn: string;
  fxRateToBase: string | null;
  baseCurrency: string;
  /** What it counts as: the hammer in the base currency. Null when it does not count. */
  countedAmount: string | null;
  /** Empty when the match is exact. */
  doubts: ObservationDoubt[];
  /** Why an observation is not in the market value, when it is not. `other-market` is a market that
   * does not anchor the stamp's area (#1634) — the last reason checked, so an observation that would
   * not count anywhere says why it would not. */
  notCounted: null | "uncertain" | "no-rate" | "no-hammer" | "other-market";
  /** Its house's market, else its platform's (#1634); null when neither names one, which counts as
   * the home market. */
  market: MarketCode | null;
  platformId: string;
  platformName: string;
  auctionHouseId: string | null;
  auctionHouseName: string | null;
  auctionName: string | null;
  lotNo: string | null;
  url: string | null;
}

/** One stamp's observations, with what the form needs to add another. */
export interface StampPriceObservations {
  collectionId: string;
  baseCurrency: string;
  /** The markets an observation has to come from to count for this stamp (#1634). */
  anchoringMarkets: MarketCode[];
  homeMarket: MarketCode;
  /** The stamp is an unknown-variant umbrella: anything recorded on it is a hint (ADR-0063 §3). */
  umbrella: boolean;
  /** Counted ones first, then the hints; newest sale first in each. */
  observations: PriceObservationView[];
}

/** What a house's own terms propose for a new observation (ADR-0063 §5). */
export interface AuctionHouseTerms {
  premiumPercent: string | null;
  premiumFixed: string | null;
  currency: string | null;
}

// ── Reads ──────────────────────────────────────────────────────────────────

export const OBSERVATION_SELECT = {
  id: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  certificateUncertain: true,
  formatId: true,
  price: true,
  currency: true,
  priceBasis: true,
  premiumPercent: true,
  premiumFixed: true,
  soldOn: true,
  fxRateToBase: true,
  platformId: true,
  auctionHouseId: true,
  auctionName: true,
  lotNo: true,
  url: true,
  condition: { select: { name: true, abbreviation: true, sortOrder: true } },
  certificateStatus: { select: { name: true, abbreviation: true, sortOrder: true } },
  format: { select: { name: true, abbreviation: true, sortOrder: true } },
  platform: { select: { name: true, market: true } },
  auctionHouse: { select: { name: true, market: true } },
  stamp: { select: { ...VARIANT_FLAG_SELECT, variants: { select: VARIANT_FLAG_SELECT } } },
} satisfies Prisma.PriceObservationSelect;

export type ObservationRow = Prisma.PriceObservationGetPayload<{ select: typeof OBSERVATION_SELECT }>;

function decimal(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The pure extraction's view of a row: judged, reduced to the hammer, with its rate. */
export function observationInput(row: ObservationRow, baseCurrency: string): MarketObservationInput {
  const doubts = observationDoubts({
    umbrella: isUnknownVariantStamp(row.stamp),
    conditionId: row.conditionId,
    certificateUncertain: row.certificateUncertain,
  });
  return {
    observationId: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    exact: doubts.length === 0,
    soldOn: row.soldOn,
    hammer: observationHammer(row.price.toString(), basisOf(row.priceBasis), premiumOf(row)),
    fxRateToBase: row.fxRateToBase?.toString() ?? null,
    inBaseCurrency: row.currency === baseCurrency,
    market: observationMarket(row),
  };
}

/** Where an observation was sold: its house's market, else its platform's (#1634). */
export function observationMarket(row: Pick<ObservationRow, "platform" | "auctionHouse">): MarketCode | null {
  return resultMarket(row.auctionHouse, row.platform);
}

function basisOf(value: string): PriceBasis {
  return isPriceBasis(value) ? value : "hammer";
}

function premiumOf(row: { premiumPercent: Prisma.Decimal | null; premiumFixed: Prisma.Decimal | null }) {
  return {
    premiumPercent: row.premiumPercent?.toString() ?? null,
    premiumFixed: row.premiumFixed?.toString() ?? null,
  };
}

function toView(
  row: ObservationRow,
  baseCurrency: string,
  anchoring: AnchoringResolver
): PriceObservationView {
  const basis = basisOf(row.priceBasis);
  const premium = premiumOf(row);
  const price = row.price.toString();
  const hammer = observationHammer(price, basis, premium);
  const doubts = observationDoubts({
    umbrella: isUnknownVariantStamp(row.stamp),
    conditionId: row.conditionId,
    certificateUncertain: row.certificateUncertain,
  });
  const inBase = row.currency === baseCurrency;
  const rate = row.fxRateToBase === null ? null : Number(row.fxRateToBase);

  let notCounted: PriceObservationView["notCounted"] = null;
  let countedAmount: string | null = null;
  if (doubts.length > 0) notCounted = "uncertain";
  else if (hammer === null) notCounted = "no-hammer";
  else if (!inBase && rate === null) notCounted = "no-rate";
  else if (!anchoring.anchors(row.stampId, observationMarket(row))) notCounted = "other-market";
  else countedAmount = (Number(hammer) * (inBase ? 1 : rate!)).toFixed(2);

  return {
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    conditionName: row.condition?.name ?? null,
    conditionAbbreviation: row.condition?.abbreviation ?? null,
    certificateStatusId: row.certificateStatusId,
    certificateStatusName: row.certificateStatus?.name ?? null,
    certificateStatusAbbreviation: row.certificateStatus?.abbreviation ?? null,
    certificateUncertain: row.certificateUncertain,
    formatId: row.formatId,
    formatName: row.format?.name ?? null,
    formatAbbreviation: row.format?.abbreviation ?? null,
    price: row.price.toFixed(2),
    currency: row.currency,
    priceBasis: basis,
    premiumPercent: decimal(row.premiumPercent),
    premiumFixed: decimal(row.premiumFixed),
    hammer,
    allIn: observationAllIn(price, basis, premium),
    soldOn: isoDay(row.soldOn),
    fxRateToBase: row.fxRateToBase?.toString() ?? null,
    baseCurrency,
    countedAmount,
    doubts,
    notCounted,
    platformId: row.platformId,
    platformName: row.platform.name,
    auctionHouseId: row.auctionHouseId,
    auctionHouseName: row.auctionHouse?.name ?? null,
    auctionName: row.auctionName,
    lotNo: row.lotNo,
    url: row.url,
    market: observationMarket(row),
  };
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

async function stampCollection(ownerId: string, stampId: string): Promise<string> {
  const stamp = await prisma.stamp.findUnique({ where: { id: stampId }, select: { collectionId: true } });
  if (!stamp) throw new Error("Stamp not found");
  await assertCollectionOwner(ownerId, stamp.collectionId);
  return stamp.collectionId;
}

/**
 * Every observation recorded on one stamp, counted ones first, then the hints; newest sale first in
 * each. What the Valuation dialog lists under Market value (ADR-0063 §6).
 */
export async function getStampPriceObservations(
  ownerId: string,
  stampId: string
): Promise<StampPriceObservations> {
  const collectionId = await stampCollection(ownerId, stampId);
  const [rows, baseCurrency, stamp, anchoring] = await Promise.all([
    prisma.priceObservation.findMany({
      where: { stampId, collectionId },
      select: OBSERVATION_SELECT,
      orderBy: [{ soldOn: "desc" }, { createdAt: "desc" }],
    }),
    getCollectionBaseCurrency(collectionId),
    prisma.stamp.findUniqueOrThrow({
      where: { id: stampId },
      select: { ...VARIANT_FLAG_SELECT, variants: { select: VARIANT_FLAG_SELECT } },
    }),
    loadAnchoring(collectionId, [stampId]),
  ]);
  const views = rows.map((row) => toView(row, baseCurrency, anchoring));
  return {
    collectionId,
    baseCurrency,
    anchoringMarkets: [...anchoring.anchorsOf(stampId)],
    homeMarket: anchoring.homeMarket,
    umbrella: isUnknownVariantStamp(stamp),
    observations: [
      ...views.filter((v) => v.notCounted === null),
      ...views.filter((v) => v.notCounted !== null),
    ],
  };
}

/**
 * The observations of a set of stamps as the market extraction reads them — **all** of them, judged
 * there: an uncertain or unconvertible one yields no datapoint, so filtering here as well would be a
 * second copy of that rule. Ownership is the caller's, as `readStampMarketValues` has it.
 */
export async function readObservationRows(
  collectionId: string,
  stampIds: string[] | null
): Promise<ObservationRow[]> {
  return prisma.priceObservation.findMany({
    where: { collectionId, ...(stampIds ? { stampId: { in: stampIds } } : {}) },
    select: OBSERVATION_SELECT,
  });
}

/** A house's terms, to propose for a new observation. The contact is read only within the collection. */
export async function getAuctionHouseTerms(
  ownerId: string,
  collectionId: string,
  contactId: string
): Promise<AuctionHouseTerms> {
  await assertCollectionOwner(ownerId, collectionId);
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, collectionId },
    select: { buyerPremiumPercent: true, buyerPremiumFixed: true, defaultCurrency: true },
  });
  return {
    premiumPercent: decimal(contact?.buyerPremiumPercent ?? null),
    premiumFixed: decimal(contact?.buyerPremiumFixed ?? null),
    currency: contact?.defaultCurrency ?? null,
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

interface ParsedObservation {
  conditionId: string | null;
  certificateStatusId: string | null;
  certificateUncertain: boolean;
  formatId: string | null;
  price: string;
  currency: string;
  priceBasis: PriceBasis;
  premiumPercent: string | null;
  premiumFixed: string | null;
  soldOn: Date;
  platformId: string;
  auctionHouseId: string | null;
  auctionName: string | null;
  lotNo: string | null;
  url: string | null;
}

/** `YYYY-MM-DD` to the UTC midnight a `@db.Date` column stores, or null when it is not a real day. */
function parseDay(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || isoDay(date) !== trimmed) return null;
  return date;
}

/** Validate and resolve the form's fields. Creates a platform or house contact for a typed name, as
 * every other party field here does (#120). */
async function parseObservation(
  collectionId: string,
  raw: PriceObservationRaw
): Promise<ParsedObservation> {
  const price = parseAuctionAmount(raw.price, "Price");
  if (!price.ok) throw new PriceObservationError(price.message);
  if (price.value === null || Number(price.value) <= 0) {
    throw new PriceObservationError("Enter the price it sold for.");
  }
  const currency = raw.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new PriceObservationError("Pick the currency of the price.");
  if (!isPriceBasis(raw.priceBasis)) {
    throw new PriceObservationError("Say whether the price is the hammer or all-in.");
  }
  const premiumPercent = parsePremiumPercent(raw.premiumPercent);
  if (!premiumPercent.ok) throw new PriceObservationError(premiumPercent.message);
  const premiumFixed = parseAuctionAmount(raw.premiumFixed, "Lot fee");
  if (!premiumFixed.ok) throw new PriceObservationError(premiumFixed.message);
  const soldOn = parseDay(raw.soldOn);
  if (!soldOn) throw new PriceObservationError("Enter the day of the sale.");
  if (soldOn.getTime() > Date.now()) throw new PriceObservationError("The sale cannot be in the future.");

  // An all-in price the premium alone exceeds has no hammer, and would never count.
  if (
    raw.priceBasis === "all_in" &&
    observationHammer(price.value, "all_in", {
      premiumPercent: premiumPercent.value,
      premiumFixed: premiumFixed.value,
    }) === null
  ) {
    throw new PriceObservationError("The lot fee is more than the all-in price.");
  }

  const conditionId = raw.conditionId?.trim() || null;
  const certificateStatusId = raw.certificateStatusId?.trim() || null;
  const formatId = raw.formatId?.trim() || null;
  const [condition, certificate, format] = await Promise.all([
    conditionId
      ? prisma.stampCondition.findFirst({ where: { id: conditionId, collectionId }, select: { id: true } })
      : null,
    certificateStatusId
      ? prisma.certificateStatus.findFirst({
          where: { id: certificateStatusId, collectionId },
          select: { id: true },
        })
      : null,
    formatId
      ? prisma.stampFormat.findFirst({ where: { id: formatId, collectionId }, select: { id: true } })
      : null,
  ]);
  if (conditionId && !condition) throw new PriceObservationError("That condition no longer exists.");
  if (certificateStatusId && !certificate) {
    throw new PriceObservationError("That certificate status no longer exists.");
  }
  if (formatId && !format) throw new PriceObservationError("That format no longer exists.");

  const platformId = await resolvePurchaseContact(collectionId, {
    id: raw.platformId,
    name: raw.platformName,
    role: "platform",
  });
  if (!platformId) throw new PriceObservationError("Name the platform it was sold on.");
  const auctionHouseId = await resolvePurchaseContact(collectionId, {
    id: raw.auctionHouseId,
    name: raw.auctionHouseName,
    role: "auctionHouse",
  });

  return {
    conditionId,
    certificateStatusId,
    certificateUncertain: raw.certificateUncertain,
    formatId,
    price: price.value,
    currency,
    priceBasis: raw.priceBasis,
    premiumPercent: premiumPercent.value,
    premiumFixed: premiumFixed.value,
    soldOn,
    platformId,
    auctionHouseId,
    auctionName: normalizeAuctionText(raw.auctionName),
    lotNo: normalizeAuctionText(raw.lotNo),
    url: normalizeAuctionUrl(raw.url),
  };
}

/** The ECB rate of the sale's day into the base currency, or null — when none is needed, and when
 * none could be had (see the module comment). */
async function freezeObservationRate(
  collectionId: string,
  currency: string,
  soldOn: Date
): Promise<Prisma.Decimal | null> {
  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  if (currency === baseCurrency) return null;
  try {
    return new Prisma.Decimal(await fetchEcbRateOn(soldOn, currency, baseCurrency));
  } catch {
    return null;
  }
}

/** Record an observation on a stamp. Returns its id. */
export async function createPriceObservation(
  ownerId: string,
  stampId: string,
  raw: PriceObservationRaw
): Promise<string> {
  const collectionId = await stampCollection(ownerId, stampId);
  const input = await parseObservation(collectionId, raw);
  const fxRateToBase = await freezeObservationRate(collectionId, input.currency, input.soldOn);
  const row = await prisma.priceObservation.create({
    data: { collectionId, stampId, ...input, fxRateToBase },
    select: { id: true },
  });
  return row.id;
}

/**
 * Correct an observation. The rate is read again when the day or the currency changed, and when it
 * is missing — a correction is the collector's way of asking for it once more after a failed lookup.
 * Otherwise the frozen rate is kept: re-reading an unchanged day would only ever return the same one.
 */
export async function updatePriceObservation(
  ownerId: string,
  observationId: string,
  raw: PriceObservationRaw
): Promise<void> {
  const existing = await prisma.priceObservation.findUnique({
    where: { id: observationId },
    select: { collectionId: true, currency: true, soldOn: true, fxRateToBase: true },
  });
  if (!existing) throw new PriceObservationError("That observation no longer exists.");
  await assertCollectionOwner(ownerId, existing.collectionId);
  const input = await parseObservation(existing.collectionId, raw);

  const unchanged =
    input.currency === existing.currency && input.soldOn.getTime() === existing.soldOn.getTime();
  const fxRateToBase =
    unchanged && existing.fxRateToBase !== null
      ? existing.fxRateToBase
      : await freezeObservationRate(existing.collectionId, input.currency, input.soldOn);

  await prisma.priceObservation.update({
    where: { id: observationId },
    data: { ...input, fxRateToBase },
  });
}

export async function deletePriceObservation(ownerId: string, observationId: string): Promise<void> {
  const existing = await prisma.priceObservation.findUnique({
    where: { id: observationId },
    select: { collectionId: true },
  });
  if (!existing) return;
  await assertCollectionOwner(ownerId, existing.collectionId);
  await prisma.priceObservation.delete({ where: { id: observationId } });
}
