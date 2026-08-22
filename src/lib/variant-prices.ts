import "server-only";
import { prisma } from "./db";
import {
  buildDescendantMap,
  buildEffectiveAreaCatalogMap,
  buildEffectivePrimaryCatalogMap,
} from "./pricing";
import { makeFormatFactorLookup } from "./format-pricing";
import { makeOfferLabeller, STAMP_LABEL_SELECT, type StampLabelRow } from "./offer-labels";
import { getStampConditions, type StampConditionData } from "./conditions";
import { getCertificateStatuses, type CertificateStatusData } from "./certificate-statuses";
import { getStampFormats, type StampFormatData } from "./stamp-formats";
import {
  VARIANT_FLAG_SELECT,
  childIsVariant,
  isUnknownVariantStamp,
} from "./variant-classification";
import { unpricedVariantCells, type CoverageVariant } from "./variant-price-coverage";
import type { RawCatalogPrice } from "./catalog-price";

// The variant price grid (#618): a grid over a **tree**, because that is the shape of the source.
//
// The unknown-variant rollup (#238, #616) picks the lowest price among a stamp's variant children,
// so a tree with three of eight variants priced answers a question about three variants while
// looking like an answer about the stamp — and a listing cannot rest on it at all (#617). Entering
// those prices one dialog at a time is the slowest thing in the workflow: a Michel tree of the
// `309 → 309A → 309AP → 309APa` shape is eight `quick-price-dialog` openings, while the printed
// catalogue they are copied from prints those very figures side by side on one line.
//
// So this module serves one grid — rows are the stamp tree, columns are the collection's conditions
// — and one write per cell. Three axes are chosen **once above the grid** rather than being columns:
// the catalog edition (which fixes the vendor and the currency), the certificate (defaulting to
// none, which is what a catalogue quotes) and the format (tabs, ADR-0020's own choice for the same
// reason a third dimension inline is unreadable).
//
// It **writes `StampCatalogPrice` rows and invents nothing**. An empty cell stays empty, and
// clearing one deletes the row rather than storing a zero. A derived format value may render as a
// cell's placeholder — exactly as the per-stamp grid does — so it stores nothing until typed over.
//
// Scope is an **issue** or a **stamp**, and never an area or a checklist: a checklist is a
// collecting goal (#531) and a variant tree crosses it, while the printed catalogue's page is an
// issue. A stamp scope resolves **up to its tree's root**, because the rollup is taken over the
// whole tree — which is also what lets a per-variant entry point land on the same grid the
// umbrella's own one opens. A scope opened **for one copy** asks `subtree` for the opposite (#679):
// there the stamp named *is* the umbrella being listed, and its ancestors are not the question.

/** What a grid is opened over. */
export type VariantPriceScope =
  | {
      kind: "stamp";
      stampId: string;
      /**
       * Draw **this stamp's own subtree** rather than its whole tree (#679).
       *
       * The default resolves up to the tree's root, which is what an entry point opened to work a
       * tree *through* wants. An opening made **for one copy** is a different question: the item
       * being listed is one umbrella, and `Mi·NL 175`'s whole tree in answer to a question about
       * `175E` buries the two rows that would unblock the listing under five that have nothing to
       * do with it. The rollup stays correct either way — an umbrella's value is the lowest of its
       * **own** descendants, and those are all still drawn.
       */
      subtree?: boolean;
    }
  | { kind: "issue"; issueId: string };

/**
 * The axes an **offer-opened** grid is narrowed to (#633): the `condition × certificate × format`
 * of the copy being listed. A blocker raised on one copy is a question about one cell of each of the
 * tree's rows, and the columns and controls around it are three ways to walk off the axis the
 * question was asked on.
 *
 * It never reaches the server: {@link getVariantPriceGrid} returns the tree whole — every condition,
 * every price, every multiplier — because the three axes above the grid are switched constantly in
 * every *other* entry point, and one payload per opening is the cheaper trade. This is a statement
 * about what the dialog **draws**, so it is applied client-side and the same payload serves both.
 */
export interface VariantPriceRestriction {
  conditionId: string;
  /** Null is *no certificate* — the axis's own value, not "unset" (ADR-0006 §2). */
  certificateStatusId: string | null;
  /** Null is **single**, the format axis's null (ADR-0020). */
  formatId: string | null;
}

/** One row of the grid: a stamp of the tree, at its depth. */
export interface VariantPriceRow {
  stampId: string;
  /** Indentation level; 0 for a root of the rendered tree. */
  depth: number;
  /** The stamp's leading catalog number with its vendor prefix (`Mi·PL 309AP`), else its name. */
  label: string;
  name: string | null;
  /**
   * True when the stamp has no variant children of its own — the rows a catalogue prices directly,
   * and the only ones {@link listUnpricedVariantTrees} counts as gaps. An intermediate node is an
   * umbrella in its own right (ADR-0010 §3), and its cells are **read-only until unlocked** (#627):
   * its value is the lowest of its children, so an open input under it reads as a gap to fill. An
   * umbrella's *own* price still outranks the rollup (#616), which is what the unlock is for.
   */
  identified: boolean;
  /**
   * True when this row **rolls up into its parent** — a variant-kind child (ADR-0010 §3), as against
   * a distinct entry merely filed under it. Reported because the grid draws an umbrella's rolled-up
   * figure client-side (#627) and must take the lowest over the same descendants
   * `valuateCopy` does; the tree's shape alone does not say which children those are.
   */
  isVariant: boolean;
}

/** One catalog edition the grid may be filled in against. */
export interface VariantPriceEdition {
  editionId: string;
  catalogNameId: string;
  vendorAbbreviation: string;
  catalogLabel: string;
  year: number;
  currency: string;
  isPrimary: boolean;
}

/** One recorded price of one of the tree's stamps, on every axis it is keyed by. */
export interface VariantPriceRecord {
  stampId: string;
  catalogEditionId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  /** 2-dp string, in the edition's own currency. */
  amount: string;
}

/** One resolved format multiplier (ADR-0020 §5). Only non-null ones are reported — an absent entry
 *  means nothing derives for that stamp × format × condition, which is the common case. */
export interface VariantPriceFactor {
  stampId: string;
  formatId: string;
  conditionId: string;
  factor: number;
}

export interface VariantPriceGridData {
  collectionId: string;
  /** Names the tree in the dialog's title — the issue, or the root stamp. */
  scopeLabel: string;
  rows: VariantPriceRow[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  formats: StampFormatData[];
  editions: VariantPriceEdition[];
  /** The edition the grid opens on: the primary catalog's latest, else the first listed. Null when
   *  the area has no catalog with an edition, which is the grid's one empty state. */
  defaultEditionId: string | null;
  prices: VariantPriceRecord[];
  formatFactors: VariantPriceFactor[];
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Fields every grid row and every coverage answer is built from. */
const GRID_STAMP_SELECT = {
  // The labeller's own fields lead, so the extras below are read as additions to them rather than
  // as replacements — `name`, `stampAreaLinks` and `issueMemberships` are all it needs.
  ...STAMP_LABEL_SELECT.stamp.select,
  id: true,
  parentId: true,
  ...VARIANT_FLAG_SELECT,
  variants: { select: VARIANT_FLAG_SELECT },
} as const;

type GridStamp = StampLabelRow & {
  id: string;
  parentId: string | null;
  // The stamp's own variant flags, beside its children's: `childIsVariant` reads them to say
  // whether this row rolls up into its parent (#627), which the tree's shape alone does not.
  actsAsVariantOverride: boolean | null;
  subtype: { actsAsVariant: boolean } | null;
  variants: { actsAsVariantOverride: boolean | null; subtype: { actsAsVariant: boolean } | null }[];
};

/**
 * A stamp's ancestry, self first, up to its tree's root. Bounded rather than trusting termination:
 * the tree is user-built and nothing at the database level forbids a cycle (`makeFormatFactorLookup`
 * guards its area walk the same way).
 *
 * The whole chain is walked rather than just the root, because a **subtree** scope (#679) needs the
 * nearest area link at-or-above the stamp it is drawn from: editions and multipliers hang off an
 * area, and a variant node need not carry a `StampAreaLink` of its own.
 */
async function resolveAncestry(
  collectionId: string,
  stampId: string
): Promise<{ id: string; areaId: string | null }[]> {
  const chain: { id: string; areaId: string | null }[] = [];
  let current = stampId;
  const seen = new Set<string>([current]);
  for (let depth = 0; depth < 50; depth++) {
    const stamp = await prisma.stamp.findFirst({
      where: { id: current, collectionId },
      select: {
        parentId: true,
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      },
    });
    const link = stamp?.stampAreaLinks.find((l) => l.isPrimary) ?? stamp?.stampAreaLinks[0] ?? null;
    chain.push({ id: current, areaId: link?.collectionAreaId ?? null });
    const parentId = stamp?.parentId ?? null;
    if (!parentId || seen.has(parentId)) return chain;
    seen.add(parentId);
    current = parentId;
  }
  return chain;
}

/**
 * Sibling order, one rule with a stated fallback: the collector's own position in the issue's tree
 * (#549) where the stamp is a member of one, then the denormalized catalog sort key (ADR-0014), then
 * the id so a tie is at least stable. In an issue scope every row has the first, which is exactly
 * the order the Issues list draws; a stamp scope may reach a descendant belonging to no issue, and
 * there the catalogue's own order is the next best statement.
 */
function compareRows(
  a: GridStamp,
  b: GridStamp,
  sortOrderByStamp: Map<string, number>
): number {
  const ao = sortOrderByStamp.get(a.id);
  const bo = sortOrderByStamp.get(b.id);
  if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
  if (ao !== undefined && bo === undefined) return -1;
  if (ao === undefined && bo !== undefined) return 1;
  const ak = a.primaryCatalogSortKey;
  const bk = b.primaryCatalogSortKey;
  if (ak != null && bk != null && ak !== bk) return ak - bk;
  if (ak != null && bk == null) return -1;
  if (ak == null && bk != null) return 1;
  return a.id.localeCompare(b.id);
}

/** Flatten a set of stamps into indented rows. A stamp whose parent is absent from the set is a
 *  root — `buildStampTree`'s own rule, so a variant whose base is in another issue still shows. */
function flattenTree(
  stamps: GridStamp[],
  sortOrderByStamp: Map<string, number>,
  labelOf: (stamp: GridStamp) => string
): VariantPriceRow[] {
  const present = new Set(stamps.map((s) => s.id));
  const childrenOf = new Map<string | null, GridStamp[]>();
  for (const stamp of stamps) {
    const parent = stamp.parentId && present.has(stamp.parentId) ? stamp.parentId : null;
    const list = childrenOf.get(parent);
    if (list) list.push(stamp);
    else childrenOf.set(parent, [stamp]);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => compareRows(a, b, sortOrderByStamp));

  const rows: VariantPriceRow[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const stamp of childrenOf.get(parentId) ?? []) {
      if (visited.has(stamp.id)) continue;
      visited.add(stamp.id);
      rows.push({
        stampId: stamp.id,
        depth,
        label: labelOf(stamp),
        name: stamp.name?.trim() || null,
        identified: !isUnknownVariantStamp(stamp),
        isVariant: childIsVariant(stamp),
      });
      walk(stamp.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Every edition of every catalog that prices an area, the area's primary catalog first. The books
 * are the area's **effective** ones (#675) — its own, or the nearest ancestor's where it attaches
 * none — so a leaf offers the same editions as the area that declares them. */
async function readAreaEditions(
  collectionId: string,
  areaId: string | null
): Promise<VariantPriceEdition[]> {
  if (!areaId) return [];
  const [primaryByArea, booksByArea] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    buildEffectiveAreaCatalogMap(collectionId),
  ]);
  const primaryCatalogNameId = primaryByArea.get(areaId) ?? null;
  const candidateIds = new Set(booksByArea.get(areaId) ?? []);
  if (primaryCatalogNameId) candidateIds.add(primaryCatalogNameId);
  if (candidateIds.size === 0) return [];

  const catalogs = await prisma.catalogName.findMany({
    where: { id: { in: [...candidateIds] }, vendor: { collectionId } },
    select: {
      id: true,
      name: true,
      currency: true,
      vendor: { select: { abbreviation: true } },
      catalogEditions: { select: { id: true, year: true }, orderBy: { year: "desc" } },
    },
  });
  return catalogs
    .flatMap((c) =>
      c.catalogEditions.map((ed) => ({
        editionId: ed.id,
        catalogNameId: c.id,
        vendorAbbreviation: c.vendor.abbreviation,
        catalogLabel: c.name,
        year: ed.year,
        currency: c.currency,
        isPrimary: c.id === primaryCatalogNameId,
      }))
    )
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (
        a.vendorAbbreviation.localeCompare(b.vendorAbbreviation) ||
        a.catalogLabel.localeCompare(b.catalogLabel) ||
        b.year - a.year
      );
    });
}

/** Which area a grid resolves its catalogs and its multipliers against: the issue's, or the root
 *  stamp's primary area link — the one `format-pricing.ts` resolves a factor against everywhere. */
function areaOfStamp(stamp: StampLabelRow): string | null {
  const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
  return link?.collectionAreaId ?? null;
}

/**
 * Everything one grid draws, in one read: the tree, the dictionaries its axes are built from, the
 * editions it may be filled in against, every price already recorded on those stamps, and the
 * multipliers that derive a format's cell from the single's.
 *
 * Prices come back **whole** rather than narrowed to the opening edition/certificate/format: the
 * three controls above the grid are switched constantly while a tree is worked through, and a
 * refetch per flick of a tab is a worse trade than one payload covering a handful of stamps.
 */
export async function getVariantPriceGrid(
  ownerId: string,
  scope: VariantPriceScope
): Promise<VariantPriceGridData> {
  const { collectionId, stampIds, sortOrderByStamp, scopeLabelIssue, areaId } =
    await resolveScope(ownerId, scope);

  const stamps = (await prisma.stamp.findMany({
    where: { id: { in: stampIds }, collectionId },
    select: GRID_STAMP_SELECT,
  })) as GridStamp[];

  const [labeller, conditions, certificateStatuses, formats, editions, priceRows, factorLookup] =
    await Promise.all([
      makeOfferLabeller(collectionId),
      getStampConditions(ownerId, collectionId),
      getCertificateStatuses(ownerId, collectionId),
      getStampFormats(ownerId, collectionId),
      readAreaEditions(collectionId, areaId),
      stamps.length === 0
        ? Promise.resolve([])
        : prisma.stampCatalogPrice.findMany({
            where: { stampId: { in: stamps.map((s) => s.id) } },
            select: {
              stampId: true,
              catalogEditionId: true,
              conditionId: true,
              certificateStatusId: true,
              formatId: true,
              price: true,
            },
          }),
      makeFormatFactorLookup(collectionId),
    ]);

  const labelOf = (stamp: GridStamp) =>
    labeller.catalogNumbers(stamp)[0] ?? labeller.copy(stamp);
  const rows = flattenTree(stamps, sortOrderByStamp, labelOf);

  // One factor per stamp × format × condition, and only where one actually resolves. The rows of a
  // tree share an area and an issue in every ordinary case, so this is a handful of entries; a
  // collection with no multipliers at all reports none.
  const stampById = new Map(stamps.map((s) => [s.id, s]));
  const formatFactors: VariantPriceFactor[] = [];
  for (const row of rows) {
    const stamp = stampById.get(row.stampId);
    if (!stamp) continue;
    const stampAreaId = areaOfStamp(stamp) ?? areaId;
    const issueId = stamp.issueMemberships[0]?.issueId ?? null;
    for (const format of formats) {
      for (const condition of conditions) {
        const factor = factorLookup(format.id, stampAreaId, issueId, condition.id);
        if (factor != null) {
          formatFactors.push({
            stampId: row.stampId,
            formatId: format.id,
            conditionId: condition.id,
            factor,
          });
        }
      }
    }
  }

  const rootLabel = rows[0] ? `${rows[0].label}${rows[0].name ? ` — ${rows[0].name}` : ""}` : "";
  return {
    collectionId,
    scopeLabel: scopeLabelIssue ?? rootLabel,
    rows,
    conditions,
    certificateStatuses,
    formats,
    editions,
    defaultEditionId: editions[0]?.editionId ?? null,
    prices: priceRows.map((p) => ({
      stampId: p.stampId,
      catalogEditionId: p.catalogEditionId,
      conditionId: p.conditionId,
      certificateStatusId: p.certificateStatusId,
      formatId: p.formatId,
      amount: p.price.toFixed(2),
    })),
    formatFactors,
  };
}

/** Which stamps a scope covers, and what the grid is named after. */
async function resolveScope(
  ownerId: string,
  scope: VariantPriceScope
): Promise<{
  collectionId: string;
  stampIds: string[];
  /** `IssueMember.sortOrder` per stamp, where the stamp is a member of the scope's issue. */
  sortOrderByStamp: Map<string, number>;
  /** The issue's own name, or null in a stamp scope where the root stamp names the grid. */
  scopeLabelIssue: string | null;
  areaId: string | null;
}> {
  if (scope.kind === "issue") {
    const issue = await prisma.issue.findUnique({
      where: { id: scope.issueId },
      select: { collectionId: true, collectionAreaId: true, name: true, year: true },
    });
    if (!issue) throw new Error("Issue not found.");
    await assertCollectionOwner(ownerId, issue.collectionId);
    const members = await prisma.issueMember.findMany({
      where: { issueId: scope.issueId },
      select: { stampId: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
    });
    return {
      collectionId: issue.collectionId,
      stampIds: members.map((m) => m.stampId),
      sortOrderByStamp: new Map(members.map((m) => [m.stampId, m.sortOrder])),
      scopeLabelIssue:
        issue.name ?? (issue.year != null ? String(issue.year) : "(unnamed issue)"),
      areaId: issue.collectionAreaId,
    };
  }

  const stamp = await prisma.stamp.findUnique({
    where: { id: scope.stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found.");
  await assertCollectionOwner(ownerId, stamp.collectionId);
  const ancestry = await resolveAncestry(stamp.collectionId, scope.stampId);
  // Where the drawn tree starts: the stamp itself for a scope opened over one copy's umbrella
  // (#679), else the root of the tree it hangs in.
  const rootId = scope.subtree ? scope.stampId : (ancestry[ancestry.length - 1]?.id ?? scope.stampId);
  const descendants = await buildDescendantMap(stamp.collectionId, new Set([rootId]));
  const stampIds = [rootId, ...(descendants.get(rootId) ?? new Set<string>())];

  // Which area the editions and the multipliers are resolved against. A whole tree takes its
  // root's, as it always has; a subtree takes the nearest link at-or-above the stamp it is drawn
  // from, since a variant node need not carry one of its own and a grid with no editions could not
  // be filled in at all.
  const areaId = scope.subtree
    ? (ancestry.find((a) => a.areaId != null)?.areaId ?? null)
    : (ancestry[ancestry.length - 1]?.areaId ?? null);

  // The root's own issue supplies the sibling order for every row that belongs to it; a descendant
  // in no issue falls back to the catalogue's own order (see `compareRows`).
  const members = await prisma.issueMember.findMany({
    where: { stampId: { in: stampIds } },
    select: { stampId: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
  });
  const sortOrderByStamp = new Map<string, number>();
  for (const m of members) if (!sortOrderByStamp.has(m.stampId)) sortOrderByStamp.set(m.stampId, m.sortOrder);
  return {
    collectionId: stamp.collectionId,
    stampIds,
    sortOrderByStamp,
    scopeLabelIssue: null,
    areaId,
  };
}

/** One cell's write. A null `amount` **clears** the cell — the row is deleted rather than stored as
 *  a zero, because an empty cell means "not recorded" and a zero is a price. */
export interface VariantPriceWrite {
  stampId: string;
  catalogEditionId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  amount: number | null;
}

/**
 * Write (or clear) one cell of the grid — the whole of its saving. There is no draft and no Save
 * button: the cell *is* the control, which is the Colnect condition-mapping panel's idiom (#404) and
 * the only one that survives a grid this size, where a lost draft is a page of typing.
 *
 * Every axis is validated against the collection rather than trusted from the client, and the
 * currency comes from the edition's own catalog — never from the payload, which would let two cells
 * of one column disagree about what their figures are denominated in.
 */
export async function setVariantCatalogPrice(
  ownerId: string,
  write: VariantPriceWrite
): Promise<void> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: write.stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found.");
  const collectionId = stamp.collectionId;
  await assertCollectionOwner(ownerId, collectionId);

  const edition = await prisma.catalogEdition.findFirst({
    where: { id: write.catalogEditionId, catalogName: { vendor: { collectionId } } },
    select: { id: true, catalogName: { select: { currency: true } } },
  });
  if (!edition) throw new Error("Catalog edition not found in this collection.");

  const condition = await prisma.stampCondition.findFirst({
    where: { id: write.conditionId, collectionId },
    select: { id: true },
  });
  if (!condition) throw new Error("Condition not found in this collection.");

  if (write.certificateStatusId) {
    const cert = await prisma.certificateStatus.findFirst({
      where: { id: write.certificateStatusId, collectionId },
      select: { id: true },
    });
    if (!cert) throw new Error("Certificate status not found in this collection.");
  }
  if (write.formatId) {
    const format = await prisma.stampFormat.findFirst({
      where: { id: write.formatId, collectionId },
      select: { id: true },
    });
    if (!format) throw new Error("Format not found in this collection.");
  }
  if (write.amount != null && (!Number.isFinite(write.amount) || write.amount < 0)) {
    throw new Error("Enter a valid non-negative amount.");
  }

  // `stamp_catalog_price_unique` uses NULLS NOT DISTINCT, which Prisma cannot target in `upsert`
  // (`quickSetCatalogPrices` finds-then-writes for the same reason).
  const existing = await prisma.stampCatalogPrice.findFirst({
    where: {
      stampId: write.stampId,
      catalogEditionId: write.catalogEditionId,
      conditionId: write.conditionId,
      certificateStatusId: write.certificateStatusId ?? null,
      formatId: write.formatId ?? null,
    },
    select: { id: true },
  });

  if (write.amount == null) {
    if (existing) await prisma.stampCatalogPrice.delete({ where: { id: existing.id } });
    return;
  }
  const data = {
    price: write.amount.toFixed(2),
    currency: edition.catalogName.currency,
  };
  if (existing) {
    await prisma.stampCatalogPrice.update({ where: { id: existing.id }, data });
  } else {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: write.stampId,
        catalogEditionId: write.catalogEditionId,
        conditionId: write.conditionId,
        certificateStatusId: write.certificateStatusId ?? null,
        formatId: write.formatId ?? null,
        ...data,
      },
    });
  }
}

/** One umbrella of the worklist: a tree whose variants are not fully priced. */
export interface UnpricedVariantTree {
  /** The umbrella — what the grid is opened over. */
  stampId: string;
  label: string;
  name: string | null;
  issueId: string | null;
  issueLabel: string | null;
  areaName: string | null;
  /** Identified variants under it, at any depth — the denominator. */
  variantCount: number;
  /** How many of those carry no price at one or more of the counted conditions. */
  unpricedVariantCount: number;
  /** `(variant × condition)` cells with no price — what a pass over this tree has to fill. */
  gapCount: number;
}

export interface UnpricedVariantWorklist {
  /** The conditions the count was taken over — named, because they are the whole reason a tree is
   *  on this list or not. */
  conditions: { id: string; name: string; abbreviation: string }[];
  trees: UnpricedVariantTree[];
}

/**
 * Umbrellas whose variants are not fully priced (#618) — so filling the gaps is a session rather
 * than a hunt.
 *
 * Incompleteness is judged **on the conditions the collection actually holds or lists at**, not on
 * every row of the dictionary, or every tree is incomplete for ever: a collection that has never
 * owned a used copy is not missing a used price. The set is the distinct conditions of its
 * undisposed copies, which covers held and listed alike — `forSale` is a disposition of a copy in
 * hand, not a state outside the inventory.
 *
 * Only stamps that **have children** are considered, which is a small fraction of any catalogue, and
 * their descendants' prices are read in one query — the same shape `loadVariantPricesForUmbrellas`
 * uses per page of issues.
 */
export async function listUnpricedVariantTrees(
  ownerId: string,
  collectionId: string
): Promise<UnpricedVariantWorklist> {
  await assertCollectionOwner(ownerId, collectionId);

  const [conditions, heldConditionIds] = await Promise.all([
    getStampConditions(ownerId, collectionId),
    prisma.item
      .findMany({
        where: { collectionId, disposedAt: null },
        select: { conditionId: true },
        distinct: ["conditionId"],
      })
      .then((rows) => new Set(rows.map((r) => r.conditionId))),
  ]);
  const countedConditions = conditions.filter((c) => heldConditionIds.has(c.id));
  const conditionIds = countedConditions.map((c) => c.id);
  const emptyAnswer: UnpricedVariantWorklist = {
    conditions: countedConditions.map((c) => ({
      id: c.id,
      name: c.name,
      abbreviation: c.abbreviation,
    })),
    trees: [],
  };
  if (conditionIds.length === 0) return emptyAnswer;

  const parents = await prisma.stamp.findMany({
    where: { collectionId, variants: { some: {} } },
    select: {
      ...STAMP_LABEL_SELECT.stamp.select,
      id: true,
      variants: { select: VARIANT_FLAG_SELECT },
      // Supersets of what the labeller selects: the worklist row names the area and the issue too.
      stampAreaLinks: {
        select: {
          isPrimary: true,
          collectionAreaId: true,
          collectionArea: { select: { name: true } },
        },
      },
      issueMemberships: {
        select: { issueId: true, issue: { select: { id: true, name: true, year: true } } },
        take: 1,
      },
    },
  });
  const umbrellas = parents.filter((p) => isUnknownVariantStamp(p));
  if (umbrellas.length === 0) return emptyAnswer;

  const descendantsByStamp = await buildDescendantMap(
    collectionId,
    new Set(umbrellas.map((u) => u.id))
  );
  const descendantIds = new Set<string>();
  for (const set of descendantsByStamp.values()) for (const id of set) descendantIds.add(id);
  if (descendantIds.size === 0) return emptyAnswer;

  const [descendants, primaryByArea, labeller] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...descendantIds] } },
      select: {
        id: true,
        ...VARIANT_FLAG_SELECT,
        variants: { select: VARIANT_FLAG_SELECT },
        catalogPrices: {
          select: {
            price: true,
            currency: true,
            conditionId: true,
            certificateStatusId: true,
            formatId: true,
            catalogEdition: { select: { year: true, catalogNameId: true } },
          },
        },
      },
    }),
    buildEffectivePrimaryCatalogMap(collectionId),
    makeOfferLabeller(collectionId),
  ]);

  const byId = new Map(descendants.map((d) => [d.id, d]));
  const trees: UnpricedVariantTree[] = [];
  for (const umbrella of umbrellas) {
    const link =
      umbrella.stampAreaLinks.find((l) => l.isPrimary) ?? umbrella.stampAreaLinks[0] ?? null;
    const primaryCatalogNameId = link ? (primaryByArea.get(link.collectionAreaId) ?? null) : null;
    const variants: CoverageVariant[] = [...(descendantsByStamp.get(umbrella.id) ?? [])]
      .map((id) => byId.get(id))
      .filter((d): d is (typeof descendants)[number] => d !== undefined)
      // Only variant-kind descendants roll up (#238), which is the same filter the valuation makes.
      .filter((d) => childIsVariant(d))
      .map((d) => ({
        stampId: d.id,
        identified: !isUnknownVariantStamp(d),
        prices: d.catalogPrices as RawCatalogPrice[],
      }));
    const identified = variants.filter((v) => v.identified);
    if (identified.length === 0) continue;
    const cells = unpricedVariantCells({ variants, conditionIds, primaryCatalogNameId });
    if (cells.length === 0) continue;
    const issue = umbrella.issueMemberships[0]?.issue ?? null;
    trees.push({
      stampId: umbrella.id,
      label: labeller.catalogNumbers(umbrella)[0] ?? labeller.copy(umbrella),
      name: umbrella.name?.trim() || null,
      issueId: issue?.id ?? null,
      issueLabel: issue
        ? (issue.name ?? (issue.year != null ? String(issue.year) : "(unnamed issue)"))
        : null,
      areaName: link?.collectionArea.name ?? null,
      variantCount: identified.length,
      unpricedVariantCount: new Set(cells.map((c) => c.stampId)).size,
      gapCount: cells.length,
    });
  }

  // Widest gap first: the tree furthest from being usable is the one a session should start with,
  // and within a tie the catalogue's own order keeps a series together.
  trees.sort(
    (a, b) =>
      b.gapCount - a.gapCount ||
      (a.areaName ?? "").localeCompare(b.areaName ?? "") ||
      a.label.localeCompare(b.label)
  );
  return { ...emptyAnswer, trees };
}
