import "server-only";
import { prisma } from "../../db";
import { invalidRequest, notFound } from "../errors";
import { parseStampNoRef } from "../../quick-jump";
import { unresolvedStamps } from "../size-reads";
import { resolveCatalogStrings } from "./catalog";
import { loadCatalogLabelling } from "./reads-shared";
import type { OperationContext } from "../types";

// Naming stamps on a write, shared by the size operations (#1415) and the catalogue writes (#1438):
// a stamp is named by its id or by a catalogue number that names only it, the number resolved
// through #1037's resolver and nothing else, and read back as the collector reads it.
//
// And, since #1574, by its short number wherever a stamp is named at all: `st 123`, exactly as the
// quick-jump box reads it. The `st` is required — a bare `123` stays a catalogue number — and a
// short number is read as one before anything else is tried, so a catalogue whose abbreviation
// happened to be `st` could not take it over.

/** The stamp ids a set of short numbers names in this collection, and the numbers that name none. */
async function stampIdsByNumber(
  context: OperationContext,
  numbers: readonly number[]
): Promise<{ ids: Map<number, string>; missing: number[] }> {
  const rows =
    numbers.length === 0
      ? []
      : await prisma.stamp.findMany({
          where: { collectionId: context.collectionId, stampNo: { in: [...numbers] } },
          select: { id: true, stampNo: true },
        });
  const ids = new Map(rows.map((row) => [row.stampNo, row.id]));
  return { ids, missing: numbers.filter((no) => !ids.has(no)) };
}

/**
 * A `stamp_id`-style parameter's value as an id: a short number (`st 123`) becomes the id of the
 * stamp it names, refused here when it names none; anything else passes through untouched, for the
 * caller's own check to accept or refuse as an id exactly as before.
 */
export async function stampIdFromRef(context: OperationContext, ref: string, parameter: string): Promise<string> {
  const no = parseStampNoRef(ref);
  if (no === null) return ref.trim();
  const { ids } = await stampIdsByNumber(context, [no]);
  const id = ids.get(no);
  if (!id) {
    throw notFound(
      `No stamp st ${no} is in this token's collection ("${parameter}"). Use \`search_collection\` to find the right stamp.`
    );
  }
  return id;
}

/** {@link stampIdFromRef} over a list: every short number must name a stamp, or the whole call is
 *  refused with the ones that do not. */
export async function stampIdsFromRefs(
  context: OperationContext,
  refs: readonly string[],
  parameter: string
): Promise<string[]> {
  const numbers = refs.map(parseStampNoRef);
  const { ids, missing } = await stampIdsByNumber(
    context,
    numbers.filter((no): no is number => no !== null)
  );
  if (missing.length > 0) {
    throw invalidRequest(
      `"${parameter}" names ${missing.map((no) => `st ${no}`).join(", ")}, which ${missing.length === 1 ? "is" : "are"} not in this collection. Nothing was changed.`
    );
  }
  return refs.map((ref, i) => {
    const no = numbers[i];
    return no === null ? ref.trim() : ids.get(no)!;
  });
}

/**
 * The stamp ids `refs` name, in order and without repeats — each an id in this collection or a
 * catalogue number naming exactly one stamp in it. Anything else refuses the whole call.
 */
export async function resolveStampRefs(
  context: OperationContext,
  refs: readonly string[],
  parameter: string
): Promise<string[]> {
  const byRef = await resolveStampRefMap(context, refs, parameter);
  return [...new Set(refs.map((ref) => byRef.get(ref.trim())!))];
}

/**
 * {@link resolveStampRefs}, answered per reference: the stamp id each trimmed ref names, for a caller
 * whose refs travel with something else — a lot line's condition and quantity (#1627). The same
 * refusals, refusing the whole call.
 */
export async function resolveStampRefMap(
  context: OperationContext,
  refs: readonly string[],
  parameter: string
): Promise<Map<string, string>> {
  const wanted = [...new Set(refs.map((ref) => ref.trim()))];
  if (wanted.length === 0 || wanted.some((ref) => ref === "")) {
    throw invalidRequest(
      `"${parameter}" must name at least one stamp and carry no blank entries — a stamp id, a short number such as \`st 123\`, or a catalogue number such as \`Mi 123a\`.`
    );
  }
  // Short numbers first, so `st 12` is never handed to the catalogue resolver.
  const shortRefs = wanted.filter((ref) => parseStampNoRef(ref) !== null);
  const shortIds = await stampIdsFromRefs(context, shortRefs, parameter);
  const byShort = new Map(shortRefs.map((ref, i) => [ref, shortIds[i]]));
  const rest = wanted.filter((ref) => !byShort.has(ref));

  const byId = await prisma.stamp.findMany({
    where: { id: { in: rest }, collectionId: context.collectionId },
    select: { id: true },
  });
  const ids = new Set(byId.map((stamp) => stamp.id));
  const numbers = rest.filter((ref) => !ids.has(ref));
  const resolutions = await resolveCatalogStrings(context, numbers);
  const failures = resolutions.filter((row) => row.verdict !== "resolved");
  if (failures.length > 0) throw unresolvedStamps(failures, parameter);

  const byNumber = new Map(numbers.map((ref, i) => [ref, resolutions[i].stamps[0].stampId]));
  return new Map(
    wanted.map((ref) => [ref, byShort.get(ref) ?? (ids.has(ref) ? ref : byNumber.get(ref)!)])
  );
}

/** A stamp as an answer names it: its short number (#1574), its name and its catalogue numbers. */
export interface StampLabel {
  stampNo: number;
  name: string | null;
  catalogNumbers: string[];
}

/** Each stamp's catalogue numbers as the collector reads them, the area's primary catalogue first,
 *  with its short number beside them. */
export async function loadStampLabels(
  context: OperationContext,
  stampIds: readonly string[]
): Promise<Map<string, StampLabel>> {
  if (stampIds.length === 0) return new Map();
  const [rows, labelling] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] }, collectionId: context.collectionId },
      select: {
        id: true,
        stampNo: true,
        name: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        // `catalog.ts`'s choice of *the* issue, so a number reads here as it reads there.
        issueMemberships: { select: { issueId: true }, orderBy: { issueId: "asc" }, take: 1 },
      },
    }),
    loadCatalogLabelling(context.collectionId),
  ]);
  return new Map(
    rows.map((row) => {
      const link = row.stampAreaLinks.find((l) => l.isPrimary) ?? row.stampAreaLinks[0];
      const labels = labelling.labelFor(
        link?.collectionAreaId ?? null,
        row.issueMemberships[0]?.issueId ?? null,
        row.catalogNumbers
      );
      return [row.id, { stampNo: row.stampNo, name: row.name, catalogNumbers: labels.map((label) => label.label) }];
    })
  );
}

/** A loaded stamp's short number. Every stamp has one, so a stamp missing from `labels` is a stamp
 *  the caller never loaded — a defect here, not an answer to give. */
export function stampNoOf(labels: ReadonlyMap<string, StampLabel>, stampId: string): number {
  const label = labels.get(stampId);
  if (!label) throw new Error(`Stamp ${stampId} was named but not loaded.`);
  return label.stampNo;
}
