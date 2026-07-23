import "server-only";
import { prisma } from "./db";
import { catalogIdentityKey, formatCatalogNumber } from "./catalog-number";

// Duplicate catalog-number detection (#85).
//
// A stamp's catalog *identity* is its vendor + the effective per-vendor prefix of
// the stamp's primary area + the stored number (e.g. "Mi·PL 200"). Two catalog
// numbers are duplicates when their identities are exactly equal — the same number
// under a different vendor or a different area prefix is not a duplicate. This
// mirrors the human-facing label built by `formatCatalogNumber` and the primary-
// area prefix resolution used by the stamp picker (`searchStampsForPicker`).

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

export type DuplicateCatalogMode = "warn" | "block";

/** The collection's duplicate policy, normalized to a known value ("warn" default). */
export async function getCollectionDuplicateMode(
  ownerId: string,
  collectionId: string
): Promise<DuplicateCatalogMode> {
  await assertCollectionOwner(ownerId, collectionId);
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { duplicateCatalogMode: true },
  });
  return col?.duplicateCatalogMode === "block" ? "block" : "warn";
}

// ── Area-prefix resolution ────────────────────────────────────────────────────

interface AreaPrefixNode {
  parentId: string | null;
  name: string;
  /** Per-vendor prefix rows set directly on this area (value may be null). */
  vendorPrefix: Map<string, string | null>;
}

/** Resolve the effective per-vendor area prefix, inheriting from the nearest
 * ancestor area that sets one (mirrors `resolveEffectivePrefix` in stamps.ts). */
function resolveEffectivePrefix(
  areaId: string,
  vendorId: string,
  nodes: Map<string, AreaPrefixNode>
): string | null {
  let current: string | null = areaId;
  let depth = 0;
  while (current && depth < 50) {
    const node: AreaPrefixNode | undefined = nodes.get(current);
    if (!node) break;
    if (node.vendorPrefix.has(vendorId)) return node.vendorPrefix.get(vendorId) ?? null;
    current = node.parentId;
    depth++;
  }
  return null;
}

async function loadAreaNodes(collectionId: string): Promise<Map<string, AreaPrefixNode>> {
  const areaRows = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: {
      id: true,
      name: true,
      parentId: true,
      collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
    },
  });
  return new Map(
    areaRows.map((a) => [
      a.id,
      {
        parentId: a.parentId,
        name: a.name,
        vendorPrefix: new Map(
          a.collectionAreaVendors.map((v) => [v.catalogVendorId, v.areaPrefix])
        ),
      } satisfies AreaPrefixNode,
    ])
  );
}

// ── Shared shapes ─────────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  catalogVendorId: string;
  number: string;
}

/** One existing stamp that carries a conflicting catalog identity. */
export interface DuplicateStampRef {
  stampId: string;
  name: string | null;
  issueName: string | null;
  issueYear: number | null;
  areaName: string | null;
}

/** A catalog identity (vendor + prefix + number) shared by two or more stamps, or
 * by a candidate and existing stamps. `stamps` lists the *existing* conflicting
 * stamps for a candidate check, or all members for the collection-wide report. */
export interface CatalogDuplicateGroup {
  catalogVendorId: string;
  vendorAbbreviation: string;
  number: string;
  /** Human label, e.g. "Mi·PL 200". */
  label: string;
  stamps: DuplicateStampRef[];
}

const STAMP_SELECT = {
  id: true,
  name: true,
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  issueMemberships: {
    select: { issue: { select: { name: true, year: true } } },
    take: 1,
  },
} as const;

type StampRow = {
  id: string;
  name: string | null;
  stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
  issueMemberships: { issue: { name: string | null; year: number | null } }[];
};

function pickPrimaryAreaId(
  links: { collectionAreaId: string; isPrimary: boolean }[]
): string | null {
  const link = links.find((l) => l.isPrimary) ?? links[0];
  return link?.collectionAreaId ?? null;
}

function primaryAreaId(stamp: StampRow): string | null {
  return pickPrimaryAreaId(stamp.stampAreaLinks);
}

function stampRef(stamp: StampRow, nodes: Map<string, AreaPrefixNode>): DuplicateStampRef {
  const areaId = primaryAreaId(stamp);
  const membership = stamp.issueMemberships[0];
  return {
    stampId: stamp.id,
    name: stamp.name,
    issueName: membership?.issue.name ?? null,
    issueYear: membership?.issue.year ?? null,
    areaName: areaId ? (nodes.get(areaId)?.name ?? null) : null,
  };
}

/** A concise error message for block-mode rejections, naming the conflicting labels. */
export function formatDuplicateBlockMessage(groups: CatalogDuplicateGroup[]): string {
  const labels = groups.map((g) => g.label);
  const shown = labels.slice(0, 5).join(", ");
  const extra = labels.length > 5 ? ` and ${labels.length - 5} more` : "";
  const noun = labels.length === 1 ? "catalog number" : "catalog numbers";
  return `Duplicate ${noun} already in this collection: ${shown}${extra}. Switch to warnings under Settings → Duplicates to save anyway.`;
}

// ── Candidate check (create / edit / auto-generate) ───────────────────────────

/**
 * Find existing stamps whose catalog identity collides with any of `candidates`.
 * `contextAreaId` is the area whose prefix applies to the candidates (the issue's
 * area on add/auto-generate, or the edited stamp's primary area). `excludeStampId`
 * drops the stamp being edited from the results. Returns one group per colliding
 * candidate identity, each listing the conflicting existing stamps.
 */
export async function findCatalogDuplicatesForCandidates(
  ownerId: string,
  collectionId: string,
  contextAreaId: string | null,
  candidates: DuplicateCandidate[],
  excludeStampId: string | null
): Promise<CatalogDuplicateGroup[]> {
  await assertCollectionOwner(ownerId, collectionId);

  // Normalize + dedupe candidates (trim numbers, drop blanks).
  const seen = new Set<string>();
  const clean: DuplicateCandidate[] = [];
  for (const c of candidates) {
    const number = c.number.trim();
    if (!number || !c.catalogVendorId) continue;
    const dedupeKey = `${c.catalogVendorId} ${number}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    clean.push({ catalogVendorId: c.catalogVendorId, number });
  }
  if (clean.length === 0) return [];

  const [vendors, nodes] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    loadAreaNodes(collectionId),
  ]);
  const vendorAbbr = new Map(vendors.map((v) => [v.id, v.abbreviation]));

  // Build one target group per candidate identity, keyed by its exact identity key.
  const groups = new Map<string, CatalogDuplicateGroup>();
  for (const c of clean) {
    const prefix = contextAreaId
      ? resolveEffectivePrefix(contextAreaId, c.catalogVendorId, nodes)
      : null;
    const key = catalogIdentityKey(c.catalogVendorId, prefix, c.number);
    if (groups.has(key)) continue;
    const abbr = vendorAbbr.get(c.catalogVendorId) ?? "";
    groups.set(key, {
      catalogVendorId: c.catalogVendorId,
      vendorAbbreviation: abbr,
      number: c.number,
      label: formatCatalogNumber(abbr, prefix, c.number),
      stamps: [],
    });
  }

  // Pull existing rows that match on the coarse (vendor, number) filter, then
  // confirm on the full identity (prefix must match too).
  const rows = await prisma.stampCatalogNumber.findMany({
    where: {
      catalogVendorId: { in: clean.map((c) => c.catalogVendorId) },
      number: { in: clean.map((c) => c.number) },
      stamp: {
        collectionId,
        ...(excludeStampId ? { id: { not: excludeStampId } } : {}),
      },
    },
    select: { catalogVendorId: true, number: true, stamp: { select: STAMP_SELECT } },
  });

  for (const row of rows) {
    const areaId = primaryAreaId(row.stamp);
    const prefix = areaId ? resolveEffectivePrefix(areaId, row.catalogVendorId, nodes) : null;
    const key = catalogIdentityKey(row.catalogVendorId, prefix, row.number);
    const group = groups.get(key);
    if (group) group.stamps.push(stampRef(row.stamp, nodes));
  }

  return [...groups.values()]
    .filter((g) => g.stamps.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Candidate check for an existing stamp being edited: resolves the stamp's own
 * primary area as the prefix context and excludes it from the results.
 */
export async function findCatalogDuplicatesForStamp(
  ownerId: string,
  collectionId: string,
  stampId: string,
  candidates: DuplicateCandidate[]
): Promise<CatalogDuplicateGroup[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId },
    select: { stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } } },
  });
  if (!stamp) return [];
  const areaId = pickPrimaryAreaId(stamp.stampAreaLinks);
  return findCatalogDuplicatesForCandidates(ownerId, collectionId, areaId, candidates, stampId);
}

// ── Block-mode enforcement ────────────────────────────────────────────────────
//
// Each returns a user-facing error message when the collection is in block mode
// and the candidates collide with an existing catalog identity, or null to proceed.

/** Enforce block mode for a candidate set with a known collection + context area
 * (add-stamp-to-issue, auto-generate). */
export async function enforceCandidateCatalogDuplicates(
  ownerId: string,
  collectionId: string,
  contextAreaId: string | null,
  candidates: DuplicateCandidate[]
): Promise<string | null> {
  if (candidates.length === 0) return null;
  if ((await getCollectionDuplicateMode(ownerId, collectionId)) !== "block") return null;
  const groups = await findCatalogDuplicatesForCandidates(
    ownerId,
    collectionId,
    contextAreaId,
    candidates,
    null
  );
  return groups.length > 0 ? formatDuplicateBlockMessage(groups) : null;
}

/** Enforce block mode when editing an existing stamp (collection + primary area
 * resolved from the stamp; the stamp itself is excluded). */
export async function enforceStampCatalogDuplicates(
  ownerId: string,
  stampId: string,
  candidates: DuplicateCandidate[]
): Promise<string | null> {
  if (candidates.length === 0) return null;
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collection: { ownerId } },
    select: { collectionId: true },
  });
  if (!stamp) return null;
  if ((await getCollectionDuplicateMode(ownerId, stamp.collectionId)) !== "block") return null;
  const groups = await findCatalogDuplicatesForStamp(ownerId, stamp.collectionId, stampId, candidates);
  return groups.length > 0 ? formatDuplicateBlockMessage(groups) : null;
}

// ── Collection-wide report ────────────────────────────────────────────────────

/**
 * Every catalog identity in the collection shared by two or more stamps, grouped
 * for the duplicate report. Computes each stamp catalog number's identity (vendor
 * + primary-area prefix + number) in JS and keeps groups with ≥2 members.
 */
export async function listCatalogDuplicates(
  ownerId: string,
  collectionId: string
): Promise<CatalogDuplicateGroup[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const [vendors, nodes, rows] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    loadAreaNodes(collectionId),
    prisma.stampCatalogNumber.findMany({
      where: { stamp: { collectionId } },
      select: { catalogVendorId: true, number: true, stamp: { select: STAMP_SELECT } },
    }),
  ]);
  const vendorAbbr = new Map(vendors.map((v) => [v.id, v.abbreviation]));

  const groups = new Map<string, CatalogDuplicateGroup>();
  for (const row of rows) {
    const areaId = primaryAreaId(row.stamp);
    const prefix = areaId ? resolveEffectivePrefix(areaId, row.catalogVendorId, nodes) : null;
    const key = catalogIdentityKey(row.catalogVendorId, prefix, row.number);
    let group = groups.get(key);
    if (!group) {
      const abbr = vendorAbbr.get(row.catalogVendorId) ?? "";
      group = {
        catalogVendorId: row.catalogVendorId,
        vendorAbbreviation: abbr,
        number: row.number,
        label: formatCatalogNumber(abbr, prefix, row.number),
        stamps: [],
      };
      groups.set(key, group);
    }
    group.stamps.push(stampRef(row.stamp, nodes));
  }

  return [...groups.values()]
    .filter((g) => g.stamps.length >= 2)
    .sort(
      (a, b) =>
        a.vendorAbbreviation.localeCompare(b.vendorAbbreviation) ||
        a.label.localeCompare(b.label, undefined, { numeric: true })
    );
}
