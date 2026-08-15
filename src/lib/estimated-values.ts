import "server-only";
import { prisma } from "./db";
import { buildDescendantMap, getCollectionBaseCurrency } from "./pricing";
import { valuateItemRows, type ValuationRow } from "./item-valuation";
import { readStampMarketValues } from "./market-values";
import { loadRealizationRatios, primaryAreaIdOf, type RatioEvidenceLot } from "./realization-ratios";
import type { RatioBucketLevel } from "./realization-ratio";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";

// **What a stamp with no recorded result of its own is likely worth** (#602; ADR-0022 §6 as
// revised) — catalogue value × the learned realization ratio (#520; ADR-0029 §2).
//
// This is an **extrapolation, and it is labelled as one everywhere it appears**. ADR-0022 §6
// refused to synthesize a market value out of comparable keys' ratios and that refusal still
// holds: nothing here ever enters the Market value figure, the holdings summary bar, the
// collection total or a checklist's market total. What changed is only the conclusion that the app
// should therefore say nothing at all — the lots screen already recommends a bid built from exactly
// this arithmetic, so the Valuation dialog reporting "no auction results recorded" and nothing else
// read as a flat contradiction of a figure the app had just used.
//
// Three rules decide what a cell holds, and each of them is a rule about **not** overstating:
//
//   1. A key with a **measured median** is left empty. The measurement is one section up; an
//      extrapolation of the same cell printed beside it invites reading the gap between the two as
//      a signal, and it is not one.
//   2. A key with **no catalogue value** is empty. There is nothing to multiply.
//   3. The **fallback** rung (#508's `bidFallbackPercent`, reached while nothing has been learned)
//      still produces a figure, because that is precisely the case where the collector most needs
//      to be told the number is policy rather than evidence. The bucket names itself
//      *No recorded results* and the surface says so.
//
// **The catalogue value is `valuateItemRows`'s**, not the dialog's cross-catalogue average: the
// ratio's own denominator is that figure (ADR-0029 §2), and the bid recommendation multiplies that
// figure. Reconciling the two screens is the entire point of this read, so it has to be the same
// number — the area's primary catalogue at its latest edition, format factors per ADR-0020, the
// unknown-variant rollup per #238, in the base currency.
//
// **Which keys exist** is read off the catalogue prices themselves — the stamp's own, plus its
// descendants' when it is an unknown-variant umbrella whose value rolls up from them. That is the
// same idiom every other grid in the window uses (the catalogue tables enumerate their price rows,
// market value its lots, purchase costs its copies), and it follows from rule 2: a key the
// catalogue has never been asked about has no figure to extrapolate from.
//
// **Computed on demand, nothing stored** (ADR-0022 §7), like every other figure in the window.
//
// Ownership is asserted at the entry points; the collection is resolved from the stamp exactly as
// `getStampMarketValueByStamp` resolves it.

/** One estimated cell: a `condition × certificate × format` key, its catalogue value and the
 * extrapolation from it. */
export interface EstimatedValueCell {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
  formatId: string | null;
  formatAbbreviation: string | null;
  formatSortOrder: number;
  /** What the catalogue asks for this key, base currency — the figure the ratio multiplies. */
  catalogueValue: string;
  /** `catalogueValue × ratio`, base currency. */
  estimate: string;
  /** For a set: how many of the checklist's stamps stand behind the figure. Always 1 for a stamp,
   * where the count would be noise. */
  stampCount: number;
}

/**
 * The ratio one row of the grid was extrapolated with.
 *
 * A row, not a cell, because **the ladder buckets on condition** (ADR-0029 §2): each condition
 * resolves its own bucket at its own `n`, and the bucket's name is the whole justification for the
 * figure. Stated beside the condition rather than hidden in a hover, which is the mistake this
 * section exists to correct.
 */
export interface EstimatedValueRow {
  conditionId: string;
  /** `Polska Ludowa, MNH, 1946–1950`, or `All recorded results` / `No recorded results`. Null on a
   * set whose contributing stamps resolved **different** buckets — see `bucketCount`. */
  bucketLabel: string | null;
  /** How many distinct buckets the row's figures came from. 1 for a stamp, always. */
  bucketCount: number;
  /** Unitless. Null on a set, where one row can hold several. */
  ratio: number | null;
  level: RatioBucketLevel | null;
  /** Observations behind the median, after the split-lot dedup. 0 at `fallback`. */
  n: number;
  /** The lots the bucket was learned from, newest first — what the figure expands into. Empty on a
   * set, which does not expand, and at `fallback`, which has no evidence. */
  lots: RatioEvidenceLot[];
}

export interface StampEstimatedValue {
  baseCurrency: string;
  rows: EstimatedValueRow[];
  cells: EstimatedValueCell[];
}

export interface ChecklistEstimatedValue extends StampEstimatedValue {
  checklistName: string;
  requiredCount: number;
}

/** The key a cell is grouped and deduplicated by, within one stamp. */
function cellKeyOf(key: {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}): string {
  return `${key.conditionId}~${key.certificateStatusId ?? ""}~${key.formatId ?? ""}`;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

const STAMP_SELECT = {
  id: true,
  issuedYear: true,
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  variants: { select: VARIANT_FLAG_SELECT },
  ...VARIANT_FLAG_SELECT,
} as const;

/** One stamp's own estimate, before any set-level summing. */
interface StampEstimate {
  cells: Map<string, Omit<EstimatedValueCell, "stampCount">>;
  /** conditionId → the ratio that condition resolved. */
  rows: Map<string, Omit<EstimatedValueRow, "conditionId">>;
}

/**
 * The estimate for a set of stamps, computed off one load of everything it needs.
 *
 * Everything expensive is loaded **once for the whole set**: the ratio evidence (which is the
 * collection's, not the stamps' — bucket 4 is every ratio recorded), the catalogue valuations, and
 * the market medians that decide which cells are measured rather than estimated.
 */
async function estimateStamps(
  collectionId: string,
  stampIds: string[]
): Promise<{ baseCurrency: string; byStamp: Map<string, StampEstimate> }> {
  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const byStamp = new Map<string, StampEstimate>();
  if (stampIds.length === 0) return { baseCurrency, byStamp };

  const stamps = await prisma.stamp.findMany({
    where: { id: { in: stampIds }, collectionId },
    select: STAMP_SELECT,
  });
  if (stamps.length === 0) return { baseCurrency, byStamp };

  // An umbrella's value rolls up from its variant children (#238), so their price rows are where
  // its keys come from too. The rollup itself is `valuateItemRows`'s: a descendant that does not
  // act as a variant contributes a key here and no value there, and the key then drops out — which
  // is cheaper and safer than re-deriving ADR-0010 §3's filter for the enumeration alone.
  const unknownVariant = new Map(stamps.map((s) => [s.id, isUnknownVariantStamp(s)]));
  const descendantsByStamp = await buildDescendantMap(
    collectionId,
    new Set(stamps.filter((s) => unknownVariant.get(s.id)).map((s) => s.id))
  );

  const priceStampIds = new Set<string>(stamps.map((s) => s.id));
  const pricedUnder = new Map<string, Set<string>>();
  for (const stamp of stamps) {
    const under = new Set<string>([stamp.id]);
    for (const id of descendantsByStamp.get(stamp.id) ?? []) {
      under.add(id);
      priceStampIds.add(id);
    }
    pricedUnder.set(stamp.id, under);
  }

  // Every `condition × certificate × format` the catalogue has been asked about, named and ordered
  // — the axes the grid is laid out on.
  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stampId: { in: [...priceStampIds] } },
    select: {
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      condition: { select: { name: true, abbreviation: true, sortOrder: true } },
      certificateStatus: { select: { abbreviation: true, sortOrder: true } },
      format: { select: { abbreviation: true, sortOrder: true } },
    },
  });

  // Per stamp, the distinct keys it could carry a figure at.
  type Axes = Omit<EstimatedValueCell, "catalogueValue" | "estimate" | "stampCount">;
  const keysByStamp = new Map<string, Map<string, Axes>>();
  for (const stamp of stamps) {
    const under = pricedUnder.get(stamp.id)!;
    const keys = new Map<string, Axes>();
    for (const price of prices) {
      if (!under.has(price.stampId)) continue;
      const id = cellKeyOf(price);
      if (keys.has(id)) continue;
      keys.set(id, {
        conditionId: price.conditionId,
        conditionName: price.condition.name,
        conditionAbbreviation: price.condition.abbreviation,
        conditionSortOrder: price.condition.sortOrder,
        certificateStatusId: price.certificateStatusId,
        certificateStatusAbbreviation: price.certificateStatus?.abbreviation ?? null,
        // `-1` for the unmarked default, the convention that makes *No cert.* and the single lead
        // every other grid in this window.
        certificateSortOrder: price.certificateStatus?.sortOrder ?? -1,
        formatId: price.formatId,
        formatAbbreviation: price.format?.abbreviation ?? null,
        formatSortOrder: price.format?.sortOrder ?? -1,
      });
    }
    keysByStamp.set(stamp.id, keys);
  }

  const valuations = await valuateItemRows(
    collectionId,
    stamps.flatMap((stamp) =>
      [...(keysByStamp.get(stamp.id)?.entries() ?? [])].map<ValuationRow>(([id, axes]) => ({
        id: `${stamp.id}~${id}`,
        stampId: stamp.id,
        conditionId: axes.conditionId,
        certificateStatusId: axes.certificateStatusId,
        formatId: axes.formatId,
        unknownVariant: unknownVariant.get(stamp.id) ?? false,
      }))
    )
  );

  const [ratios, marketByStamp] = await Promise.all([
    loadRealizationRatios(collectionId),
    readStampMarketValues(collectionId, stamps.map((s) => s.id)),
  ]);

  for (const stamp of stamps) {
    const keys = keysByStamp.get(stamp.id) ?? new Map<string, Axes>();
    // A key the market has actually measured is not estimated — rule 1.
    const measured = new Set(
      (marketByStamp.get(stamp.id) ?? []).map((value) => cellKeyOf(value))
    );
    const areaId = primaryAreaIdOf(stamp.stampAreaLinks);

    const rows = new Map<string, Omit<EstimatedValueRow, "conditionId">>();
    const cells = new Map<string, Omit<EstimatedValueCell, "stampCount">>();
    for (const [id, axes] of keys) {
      if (measured.has(id)) continue;
      const catalogueValue = valuations.get(`${stamp.id}~${id}`)?.baseAmount ?? null;
      if (catalogueValue === null || catalogueValue <= 0) continue;

      let row = rows.get(axes.conditionId);
      if (!row) {
        const resolved = ratios.resolve({
          areaId,
          conditionId: axes.conditionId,
          issuedYear: stamp.issuedYear,
        });
        row = {
          bucketLabel: resolved.bucketLabel,
          bucketCount: 1,
          ratio: resolved.ratio,
          level: resolved.level,
          n: resolved.n,
          lots: ratios.describeLots(resolved),
        };
        rows.set(axes.conditionId, row);
      }

      cells.set(id, {
        ...axes,
        catalogueValue: catalogueValue.toFixed(2),
        estimate: (catalogueValue * (row.ratio ?? 0)).toFixed(2),
      });
    }

    byStamp.set(stamp.id, { cells, rows });
  }

  return { baseCurrency, byStamp };
}

/** Rows and cells in the collector's own axis order — the one every grid in the dialog uses. */
function ordered(
  rows: EstimatedValueRow[],
  cells: EstimatedValueCell[]
): { rows: EstimatedValueRow[]; cells: EstimatedValueCell[] } {
  const sortOrderOf = new Map(cells.map((c) => [c.conditionId, c.conditionSortOrder]));
  return {
    rows: rows.sort(
      (a, b) => (sortOrderOf.get(a.conditionId) ?? 0) - (sortOrderOf.get(b.conditionId) ?? 0)
    ),
    cells: cells.sort(
      (a, b) =>
        a.conditionSortOrder - b.conditionSortOrder ||
        a.certificateSortOrder - b.certificateSortOrder ||
        a.formatSortOrder - b.formatSortOrder
    ),
  };
}

/**
 * One stamp's estimated value (#602).
 *
 * Empty when every key it carries is either measured already or unpriced — which is the good case,
 * and the section says so in words rather than by being absent.
 */
export async function getStampEstimatedValue(
  ownerId: string,
  stampId: string
): Promise<StampEstimatedValue> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found");
  await assertCollectionOwner(ownerId, stamp.collectionId);

  const { baseCurrency, byStamp } = await estimateStamps(stamp.collectionId, [stampId]);
  const estimate = byStamp.get(stampId);
  if (!estimate) return { baseCurrency, rows: [], cells: [] };

  const { rows, cells } = ordered(
    [...estimate.rows.entries()].map(([conditionId, row]) => ({ conditionId, ...row })),
    [...estimate.cells.values()].map((cell) => ({ ...cell, stampCount: 1 }))
  );
  return { baseCurrency, rows, cells };
}

/**
 * A whole set's estimated value (#602) — the members' estimates summed per cell.
 *
 * The same rule the set's Market value follows: a total with its **coverage count** beside it, and
 * no expansion. Each member contributes to exactly one of the two sections at a given key — the one
 * with a measured median to Market value, the one without to this — so the two coverage counts
 * describe complementary halves of the set rather than the same stamps counted twice.
 *
 * A row can hold several buckets here, since the ladder resolves per stamp: `bucketCount` says how
 * many, and `bucketLabel` is set only when they all agree.
 */
export async function getChecklistEstimatedValue(
  ownerId: string,
  collectionId: string,
  checklistId: string
): Promise<ChecklistEstimatedValue> {
  await assertCollectionOwner(ownerId, collectionId);
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: { name: true },
  });
  if (!checklist) throw new Error("Checklist not found.");

  const members = await prisma.checklistStamp.findMany({
    where: { checklistId },
    select: { stampId: true },
  });
  const { baseCurrency, byStamp } = await estimateStamps(
    collectionId,
    members.map((m) => m.stampId)
  );

  const cells = new Map<string, EstimatedValueCell>();
  const buckets = new Map<string, Set<string>>();
  const sampleRow = new Map<string, Omit<EstimatedValueRow, "conditionId">>();
  for (const estimate of byStamp.values()) {
    for (const [id, cell] of estimate.cells) {
      const total = cells.get(id);
      if (!total) {
        cells.set(id, { ...cell, stampCount: 1 });
        continue;
      }
      total.catalogueValue = (Number(total.catalogueValue) + Number(cell.catalogueValue)).toFixed(2);
      total.estimate = (Number(total.estimate) + Number(cell.estimate)).toFixed(2);
      total.stampCount += 1;
    }
    for (const [conditionId, row] of estimate.rows) {
      let labels = buckets.get(conditionId);
      if (!labels) {
        labels = new Set<string>();
        buckets.set(conditionId, labels);
        sampleRow.set(conditionId, row);
      }
      if (row.bucketLabel) labels.add(row.bucketLabel);
    }
  }

  const { rows, cells: sorted } = ordered(
    [...buckets.entries()].map(([conditionId, labels]) => {
      const sample = sampleRow.get(conditionId)!;
      const one = labels.size === 1;
      return {
        conditionId,
        bucketLabel: one ? [...labels][0] : null,
        bucketCount: labels.size,
        // Stated only when there is one of it: a set whose members resolved different buckets has
        // no single ratio, and printing one of them would name the wrong evidence for the rest.
        ratio: one ? sample.ratio : null,
        level: one ? sample.level : null,
        n: one ? sample.n : 0,
        // A set does not expand — its evidence is every bucket of every member, which is a list
        // read one stamp at a time (the same reason Market value's set total does not expand).
        lots: [],
      };
    }),
    [...cells.values()]
  );

  return {
    baseCurrency,
    checklistName: checklist.name,
    requiredCount: members.length,
    rows,
    cells: sorted,
  };
}
