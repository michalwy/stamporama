import "server-only";
import { prisma } from "./db";
import {
  catalogDigits,
  catalogIdentityKey,
  catalogMatchKey,
  formatCatalogNumber,
} from "./catalog-number";
import {
  buildAreaPrefixNodes,
  resolveEffectivePrefix,
  type AreaPrefixNode,
} from "./area-prefix";
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
  /** The collection's duplicate-catalog policy (#85), which the backfill has to respect. */
  duplicateMode: DuplicateCatalogMode;
}

async function loadColnectContext(collectionId: string): Promise<ColnectContext> {
  const [vendors, mappings, areaRows, collection] = await Promise.all([
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
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
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
    duplicateMode: collection?.duplicateCatalogMode === "block" ? "block" : "warn",
  };
}

// ── Catalog-number backfill (#280) ───────────────────────────────────────────
//
// A matched stamp is filled from the Colnect page for every catalog it has *no* number for. The
// decision per reference is pure ({@link proposeBackfill}); what lives here is the collection
// context around it: resolving Colnect abbreviations, the stamp's effective area prefixes, the
// duplicate policy (#85), and the write itself.

/** The stamp a backfill is computed against: its area (for prefixes) and current numbers. */
interface BackfillStamp {
  stampId: string;
  areaId: string | null;
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
      stamp.areaId ? resolveEffectivePrefix(stamp.areaId, vendorId, ctx.areaNodes) : null,
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
        },
      },
    },
  });

  const holdersByIdentity = new Map<string, { id: string; name: string | null }[]>();
  for (const row of rows) {
    const link = row.stamp.stampAreaLinks.find((l) => l.isPrimary) ?? row.stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const prefix = areaId
      ? resolveEffectivePrefix(areaId, row.catalogVendorId, ctx.areaNodes)
      : null;
    const key = catalogIdentityKey(row.catalogVendorId, prefix, row.number);
    const list = holdersByIdentity.get(key);
    if (list) list.push({ id: row.stamp.id, name: row.stamp.name });
    else holdersByIdentity.set(key, [{ id: row.stamp.id, name: row.stamp.name }]);
  }

  for (const { stamp, proposal } of fills) {
    const prefix = stamp.areaId
      ? resolveEffectivePrefix(stamp.areaId, proposal.catalogVendorId, ctx.areaNodes)
      : null;
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

/** One Colnect item to match: its Colnect ID and the catalog references extracted from the page. */
export interface ColnectMatchItemInput {
  colnectId: string;
  catalogRefs: { catalog: string; number: string }[];
}

/** One of our stamps offered for the user to choose from when a match needs confirmation. */
export interface ColnectCandidate {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
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
  /** The stamp's current Colnect ID, so the UI can flag a would-be overwrite. */
  existingColnectId: string | null;
}

export type { ColnectBackfillProposal, ColnectBackfillStatus } from "./colnect-backfill";

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
  base: Omit<ColnectCandidate, "catalogNumbers" | "backfill">;
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
  backfill: ColnectBackfillProposal[] = []
): ColnectCandidate {
  return {
    ...entry.base,
    backfill,
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

/** One `contains` condition of the candidate recall net: what to look for inside a stored number,
 *  and whether the comparison must ignore case. */
interface ColnectRecallCondition {
  catalogVendorId: string;
  value: string;
  insensitive: boolean;
}

/**
 * The substring to recall candidate stamps by, for one printed Colnect number.
 *
 * Digits are the sharpest handle and the common case: `"PL 3690"` → `"3690"`, `"BL132"` → `"132"`,
 * matched case-sensitively (digits have no case). A number with **no digits at all** — Michel's
 * Roman local-issue numbers, e.g. `"RU-BW IIIA"` — would otherwise recall nothing and be
 * reported `no-candidates` even with the very stamp in the collection. For those the handle is the
 * bare number the backfill would store, i.e. the value minus its leading area-prefix token
 * (`"RU-BW IIIA"` → `"IIIA"`, `"IIIA"` → `"IIIA"`), compared case-insensitively so a stamp filed as
 * `IIIa` is still recalled. Null when nothing usable is left. Recall may over-match freely — the
 * strict full-key check that follows is what decides.
 */
function colnectRecallToken(printed: string): { value: string; insensitive: boolean } | null {
  const digits = catalogDigits(printed);
  if (digits) return { value: digits, insensitive: false };
  const bare = splitColnectNumber(printed).number.trim();
  return bare ? { value: bare, insensitive: true } : null;
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
  opts: { dryRun?: boolean; backfill?: boolean } = {}
): Promise<ColnectMatchResult[]> {
  await assertCollectionOwner(ownerId, collectionId);

  // ── Load the collection's catalog + area context once, build in-memory resolvers. ──
  const ctx = await loadColnectContext(collectionId);
  const { vendorAbbrById, resolveVendorId, areaNodes, areaNames } = ctx;

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
      recall.set(`${vendorId}~${token.value}`, { catalogVendorId: vendorId, ...token });
    }
  }

  const candidateStamps = recall.size
    ? await prisma.stamp.findMany({
        where: {
          collectionId,
          OR: [...recall.values()].map((r) => ({
            catalogNumbers: {
              some: {
                catalogVendorId: r.catalogVendorId,
                number: r.insensitive
                  ? { contains: r.value, mode: "insensitive" as const }
                  : { contains: r.value },
              },
            },
          })),
        },
        select: {
          id: true,
          name: true,
          issuedYear: true,
          colnectId: true,
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          issueMemberships: { select: { issue: { select: { name: true } } }, take: 1 },
          photos: { select: { id: true, role: true, title: true, sortOrder: true } },
        },
      })
    : [];

  const candidatesById = new Map<string, CandidateEntry>();
  for (const s of candidateStamps) {
    const primaryLink = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = primaryLink?.collectionAreaId ?? null;
    const refs: ResolvedRef[] = [];
    const numbers: CandidateEntry["numbers"] = [];
    for (const cn of s.catalogNumbers) {
      const abbr = vendorAbbrById.get(cn.catalogVendorId) ?? "";
      const prefix = areaId ? resolveEffectivePrefix(areaId, cn.catalogVendorId, areaNodes) : null;
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
      backfillStamp: {
        stampId: s.id,
        areaId,
        numbersByVendor: new Map(s.catalogNumbers.map((cn) => [cn.catalogVendorId, cn.number])),
      },
      base: {
        stampId: s.id,
        name: s.name,
        issuedYear: s.issuedYear,
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
  // Proposals for stamps we are confident about (`auto`), which is what a real run may write. The
  // objects are shared with the results, so marking/applying them updates what the caller sees.
  const autoFills: PendingFill[] = [];
  // Everything proposed anywhere, including the candidates of a `needs-confirm` item: the duplicate
  // check runs over all of it so the preview tells the truth before the user picks.
  const allFills: PendingFill[] = [];

  const proposalsFor = (entry: CandidateEntry, annotated: ResolvedAnnotation[]) => {
    if (!wantBackfill) return [];
    const proposals = backfillFor(entry.backfillStamp, annotated, ctx);
    for (const proposal of proposals) allFills.push({ stamp: entry.backfillStamp, proposal });
    return proposals;
  };

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
            return entry ? candidateView(entry, itemByVendor, proposalsFor(entry, annotated)) : undefined;
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
          return candidateView(entry, itemByVendor, proposals);
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

  return results;
}

/**
 * Commit a user-chosen Colnect match: set `Stamp.colnectId` for a stamp the user picked from a
 * `needs-confirm` result. Owner-authorized and collection-scoped. Refuses to overwrite a different
 * existing Colnect ID unless `allowOverwrite` is set (throws {@link ColnectMatchConflictError}).
 *
 * When `catalogRefs` are supplied and `backfill` is set, the item's numbers also fill the catalogs
 * the chosen stamp lacks (#280) — the same rules as the batch path, applied to the one stamp the
 * user picked. The applied/skipped proposals are returned so the caller can report them.
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
  }
): Promise<ColnectBackfillProposal[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: {
      id: true,
      colnectId: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
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

  if (!input.backfill || !input.catalogRefs?.length) return [];

  const ctx = await loadColnectContext(collectionId);
  const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
  const target: BackfillStamp = {
    stampId: stamp.id,
    areaId: link?.collectionAreaId ?? null,
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
  return proposals;
}
