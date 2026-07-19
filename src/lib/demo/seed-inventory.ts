import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

// Inventory demo data: owned copies (`Item`), contacts (`Contact` address book),
// certificate statuses, and refinement history (`ItemVariantHistory`). Seeded on
// top of the catalog data (stamps/issues/areas) so the Inventory screen — list,
// filters, holdings valuation — is populated in the demo. Acquisition/cost now live
// on the purchase model (ADR-0009); purchase demo data is seeded by #124.
//
// Fully deterministic: a fixed-seed PRNG drives every choice, so repeated seeds
// produce the same inventory. Stamps are read back in `id` order for stability.

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Static ECB-style reference rates (units per 1 EUR) used to seed exchange
// rates so holdings valuation converts offline in the demo, without hitting the
// live ECB feed. Approximate mid-2020s values; covers every supported base
// currency (see BASE_CURRENCIES).
const EUR_REFERENCE_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.85,
  PLN: 4.3,
  CHF: 0.95,
  CZK: 25.0,
  DKK: 7.46,
  SEK: 11.3,
  NOK: 11.6,
};

// Currencies the demo catalog prices are recorded in (Fischer=PLN, Michel=EUR).
const DEMO_PRICE_CURRENCIES = ["EUR", "PLN"] as const;

const DEMO_CERT_STATUSES: ReadonlyArray<{ name: string; abbreviation: string }> = [
  { name: "Photo Certificate", abbreviation: "Cert" },
  { name: "Expertise Guarantee", abbreviation: "Guar" },
];

interface DemoContact {
  name: string;
  buyer?: boolean;
  seller?: boolean;
  exchangePartner?: boolean;
  auctionHouse?: boolean;
  platform?: boolean;
  other?: boolean;
}

const DEMO_CONTACTS: ReadonlyArray<DemoContact> = [
  { name: "Hobby Stamps Kraków", seller: true },
  { name: "Warsaw Philatelic Auctions", auctionHouse: true },
  { name: "Deutsche Briefmarken GmbH", seller: true },
  { name: "Berlin Auktionshaus", auctionHouse: true },
  { name: "Delcampe", platform: true },
  { name: "Allegro", platform: true },
  { name: "eBay", platform: true },
  { name: "Jan Kowalski", exchangePartner: true },
  { name: "Piotr Nowak", buyer: true, exchangePartner: true },
  { name: "Estate Collection Lot", other: true },
];

const DEMO_NOTES: ReadonlyArray<string> = [
  "Bought at a local stamp fair.",
  "Part of a larger lot.",
  "Excellent centering, fresh colour.",
  "Small thin spot on reverse.",
  "Light hinge remnant.",
  "Corner margin piece.",
  "From an estate purchase.",
  "Nicely cancelled.",
];

// Condition pick weights, aligned to the default condition order
// (MNH, MH, MNG, Used, CTO, FDC). MNH is favoured so a meaningful share of
// copies match the demo catalog prices (all recorded against MNH) and feed the
// holdings valuation.
const CONDITION_WEIGHTS = [45, 20, 6, 22, 4, 3];

function weightedIndex(rng: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export async function seedInventory(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const rng = mulberry32(0x5741_4d50);

  // Exchange rates: seed each demo price currency → the collection base currency
  // so holdings valuation converts offline (no live ECB fetch needed). A single
  // row per pair; runtime treats it as cached (see safeRateMap / getOrFetchRate).
  const collection = await tx.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  const base = collection.baseCurrency;
  const baseRef = EUR_REFERENCE_RATES[base];
  if (baseRef !== undefined) {
    const fetchedAt = new Date();
    for (const from of DEMO_PRICE_CURRENCIES) {
      const fromRef = EUR_REFERENCE_RATES[from];
      if (from === base || fromRef === undefined) continue;
      await tx.exchangeRate.create({
        data: {
          collectionId,
          fromCurrency: from,
          toCurrency: base,
          rate: Math.round((baseRef / fromRef) * 1e6) / 1e6,
          fetchedAt,
        },
      });
    }
  }

  // Certificate statuses (normally empty per #94; seeded here so demo copies can
  // showcase the certificate filter).
  const certStatusIds: string[] = [];
  for (let i = 0; i < DEMO_CERT_STATUSES.length; i++) {
    const cs = await tx.certificateStatus.create({
      data: {
        collectionId,
        name: DEMO_CERT_STATUSES[i].name,
        abbreviation: DEMO_CERT_STATUSES[i].abbreviation,
        sortOrder: i,
      },
    });
    certStatusIds.push(cs.id);
  }

  // Contacts (address book). Under the purchase model (ADR-0009) suppliers link to a
  // `Purchase`, not directly to items; #124 seeds purchases. Seeded here so the
  // Contacts screen is populated in the demo.
  for (const c of DEMO_CONTACTS) {
    await tx.contact.create({
      data: {
        collectionId,
        name: c.name,
        buyer: c.buyer ?? false,
        seller: c.seller ?? false,
        exchangePartner: c.exchangePartner ?? false,
        auctionHouse: c.auctionHouse ?? false,
        platform: c.platform ?? false,
        other: c.other ?? false,
      },
    });
  }

  const conditions = await tx.stampCondition.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (conditions.length === 0) {
    throw new Error("Inventory seed requires seeded conditions.");
  }
  const conditionWeights = CONDITION_WEIGHTS.slice(0, conditions.length);

  const stamps = await tx.stamp.findMany({
    where: { collectionId },
    orderBy: { id: "asc" },
    select: { id: true, parentId: true },
  });

  type ItemData = {
    collectionId: string;
    stampId: string;
    conditionId: string;
    certificateStatusId: string | null;
    inCollection: boolean;
    forSale: boolean;
    forTrade: boolean;
    notes: string | null;
  };

  function buildItem(stamp: (typeof stamps)[number]): ItemData {
    const conditionId = conditions[weightedIndex(rng, conditionWeights)].id;
    const certificateStatusId =
      rng() < 0.07 ? certStatusIds[Math.floor(rng() * certStatusIds.length)] : null;
    const forSale = rng() < 0.15;
    const forTrade = rng() < 0.12;
    const inCollection = !(forSale && rng() < 0.3);

    const notes = rng() < 0.2 ? DEMO_NOTES[Math.floor(rng() * DEMO_NOTES.length)] : null;

    return {
      collectionId,
      stampId: stamp.id,
      conditionId,
      certificateStatusId,
      inCollection,
      forSale,
      forTrade,
      notes,
    };
  }

  // Bulk copies: one per stamp, plus extra copies for a fraction of stamps, to
  // reach a large inventory (~1000+) that exercises endless scroll and valuation.
  const bulk: ItemData[] = [];
  for (const stamp of stamps) {
    let copies = 1;
    if (rng() < 0.35) copies++;
    if (rng() < 0.12) copies++;
    for (let c = 0; c < copies; c++) bulk.push(buildItem(stamp));
  }
  for (let i = 0; i < bulk.length; i += 500) {
    await tx.item.createMany({ data: bulk.slice(i, i + 500) });
  }

  // Refinement history: for each variant stamp, add one copy that was refined
  // from its base stamp, recording an ItemVariantHistory row (#100). Created
  // individually because the history row needs the new item's id.
  const variants = stamps.filter((s) => s.parentId);
  for (const variant of variants) {
    const data = buildItem(variant);
    const item = await tx.item.create({ data, select: { id: true } });
    await tx.itemVariantHistory.create({
      data: {
        itemId: item.id,
        fromStampId: variant.parentId!,
        toStampId: variant.id,
        note: "Refined from the base stamp after closer inspection.",
      },
    });
  }
}
