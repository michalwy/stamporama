import "server-only";
import { prisma } from "./db";
import {
  catalogDigitRuns,
  catalogIdentityKey,
  catalogMatchKey,
  formatCatalogNumber,
} from "./catalog-number";
import {
  buildAreaPrefixNodes,
  effectivePrefixFor,
  type AreaPrefixNode,
} from "./area-prefix";
import { loadIssuePrefixMap } from "./issue-prefix";
import type { IssuePrefixMap } from "./area-vendor";
import { sortPhotos } from "./photos";
import { recomputeStampSortKeys } from "./catalog-sort-key-recompute";
import type { DuplicateCatalogMode } from "./duplicate-catalog";
import {
  proposeBackfill,
  splitColnectNumber,
  type BackfillRefInput,
  type ColnectBackfillProposal,
} from "./colnect-backfill";
import {
  formatPartialDate,
  parseColnectDate,
  proposeIssuedDate,
  type ColnectDateProposal,
  type PartialDate,
} from "./colnect-date";
import { colnectGradeFor, isColnectConditionValue } from "./colnect-conditions";
import {
  attributeWrites,
  proposeStampAttributes,
  type ColnectAttributeDictionaries,
  type ColnectAttributeProposal,
  type ColnectAttributes,
  type CurrentStampAttributes,
} from "./colnect-attributes";
import { COLNECT_PLATFORM_MODULE } from "./platform-modules";
import {
  getModulePlatform,
  listPlatformContactRows,
  setModulePlatform,
} from "./module-platform";
import {
  colnectRefKey,
  decideColnectItem,
  type CandidateStampRefs,
  type ColnectNeedsConfirmReason,
  type ColnectSkippedReason,
  type ResolvedRef,
} from "./colnect-match";

// Per-collection Colnect catalog-abbreviation → local `CatalogVendor` mapping (#248, part of
// #155). Colnect catalog pages print numbers under Colnect's own abbreviations (Mi, Sn, Yt, Sg,
// AFA, Pol…); matching them to our stamps needs a translation to our local vendors, because some
// abbreviations differ — notably Colnect `Pol` is Fischer, which we abbreviate `Fi`. Only the
// mismatches need an explicit row; see {@link resolveColnectAbbreviation} for the fallback.

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveMappingCollection(mappingId: string): Promise<string> {
  const mapping = await prisma.colnectCatalogMapping.findUnique({
    where: { id: mappingId },
    select: { collectionId: true },
  });
  if (!mapping) throw new Error("Colnect mapping not found.");
  return mapping.collectionId;
}

/** Raised when a mapping would reuse a Colnect abbreviation already mapped in the collection
 *  (case-insensitive). The action layer turns it into a user-facing message. */
export class ColnectAbbrevTakenError extends Error {
  constructor(abbrev: string) {
    super(`Colnect abbreviation "${abbrev}" is already mapped.`);
    this.name = "ColnectAbbrevTakenError";
  }
}

export interface ColnectMappingData {
  id: string;
  colnectAbbrev: string;
  catalogVendorId: string;
  vendorName: string;
  vendorAbbreviation: string;
}

/** The explicit mapping rows for a collection, each joined with its local vendor, ordered by the
 *  Colnect abbreviation. Implicit exact-abbreviation matches (see {@link resolveColnectAbbreviation})
 *  are not rows and are not listed here. */
export async function getColnectMappings(
  ownerId: string,
  collectionId: string
): Promise<ColnectMappingData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.colnectCatalogMapping.findMany({
    where: { collectionId },
    orderBy: { colnectAbbrev: "asc" },
    select: {
      id: true,
      colnectAbbrev: true,
      catalogVendorId: true,
      catalogVendor: { select: { name: true, abbreviation: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    colnectAbbrev: r.colnectAbbrev,
    catalogVendorId: r.catalogVendorId,
    vendorName: r.catalogVendor.name,
    vendorAbbreviation: r.catalogVendor.abbreviation,
  }));
}

/** Assert the vendor exists and belongs to `collectionId` (guards against mapping to a vendor
 *  from another collection). */
async function assertVendorInCollection(
  collectionId: string,
  catalogVendorId: string
): Promise<void> {
  const vendor = await prisma.catalogVendor.findFirst({
    where: { id: catalogVendorId, collectionId },
    select: { id: true },
  });
  if (!vendor) throw new Error("Catalog vendor not found in this collection.");
}

/** Reject a Colnect abbreviation that already has a mapping row in the collection, compared
 *  case-insensitively so "Pol" and "pol" can't both exist. `exceptId` skips the row being edited. */
async function assertAbbrevFree(
  collectionId: string,
  colnectAbbrev: string,
  exceptId?: string
): Promise<void> {
  const existing = await prisma.colnectCatalogMapping.findFirst({
    where: {
      collectionId,
      colnectAbbrev: { equals: colnectAbbrev, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new ColnectAbbrevTakenError(colnectAbbrev);
}

export async function createColnectMapping(
  ownerId: string,
  collectionId: string,
  data: { colnectAbbrev: string; catalogVendorId: string }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertVendorInCollection(collectionId, data.catalogVendorId);
  await assertAbbrevFree(collectionId, data.colnectAbbrev);
  await prisma.colnectCatalogMapping.create({
    data: {
      collectionId,
      colnectAbbrev: data.colnectAbbrev,
      catalogVendorId: data.catalogVendorId,
    },
  });
}

export async function updateColnectMapping(
  ownerId: string,
  mappingId: string,
  data: { colnectAbbrev: string; catalogVendorId: string }
): Promise<void> {
  const collectionId = await resolveMappingCollection(mappingId);
  await assertCollectionOwner(ownerId, collectionId);
  await assertVendorInCollection(collectionId, data.catalogVendorId);
  await assertAbbrevFree(collectionId, data.colnectAbbrev, mappingId);
  await prisma.colnectCatalogMapping.update({
    where: { id: mappingId },
    data: { colnectAbbrev: data.colnectAbbrev, catalogVendorId: data.catalogVendorId },
  });
}

export async function deleteColnectMapping(
  ownerId: string,
  mappingId: string
): Promise<void> {
  const collectionId = await resolveMappingCollection(mappingId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.colnectCatalogMapping.delete({ where: { id: mappingId } });
}

/** Resolution of a Colnect abbreviation to a local vendor, plus where it came from:
 *  `explicit` = a mapping row, `exact` = fell back to a local vendor with the same abbreviation. */
export interface ColnectResolution {
  catalogVendorId: string;
  source: "explicit" | "exact";
}

/**
 * Resolve a single Colnect catalog abbreviation to a local `CatalogVendor` for `collectionId`:
 *   1. an explicit mapping row (case-insensitive on the Colnect abbreviation) wins;
 *   2. else a local vendor whose own `abbreviation` equals it (case-insensitive);
 *   3. else `null` — unmapped, ignored by the matcher (not an error).
 * Owner-authorized. This is the read primitive the number-matcher (#155) builds on.
 */
export async function resolveColnectAbbreviation(
  ownerId: string,
  collectionId: string,
  colnectAbbrev: string
): Promise<ColnectResolution | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const abbrev = colnectAbbrev.trim();
  if (!abbrev) return null;

  const explicit = await prisma.colnectCatalogMapping.findFirst({
    where: { collectionId, colnectAbbrev: { equals: abbrev, mode: "insensitive" } },
    select: { catalogVendorId: true },
  });
  if (explicit) return { catalogVendorId: explicit.catalogVendorId, source: "explicit" };

  const exact = await prisma.catalogVendor.findFirst({
    where: { collectionId, abbreviation: { equals: abbrev, mode: "insensitive" } },
    select: { id: true },
  });
  if (exact) return { catalogVendorId: exact.id, source: "exact" };

  return null;
}

// ── Condition mapping (#404, part of #155) ───────────────────────────────────
//
// The condition-side counterpart of the catalog mapping above, and configured in the same Settings
// tab. `StampCondition` is the collector's own grade list; Colnect's is fixed and global (#402), so
// a mapping row stores only Colnect's option value and the label comes from the built-in
// vocabulary. Unlike the catalog mapping there is no fallback and nothing is ignored: a condition
// with no row is unmapped, which listing preconditions (#406) report rather than guess around.

/** One of our conditions with the Colnect grade it maps to (null = not mapped). The panel lists
 *  **every** condition, so the row exists whether or not a mapping does. */
export interface ColnectConditionMappingData {
  stampConditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  /** Colnect's option value, or null when the condition is unmapped. */
  colnectValue: string | null;
  /** What that value renders as on Colnect's form, resolved from the built-in list. Null with the
   *  value, and also when a stored value is no longer one Colnect offers. */
  colnectLabel: string | null;
}

/** Raised when a mapping would store a value Colnect does not offer — a grade that cannot be
 *  rendered or posted is worse than no mapping at all. */
export class ColnectConditionValueError extends Error {
  constructor(value: string) {
    super(`"${value}" is not one of Colnect's condition values.`);
    this.name = "ColnectConditionValueError";
  }
}

/**
 * Every condition of the collection, in the collector's own order, each with the Colnect grade it
 * maps to. Owner-authorized. This is what the Settings panel renders: an unmapped condition is a
 * row with a blank select, not a missing row.
 */
export async function getColnectConditionMappings(
  ownerId: string,
  collectionId: string
): Promise<ColnectConditionMappingData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.stampCondition.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      colnectMapping: { select: { colnectValue: true } },
    },
  });
  return rows.map((r) => {
    const value = r.colnectMapping?.colnectValue ?? null;
    return {
      stampConditionId: r.id,
      conditionName: r.name,
      conditionAbbreviation: r.abbreviation,
      colnectValue: value,
      colnectLabel: value ? (colnectGradeFor(value)?.label ?? null) : null,
    };
  });
}

/**
 * Map one of our conditions to a Colnect grade, or **unmap** it by passing null — clearing is a
 * delete rather than a stored blank, so "unmapped" has one representation everywhere. Owner-
 * authorized through the condition's own collection. Throws {@link ColnectConditionValueError} for
 * a value outside {@link COLNECT_CONDITIONS}.
 */
export async function setColnectConditionMapping(
  ownerId: string,
  stampConditionId: string,
  colnectValue: string | null
): Promise<void> {
  const condition = await prisma.stampCondition.findUnique({
    where: { id: stampConditionId },
    select: { collectionId: true },
  });
  if (!condition) throw new Error("Stamp condition not found.");
  await assertCollectionOwner(ownerId, condition.collectionId);

  const value = colnectValue?.trim() || null;
  if (value === null) {
    await prisma.colnectConditionMapping.deleteMany({ where: { stampConditionId } });
    return;
  }
  if (!isColnectConditionValue(value)) throw new ColnectConditionValueError(value);
  await prisma.colnectConditionMapping.upsert({
    where: { stampConditionId },
    create: { collectionId: condition.collectionId, stampConditionId, colnectValue: value },
    update: { colnectValue: value },
  });
}

/**
 * The collection's condition mapping as a lookup: our `StampCondition` id → Colnect's option value.
 * This is the read primitive the listing kit (#405) and the listing preconditions (#406) build on —
 * loaded **once per offer**, never per copy, since a komplet is dozens of copies over a handful of
 * conditions. A condition missing from the map is unmapped, and that is deliberately all this says:
 * what to do about it belongs to the caller. The caller must already have authorized the collection.
 */
export async function loadColnectConditionMap(
  collectionId: string
): Promise<Map<string, string>> {
  const rows = await prisma.colnectConditionMapping.findMany({
    where: { collectionId },
    select: { stampConditionId: true, colnectValue: true },
  });
  return new Map(rows.map((r) => [r.stampConditionId, r.colnectValue]));
}

// ── Which platform is Colnect (#406) ─────────────────────────────────────────
//
// The listing preconditions are **Colnect's own rules** — an item-ID on every stamp, a grade for
// every condition, interchangeable sets — so they are only worth checking on offers actually headed
// for Colnect. Which platform `Contact` that is has to be said somewhere, and it is said **here**,
// beside the two vocabulary mappings, rather than as a field on the contact form: it is one fact per
// collection, and the collector who is setting up Colnect is looking at this tab.
//
// The store is `Contact.platformModule` (the extension's `PlatformModule` id, #408), so the offer
// side asks the platform and never this setting. Exactly **one** contact may hold it: Colnect is one
// marketplace, and two platforms claiming it could only disagree.

// The exclusivity rule itself lives in `module-platform.ts` since #355, where Allegro asks the same
// question on its own tab: an exclusive setter written twice is a rule that drifts. What stays here
// is the ownership check and the Colnect id.

/** The platform contact currently marked as Colnect, or null when none is. */
export async function getColnectPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, COLNECT_PLATFORM_MODULE);
}

/** Every platform contact of the collection, for the picker — a listing platform is the only kind
 *  of contact that could be Colnect. */
export async function listPlatformContacts(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return listPlatformContactRows(collectionId);
}

/**
 * Mark one platform contact as Colnect, or clear the setting with null. **Exclusive**: whoever held
 * it before is cleared in the same transaction, so the collection can never have two Colnect
 * platforms and "which one is it" always has one answer. Passing a contact that is not a platform of
 * this collection is refused — the marker only means anything on a platform an offer can be listed
 * on.
 */
export async function setColnectPlatform(
  ownerId: string,
  collectionId: string,
  contactId: string | null
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await setModulePlatform(collectionId, COLNECT_PLATFORM_MODULE, contactId);
}

// ── Catalog-number matcher (#250, part of #155) ──────────────────────────────
//
// Receives a batch of Colnect items (each a numeric Colnect ID plus the catalog references printed
// on its page) and decides which of our stamps each one is, writing the Colnect ID onto unambiguous
// matches. Matching is strict full-key: a Colnect ref matches a stamp only when
// `vendorAbbrev + effectiveAreaPrefix + number` is exactly equal (see {@link colnectRefKey} and
// `catalogMatchKey`). The write target is the plain `Stamp.colnectId` field (#247). All decisions
// follow the agreed matrix in {@link decideColnectItem}; `dryRun` computes them without persisting.

/** The per-collection lookups both the matcher and the backfill need, loaded once per request. */
interface ColnectContext {
  vendorAbbrById: Map<string, string>;
  /** Colnect abbreviation → local vendor id, applying the same precedence as
   *  {@link resolveColnectAbbreviation} (explicit mapping, then equal local abbreviation). */
  resolveVendorId: (colnectAbbrev: string) => string | null;
  areaNodes: Map<string, AreaPrefixNode>;
  areaNames: Map<string, string>;
  /** Per-issue overrides of the area-resolved prefix (#377). Part of the *match key*, not only of
   * the label: an issue numbering under its own sub-catalog holds a different catalog identity, and
   * Colnect matching is strict full-key. */
  issuePrefixes: IssuePrefixMap;
  /** The collection's duplicate-catalog policy (#85), which the backfill has to respect. */
  duplicateMode: DuplicateCatalogMode;
}

async function loadColnectContext(collectionId: string): Promise<ColnectContext> {
  const [vendors, mappings, areaRows, issuePrefixes, collection] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    prisma.colnectCatalogMapping.findMany({
      where: { collectionId },
      select: { colnectAbbrev: true, catalogVendorId: true },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        catalogPrefix: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
    loadIssuePrefixMap(collectionId),
    prisma.collection.findUnique({
      where: { id: collectionId },
      select: { duplicateCatalogMode: true },
    }),
  ]);

  const explicitByAbbrev = new Map(
    mappings.map((m) => [m.colnectAbbrev.trim().toLowerCase(), m.catalogVendorId])
  );
  const exactByAbbrev = new Map(vendors.map((v) => [v.abbreviation.trim().toLowerCase(), v.id]));

  return {
    vendorAbbrById: new Map(vendors.map((v) => [v.id, v.abbreviation])),
    resolveVendorId: (colnectAbbrev: string) => {
      const key = colnectAbbrev.trim().toLowerCase();
      if (!key) return null;
      return explicitByAbbrev.get(key) ?? exactByAbbrev.get(key) ?? null;
    },
    areaNodes: buildAreaPrefixNodes(areaRows),
    areaNames: new Map(areaRows.map((a) => [a.id, a.name])),
    issuePrefixes,
    duplicateMode: collection?.duplicateCatalogMode === "block" ? "block" : "warn",
  };
}

// ── Catalog-number backfill (#280) ───────────────────────────────────────────
//
// A matched stamp is filled from the Colnect page for every catalog it has *no* number for. The
// decision per reference is pure ({@link proposeBackfill}); what lives here is the collection
// context around it: resolving Colnect abbreviations, the stamp's effective area prefixes, the
// duplicate policy (#85), and the write itself.

/** The stamp a backfill is computed against: its area *and* issue (which together resolve its
 * prefixes, #377) and its current numbers. */
interface BackfillStamp {
  stampId: string;
  areaId: string | null;
  issueId: string | null;
  numbersByVendor: Map<string, string>;
}

/** Propose fills for one stamp from the resolvable references of one Colnect item. */
function backfillFor(
  stamp: BackfillStamp,
  refs: readonly { catalog: string; number: string; catalogVendorId: string | null }[],
  ctx: ColnectContext
): ColnectBackfillProposal[] {
  const usable: BackfillRefInput[] = refs
    .filter((r): r is typeof r & { catalogVendorId: string } => r.catalogVendorId !== null)
    .map((r) => ({
      catalog: r.catalog,
      printedNumber: r.number,
      catalogVendorId: r.catalogVendorId,
      vendorAbbreviation: ctx.vendorAbbrById.get(r.catalogVendorId) ?? "",
    }));
  if (usable.length === 0) return [];
  const prefixByVendor = new Map(
    [...new Set(usable.map((r) => r.catalogVendorId))].map((vendorId) => [
      vendorId,
      effectivePrefixFor(stamp.areaId, vendorId, ctx.areaNodes, stamp.issueId, ctx.issuePrefixes),
    ])
  );
  return proposeBackfill(usable, { numbersByVendor: stamp.numbersByVendor, prefixByVendor });
}

/** A proposal together with the stamp it would land on, for the collection-wide duplicate check. */
interface PendingFill {
  stamp: BackfillStamp;
  proposal: ColnectBackfillProposal;
}

/**
 * Apply the collection's duplicate-catalog policy (#85) to every proposed fill: a fill whose
 * resulting identity (vendor + effective area prefix + number) already exists on another stamp is
 * turned into `duplicate` under `block`, or kept and flagged under `warn`. Mutates the proposals in
 * place — they are the same objects the results already reference.
 */
async function markBackfillDuplicates(
  collectionId: string,
  pending: readonly PendingFill[],
  ctx: ColnectContext
): Promise<void> {
  const fills = pending.filter((p) => p.proposal.status === "would-fill" && p.proposal.number);
  if (fills.length === 0) return;

  const rows = await prisma.stampCatalogNumber.findMany({
    where: {
      catalogVendorId: { in: [...new Set(fills.map((f) => f.proposal.catalogVendorId))] },
      number: { in: [...new Set(fills.map((f) => f.proposal.number!))] },
      stamp: { collectionId },
    },
    select: {
      catalogVendorId: true,
      number: true,
      stamp: {
        select: {
          id: true,
          name: true,
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          // An issue may override the area's prefix, and so decide whether this row really holds
          // the identity a fill would land on (#377).
          issueMemberships: { select: { issueId: true }, take: 1 },
        },
      },
    },
  });

  const holdersByIdentity = new Map<string, { id: string; name: string | null }[]>();
  for (const row of rows) {
    const link = row.stamp.stampAreaLinks.find((l) => l.isPrimary) ?? row.stamp.stampAreaLinks[0];
    const prefix = effectivePrefixFor(
      link?.collectionAreaId ?? null,
      row.catalogVendorId,
      ctx.areaNodes,
      row.stamp.issueMemberships[0]?.issueId ?? null,
      ctx.issuePrefixes
    );
    const key = catalogIdentityKey(row.catalogVendorId, prefix, row.number);
    const list = holdersByIdentity.get(key);
    if (list) list.push({ id: row.stamp.id, name: row.stamp.name });
    else holdersByIdentity.set(key, [{ id: row.stamp.id, name: row.stamp.name }]);
  }

  for (const { stamp, proposal } of fills) {
    const prefix = effectivePrefixFor(
      stamp.areaId,
      proposal.catalogVendorId,
      ctx.areaNodes,
      stamp.issueId,
      ctx.issuePrefixes
    );
    const key = catalogIdentityKey(proposal.catalogVendorId, prefix, proposal.number!);
    const holders = (holdersByIdentity.get(key) ?? []).filter((h) => h.id !== stamp.stampId);
    if (holders.length === 0) continue;
    proposal.duplicateStampNames = holders.map((h) => h.name ?? "(unnamed stamp)");
    if (ctx.duplicateMode === "block") {
      proposal.status = "duplicate";
      proposal.number = null;
    } else {
      proposal.duplicateWarning = true;
    }
  }
}

/**
 * Write every still-proposed fill, flipping its status to `filled`. Rows are deduplicated per
 * (stamp, vendor) — the table holds one number per pair, and two Colnect items in one batch can
 * resolve to the same stamp. Recomputes `primaryCatalogSortKey` for the touched stamps (#181).
 */
async function applyBackfill(
  collectionId: string,
  pending: readonly PendingFill[]
): Promise<void> {
  const rows: { stampId: string; catalogVendorId: string; number: string }[] = [];
  const seen = new Set<string>();
  for (const { stamp, proposal } of pending) {
    if (proposal.status !== "would-fill" || !proposal.number) continue;
    const key = `${stamp.stampId}~${proposal.catalogVendorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      stampId: stamp.stampId,
      catalogVendorId: proposal.catalogVendorId,
      number: proposal.number,
    });
    proposal.status = "filled";
  }
  if (rows.length === 0) return;

  await prisma.$transaction(rows.map((data) => prisma.stampCatalogNumber.create({ data })));
  // A new number can change which number is primary for sorting (#181, ADR-0014).
  await recomputeStampSortKeys(collectionId, [...new Set(rows.map((r) => r.stampId))]);
}

// ── Issue-date sync (#655) ───────────────────────────────────────────────────
//
// The catalog backfill one field wider. Colnect dates a stamp to the day where it can, ours are
// commonly dated by year alone (#70/#360), so a matched item usually knows more than we do — and
// the rule is the backfill's: fill what is missing, report what disagrees. The decision is pure
// ({@link proposeIssuedDate}); what lives here is the write and the stamp it lands on.
//
// The **printed value travels verbatim**, exactly as a catalog number does, and is parsed here. The
// Assistant says what the page said; deciding what that means is the instance's job, and a client
// that parsed dates itself would be a second reading of Colnect to keep in step with this one.

/** A date proposal together with the stamp it would land on. */
interface PendingDate {
  stampId: string;
  proposal: ColnectDateProposal;
}

/** Propose a date for one stamp from what a Colnect item's page printed. */
function dateProposalFor(current: PartialDate, printed: string | null | undefined) {
  return proposeIssuedDate(parseColnectDate(printed), current);
}

/**
 * Write every still-proposed date fill, flipping its status to `filled`. Deduplicated per stamp —
 * two Colnect items in one batch can resolve to the same stamp, and the second was decided against
 * the same pre-write state as the first, so only the first is applied and the other stays a
 * proposal (`applyBackfill`'s rule for two refs landing on one field).
 */
async function applyDateFills(pending: readonly PendingDate[]): Promise<void> {
  const rows: { stampId: string; date: PartialDate }[] = [];
  const seen = new Set<string>();
  for (const { stampId, proposal } of pending) {
    if (proposal.status !== "would-fill") continue;
    if (seen.has(stampId)) continue;
    seen.add(stampId);
    rows.push({ stampId, date: proposal.date });
    proposal.status = "filled";
  }
  if (rows.length === 0) return;

  // A fill only ever adds components the stamp lacked, so writing all three restores the values it
  // already held; the merge happened in `proposeIssuedDate`.
  await prisma.$transaction(
    rows.map((r) =>
      prisma.stamp.update({
        where: { id: r.stampId },
        data: { issuedYear: r.date.year, issuedMonth: r.date.month, issuedDay: r.date.day },
      })
    )
  );
}

// ── Stamp-attribute sync (#739) ──────────────────────────────────────────────
//
// The date sync five fields wider (#655), on the identical rule: fill what we state nothing for,
// report a disagreement, never overwrite silently. What is new is the **vocabulary gap** — Colnect
// prints its colour, watermark, paper and printing method as text where ours are dictionary rows —
// so the four go through the collection's own mapping (`colnectValue` on the dictionary row, #404's
// shape) and a value the mapping does not cover is *reported*, never auto-created. The decision is
// pure (`colnect-attributes.ts`); what lives here is the dictionaries, the write and the stamp it
// lands on.
//
// The printed values travel **verbatim**, exactly as the date and the catalog numbers do: the
// Assistant says what the page said, and deciding what that means is the instance's job.

/** An attribute proposal set together with the stamp it would land on. */
interface PendingAttributes {
  stampId: string;
  proposals: ColnectAttributeProposal[];
}

/** The four dictionaries of a collection, with what Colnect calls each row (#739). Loaded once per
 * matcher run and only when the caller asked for the attribute sync at all — a page of two hundred
 * stamps is one read, and a collection that has mapped nothing pays for none. */
async function loadAttributeDictionaries(
  collectionId: string
): Promise<ColnectAttributeDictionaries> {
  const [color, watermark, paper, printing] = await Promise.all([
    prisma.stampColor.findMany({ where: { collectionId }, select: ATTRIBUTE_ROW_SELECT }),
    prisma.stampWatermark.findMany({ where: { collectionId }, select: ATTRIBUTE_ROW_SELECT }),
    prisma.stampPaper.findMany({ where: { collectionId }, select: ATTRIBUTE_ROW_SELECT }),
    prisma.stampPrinting.findMany({ where: { collectionId }, select: ATTRIBUTE_ROW_SELECT }),
  ]);
  return { color, watermark, paper, printing };
}

const ATTRIBUTE_ROW_SELECT = { id: true, name: true, colnectValue: true } as const;

/** The six columns a stamp's attributes are compared and written through. */
const STAMP_ATTRIBUTE_SELECT = {
  denomination: true,
  perforation: true,
  colorId: true,
  watermarkId: true,
  paperId: true,
  printingId: true,
} as const;

/** Nothing mapped and nothing to compare against — what a run that did not ask for the attribute
 * sync hands the proposal function, so no caller has to special-case its absence. */
const NO_ATTRIBUTE_DICTIONARIES: ColnectAttributeDictionaries = {
  color: [],
  watermark: [],
  paper: [],
  printing: [],
};

/**
 * Write every still-proposed attribute fill, flipping its status to `filled`. Deduplicated per
 * stamp for `applyDateFills`' own reason: two Colnect items in one batch can resolve to the same
 * stamp, and the second was decided against the same pre-write state as the first.
 *
 * Only `would-fill` is written. A `conflict` is the disagreement, reported and left alone
 * (`overwriteColnectAttributes` is the collector settling one), and an `unmapped` value has nothing
 * to write.
 */
async function applyAttributeFills(pending: readonly PendingAttributes[]): Promise<void> {
  const rows: { stampId: string; data: Record<string, string> }[] = [];
  const seen = new Set<string>();
  for (const { stampId, proposals } of pending) {
    if (seen.has(stampId)) continue;
    const data = attributeWrites(proposals, ["would-fill"]);
    if (Object.keys(data).length === 0) continue;
    seen.add(stampId);
    rows.push({ stampId, data });
    for (const p of proposals) if (p.status === "would-fill") p.status = "filled";
  }
  if (rows.length === 0) return;

  await prisma.$transaction(
    rows.map((r) => prisma.stamp.update({ where: { id: r.stampId }, data: r.data }))
  );
}

/** One Colnect item to match: its Colnect ID and what the page printed for it. */
export interface ColnectMatchItemInput {
  colnectId: string;
  catalogRefs: { catalog: string; number: string }[];
  /** The page's "Issued on" value, verbatim (#655) — parsed here, not by the client. */
  issuedOn?: string | null;
  /** What the page states about the stamp itself (#739), each value verbatim — the two printed
   * attributes and the four the collection's mapping translates. Absent on an older Assistant, and
   * on a page that states none. */
  attributes?: ColnectAttributes | null;
}

/** One of our stamps offered for the user to choose from when a match needs confirmation. */
export interface ColnectCandidate {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
  /** The rest of the stamp's date (#655), so both sides can be read to the day. */
  issuedMonth: number | null;
  issuedDay: number | null;
  areaName: string | null;
  /** Name of the issue the stamp belongs to, for orientation when picking between siblings. */
  issueName: string | null;
  /** First photo of the stamp (by the shared `sortPhotos` order), for a visual comparison in the
   *  Assistant window (#282). Null when the stamp has no photos. Addressed through the
   *  collection-scoped serving route; bytes are never inlined here. */
  photoId: string | null;
  /** The stamp's catalog numbers, each marked against what the Colnect item prints (#284). */
  catalogNumbers: ColnectNumberView[];
  /** What the Colnect item would add to (or disagrees with on) this stamp (#280). Empty unless the
   *  caller asked for the backfill. */
  backfill: ColnectBackfillProposal[];
  /** What the item's issue date would add to (or disagrees with on) this stamp (#655). Null when
   *  the caller asked for no date sync, the page states none, or it tells us nothing new. */
  dateProposal: ColnectDateProposal | null;
  /** What the page's stated attributes would add to (or disagree with on) this stamp (#739). Empty
   *  unless the caller asked for the attribute sync, and holding one entry per attribute that has
   *  something to say — including the `unmapped` ones, which are reported so the collector can map
   *  the word in Settings. */
  attributes: ColnectAttributeProposal[];
  /** The stamp's current Colnect ID, so the UI can flag a would-be overwrite. */
  existingColnectId: string | null;
}

export type { ColnectBackfillProposal, ColnectBackfillStatus } from "./colnect-backfill";
export type { ColnectDateProposal, ColnectDateStatus } from "./colnect-date";
export type {
  ColnectAttributeProposal,
  ColnectAttributeStatus,
  ColnectAttributes,
} from "./colnect-attributes";

/**
 * What one catalog reference printed on the Colnect page means for us (#284 display):
 *   - `matched`  — it equals a number on the stamp we resolved to; this is the matching evidence.
 *   - `missing`  — we know this catalog, but the stamp carries no number for it: Colnect knows
 *                  something we don't (the backfill candidate of #280).
 *   - `conflict` — we know this catalog and the stamp has a *different* number for it.
 *   - `unmapped` — the Colnect abbreviation maps to no catalog of ours (#248), so it is unusable.
 *   - `unknown`  — mapped, but there is no single stamp to compare against (several candidates, or
 *                  nothing matched), so claiming missing/conflict would be a guess.
 */
export type ColnectRefStatus = "matched" | "missing" | "conflict" | "unmapped" | "unknown";

export interface ColnectRefView {
  /** The abbreviation as printed on Colnect. */
  catalog: string;
  /** The value as printed, verbatim. */
  number: string;
  status: ColnectRefStatus;
}

/**
 * The mirror of {@link ColnectRefStatus}, for one of *our* stamp's numbers seen from the Colnect
 * item: `matched` (Colnect prints the same), `conflict` (Colnect prints a different number in that
 * catalog), `only-mine` (Colnect doesn't mention that catalog at all).
 */
export type ColnectMineStatus = "matched" | "conflict" | "only-mine";

export interface ColnectNumberView {
  /** Human label, e.g. "Mi·PL 200". */
  label: string;
  status: ColnectMineStatus;
}

export type ColnectMatchResult =
  | {
      colnectId: string;
      status: "auto";
      stampId: string;
      written: boolean;
      alreadySet: boolean;
      /** The matched stamp, so callers can show *which* stamp the ID landed on (#249 preview). */
      stamp: ColnectCandidate | null;
      /** Every ref printed on the page, classified against the matched stamp. */
      refs: ColnectRefView[];
    }
  | {
      colnectId: string;
      status: "needs-confirm";
      reason: ColnectNeedsConfirmReason;
      candidates: ColnectCandidate[];
      refs: ColnectRefView[];
    }
  | { colnectId: string; status: "skipped"; reason: ColnectSkippedReason; refs: ColnectRefView[] };

/** Raised by {@link confirmColnectMatch} when the target stamp already carries a different Colnect
 *  ID and the caller did not pass `allowOverwrite`. */
export class ColnectMatchConflictError extends Error {
  constructor(public readonly existingColnectId: string) {
    super("Stamp already has a different Colnect ID.");
    this.name = "ColnectMatchConflictError";
  }
}

/** Internal shape for a discovered candidate stamp: decision keys plus display fields. */
interface CandidateEntry extends CandidateStampRefs {
  /** Everything about the stamp that doesn't depend on which Colnect item it is compared to. */
  base: Omit<ColnectCandidate, "catalogNumbers" | "backfill" | "dateProposal" | "attributes">;
  /** The stamp's own date, for comparing against what the item's page printed (#655). */
  issuedDate: PartialDate;
  /** Its six attributes as stored, for the same comparison one page wider (#739). */
  attributes: CurrentStampAttributes;
  /** Its numbers, carrying the keys needed to compare each against a Colnect item. */
  numbers: { label: string; catalogVendorId: string; key: string }[];
  /** What the backfill (#280) needs: the area whose prefixes apply, and the raw stored numbers. */
  backfillStamp: BackfillStamp;
}

/** Group resolved refs by vendor, for comparing one side's numbers against the other's. */
function keysByVendor(refs: readonly ResolvedRef[]): Map<string, Set<string>> {
  const byVendor = new Map<string, Set<string>>();
  for (const r of refs) {
    let set = byVendor.get(r.catalogVendorId);
    if (!set) byVendor.set(r.catalogVendorId, (set = new Set()));
    set.add(r.key);
  }
  return byVendor;
}

/**
 * A candidate as shown against one specific Colnect item: its own numbers marked with whether that
 * item prints the same number, a different one, or nothing at all for that catalog. The marking is
 * per-item, which is why candidates are stored unmarked and viewed through this.
 */
function candidateView(
  entry: CandidateEntry,
  itemByVendor: Map<string, Set<string>>,
  backfill: ColnectBackfillProposal[] = [],
  dateProposal: ColnectDateProposal | null = null,
  attributes: ColnectAttributeProposal[] = []
): ColnectCandidate {
  return {
    ...entry.base,
    backfill,
    dateProposal,
    attributes,
    catalogNumbers: entry.numbers.map((n) => {
      const theirs = itemByVendor.get(n.catalogVendorId);
      const status: ColnectMineStatus = !theirs
        ? "only-mine"
        : theirs.has(n.key)
          ? "matched"
          : "conflict";
      return { label: n.label, status };
    }),
  };
}

/** The stamp's lead photo id — same ordering the rest of the app shows (front/main first). */
function pickPhotoId(
  photos: { id: string; role: string | null; title: string | null; sortOrder: number }[]
): string | null {
  if (photos.length === 0) return null;
  const ordered = [...photos]
    .map((p) => ({
      ...p,
      role: (p.role === "main" || p.role === "front" || p.role === "back" ? p.role : null) as
        | "front"
        | "back"
        | "main"
        | null,
    }))
    .sort(sortPhotos);
  return ordered[0]?.id ?? null;
}

/** One condition of the candidate recall net: the substrings a stored number must **all** contain,
 *  and whether the comparison must ignore case. */
interface ColnectRecallCondition {
  catalogVendorId: string;
  values: string[];
  insensitive: boolean;
}

/**
 * The substrings to recall candidate stamps by, for one printed Colnect number — a stored number
 * has to contain **all** of them.
 *
 * Digits are the sharpest handle and the common case, taken one **run** at a time: `"PL 3690"` →
 * `["3690"]`, `"BL132"` → `["132"]`, `"PL BL30 B4"` → `["30", "4"]`, matched case-sensitively
 * (digits have no case). Per run rather than all the digits at once because a number carrying two of
 * them concatenates to something no stored value contains (`"304"` against a filed `"BL30 B4"`),
 * which recalled nothing and reported `no-candidates` with the very stamp in the collection (#435).
 * A run, by contrast, survives every spacing and punctuation difference between the two sides —
 * which is what the strict key already folds away.
 *
 * A number with **no digits at all** — Michel's Roman local-issue numbers, e.g. `"RU-BW IIIA"` —
 * would likewise recall nothing. For those the handle is the bare number the backfill would store,
 * i.e. the value minus its leading area-prefix token (`"RU-BW IIIA"` → `"IIIA"`, `"IIIA"` →
 * `"IIIA"`), compared case-insensitively so a stamp filed as `IIIa` is still recalled. Null when
 * nothing usable is left. Recall may over-match freely — the strict full-key check that follows is
 * what decides.
 */
function colnectRecallToken(printed: string): { values: string[]; insensitive: boolean } | null {
  const runs = catalogDigitRuns(printed);
  if (runs.length > 0) return { values: runs, insensitive: false };
  const bare = splitColnectNumber(printed).number.trim();
  return bare ? { values: [bare], insensitive: true } : null;
}

/**
 * Match a batch of Colnect items against the collection's stamps and, unless `dryRun`, write the
 * Colnect ID onto every unambiguously-matched stamp. Owner-authorized, collection-scoped. Returns
 * one result per input item, in order: `auto` (with the matched stamp and whether a write
 * happened), `needs-confirm` (with the reason and candidate stamps to choose between), or `skipped`.
 */
export async function matchColnectItems(
  ownerId: string,
  collectionId: string,
  items: ColnectMatchItemInput[],
  opts: { dryRun?: boolean; backfill?: boolean; issueDate?: boolean; attributes?: boolean } = {}
): Promise<ColnectMatchResult[]> {
  await assertCollectionOwner(ownerId, collectionId);

  // ── Load the collection's catalog + area context once, build in-memory resolvers. ──
  const ctx = await loadColnectContext(collectionId);
  const { vendorAbbrById, resolveVendorId, areaNodes, areaNames, issuePrefixes } = ctx;

  /** One printed reference plus what it resolved to (null vendor = a catalog we don't keep). */
  interface ResolvedAnnotation {
    catalog: string;
    number: string;
    catalogVendorId: string | null;
    key: string | null;
  }

  // ── Resolve each item's refs to full keys; collect the recall conditions. ──
  // Unresolvable refs are kept (with a null vendor) rather than dropped: the matcher ignores them,
  // but the caller still shows them, marked as belonging to a catalog we don't keep.
  const resolvedItems = items.map((item) => {
    const annotated: ResolvedAnnotation[] = item.catalogRefs.map((ref) => {
      const vendorId = resolveVendorId(ref.catalog);
      const abbr = vendorId ? (vendorAbbrById.get(vendorId) ?? "") : "";
      return {
        catalog: ref.catalog,
        number: ref.number,
        catalogVendorId: vendorId,
        key: vendorId ? colnectRefKey(abbr, ref.number) : null,
      };
    });
    const itemRefs: ResolvedRef[] = annotated
      .filter((r): r is typeof r & { catalogVendorId: string; key: string } => !!r.catalogVendorId && !!r.key)
      .map((r) => ({ catalogVendorId: r.catalogVendorId, key: r.key }));
    return { item, itemRefs, annotated };
  });

  /**
   * Classify each printed ref for display. Against a single resolved stamp we can be precise
   * (matched / missing / conflict); with several candidates or none, a mapped ref that matched
   * nothing stays `unknown` rather than pretending we know which stamp it should belong to.
   */
  const classifyRefs = (
    annotated: ResolvedAnnotation[],
    target: CandidateStampRefs | null,
    candidates: readonly CandidateStampRefs[]
  ): ColnectRefView[] => {
    const byVendor = keysByVendor(target?.refs ?? []);
    return annotated.map((ref) => {
      if (!ref.catalogVendorId || !ref.key) {
        return { catalog: ref.catalog, number: ref.number, status: "unmapped" as const };
      }
      if (target) {
        const mine = byVendor.get(ref.catalogVendorId);
        const status: ColnectRefStatus = !mine
          ? "missing"
          : mine.has(ref.key)
            ? "matched"
            : "conflict";
        return { catalog: ref.catalog, number: ref.number, status };
      }
      const matchedAny = candidates.some((c) =>
        c.refs.some((r) => r.catalogVendorId === ref.catalogVendorId && r.key === ref.key)
      );
      return {
        catalog: ref.catalog,
        number: ref.number,
        status: matchedAny ? ("matched" as const) : ("unknown" as const),
      };
    });
  };

  // Recall net: for every distinct (vendor, token) pair, pull stamps holding that vendor's number
  // containing the token. Precision (the strict full-key check) happens in memory below.
  const recall = new Map<string, ColnectRecallCondition>();
  for (const { item } of resolvedItems) {
    for (const ref of item.catalogRefs) {
      const vendorId = resolveVendorId(ref.catalog);
      if (!vendorId) continue;
      const token = colnectRecallToken(ref.number);
      if (!token) continue;
      recall.set(`${vendorId}~${token.values.join("~")}`, { catalogVendorId: vendorId, ...token });
    }
  }

  // Asked of the numbers table rather than of `stamp`, and deliberately so. Written the obvious way
  // — one `catalogNumbers: { some }` per condition, OR-ed on `stamp` — Prisma emits a *correlated
  // EXISTS per condition*, and one batch of 25 items carries around sixty of them. Postgres costs
  // that plan at ~900k, crosses its JIT inlining threshold (`jit_above_cost` 100k,
  // `jit_inline_above_cost` 500k) and spends ~1.7s compiling ~900 functions to run 10ms of work —
  // measured on a collection of 1,740 stamps, so it is the plan shape, not the data. Against the
  // numbers table the same conditions are plain column predicates: one scan with an OR-ed filter,
  // plan cost ~600, no JIT, ~5ms. The stamps themselves are then loaded by id.
  const recallRows = recall.size
    ? await prisma.stampCatalogNumber.findMany({
        where: {
          stamp: { collectionId },
          OR: [...recall.values()].map((r) => ({
            catalogVendorId: r.catalogVendorId,
            // Every run has to be inside the *same* stored number, so they are ANDed on one row
            // rather than spread over several.
            AND: r.values.map((value) => ({
              number: r.insensitive
                ? { contains: value, mode: "insensitive" as const }
                : { contains: value },
            })),
          })),
        },
        select: { stampId: true },
      })
    : [];

  const candidateIds = [...new Set(recallRows.map((r) => r.stampId))];
  const candidateStamps = candidateIds.length
    ? await prisma.stamp.findMany({
        // Scoped again rather than trusting the join above: every read of stamps in this file is
        // collection-scoped, and a lookup by id is exactly where that would quietly stop being true.
        where: { id: { in: candidateIds }, collectionId },
        select: {
          id: true,
          name: true,
          issuedYear: true,
          issuedMonth: true,
          issuedDay: true,
          colnectId: true,
          ...STAMP_ATTRIBUTE_SELECT,
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          issueMemberships: {
            // `issueId` because the issue may override the area's prefix and so the stamp's whole
            // match key (#377), not only the issue name the result row shows.
            select: { issueId: true, issue: { select: { name: true } } },
            take: 1,
          },
          photos: { select: { id: true, role: true, title: true, sortOrder: true } },
        },
      })
    : [];

  const candidatesById = new Map<string, CandidateEntry>();
  for (const s of candidateStamps) {
    const primaryLink = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = primaryLink?.collectionAreaId ?? null;
    const issueId = s.issueMemberships[0]?.issueId ?? null;
    const refs: ResolvedRef[] = [];
    const numbers: CandidateEntry["numbers"] = [];
    for (const cn of s.catalogNumbers) {
      const abbr = vendorAbbrById.get(cn.catalogVendorId) ?? "";
      const prefix = effectivePrefixFor(areaId, cn.catalogVendorId, areaNodes, issueId, issuePrefixes);
      const key = catalogMatchKey(abbr, prefix, cn.number);
      refs.push({ catalogVendorId: cn.catalogVendorId, key });
      numbers.push({
        label: formatCatalogNumber(abbr, prefix, cn.number),
        catalogVendorId: cn.catalogVendorId,
        key,
      });
    }
    candidatesById.set(s.id, {
      stampId: s.id,
      existingColnectId: s.colnectId,
      refs,
      numbers,
      issuedDate: { year: s.issuedYear, month: s.issuedMonth, day: s.issuedDay },
      attributes: {
        denomination: s.denomination,
        perforation: s.perforation,
        colorId: s.colorId,
        watermarkId: s.watermarkId,
        paperId: s.paperId,
        printingId: s.printingId,
      },
      backfillStamp: {
        stampId: s.id,
        areaId,
        issueId,
        numbersByVendor: new Map(s.catalogNumbers.map((cn) => [cn.catalogVendorId, cn.number])),
      },
      base: {
        stampId: s.id,
        name: s.name,
        issuedYear: s.issuedYear,
        issuedMonth: s.issuedMonth,
        issuedDay: s.issuedDay,
        areaName: areaId ? (areaNames.get(areaId) ?? null) : null,
        issueName: s.issueMemberships[0]?.issue.name ?? null,
        photoId: pickPhotoId(s.photos),
        existingColnectId: s.colnectId,
      },
    });
  }
  const allCandidates = [...candidatesById.values()];

  // ── Decide each item; collect the unambiguous writes. ──
  const results: ColnectMatchResult[] = [];
  const writes: { stampId: string; colnectId: string }[] = [];
  const dryRun = opts.dryRun ?? false;
  const wantBackfill = opts.backfill ?? false;
  const wantDate = opts.issueDate ?? false;
  const wantAttributes = opts.attributes ?? false;
  // Loaded only for a run that asked, and once for the whole batch (#739).
  const dictionaries = wantAttributes
    ? await loadAttributeDictionaries(collectionId)
    : NO_ATTRIBUTE_DICTIONARIES;
  // Proposals for stamps we are confident about (`auto`), which is what a real run may write. The
  // objects are shared with the results, so marking/applying them updates what the caller sees.
  const autoFills: PendingFill[] = [];
  // Everything proposed anywhere, including the candidates of a `needs-confirm` item: the duplicate
  // check runs over all of it so the preview tells the truth before the user picks.
  const allFills: PendingFill[] = [];
  /** Date fills for the stamps we are confident about (#655), which a real run writes. */
  const autoDates: PendingDate[] = [];
  /** The same for the attributes (#739). */
  const autoAttributes: PendingAttributes[] = [];

  const proposalsFor = (entry: CandidateEntry, annotated: ResolvedAnnotation[]) => {
    if (!wantBackfill) return [];
    const proposals = backfillFor(entry.backfillStamp, annotated, ctx);
    for (const proposal of proposals) allFills.push({ stamp: entry.backfillStamp, proposal });
    return proposals;
  };

  const dateFor = (entry: CandidateEntry, item: ColnectMatchItemInput) =>
    wantDate ? dateProposalFor(entry.issuedDate, item.issuedOn) : null;

  const attributesFor = (entry: CandidateEntry, item: ColnectMatchItemInput) =>
    wantAttributes ? proposeStampAttributes(item.attributes, entry.attributes, dictionaries) : [];

  for (const { item, itemRefs, annotated } of resolvedItems) {
    const decision = decideColnectItem(item.colnectId, itemRefs, allCandidates);
    // What this Colnect item prints, for marking our stamps' numbers against it.
    const itemByVendor = keysByVendor(itemRefs);
    if (decision.status === "skipped") {
      results.push({
        colnectId: item.colnectId,
        status: "skipped",
        reason: decision.reason,
        refs: classifyRefs(annotated, null, allCandidates),
      });
    } else if (decision.status === "needs-confirm") {
      // One candidate is a definite target, so missing/conflict are knowable; several are not.
      const only =
        decision.candidateStampIds.length === 1
          ? (candidatesById.get(decision.candidateStampIds[0]) ?? null)
          : null;
      results.push({
        colnectId: item.colnectId,
        status: "needs-confirm",
        reason: decision.reason,
        candidates: decision.candidateStampIds
          .map((id) => {
            const entry = candidatesById.get(id);
            return entry
              ? candidateView(
                  entry,
                  itemByVendor,
                  proposalsFor(entry, annotated),
                  dateFor(entry, item),
                  attributesFor(entry, item)
                )
              : undefined;
          })
          .filter((c): c is ColnectCandidate => c !== undefined),
        refs: classifyRefs(annotated, only, allCandidates),
      });
    } else {
      const willWrite = !dryRun && !decision.alreadySet;
      if (willWrite) writes.push({ stampId: decision.stampId, colnectId: item.colnectId });
      results.push({
        colnectId: item.colnectId,
        status: "auto",
        stampId: decision.stampId,
        written: willWrite,
        alreadySet: decision.alreadySet,
        stamp: (() => {
          const entry = candidatesById.get(decision.stampId);
          if (!entry) return null;
          // Backfilling is not conditional on the Colnect ID write: a stamp already carrying this
          // ID is just as confidently matched, and Colnect may have added catalogs since.
          const proposals = proposalsFor(entry, annotated);
          for (const proposal of proposals) {
            autoFills.push({ stamp: entry.backfillStamp, proposal });
          }
          // The date rides on the same confidence, for the same reason (#655).
          const date = dateFor(entry, item);
          if (date) autoDates.push({ stampId: entry.stampId, proposal: date });
          // …and the attributes on the same again (#739).
          const attributes = attributesFor(entry, item);
          if (attributes.length > 0) {
            autoAttributes.push({ stampId: entry.stampId, proposals: attributes });
          }
          return candidateView(entry, itemByVendor, proposals, date, attributes);
        })(),
        refs: classifyRefs(annotated, candidatesById.get(decision.stampId) ?? null, allCandidates),
      });
    }
  }

  if (writes.length > 0) {
    // Setting `colnectId` is not a catalog-number change, so no sort-key recompute is needed (#181).
    await prisma.$transaction(
      writes.map((w) =>
        prisma.stamp.update({ where: { id: w.stampId }, data: { colnectId: w.colnectId } })
      )
    );
  }

  if (wantBackfill) {
    await markBackfillDuplicates(collectionId, allFills, ctx);
    if (!dryRun) await applyBackfill(collectionId, autoFills);
  }
  if (wantDate && !dryRun) await applyDateFills(autoDates);
  if (wantAttributes && !dryRun) await applyAttributeFills(autoAttributes);

  return results;
}

// ── Resolving a conflicting number with Colnect's (#433) ─────────────────────
//
// The backfill never touches a catalog number the stamp already has: a match is not evidence that
// our number is the wrong one, so a disagreement is reported and left alone (#280). This is the
// collector taking that decision explicitly, one field at a time — "Colnect is right, store its
// number here". It is deliberately *not* part of confirming a match: linking an item and correcting
// a number are two different claims, and only one of them destroys something.

/** Raised when an overwrite would land on a catalog identity another stamp already holds while the
 *  collection's duplicate policy (#85) is `block`. Carries the holders, for naming them. */
export class ColnectDuplicateNumberError extends Error {
  constructor(readonly stampNames: string[]) {
    super(`That number is already on ${stampNames.join(", ") || "another stamp"}.`);
    this.name = "ColnectDuplicateNumberError";
  }
}

/** What an overwrite actually did: the stored number, its full label, and — under `warn` — the
 *  stamps it now collides with (#85). */
export interface ColnectNumberOverwrite {
  number: string;
  label: string;
  duplicateStampNames?: string[];
}

/**
 * Replace one stamp's catalog number for a single vendor with the value Colnect prints (#433).
 * Owner-authorized and collection-scoped.
 *
 * `number` is the **bare** number to store, exactly as `proposeBackfill` resolved it for the
 * conflict (prefix already stripped against the stamp's area) — this call does not re-split a
 * printed value, so what the window offered is what lands. It only ever *replaces*: a vendor the
 * stamp holds no number for is the backfill's job and is refused here, so the two paths can't both
 * claim one field. The collection's duplicate policy applies exactly as it does to a fill — `block`
 * refuses with {@link ColnectDuplicateNumberError}, `warn` writes and reports the collision — and
 * the primary sort key is recomputed (#181), a changed number being able to change it.
 */
export async function overwriteColnectCatalogNumber(
  ownerId: string,
  collectionId: string,
  input: { stampId: string; catalogVendorId: string; number: string }
): Promise<ColnectNumberOverwrite> {
  await assertCollectionOwner(ownerId, collectionId);
  const number = input.number.trim();
  if (!number) throw new Error("A catalog number is required.");

  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: {
      id: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      issueMemberships: { select: { issueId: true }, take: 1 },
    },
  });
  if (!stamp) throw new Error("Stamp not found in this collection.");

  const row = stamp.catalogNumbers.find((cn) => cn.catalogVendorId === input.catalogVendorId);
  if (!row) throw new Error("This stamp has no number in that catalog to replace.");

  const ctx = await loadColnectContext(collectionId);
  const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
  const target: BackfillStamp = {
    stampId: stamp.id,
    areaId: link?.collectionAreaId ?? null,
    issueId: stamp.issueMemberships[0]?.issueId ?? null,
    numbersByVendor: new Map(stamp.catalogNumbers.map((cn) => [cn.catalogVendorId, cn.number])),
  };
  const prefix = effectivePrefixFor(
    target.areaId,
    input.catalogVendorId,
    ctx.areaNodes,
    target.issueId,
    ctx.issuePrefixes
  );
  const vendorAbbreviation = ctx.vendorAbbrById.get(input.catalogVendorId);
  if (vendorAbbreviation === undefined) {
    throw new Error("Catalog vendor not found in this collection.");
  }
  const label = formatCatalogNumber(vendorAbbreviation, prefix, number);

  // The duplicate check is the fill's own, run over a proposal shaped like one, so an overwrite and
  // a fill can never disagree about what collides with what.
  const proposal: ColnectBackfillProposal = {
    catalog: vendorAbbreviation,
    printedNumber: number,
    catalogVendorId: input.catalogVendorId,
    vendorAbbreviation,
    status: "would-fill",
    number,
    label,
  };
  await markBackfillDuplicates(collectionId, [{ stamp: target, proposal }], ctx);
  if (proposal.status === "duplicate") {
    throw new ColnectDuplicateNumberError(proposal.duplicateStampNames ?? []);
  }

  if (row.number !== number) {
    await prisma.stampCatalogNumber.update({
      where: { stampId_catalogVendorId: { stampId: stamp.id, catalogVendorId: input.catalogVendorId } },
      data: { number },
    });
    await recomputeStampSortKeys(collectionId, [stamp.id]);
  }

  return {
    number,
    label,
    ...(proposal.duplicateStampNames
      ? { duplicateStampNames: proposal.duplicateStampNames }
      : {}),
  };
}

// ── Resolving a conflicting date with Colnect's (#655) ───────────────────────
//
// The date sync never corrects a date component the stamp already states, on the number backfill's
// reasoning: a match is not evidence that our value is the wrong one. This is the collector taking
// that decision explicitly — "Colnect is right about when this was issued" — and, like #433, it is
// deliberately not part of confirming a match, because only this one destroys something.

/** What an overwrite stored, for reporting it back. */
export interface ColnectDateOverwrite {
  issuedYear: number | null;
  issuedMonth: number | null;
  issuedDay: number | null;
  /** The stored date formatted, e.g. "22 Jan 1945". */
  label: string;
}

/**
 * Replace one stamp's date of issue with the date the Colnect page prints (#655). Owner-authorized
 * and collection-scoped.
 *
 * The **printed value** is sent, exactly as the matcher received it, and parsed here — the window
 * and the instance cannot then disagree about what the page said. It replaces the date **whole**,
 * clearing a month or day Colnect does not state: the collector is calling our date wrong, and a
 * day kept under a year we just abandoned is a date neither side ever stated. A value that parses
 * to no date at all is refused rather than clearing the stamp's own.
 */
export async function overwriteColnectIssuedDate(
  ownerId: string,
  collectionId: string,
  input: { stampId: string; issuedOn: string }
): Promise<ColnectDateOverwrite> {
  await assertCollectionOwner(ownerId, collectionId);
  const parsed = parseColnectDate(input.issuedOn);
  if (!parsed) throw new Error("That is not a date we can read.");

  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: { id: true },
  });
  if (!stamp) throw new Error("Stamp not found in this collection.");

  const date: PartialDate = { year: parsed.year, month: parsed.month, day: parsed.day };
  await prisma.stamp.update({
    where: { id: stamp.id },
    data: { issuedYear: date.year, issuedMonth: date.month, issuedDay: date.day },
  });

  return {
    issuedYear: date.year,
    issuedMonth: date.month,
    issuedDay: date.day,
    label: formatPartialDate(date) ?? String(parsed.year),
  };
}

/**
 * Replace stamp attributes with what the Colnect page prints (#739). Owner-authorized and
 * collection-scoped.
 *
 * The **printed values** are sent, exactly as the matcher received them, and compared here against
 * what the stamp holds — the window and the instance cannot then disagree about what the page said,
 * and a mapping changed in the meantime is honoured rather than baked into the request. Only the
 * attributes named in `attributes` are touched: an unticked disagreement is expressed by not sending
 * that attribute at all, which is the same shape the date sync's ticks already have.
 *
 * A value the mapping does not cover writes **nothing** and is reported back as `unmapped` — this
 * path can settle a disagreement, but it cannot invent a dictionary row any more than the fill can.
 * Attributes the stamp does not hold at all are written too: *use Colnect's* is the same statement
 * about a blank field as about a full one, and refusing it here would leave a fill the collector has
 * just asked for undone.
 */
export async function overwriteColnectAttributes(
  ownerId: string,
  collectionId: string,
  input: { stampId: string; attributes: ColnectAttributes }
): Promise<ColnectAttributeProposal[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: { id: true, ...STAMP_ATTRIBUTE_SELECT },
  });
  if (!stamp) throw new Error("Stamp not found in this collection.");

  const dictionaries = await loadAttributeDictionaries(collectionId);
  const proposals = proposeStampAttributes(input.attributes, stamp, dictionaries);
  const data = attributeWrites(proposals, ["conflict", "would-fill"]);
  if (Object.keys(data).length === 0) return proposals;

  await prisma.stamp.update({ where: { id: stamp.id }, data });
  for (const p of proposals) if (p.status !== "unmapped") p.status = "filled";
  return proposals;
}

/** What a confirmed match wrote beyond the Colnect ID: the catalog numbers (#280), the date
 *  (#655) and the attributes (#739), each reported so the caller can say what it did. */
export interface ColnectConfirmResult {
  backfill: ColnectBackfillProposal[];
  /** Null when no date sync was asked for, the page stated none, or it told us nothing new. A
   *  `conflict` here was **not** written — it is the disagreement, reported. */
  date: ColnectDateProposal | null;
  /** Empty when no attribute sync was asked for, the page stated none, or the two sides already
   *  agree. A `conflict` and an `unmapped` were **not** written, for the same reason. */
  attributes: ColnectAttributeProposal[];
}

/**
 * Commit a user-chosen Colnect match: set `Stamp.colnectId` for a stamp the user picked from a
 * `needs-confirm` result. Owner-authorized and collection-scoped. Refuses to overwrite a different
 * existing Colnect ID unless `allowOverwrite` is set (throws {@link ColnectMatchConflictError}).
 *
 * When `catalogRefs` are supplied and `backfill` is set, the item's numbers also fill the catalogs
 * the chosen stamp lacks (#280) — the same rules as the batch path, applied to the one stamp the
 * user picked. `issuedOn` with `issueDate` does the same for the date (#655). The applied/skipped
 * proposals are returned so the caller can report them.
 */
export async function confirmColnectMatch(
  ownerId: string,
  collectionId: string,
  input: {
    colnectId: string;
    stampId: string;
    allowOverwrite?: boolean;
    catalogRefs?: { catalog: string; number: string }[];
    backfill?: boolean;
    issuedOn?: string | null;
    issueDate?: boolean;
    attributes?: ColnectAttributes | null;
    attributeSync?: boolean;
  }
): Promise<ColnectConfirmResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: {
      id: true,
      colnectId: true,
      issuedYear: true,
      issuedMonth: true,
      issuedDay: true,
      ...STAMP_ATTRIBUTE_SELECT,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      // The issue may override the area's prefix, which the backfill resolves numbers against (#377).
      issueMemberships: { select: { issueId: true }, take: 1 },
    },
  });
  if (!stamp) throw new Error("Stamp not found in this collection.");
  if (
    stamp.colnectId !== null &&
    stamp.colnectId !== input.colnectId &&
    !input.allowOverwrite
  ) {
    throw new ColnectMatchConflictError(stamp.colnectId);
  }
  await prisma.stamp.update({
    where: { id: stamp.id },
    data: { colnectId: input.colnectId },
  });

  // The date is its own switch and its own field, so it is written whether or not the numbers are
  // (#655). A conflict is reported and left alone — settling one is `overwriteColnectIssuedDate`.
  const date = input.issueDate
    ? dateProposalFor(
        { year: stamp.issuedYear, month: stamp.issuedMonth, day: stamp.issuedDay },
        input.issuedOn
      )
    : null;
  if (date) await applyDateFills([{ stampId: stamp.id, proposal: date }]);

  // The attributes are their own switch again (#739), and their own six fields.
  const attributes = input.attributeSync
    ? proposeStampAttributes(
        input.attributes,
        stamp,
        await loadAttributeDictionaries(collectionId)
      )
    : [];
  if (attributes.length > 0) {
    await applyAttributeFills([{ stampId: stamp.id, proposals: attributes }]);
  }

  if (!input.backfill || !input.catalogRefs?.length) return { backfill: [], date, attributes };

  const ctx = await loadColnectContext(collectionId);
  const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
  const target: BackfillStamp = {
    stampId: stamp.id,
    areaId: link?.collectionAreaId ?? null,
    issueId: stamp.issueMemberships[0]?.issueId ?? null,
    numbersByVendor: new Map(stamp.catalogNumbers.map((cn) => [cn.catalogVendorId, cn.number])),
  };
  const proposals = backfillFor(
    target,
    input.catalogRefs.map((r) => ({
      catalog: r.catalog,
      number: r.number,
      catalogVendorId: ctx.resolveVendorId(r.catalog),
    })),
    ctx
  );
  const pending = proposals.map((proposal) => ({ stamp: target, proposal }));
  await markBackfillDuplicates(collectionId, pending, ctx);
  await applyBackfill(collectionId, pending);
  return { backfill: proposals, date, attributes };
}
