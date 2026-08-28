import "server-only";
import { prisma } from "./db";
import {
  collectCatalogImportNumbers,
  planCatalogImport,
  readCatalogImportFile,
  CATALOG_IMPORT_MAX_STAMPS_PER_ROW,
  type CatalogImportFillRow,
  type CatalogImportMapping,
  type CatalogImportNewIssueRow,
  type CatalogImportPlan,
  type ExistingCatalogNumber,
  type ExistingIssueRef,
} from "./catalog-import-rules";
import { buildAreaPrefixNodes, effectivePrefixFor, resolveEffectivePrefix } from "./area-prefix";
import { loadIssuePrefixMap } from "./issue-prefix";
import { buildPrimaryVendorByAreaMap } from "./pricing";
import {
  addStampRangeToIssue,
  createIssue,
  fillIssueDetails,
  getIssueRangeSuggestions,
  setIssueCatalogRange,
} from "./issues";

// **Executing a catalog CSV** (#717) — the server half of the import track whose pure half is
// `catalog-import-rules.ts` (#716) and whose dialog is #718.
//
// The division is the point of the track: `planCatalogImport` decides *what a file would do* with no
// database in sight, and this module does the two things that need one — resolving the collection
// side the classification is judged against, then carrying the verdicts out. The preview and the
// commit call {@link buildCatalogImportPlan} identically, so the screen that promises and the writer
// that acts are the same computation and cannot disagree.
//
// **The commit re-plans; it is never handed a plan.** A classification is only as good as the
// collection it was computed against, and the client's copy is both stale and unauthenticated. Re-
// reading the file costs a pass over something a collector typed, and it means a row that became a
// duplicate while the preview sat open is refused rather than written.
//
// **Writes are per row, and a row that fails does not stop the file.** An all-or-nothing transaction
// over a whole file would throw away hundreds of good rows for one late failure, and the plan has
// already excluded everything that could be judged wrong in advance — what is left is the kind of
// failure worth reporting and stepping over rather than rolling back to.
//
// **The duplicate guard (#85) is not re-run here** and is not missing: a row whose numbers collide
// with an existing catalog identity is exactly what the classification calls `fill-existing` (or an
// error, where it spans two issues or a stamp on none). The candidates a `new-issue` row creates are
// by construction the numbers *nothing* in the collection holds, so there is nothing for block mode
// to block.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Where an import lands, resolved once for the whole file. */
export interface CatalogImportTarget {
  areaId: string;
  areaName: string;
  /** The area's leading numbering vendor (#675) — the file carries one numbers column and this is
   *  whose numbers they are. */
  catalogVendorId: string;
  vendorAbbreviation: string;
  /** That vendor's effective prefix for the area, by the ordinary three-level walk (#675). */
  areaPrefix: string | null;
}

export type CatalogImportPlanResult =
  | { ok: true; target: CatalogImportTarget; plan: CatalogImportPlan }
  | { ok: false; message: string };

/**
 * Resolve the area an import was pointed at into the vendor and prefix its numbers are filed under.
 *
 * Refusals here are about the *file as a whole* and are worth stating plainly, unlike a row's — a
 * grouping-only area or an area whose chain declares no leading vendor cannot import anything, and
 * "nothing happened" would be a poor answer to either.
 */
async function resolveImportTarget(
  collectionId: string,
  areaId: string
): Promise<{ ok: true; target: CatalogImportTarget } | { ok: false; message: string }> {
  const area = await prisma.collectionArea.findFirst({
    where: { id: areaId, collectionId },
    select: { id: true, name: true, assignable: true },
  });
  if (!area) return { ok: false, message: "Collection area not found." };
  if (!area.assignable) {
    return {
      ok: false,
      message: "This is a grouping-only area and can't hold issues. Pick a specific area.",
    };
  }

  const catalogVendorId = (await buildPrimaryVendorByAreaMap(collectionId)).get(areaId) ?? null;
  if (!catalogVendorId) {
    return {
      ok: false,
      message: `${area.name} has no primary catalog set, so there is no catalog for the file's numbers. Set one on the area first.`,
    };
  }
  const vendor = await prisma.catalogVendor.findFirst({
    where: { id: catalogVendorId, collectionId },
    select: { abbreviation: true },
  });

  const nodes = buildAreaPrefixNodes(
    await prisma.collectionArea.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        catalogPrefix: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    })
  );

  return {
    ok: true,
    target: {
      areaId,
      areaName: area.name,
      catalogVendorId,
      vendorAbbreviation: vendor?.abbreviation ?? "",
      areaPrefix: resolveEffectivePrefix(areaId, catalogVendorId, nodes),
    },
  };
}

/**
 * Every catalog identity in the collection that one of the file's numbers could collide with.
 *
 * The coarse `(vendor, number in […])` filter of `findCatalogDuplicatesForCandidates` (#85), then
 * each row's *own* effective prefix resolved the way that module resolves it — the stamp's issue
 * override first (#377), else its primary area's walk (#675) — because it is the resolved identity
 * that decides a match, and `Mi·SP 1` must never answer for `Mi·PL 1`.
 *
 * The issue reported is the stamp's **first** membership, `duplicate-catalog.ts`'s own convention.
 */
async function loadExistingNumbers(
  collectionId: string,
  catalogVendorId: string,
  numbers: readonly string[]
): Promise<ExistingCatalogNumber[]> {
  if (numbers.length === 0) return [];
  const [nodes, issuePrefixes, rows] = await Promise.all([
    prisma.collectionArea
      .findMany({
        where: { collectionId },
        select: {
          id: true,
          name: true,
          parentId: true,
          catalogPrefix: true,
          collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
        },
      })
      .then(buildAreaPrefixNodes),
    loadIssuePrefixMap(collectionId),
    prisma.stampCatalogNumber.findMany({
      where: { catalogVendorId, number: { in: [...numbers] }, stamp: { collectionId } },
      select: {
        number: true,
        stamp: {
          select: {
            stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
            issueMemberships: {
              select: { issue: { select: { id: true, name: true, year: true } } },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  return rows.map((row) => {
    const links = row.stamp.stampAreaLinks;
    const areaId = (links.find((l) => l.isPrimary) ?? links[0])?.collectionAreaId ?? null;
    const issue: ExistingIssueRef | null = row.stamp.issueMemberships[0]?.issue ?? null;
    return {
      number: row.number,
      areaPrefix: effectivePrefixFor(areaId, catalogVendorId, nodes, issue?.id ?? null, issuePrefixes),
      issue,
    };
  });
}

/**
 * Read a file, resolve its target, and classify every row against the collection.
 *
 * This is the whole answer both consumers work from: #718's preview renders it, and
 * {@link runCatalogImport} executes it.
 */
export async function buildCatalogImportPlan(
  ownerId: string,
  collectionId: string,
  areaId: string,
  text: string,
  mapping: CatalogImportMapping
): Promise<CatalogImportPlanResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const target = await resolveImportTarget(collectionId, areaId);
  if (!target.ok) return target;

  const read = readCatalogImportFile(text);
  if (!read.ok) return { ok: false, message: read.message };

  const existingNumbers = await loadExistingNumbers(
    collectionId,
    target.target.catalogVendorId,
    collectCatalogImportNumbers(read.file, mapping)
  );

  return {
    ok: true,
    target: target.target,
    plan: planCatalogImport(read.file, mapping, {
      catalogVendorId: target.target.catalogVendorId,
      areaPrefix: target.target.areaPrefix,
      existingNumbers,
    }),
  };
}

// ── Running it ───────────────────────────────────────────────────────────────

/** One row the writer attempted and could not finish. */
export interface CatalogImportFailure {
  /** The line of the file, so the message names something the collector can find in front of them. */
  line: number;
  message: string;
}

/**
 * What a run did, in the terms the collector asked the question in.
 *
 * *Skipped* and *unchanged* are counted apart on purpose: one is "this row was wrong" and the other
 * is "you have imported this file already", and #716 kept `noChange` as an answer precisely so a
 * re-import reads as the second rather than as a screen of blank rows.
 */
export interface CatalogImportReport {
  issuesCreated: number;
  /** Rows that filled an existing issue with something — numbers, a name, a year, or a range. */
  issuesFilled: number;
  /** Stamps actually created, across both kinds of row. */
  stampsCreated: number;
  /** Fill rows whose issue already held everything the row says. */
  rowsUnchanged: number;
  /** Rows the plan refused; never attempted. */
  rowsSkipped: number;
  rowsFailed: number;
  failures: CatalogImportFailure[];
}

export type CatalogImportRunResult =
  | { ok: true; target: CatalogImportTarget; report: CatalogImportReport }
  | { ok: false; message: string };

/** The generated-range input a row's numbers make: one vendor, one number per stamp (#70/#452). */
function autoCreateInput(catalogVendorId: string, numbers: readonly string[]) {
  return { count: numbers.length, vendors: [{ catalogVendorId, numbers: [...numbers] }] };
}

async function writeNewIssue(
  ownerId: string,
  collectionId: string,
  target: CatalogImportTarget,
  row: CatalogImportNewIssueRow
): Promise<void> {
  // Exactly what `createIssueAction` builds from the same spec (#452): the numbers generate the
  // stamps and the declared series range is derived from the spec rather than typed.
  await createIssue(ownerId, collectionId, target.areaId, {
    name: row.name,
    year: row.year,
    catalogNumbers: [
      {
        catalogVendorId: target.catalogVendorId,
        firstNumber: row.declared.firstNumber,
        lastNumber: row.declared.lastNumber,
      },
    ],
    autoCreateStamps: autoCreateInput(target.catalogVendorId, row.numbers),
    maxAutoCreateStamps: CATALOG_IMPORT_MAX_STAMPS_PER_ROW,
  });
}

/**
 * Fill one existing issue in: its empty fields, then the numbers it does not carry, then the range.
 *
 * **In that order, and never as one transaction.** The fields come first because a stamp takes its
 * issued year from the issue it is appended to, so filling the year afterwards would leave the very
 * stamps this row created without it. The range comes last because it is measured against the
 * members, which is only true once they exist.
 *
 * The appended stamps land in the **issue's own area**, not the import's — the issue lives where it
 * lives. That cannot change their catalog identity: a fill match means the row's numbers already
 * resolve under the import's prefix, and a stamp appended to the issue resolves under the issue's
 * override or its area, which is what resolved them in the first place.
 */
async function writeFill(
  ownerId: string,
  collectionId: string,
  target: CatalogImportTarget,
  row: CatalogImportFillRow
): Promise<number> {
  if (row.fillName !== null || row.fillYear !== null) {
    await fillIssueDetails(ownerId, collectionId, row.issue.id, {
      name: row.fillName,
      year: row.fillYear,
    });
  }
  if (row.missingNumbers.length === 0) return 0;

  await addStampRangeToIssue(
    ownerId,
    collectionId,
    row.issue.id,
    autoCreateInput(target.catalogVendorId, row.missingNumbers),
    CATALOG_IMPORT_MAX_STAMPS_PER_ROW
  );

  // Widen the declared range over the numbers just appended — `computeIssueRangeExtension`'s rule,
  // through the same machinery the add-stamp dialog's *widen range* box uses (#333).
  //
  // Only this import's vendor, and only a widening: the same computation also offers `adopt-basic`,
  // which *replaces* a prefixed range with the members' basic numbering, and rewriting a declared
  // range the collector chose is not something a bulk file should do unattended. An issue that
  // declares no range for this vendor at all gets none — a declared range is a statement about the
  // series, and one row of a file covers only its own numbers, not the issue's.
  for (const suggestion of await getIssueRangeSuggestions(ownerId, collectionId, row.issue.id)) {
    if (suggestion.catalogVendorId !== target.catalogVendorId) continue;
    if (suggestion.kind !== "extend") continue;
    await setIssueCatalogRange(
      ownerId,
      collectionId,
      row.issue.id,
      suggestion.catalogVendorId,
      suggestion.proposedFirst,
      suggestion.proposedLast
    );
  }
  return row.missingNumbers.length;
}

/**
 * Execute an approved import: create the new issues with their stamps, fill in the matched ones.
 *
 * Walks the plan top to bottom with nothing left to re-decide — the classification already resolved
 * every row against the collection *and* against the file's earlier rows, so two rows generating one
 * number cannot both plan to create it.
 */
export async function runCatalogImport(
  ownerId: string,
  collectionId: string,
  areaId: string,
  text: string,
  mapping: CatalogImportMapping
): Promise<CatalogImportRunResult> {
  const planned = await buildCatalogImportPlan(ownerId, collectionId, areaId, text, mapping);
  if (!planned.ok) return planned;
  const { target, plan } = planned;

  const report: CatalogImportReport = {
    issuesCreated: 0,
    issuesFilled: 0,
    stampsCreated: 0,
    rowsUnchanged: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    failures: [],
  };

  for (const row of plan.rows) {
    if (row.kind === "error") {
      report.rowsSkipped += 1;
      continue;
    }
    if (row.kind === "fill-existing" && row.noChange) {
      report.rowsUnchanged += 1;
      continue;
    }
    try {
      if (row.kind === "new-issue") {
        await writeNewIssue(ownerId, collectionId, target, row);
        report.issuesCreated += 1;
        report.stampsCreated += row.numbers.length;
      } else {
        report.stampsCreated += await writeFill(ownerId, collectionId, target, row);
        report.issuesFilled += 1;
      }
    } catch (e) {
      // The row is reported and the file carries on. A failure here is a write that got past every
      // check the plan could make — an area rule, a constraint, a lost connection — so the message
      // is worth passing through rather than flattening into "something went wrong".
      report.rowsFailed += 1;
      report.failures.push({
        line: row.line,
        message: e instanceof Error ? e.message : "Failed to import this row.",
      });
    }
  }

  return { ok: true, target, report };
}
