import "server-only";
import { prisma } from "../../db";
import { invalidRequest } from "../errors";
import { unresolvedStamps } from "../size-reads";
import { resolveCatalogStrings } from "./catalog";
import { loadCatalogLabelling } from "./reads-shared";
import type { OperationContext } from "../types";

// Naming stamps on a write, shared by the size operations (#1415) and the catalogue writes (#1438):
// a stamp is named by its id or by a catalogue number that names only it, the number resolved
// through #1037's resolver and nothing else, and read back as the collector reads it.

/**
 * The stamp ids `refs` name, in order and without repeats — each an id in this collection or a
 * catalogue number naming exactly one stamp in it. Anything else refuses the whole call.
 */
export async function resolveStampRefs(
  context: OperationContext,
  refs: readonly string[],
  parameter: string
): Promise<string[]> {
  const wanted = [...new Set(refs.map((ref) => ref.trim()))];
  if (wanted.length === 0 || wanted.some((ref) => ref === "")) {
    throw invalidRequest(
      `"${parameter}" must name at least one stamp and carry no blank entries — a stamp id, or a catalogue number such as \`Mi 123a\`.`
    );
  }
  const byId = await prisma.stamp.findMany({
    where: { id: { in: wanted }, collectionId: context.collectionId },
    select: { id: true },
  });
  const ids = new Set(byId.map((stamp) => stamp.id));
  const numbers = wanted.filter((ref) => !ids.has(ref));
  const resolutions = await resolveCatalogStrings(context, numbers);
  const failures = resolutions.filter((row) => row.verdict !== "resolved");
  if (failures.length > 0) throw unresolvedStamps(failures, parameter);

  const byNumber = new Map(numbers.map((ref, i) => [ref, resolutions[i].stamps[0].stampId]));
  return [...new Set(wanted.map((ref) => (ids.has(ref) ? ref : byNumber.get(ref)!)))];
}

/** Each stamp's catalogue numbers as the collector reads them, the area's primary catalogue first. */
export async function loadStampLabels(
  context: OperationContext,
  stampIds: readonly string[]
): Promise<Map<string, { name: string | null; catalogNumbers: string[] }>> {
  if (stampIds.length === 0) return new Map();
  const [rows, labelling] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] }, collectionId: context.collectionId },
      select: {
        id: true,
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
      return [row.id, { name: row.name, catalogNumbers: labels.map((label) => label.label) }];
    })
  );
}
