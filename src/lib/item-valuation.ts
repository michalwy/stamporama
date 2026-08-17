import "server-only";
import { prisma } from "./db";
import {
  buildDescendantMap,
  buildEffectivePrimaryCatalogMap,
  getCollectionBaseCurrency,
  safeRateMap,
} from "./pricing";
import type { RawCatalogPrice } from "./catalog-price";
import { makeFormatFactorLookup } from "./format-pricing";
import { valuateCopy, type CopyValuation } from "./valuation";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";

// Split out of `items.ts` so that **market** valuation can reuse it without the two modules
// importing each other: `market-values.ts` values a lot's lines with the very same rule a copy is
// valued by (#456), and `items.ts` in turn needs the market medians for its holdings total (#458).
// One shared module below both is what keeps that from being a cycle.
// ── Copy valuation (ADR-0007 §7) ────────────────────────────────────────────
// Assembles the inputs the pure `valuateCopy` needs (area primary catalog, own +
// descendant-variant prices, currency rates) and delegates the rule to `valuation.ts`.

/**
 * Minimal projection needed to value one thing from the catalog.
 *
 * Nothing here is copy-specific: it is a **stamp × condition × certificate × format**, of which a
 * physical copy is one instance and an auction lot's composition line (#353) is another. `id` is
 * only the key the result map is returned under, so a caller may key by whatever it holds.
 */
export interface ValuationRow {
  id: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** The copy's physical format (#343); null is the single. */
  formatId: string | null;
  /** True when the copy links to a base stamp that has variants (variant unknown). */
  unknownVariant: boolean;
}

const VALUATION_PRICE_SELECT = {
  price: true,
  currency: true,
  conditionId: true,
  certificateStatusId: true,
  // Required by `RawCatalogPrice` (ADR-0020): a copy is valued against prices of *its own*
  // format, and omitting the column here would let a block's price stand in for a single's.
  formatId: true,
  catalogEdition: { select: { year: true, catalogNameId: true } },
} as const;

/** Value a set of {@link ValuationRow}s. Loads the stamp prices, area primary catalogs, descendant
 * variant prices, format factors and currency rates **once** for the whole set, then applies the
 * pure `valuateCopy` rule — which is why every caller batches rather than valuing row by row.
 * Caller must have already asserted collection ownership. Returns id → valuation.
 *
 * Exported for the auction lot composition (#353), whose lines are the same shape at a null
 * certificate: re-deriving the unknown-variant rollup and the format factors there would be two
 * copies of ADR-0020 and #238 to keep in step. */
export async function valuateItemRows(
  collectionId: string,
  rows: ValuationRow[]
): Promise<Map<string, CopyValuation>> {
  if (rows.length === 0) return new Map();

  const [primaryCatalogByArea, baseCurrency] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
  ]);

  const unknownStampIds = new Set(
    rows.filter((r) => r.unknownVariant).map((r) => r.stampId)
  );
  const descendantsByStamp = await buildDescendantMap(collectionId, unknownStampIds);

  // Every stamp whose prices/area we must load: the copies' own stamps plus the
  // descendant variants of any unknown-variant copy.
  const stampIds = new Set<string>();
  for (const r of rows) stampIds.add(r.stampId);
  for (const set of descendantsByStamp.values()) {
    for (const id of set) stampIds.add(id);
  }

  const [stamps, factorLookup] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] } },
      select: {
        id: true,
        // Which descendants are **fully identified** (#617) is a fact about the tree's shape: a node
        // with variant children of its own is an umbrella too (ADR-0010 §3), so it is not expected to
        // carry a price. Read as one column here rather than as a `variants` relation per stamp — the
        // whole subtree is already in this result set, so the parent edges are enough.
        parentId: true,
        catalogPrices: { select: VALUATION_PRICE_SELECT },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        // The issue anchors a format multiplier (#343) — the narrowest anchor a catalog prints one
        // against. A stamp belongs to at most one issue in practice.
        issueMemberships: { select: { issueId: true }, take: 1 },
        ...VARIANT_FLAG_SELECT,
      },
    }),
    makeFormatFactorLookup(collectionId),
  ]);

  const pricesByStamp = new Map<string, RawCatalogPrice[]>();
  const primaryCatalogByStamp = new Map<string, string | null>();
  const areaByStamp = new Map<string, string | null>();
  const issueByStamp = new Map<string, string | null>();
  // Which descendants count as variants (ADR-0010 §3): only variant-kind children
  // feed the lowest-child price; distinct-entry descendants are excluded.
  const isVariantByStamp = new Map<string, boolean>();
  /** Stamps that have a variant-kind child of their own — the ones no price is expected of (#617). */
  const umbrellaStampIds = new Set<string>();
  const currencies: string[] = [];
  for (const s of stamps) {
    pricesByStamp.set(s.id, s.catalogPrices);
    isVariantByStamp.set(s.id, childIsVariant(s));
    if (s.parentId && childIsVariant(s)) umbrellaStampIds.add(s.parentId);
    for (const p of s.catalogPrices) currencies.push(p.currency);
    const link = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    primaryCatalogByStamp.set(
      s.id,
      areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null
    );
    areaByStamp.set(s.id, areaId);
    issueByStamp.set(s.id, s.issueMemberships[0]?.issueId ?? null);
  }

  const rates = await safeRateMap(collectionId, baseCurrency, currencies);

  const result = new Map<string, CopyValuation>();
  for (const r of rows) {
    const descendants = r.unknownVariant
      ? [...(descendantsByStamp.get(r.stampId) ?? new Set<string>())].filter(
          (id) => isVariantByStamp.get(id) ?? false
        )
      : null;
    result.set(
      r.id,
      valuateCopy({
        conditionId: r.conditionId,
        certificateStatusId: r.certificateStatusId,
        formatId: r.formatId,
        // Resolved against the copy's *own* stamp — a variant child's price, when the rollup uses
        // one, is scaled by the same rule, since it shares the umbrella's issue and area.
        formatFactor: factorLookup(
          r.formatId,
          areaByStamp.get(r.stampId) ?? null,
          issueByStamp.get(r.stampId) ?? null,
          r.conditionId
        ),
        unknownVariant: r.unknownVariant,
        primaryCatalogNameId: primaryCatalogByStamp.get(r.stampId) ?? null,
        ownPrices: pricesByStamp.get(r.stampId) ?? [],
        // Tagged with the variant each array belongs to (#616), so the rollup's answer names the
        // stamp it took its figure from.
        variantPrices: descendants
          ? descendants.map((id) => ({
              stampId: id,
              prices: pricesByStamp.get(id) ?? [],
              // A leaf of the variant tree is fully identified; a node with variants of its own is
              // still an umbrella, whose value is the lowest of its children rather than a price of
              // its own (#617).
              identified: !umbrellaStampIds.has(id),
            }))
          : undefined,
        baseCurrency,
        rates,
      })
    );
  }
  return result;
}
