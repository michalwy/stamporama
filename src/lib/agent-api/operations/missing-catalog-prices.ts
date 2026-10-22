import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { buildDescendantMap, buildEffectivePrimaryCatalogMap } from "../../pricing";
import { makeFormatFactorLookup } from "../../format-pricing";
import { getCertificateStatuses } from "../../certificate-statuses";
import { catalogPriceMarkOf } from "../../catalog-price-mark";
import { childIsVariant, isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "../../variant-classification";
import { invalidRequest, notFound } from "../errors";
import { MAX_LIST_LIMIT, parseListWindow } from "../list";
import { optionalString, stringList } from "../params";
import { agentEdition, resolveAxisValue, resolveEdition, type AgentCatalogEdition } from "../catalog-prices";
import {
  areaRanks,
  compareIssues,
  missingCatalogPriceCells,
  pageIntoGroups,
  stampTreeOrder,
  type AskedCell,
  type GapStamp,
  type MissingCell,
} from "../missing-catalog-prices";
import { resolveVocabularyValue, type VocabularyEntry } from "../vocabulary";
import { areaEntries, loadAxes, loadEditions, type Axes } from "./catalog-prices";
import { loadStampLabels, resolveStampRefs } from "./stamp-refs";
import type { Operation, OperationContext, ParsedParams } from "../types";

// `find_missing_catalogue_prices` (#2110): the stamps of an area, an issue, a checklist or a list that
// have no catalogue price in an edition for the cells asked about — so an assistant entering prices
// finds the gaps in one read instead of reading stamp after stamp. Translations have the same read
// (`find_missing_translations`, #1452).
//
// **Every stamp of the catalogue, held or not** — the collector's decision on #2110, and the
// difference from the variant price grid's worklist (`listUnpricedVariantTrees`), which judges a tree
// on the conditions the collection holds. What counts as missing is the grid's own reading, stated in
// `missing-catalog-prices.ts`; this module only gathers the stamps, their prices and their
// multipliers, and tells the answer. It reads and computes and stores nothing.

/** A stamp of the scope, with what grouping, ordering and the edition default read off it. */
interface ScopeStamp {
  readonly id: string;
  readonly stampNo: number;
  readonly name: string | null;
  readonly parentId: string | null;
  readonly sortKey: string | null;
  readonly issueId: string | null;
  readonly sortOrder: number | null;
  /** The area its catalogue is resolved against: its issue's, else its own primary link's. */
  readonly areaId: string | null;
  /** Its own primary area link — where a format multiplier is resolved, as the grid resolves it. */
  readonly ownAreaId: string | null;
  readonly umbrella: boolean;
}

const SCOPE_STAMP_SELECT = {
  id: true,
  stampNo: true,
  name: true,
  parentId: true,
  primaryCatalogSortKey: true,
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  issueMemberships: {
    select: { issueId: true, sortOrder: true, issue: { select: { collectionAreaId: true } } },
    orderBy: { issueId: "asc" },
  },
  ...VARIANT_FLAG_SELECT,
  variants: { select: VARIANT_FLAG_SELECT },
} as const;

/** The stamp ids a scope names, and the issue it was asked through when it was one. */
async function scopeStampIds(
  context: OperationContext,
  params: ParsedParams
): Promise<{ ids: string[]; issueId: string | null }> {
  const area = optionalString(params, "area");
  const issue = optionalString(params, "issue");
  const checklist = optionalString(params, "checklist");
  const stamps = params.stamps === undefined ? null : stringList(params, "stamps");
  const sent = [area, issue, checklist, stamps].filter((value) => value !== null).length;
  if (sent !== 1) {
    throw invalidRequest(
      'Send one of "area", "issue", "checklist" or "stamps": an area with every area under it, one issue, one checklist, or a list of stamps.',
      ["area", "issue", "checklist", "stamps"]
    );
  }

  if (issue !== null) {
    const found = await prisma.issue.findFirst({
      where: { id: issue.trim(), collectionId: context.collectionId },
      select: { id: true, members: { select: { stampId: true } } },
    });
    if (!found) throw notFound(`No issue "${issue}" in this collection. Send an issue's id — \`search_collection\` finds one.`);
    return { ids: found.members.map((m) => m.stampId), issueId: found.id };
  }
  if (checklist !== null) {
    const found = await prisma.checklist.findFirst({
      where: { id: checklist.trim(), collectionId: context.collectionId },
      select: { stamps: { select: { stampId: true } } },
    });
    if (!found) {
      throw notFound(`No checklist with id "${checklist}" is in this token's collection. Use \`list_checklists\` to find the right id.`);
    }
    return { ids: found.stamps.map((s) => s.stampId), issueId: null };
  }
  if (stamps !== null) {
    if (stamps.length > MAX_LIST_LIMIT) {
      throw invalidRequest(`"stamps" names at most ${MAX_LIST_LIMIT} stamps. Ask for fewer at a time, or name their issue or area.`);
    }
    return { ids: await resolveStampRefs(context, stamps, "stamps"), issueId: null };
  }

  const areaId = resolveVocabularyValue(area!, await areaEntries(context), { vocabulary: "area", parameter: "area" });
  const subtree = await areaSubtreeIds(context.collectionId, areaId);
  const rows = await prisma.stamp.findMany({
    where: {
      collectionId: context.collectionId,
      OR: [
        { issueMemberships: { some: { issue: { collectionAreaId: { in: subtree } } } } },
        { stampAreaLinks: { some: { collectionAreaId: { in: subtree } } } },
      ],
    },
    select: { id: true },
  });
  return { ids: rows.map((row) => row.id), issueId: null };
}

/** The cells asked about: every condition, no certificate and the single unless narrowed. */
function askedCells(axes: Axes, params: ParsedParams): AskedCell[] {
  const list = (name: string) => (params[name] === undefined ? null : stringList(params, name));
  const conditions = list("conditions");
  const certificates = list("certificates");
  const formats = list("formats");
  const unique = <T>(values: T[]) => [...new Set(values)];
  const conditionIds = conditions
    ? unique(conditions.map((c) => resolveVocabularyValue(c, axes.conditions, { vocabulary: "condition", parameter: "conditions" })))
    : axes.conditions.map((entry) => entry.id);
  const certificateIds = certificates
    ? unique(
        certificates.map((c) =>
          resolveAxisValue(c, axes.certificates, "none", { vocabulary: "certificate status", parameter: "certificates" })
        )
      )
    : [null];
  const formatIds = formats
    ? unique(formats.map((f) => resolveAxisValue(f, axes.formats, "single", { vocabulary: "format", parameter: "formats" })))
    : [null];
  const cells: AskedCell[] = [];
  for (const certificateStatusId of certificateIds) {
    for (const formatId of formatIds) {
      for (const conditionId of conditionIds) cells.push({ conditionId, certificateStatusId, formatId });
    }
  }
  return cells;
}

/** One cell an agent is told is missing. */
interface AgentMissingCell {
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  readonly derivable?: string;
}

interface AgentMissingStamp {
  readonly stampId: string;
  readonly stampNo: number;
  readonly numbers: readonly string[];
  readonly name?: string;
  readonly umbrella?: true;
  readonly missing: readonly AgentMissingCell[];
}

interface AgentMissingGroup {
  readonly issueId: string | null;
  readonly issue?: string;
  readonly year?: number;
  readonly edition: string;
  readonly currency: string;
  readonly stamps: readonly AgentMissingStamp[];
}

async function findMissing(context: OperationContext, params: ParsedParams) {
  const window = parseListWindow(params);
  const axes = await loadAxes(context);
  const cells = askedCells(axes, params);
  const editions = await loadEditions(context);
  const editionParam = optionalString(params, "edition");
  const asked = editionParam === null ? null : resolveEdition(editionParam, editions, "edition");
  const { ids, issueId: scopeIssueId } = await scopeStampIds(context, params);

  const rows = await prisma.stamp.findMany({
    where: { id: { in: ids }, collectionId: context.collectionId },
    select: SCOPE_STAMP_SELECT,
  });
  const scope: ScopeStamp[] = rows.map((row) => {
    const membership =
      (scopeIssueId ? row.issueMemberships.find((m) => m.issueId === scopeIssueId) : null) ?? row.issueMemberships[0] ?? null;
    const link = row.stampAreaLinks.find((l) => l.isPrimary) ?? row.stampAreaLinks[0] ?? null;
    return {
      id: row.id,
      stampNo: row.stampNo,
      name: row.name?.trim() || null,
      parentId: row.parentId,
      sortKey: row.primaryCatalogSortKey,
      issueId: membership?.issueId ?? null,
      sortOrder: membership?.sortOrder ?? null,
      areaId: membership?.issue.collectionAreaId ?? link?.collectionAreaId ?? null,
      ownAreaId: link?.collectionAreaId ?? null,
      umbrella: isUnknownVariantStamp(row),
    };
  });

  // The edition each stamp is looked at in: the one asked, else its area's primary catalogue in its
  // newest edition — the grid's default (`defaultEditionId`).
  const editionOf = new Map<string, string>();
  if (asked) {
    for (const stamp of scope) editionOf.set(stamp.id, asked.id);
  } else {
    const primary = await buildEffectivePrimaryCatalogMap(context.collectionId);
    const books = [...new Set(scope.map((s) => (s.areaId ? primary.get(s.areaId) : null)).filter((id): id is string => !!id))];
    const newest = new Map<string, { id: string; year: number }>();
    for (const edition of await prisma.catalogEdition.findMany({
      where: { catalogNameId: { in: books } },
      select: { id: true, year: true, catalogNameId: true },
    })) {
      const best = newest.get(edition.catalogNameId);
      if (!best || edition.year > best.year) newest.set(edition.catalogNameId, edition);
    }
    for (const stamp of scope) {
      const book = stamp.areaId ? primary.get(stamp.areaId) : null;
      const edition = book ? newest.get(book) : undefined;
      if (edition) editionOf.set(stamp.id, edition.id);
    }
  }
  const checked = scope.filter((stamp) => editionOf.has(stamp.id));

  // An umbrella is priced when every fully identified variant under it is (#238), so its variants are
  // read too, whether or not the scope names them.
  const umbrellaIds = new Set(checked.filter((s) => s.umbrella).map((s) => s.id));
  const descendants = await buildDescendantMap(context.collectionId, umbrellaIds);
  const descendantIds = [...new Set([...descendants.values()].flatMap((set) => [...set]))];
  const scopeIds = new Set(scope.map((s) => s.id));
  const extraRows = await prisma.stamp.findMany({
    where: { id: { in: descendantIds.filter((id) => !scopeIds.has(id)) }, collectionId: context.collectionId },
    select: SCOPE_STAMP_SELECT,
  });
  const flagsById = new Map([...rows, ...extraRows].map((row) => [row.id, row]));
  const placeOf = new Map(
    [...rows, ...extraRows].map((row) => {
      const link = row.stampAreaLinks.find((l) => l.isPrimary) ?? row.stampAreaLinks[0] ?? null;
      const membership = row.issueMemberships[0] ?? null;
      return [row.id, { areaId: link?.collectionAreaId ?? membership?.issue.collectionAreaId ?? null, issueId: membership?.issueId ?? null }];
    })
  );
  const gapStamps: GapStamp[] = checked.map((stamp) => ({
    stampId: stamp.id,
    editionId: editionOf.get(stamp.id)!,
    variantIds: stamp.umbrella
      ? [...(descendants.get(stamp.id) ?? [])].filter((id) => {
          const flags = flagsById.get(id);
          return flags !== undefined && childIsVariant(flags) && !isUnknownVariantStamp(flags);
        })
      : null,
  }));

  const pricedIds = [...new Set([...gapStamps.map((s) => s.stampId), ...gapStamps.flatMap((s) => s.variantIds ?? [])])];
  const editionIds = [...new Set(editionOf.values())];
  const needsFactors = cells.some((cell) => cell.formatId !== null);
  const [prices, factorLookup, certificates] = await Promise.all([
    prisma.stampCatalogPrice.findMany({
      where: { stampId: { in: pricedIds }, catalogEditionId: { in: editionIds } },
      select: { stampId: true, catalogEditionId: true, conditionId: true, certificateStatusId: true, formatId: true, price: true, mark: true },
    }),
    needsFactors ? makeFormatFactorLookup(context.collectionId) : Promise.resolve(null),
    getCertificateStatuses(context.ownerId, context.collectionId),
  ]);
  const percentById = new Map(certificates.map((status) => [status.id, status.pricePercent]));
  const missing = missingCatalogPriceCells({
    stamps: gapStamps,
    cells,
    prices: prices.map((p) => ({
      stampId: p.stampId,
      catalogEditionId: p.catalogEditionId,
      conditionId: p.conditionId,
      certificateStatusId: p.certificateStatusId,
      formatId: p.formatId,
      amount: p.price === null ? "" : p.price.toFixed(2),
      mark: catalogPriceMarkOf(p.mark),
    })),
    // The grid's resolution: the stamp's own area link, its first issue, the condition.
    factor: (stampId, formatId, conditionId) => {
      const place = placeOf.get(stampId);
      return factorLookup?.(formatId, place?.areaId ?? null, place?.issueId ?? null, conditionId) ?? null;
    },
    percent: (id) => percentById.get(id) ?? null,
  });

  // The order: issues in catalogue order, each issue's stamps in its tree; stamps in no issue last.
  const lacking = checked.filter((stamp) => missing.has(stamp.id));
  const issueIds = [...new Set(lacking.flatMap((s) => (s.issueId ? [s.issueId] : [])))];
  const [issues, areas] = await Promise.all([
    prisma.issue.findMany({
      where: { id: { in: issueIds }, collectionId: context.collectionId },
      select: { id: true, name: true, year: true, collectionAreaId: true, primaryCatalogSortKey: true },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId: context.collectionId },
      select: { id: true, parentId: true, sortOrder: true, name: true },
    }),
  ]);
  const ranks = areaRanks(areas);
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const orderedIssues = issues
    .map((issue) => ({
      id: issue.id,
      areaRank: (issue.collectionAreaId ? ranks.get(issue.collectionAreaId) : undefined) ?? Number.MAX_SAFE_INTEGER,
      sortKey: issue.primaryCatalogSortKey,
      year: issue.year,
    }))
    .sort(compareIssues);
  const byIssue = new Map<string | null, ScopeStamp[]>();
  for (const stamp of lacking) byIssue.set(stamp.issueId, [...(byIssue.get(stamp.issueId) ?? []), stamp]);
  const ordered = [...orderedIssues.map((issue) => issue.id), null].flatMap((issueId) =>
    stampTreeOrder(byIssue.get(issueId) ?? []).map((stamp) => ({
      groupKey: `${issueId ?? ""}~${editionOf.get(stamp.id)}`,
      stamp,
    }))
  );
  // Within an issue the edition can differ only where its stamps' areas resolve different books;
  // keep each edition's stamps together so a group names one.
  const issueRank = new Map(orderedIssues.map((issue, i) => [issue.id, i]));
  const rankOf = (stamp: ScopeStamp) => (stamp.issueId ? (issueRank.get(stamp.issueId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER);
  ordered.sort(
    (a, b) => rankOf(a.stamp) - rankOf(b.stamp) || (editionOf.get(a.stamp.id) ?? "").localeCompare(editionOf.get(b.stamp.id) ?? "")
  );

  const page = pageIntoGroups(ordered, window);
  const nameOf = (entries: VocabularyEntry[], id: string) => entries.find((entry) => entry.id === id)?.name ?? id;
  const editionById = new Map<string, AgentCatalogEdition>(editions.map((edition) => [edition.id, agentEdition(edition)]));
  const labels = await loadStampLabels(context, page.flatMap((group) => group.stamps.map((stamp) => stamp.id)));
  const tell = (cell: MissingCell): AgentMissingCell => ({
    condition: nameOf(axes.conditions, cell.conditionId),
    ...(cell.certificateStatusId ? { certificate: nameOf(axes.certificates, cell.certificateStatusId) } : {}),
    ...(cell.formatId ? { format: nameOf(axes.formats, cell.formatId) } : {}),
    ...(cell.derivable !== undefined ? { derivable: cell.derivable } : {}),
  });
  const items: AgentMissingGroup[] = page.map((group) => {
    const first = group.stamps[0];
    const issue = first.issueId ? issueById.get(first.issueId) : undefined;
    const edition = editionById.get(editionOf.get(first.id)!);
    return {
      issueId: issue?.id ?? null,
      ...(issue ? { issue: issue.name ?? (issue.year != null ? String(issue.year) : "(unnamed issue)") } : {}),
      ...(issue?.year != null ? { year: issue.year } : {}),
      edition: edition?.name ?? editionOf.get(first.id)!,
      currency: edition?.currency ?? "",
      stamps: group.stamps.map((stamp) => ({
        stampId: stamp.id,
        stampNo: stamp.stampNo,
        numbers: labels.get(stamp.id)?.catalogNumbers ?? [],
        ...(stamp.name ? { name: stamp.name } : {}),
        ...(stamp.umbrella ? { umbrella: true as const } : {}),
        missing: missing.get(stamp.id)!.map(tell),
      })),
    };
  });

  const consumed = window.offset + page.reduce((sum, group) => sum + group.stamps.length, 0);
  const missingCells = [...missing.values()].reduce((sum, list) => sum + list.length, 0);
  const unchecked = scope.length - checked.length;
  return {
    items,
    total: ordered.length,
    nextCursor: consumed < ordered.length ? String(consumed) : null,
    missingCells,
    ...(unchecked > 0 ? { withoutCatalogue: unchecked } : {}),
  };
}

export const findMissingCataloguePricesOperation: Operation = {
  name: "find_missing_catalogue_prices",
  method: "GET",
  path: "/catalog-prices/missing",
  description:
    "Find the stamps that have no catalogue price yet in an edition — across an `area` (with every area under it), one `issue`, one `checklist`, or a list of `stamps`, whether or not the collection holds them. The edition is the one sent, else each stamp's area's primary catalogue in its newest edition. The cells asked about are every condition, without a certificate, as a single — narrow or widen them with `conditions`, `certificates` and `formats`. A cell counts as missing only when nothing is entered: a cell recorded as `-` or `?` (the catalogue gives no price) is answered and never reported. A format cell the single's price and the format's multiplier already give is priced. An umbrella (a stamp with variants) is missing a cell only while one of its variants is, since its value is the lowest of theirs; each variant is reported on its own. A certificate cell is reported even when *Fill from None* could fill it from the plain price, and then says what it would write. Use it before `set_catalog_prices` to price a series in one call.",
  writes: false,
  parameters: [
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description: "An area, with every area under it — its name from `get_collection_vocabulary` or its id. Send one of `area`, `issue`, `checklist`, `stamps`.",
    },
    {
      name: "issue",
      in: "query",
      type: "string",
      required: false,
      description: "One issue, by id — `search_collection` finds one.",
    },
    {
      name: "checklist",
      in: "query",
      type: "string",
      required: false,
      description: "One checklist, by id from `list_checklists` — only its stamps are checked.",
    },
    {
      name: "stamps",
      in: "query",
      type: "string[]",
      required: false,
      description: `Up to ${MAX_LIST_LIMIT} stamps, each by id, short number (\`st 123\`) or a catalogue number naming only it, such as \`Mi 309AP\`.`,
    },
    {
      name: "edition",
      in: "query",
      type: "string",
      required: false,
      description:
        "The edition to look in for every stamp — its name from `list_catalog_editions`, such as `Michel Polen 2024`, or its id. Omitted, each stamp is looked at in its area's primary catalogue's newest edition.",
    },
    {
      name: "conditions",
      in: "query",
      type: "string[]",
      required: false,
      description: "The conditions to check, by name, abbreviation or id. Every condition of the collection when omitted.",
    },
    {
      name: "certificates",
      in: "query",
      type: "string[]",
      required: false,
      description: "The certificate statuses to check; `none` for a piece without one. Only `none` when omitted.",
    },
    {
      name: "formats",
      in: "query",
      type: "string[]",
      required: false,
      description: "The formats to check; `single` for a single stamp. Only `single` when omitted.",
    },
  ],
  result: {
    kind: "list",
    description:
      "Groups in catalogue order, one per issue and edition: `issueId`, `issue` and `year` (absent for stamps in no issue), `edition`, `currency`, and `stamps` in the issue's tree order — each with `stampId`, `stampNo`, `numbers` (its catalogue numbers), `name`, `umbrella` on a stamp with variants, and `missing`: the cells without a price, each `condition`, `certificate` and `format` (absent for none and single), and `derivable` on a certificate cell *Fill from None* would fill — the figure, or `-`/`?` — which is what to send as its `price`. `total` and the cursor count **stamps**, not groups: a page holds at most `limit` stamps, and an issue cut by the page boundary is told on both pages. `missingCells` counts every missing cell of every page; `withoutCatalogue`, when present, counts the stamps not checked because no `edition` was sent and their area has no primary catalogue with an edition.",
  },
  handler: async (context, params) => findMissing(context, params),
};
