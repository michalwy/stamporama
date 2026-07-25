import "server-only";
import { prisma } from "./db";
import { catalogDigits, catalogMatchKey, formatCatalogNumber } from "./catalog-number";
import { buildAreaPrefixNodes, resolveEffectivePrefix } from "./area-prefix";
import { sortPhotos } from "./photos";
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
  /** The stamp's current Colnect ID, so the UI can flag a would-be overwrite. */
  existingColnectId: string | null;
}

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
  base: Omit<ColnectCandidate, "catalogNumbers">;
  /** Its numbers, carrying the keys needed to compare each against a Colnect item. */
  numbers: { label: string; catalogVendorId: string; key: string }[];
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
  itemByVendor: Map<string, Set<string>>
): ColnectCandidate {
  return {
    ...entry.base,
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
  opts: { dryRun?: boolean } = {}
): Promise<ColnectMatchResult[]> {
  await assertCollectionOwner(ownerId, collectionId);

  // ── Load the collection's catalog + area context once, build in-memory resolvers. ──
  const [vendors, mappings, areaRows] = await Promise.all([
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
  ]);

  const vendorAbbrById = new Map(vendors.map((v) => [v.id, v.abbreviation]));
  const explicitByAbbrev = new Map(
    mappings.map((m) => [m.colnectAbbrev.trim().toLowerCase(), m.catalogVendorId])
  );
  const exactByAbbrev = new Map(
    vendors.map((v) => [v.abbreviation.trim().toLowerCase(), v.id])
  );
  const resolveVendorId = (colnectAbbrev: string): string | null => {
    const key = colnectAbbrev.trim().toLowerCase();
    if (!key) return null;
    return explicitByAbbrev.get(key) ?? exactByAbbrev.get(key) ?? null;
  };

  // ── Resolve each item's refs to full keys; collect the recall conditions. ──
  // Unresolvable refs are kept (with a null vendor) rather than dropped: the matcher ignores them,
  // but the caller still shows them, marked as belonging to a catalog we don't keep.
  const resolvedItems = items.map((item) => {
    const annotated = item.catalogRefs.map((ref) => {
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
    annotated: (typeof resolvedItems)[number]["annotated"],
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

  // Recall net: for every distinct (vendor, number-digits) pair, pull stamps holding that vendor's
  // number containing those digits. Precision (the strict full-key check) happens in memory below.
  const recall = new Map<string, { catalogVendorId: string; digits: string }>();
  for (const { item } of resolvedItems) {
    for (const ref of item.catalogRefs) {
      const vendorId = resolveVendorId(ref.catalog);
      if (!vendorId) continue;
      const digits = catalogDigits(ref.number);
      if (!digits) continue;
      recall.set(`${vendorId}~${digits}`, { catalogVendorId: vendorId, digits });
    }
  }

  const candidateStamps = recall.size
    ? await prisma.stamp.findMany({
        where: {
          collectionId,
          OR: [...recall.values()].map((r) => ({
            catalogNumbers: {
              some: { catalogVendorId: r.catalogVendorId, number: { contains: r.digits } },
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

  const areaNodes = buildAreaPrefixNodes(areaRows);
  const areaNames = new Map(areaRows.map((a) => [a.id, a.name]));

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
            return entry ? candidateView(entry, itemByVendor) : undefined;
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
          return entry ? candidateView(entry, itemByVendor) : null;
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

  return results;
}

/**
 * Commit a user-chosen Colnect match: set `Stamp.colnectId` for a stamp the user picked from a
 * `needs-confirm` result. Owner-authorized and collection-scoped. Refuses to overwrite a different
 * existing Colnect ID unless `allowOverwrite` is set (throws {@link ColnectMatchConflictError}).
 */
export async function confirmColnectMatch(
  ownerId: string,
  collectionId: string,
  input: { colnectId: string; stampId: string; allowOverwrite?: boolean }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: { id: true, colnectId: true },
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
}
