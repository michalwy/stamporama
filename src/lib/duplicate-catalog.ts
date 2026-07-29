import "server-only";
import { prisma } from "./db";
import { catalogIdentityKey, formatCatalogNumber } from "./catalog-number";
import {
  buildAreaPrefixNodes,
  effectivePrefixFor,
  resolveEffectivePrefix,
  type AreaPrefixNode,
} from "./area-prefix";
import { loadIssuePrefixMap, loadIssuePrefixes } from "./issue-prefix";
import type { IssuePrefixMap } from "./area-vendor";

// Duplicate catalog-number detection (#85).
//
// A stamp's catalog *identity* is its vendor + its effective per-vendor prefix + the stored number
// (e.g. "Mi·PL 200"). Two catalog numbers are duplicates when their identities are exactly equal —
// the same number under a different vendor or a different prefix is not a duplicate. This mirrors
// the human-facing label built by `formatCatalogNumber` and the prefix resolution used by the stamp
// picker (`searchStampsForPicker`).
//
// The prefix comes from the stamp's primary area, inherited down the area tree (#66), *unless* its
// issue overrides it (#377) — an issue numbering under a special sub-catalog genuinely holds a
// different catalog identity, and resolving it here rather than only at display time is what keeps
// "Mi·SP 1" from colliding with "Mi·PL 1".

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

// ── Prefix resolution ─────────────────────────────────────────────────────────

/**
 * Where a set of candidate numbers takes its prefix from (#377). Resolution order is
 * `prefixes` → the issue's stored overrides → the area's inherited prefix:
 *
 * - `areaId` — the area whose per-vendor prefixes apply when nothing overrides them (the issue's
 *   area on add / auto-generate, or the edited stamp's primary area).
 * - `issueId` — the issue the candidates belong to, whose stored overrides win over the area.
 * - `prefixes` — overrides that are not stored yet, which is the issue *create* dialog: the issue
 *   does not exist while its own numbers are being checked, so the fields in the form are the only
 *   place its prefixes can come from.
 */
export interface CatalogPrefixContext {
  areaId: string | null;
  issueId?: string | null;
  prefixes?: Record<string, string>;
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
  return buildAreaPrefixNodes(areaRows);
}

/** The prefix a {@link CatalogPrefixContext} gives one vendor's candidate numbers. */
function contextPrefix(
  ctx: CatalogPrefixContext,
  vendorId: string,
  nodes: Map<string, AreaPrefixNode>,
  contextIssuePrefixes: Map<string, string>
): string | null {
  const unsaved = ctx.prefixes?.[vendorId];
  if (unsaved) return unsaved;
  const stored = contextIssuePrefixes.get(vendorId);
  if (stored !== undefined) return stored;
  return ctx.areaId ? resolveEffectivePrefix(ctx.areaId, vendorId, nodes) : null;
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
    // `issueId` because the issue may override the area's prefix and so decide the stamp's whole
    // catalog identity (#377), not only what its issue column reads.
    select: { issueId: true, issue: { select: { name: true, year: true } } },
    take: 1,
  },
} as const;

type StampRow = {
  id: string;
  name: string | null;
  stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
  issueMemberships: { issueId: string; issue: { name: string | null; year: number | null } }[];
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

/** The stamp's own catalog identity prefix for one vendor: its issue's override, else its primary
 * area's inherited prefix (#377). */
function stampPrefix(
  stamp: StampRow,
  vendorId: string,
  nodes: Map<string, AreaPrefixNode>,
  issuePrefixes: IssuePrefixMap
): string | null {
  return effectivePrefixFor(
    primaryAreaId(stamp),
    vendorId,
    nodes,
    stamp.issueMemberships[0]?.issueId ?? null,
    issuePrefixes
  );
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
 * `context` says where the candidates' prefixes come from — see {@link CatalogPrefixContext}.
 * `excludeStampId` drops the stamp being edited from the results. Returns one group per colliding
 * candidate identity, each listing the conflicting existing stamps.
 */
export async function findCatalogDuplicatesForCandidates(
  ownerId: string,
  collectionId: string,
  context: CatalogPrefixContext,
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

  const [vendors, nodes, issuePrefixes, contextIssuePrefixes] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    loadAreaNodes(collectionId),
    loadIssuePrefixMap(collectionId),
    context.issueId ? loadIssuePrefixes(context.issueId) : Promise.resolve(new Map<string, string>()),
  ]);
  const vendorAbbr = new Map(vendors.map((v) => [v.id, v.abbreviation]));

  // Build one target group per candidate identity, keyed by its exact identity key.
  const groups = new Map<string, CatalogDuplicateGroup>();
  for (const c of clean) {
    const prefix = contextPrefix(context, c.catalogVendorId, nodes, contextIssuePrefixes);
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
    const prefix = stampPrefix(row.stamp, row.catalogVendorId, nodes, issuePrefixes);
    const key = catalogIdentityKey(row.catalogVendorId, prefix, row.number);
    const group = groups.get(key);
    if (group) group.stamps.push(stampRef(row.stamp, nodes));
  }

  return [...groups.values()]
    .filter((g) => g.stamps.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Candidate check for an existing stamp being edited: resolves the stamp's own primary area *and*
 * its issue as the prefix context (#377) and excludes it from the results.
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
    select: {
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      issueMemberships: { select: { issueId: true }, take: 1 },
    },
  });
  if (!stamp) return [];
  return findCatalogDuplicatesForCandidates(
    ownerId,
    collectionId,
    {
      areaId: pickPrimaryAreaId(stamp.stampAreaLinks),
      issueId: stamp.issueMemberships[0]?.issueId ?? null,
    },
    candidates,
    stampId
  );
}

// ── Block-mode enforcement ────────────────────────────────────────────────────
//
// Each returns a user-facing error message when the collection is in block mode
// and the candidates collide with an existing catalog identity, or null to proceed.

/** Enforce block mode for a candidate set with a known collection + prefix context
 * (add-stamp-to-issue, auto-generate). */
export async function enforceCandidateCatalogDuplicates(
  ownerId: string,
  collectionId: string,
  context: CatalogPrefixContext,
  candidates: DuplicateCandidate[]
): Promise<string | null> {
  if (candidates.length === 0) return null;
  if ((await getCollectionDuplicateMode(ownerId, collectionId)) !== "block") return null;
  const groups = await findCatalogDuplicatesForCandidates(
    ownerId,
    collectionId,
    context,
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
 * + effective prefix + number) in JS and keeps groups with ≥2 members.
 */
export async function listCatalogDuplicates(
  ownerId: string,
  collectionId: string
): Promise<CatalogDuplicateGroup[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const [vendors, nodes, issuePrefixes, rows] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    loadAreaNodes(collectionId),
    loadIssuePrefixMap(collectionId),
    prisma.stampCatalogNumber.findMany({
      where: { stamp: { collectionId } },
      select: { catalogVendorId: true, number: true, stamp: { select: STAMP_SELECT } },
    }),
  ]);
  const vendorAbbr = new Map(vendors.map((v) => [v.id, v.abbreviation]));

  const groups = new Map<string, CatalogDuplicateGroup>();
  for (const row of rows) {
    const prefix = stampPrefix(row.stamp, row.catalogVendorId, nodes, issuePrefixes);
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
