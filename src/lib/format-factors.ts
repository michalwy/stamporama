import "server-only";
import { prisma } from "./db";
import { resolveFormatFactor, type FormatFactorRow } from "./format-factor";

// Storage and read paths for the format multipliers. The *resolution* rule is pure and lives in
// `format-factor.ts`; this module only fetches rows and asserts ownership.

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

async function resolveFactorCollection(factorId: string): Promise<string> {
  const row = await prisma.stampFormatFactor.findUnique({
    where: { id: factorId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("Format multiplier not found.");
  return row.collectionId;
}

export interface FormatFactorData {
  id: string;
  formatId: string;
  factor: number;
  collectionAreaId: string | null;
  issueId: string | null;
  conditionId: string | null;
  /** Denormalised for display, so the list can name an anchor without a second round trip. */
  areaName: string | null;
  issueName: string | null;
  conditionName: string | null;
}

export interface FormatFactorInput {
  formatId: string;
  factor: number;
  collectionAreaId: string | null;
  issueId: string | null;
  conditionId: string | null;
}

/** Shared read. Callers narrow with `where` so a scoped list never loads rows it will discard —
 *  issue-anchored multipliers are unbounded in number and must stay out of any collection-wide
 *  query. */
async function queryFactors(
  where: { collectionId: string; issueId?: string | null; collectionAreaId?: string }
): Promise<FormatFactorData[]> {
  const rows = await prisma.stampFormatFactor.findMany({
    where,
    select: {
      id: true,
      formatId: true,
      factor: true,
      collectionAreaId: true,
      issueId: true,
      conditionId: true,
      collectionArea: { select: { name: true } },
      issue: { select: { name: true, year: true } },
      condition: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    formatId: r.formatId,
    factor: Number(r.factor),
    collectionAreaId: r.collectionAreaId,
    issueId: r.issueId,
    conditionId: r.conditionId,
    areaName: r.collectionArea?.name ?? null,
    issueName: r.issue ? issueLabel(r.issue) : null,
    conditionName: r.condition?.name ?? null,
  }));
}

/**
 * The multipliers Settings shows and edits: the collection default and the area-anchored ones.
 * **Issue-anchored rows are excluded at the query**, not filtered afterwards — a collection can
 * hold one per issue per format, which is thousands of rows and not a list anybody reads. They are
 * managed from their own issue's row instead.
 */
export async function getCollectionFormatFactors(
  ownerId: string,
  collectionId: string
): Promise<FormatFactorData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return queryFactors({ collectionId, issueId: null });
}

/** An issue has an optional name and an optional year, and may carry neither. */
function issueLabel(issue: { name: string | null; year: number | null }): string {
  if (issue.name && issue.year) return `${issue.name} (${issue.year})`;
  if (issue.name) return issue.name;
  if (issue.year) return String(issue.year);
  return "Untitled issue";
}

/** Where a multiplier is being managed from. A factor's anchors are fixed by the screen it is
 *  created on — an issue's multipliers are edited on that issue, an area's on that area — so the
 *  form never asks for an anchor the surrounding screen already answers. */
export type FormatFactorScope =
  | { kind: "area"; id: string }
  | { kind: "issue"; id: string };

/** The multipliers anchored to exactly this area or issue. Deliberately *not* the ones that would
 *  *apply* here through inheritance: this is an editor for what is set on this row, and showing
 *  inherited rows would invite editing a parent's rule from a child. */
export async function getFormatFactorsForScope(
  ownerId: string,
  collectionId: string,
  scope: FormatFactorScope
): Promise<FormatFactorData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return queryFactors(
    scope.kind === "area"
      ? { collectionId, collectionAreaId: scope.id, issueId: null }
      : { collectionId, issueId: scope.id }
  );
}

/** Raised when the anchors of a saved row collide with an existing one — the DB's unique index is
 *  the real guard, this only turns it into something the UI can say. */
export class DuplicateFormatFactorError extends Error {
  constructor() {
    super("A multiplier with these anchors already exists.");
    this.name = "DuplicateFormatFactorError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

export async function createFormatFactor(
  ownerId: string,
  collectionId: string,
  input: FormatFactorInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.stampFormatFactor.create({ data: { collectionId, ...input } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateFormatFactorError();
    throw err;
  }
}

export async function updateFormatFactor(
  ownerId: string,
  factorId: string,
  input: FormatFactorInput
): Promise<void> {
  const collectionId = await resolveFactorCollection(factorId);
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.stampFormatFactor.update({ where: { id: factorId }, data: input });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateFormatFactorError();
    throw err;
  }
}

export async function deleteFormatFactor(
  ownerId: string,
  factorId: string
): Promise<void> {
  const collectionId = await resolveFactorCollection(factorId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampFormatFactor.delete({ where: { id: factorId } });
}

/**
 * Every factor row in the collection, in the shape the pure resolver takes. A collection holds a
 * handful of these — one per format plus the few places a catalog deviates — so they are read
 * whole and resolved in memory rather than queried per stamp.
 */
export async function getFormatFactorRows(collectionId: string): Promise<FormatFactorRow[]> {
  const rows = await prisma.stampFormatFactor.findMany({
    where: { collectionId },
    select: {
      formatId: true,
      factor: true,
      collectionAreaId: true,
      issueId: true,
      conditionId: true,
    },
  });
  return rows.map((r) => ({ ...r, factor: Number(r.factor) }));
}

export { resolveFormatFactor };
