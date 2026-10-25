import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { parseCatalogSearch } from "../../catalog-number";
import { getStampConditions } from "../../conditions";
import { countCopiesByStampAndCondition, stampConditionKey } from "../../copy-counts";
import { countIssues, listIssuesPaginated, type IssueListFilterOpts } from "../../issues";
import {
  checkIssueListNarrowing,
  heldByCondition,
  issueListRow,
  issueStamps,
  type AgentIssueListRow,
  type AgentIssueStamp,
  type IssueStampSource,
} from "../issue-list-reads";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalInteger, optionalString } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { areaEntries } from "./catalog-prices";
import { includeSpecialisedParam, INCLUDE_SPECIALISED_PARAMETER } from "./checklist-type-params";
import { collectionPath, loadCatalogLabelling, loadCollectionHeader, loadIssueLabelling } from "./reads-shared";
import type { Operation, OperationContext, ParsedParams } from "../types";

// `list_issues` (#2167): the issues of an area, held or not — what an assistant entering a catalogue
// area by area, or asked *"what series do I have catalogued for Generalgouvernement 1940?"*, reads to
// see what is already there. `search_collection` is not narrowed by area, `list_holdings` covers only
// what is held, and `get_issue` reads one issue in full; this is the Issues list.
//
// **It is the Issues list's own read**: `listIssuesPaginated` over the screen's filter and in the
// screen's default order (year, then the leading catalogue's number, then name), its text matched as
// the screen's search box matches it — a name, a stamp's name, a catalogue number, `#12` for an
// issue's own number, `Mi PL 200` with its catalogue — and `countIssues` over the same `where` for
// the total. The area is the screen's area filter with its *+ sub-areas* switch, on by default as on
// the screen. The held copies are `countCopiesByStampAndCondition`'s, so *held* means here what it
// means on every badge. It reads and stores nothing.
//
// #2170 added what an assistant completing a catalogue still read off the screen: a `catalogue` to
// narrow by, pages of up to {@link ISSUE_LIST_MAX_LIMIT} rows, and with `include_numbers` every stamp
// of each issue with its numbers — the stamps outside the declared range included, since those are
// the ones its refused writes collided with. The numbers are labelled against the row's own issue, so
// an issue's own prefix (#377) reads on its stamps as it does on its range.

/** The page cap of `list_issues` — twice the shared one: a row is short, and an area's catalogue is
 *  read issue after issue. */
export const ISSUE_LIST_MAX_LIMIT = 200;

async function listIssues(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentIssueListRow>> {
  const window = parseListWindow(params, ISSUE_LIST_MAX_LIMIT);
  const area = optionalString(params, "area")?.trim() || null;
  const catalogue = optionalString(params, "catalogue")?.trim() || null;
  const includeNumbers = optionalBoolean(params, "include_numbers") ?? false;
  const text = optionalString(params, "text")?.trim() || null;
  const yearFrom = optionalInteger(params, "year_from");
  const yearTo = optionalInteger(params, "year_to");
  checkIssueListNarrowing({ area, text, yearFrom, yearTo });
  const header = await loadCollectionHeader(context);

  let areaIds: string[] | undefined;
  if (area !== null) {
    const areaId = resolveVocabularyValue(area, await areaEntries(context), { vocabulary: "area", parameter: "area" });
    areaIds = (optionalBoolean(params, "sub_areas") ?? true)
      ? await areaSubtreeIds(context.collectionId, areaId)
      : [areaId];
  }

  const vendors =
    text !== null || catalogue !== null
      ? await prisma.catalogVendor.findMany({
          where: { collectionId: context.collectionId },
          select: { id: true, name: true, abbreviation: true },
          orderBy: { name: "asc" },
        })
      : [];
  const numberedInVendorId =
    catalogue === null
      ? undefined
      : resolveVocabularyValue(catalogue, vendors, { vocabulary: "catalog vendor", parameter: "catalogue" });

  let search: Pick<IssueListFilterOpts, "search" | "searchCatalogVendorId" | "searchCatalogNumber"> = {};
  if (text !== null) {
    const parsed = parseCatalogSearch(text, vendors);
    search = {
      search: text,
      searchCatalogVendorId: parsed.vendorId ?? undefined,
      searchCatalogNumber: parsed.number || undefined,
    };
  }

  const filter = {
    areaIds,
    ...search,
    numberedInVendorId,
    yearFrom: yearFrom ?? undefined,
    yearTo: yearTo ?? undefined,
    includeSpecialised: includeSpecialisedParam(params),
  };
  const [page, total, labelling, conditions] = await Promise.all([
    listIssuesPaginated(context.ownerId, context.collectionId, {
      ...filter,
      offset: window.offset,
      pageSize: window.limit,
    }),
    countIssues(context.ownerId, context.collectionId, filter),
    loadIssueLabelling(context.collectionId),
    getStampConditions(context.ownerId, context.collectionId),
  ]);

  const members = await prisma.issueMember.findMany({
    where: { issueId: { in: page.items.map((issue) => issue.id) } },
    select: { issueId: true, stampId: true },
  });
  const stampsByIssue = includeNumbers ? await loadIssueStamps(context, page.items) : null;
  const stampsOf = new Map<string, string[]>();
  for (const member of members) {
    const list = stampsOf.get(member.issueId);
    if (list) list.push(member.stampId);
    else stampsOf.set(member.issueId, [member.stampId]);
  }
  const held = await countCopiesByStampAndCondition(
    context.collectionId,
    members.map((member) => member.stampId)
  );
  const countOf = (stampId: string, conditionId: string) => held.get(stampConditionKey(stampId, conditionId)) ?? 0;

  return listResponse(
    page.items.map((issue) =>
      issueListRow(issue, {
        area: labelling.areaName(issue.collectionAreaId),
        catalogRanges: labelling.catalogRanges(issue),
        abbrOf: labelling.abbrOf,
        held: heldByCondition(stampsOf.get(issue.id) ?? [], conditions, countOf),
        stamps: stampsByIssue ? (stampsByIssue.get(issue.id) ?? []) : undefined,
        path: collectionPath(header, `/issues/${issue.id}`),
      })
    ),
    total,
    window
  );
}

/** Every stamp of each issue on the page with its numbers, in the issue's order (#2170). */
async function loadIssueStamps(
  context: OperationContext,
  issues: readonly { readonly id: string; readonly collectionAreaId: string }[]
): Promise<Map<string, AgentIssueStamp[]>> {
  const [members, labelling] = await Promise.all([
    prisma.issueMember.findMany({
      where: { issueId: { in: issues.map((issue) => issue.id) }, stamp: { collectionId: context.collectionId } },
      select: {
        issueId: true,
        sortOrder: true,
        stamp: {
          select: {
            id: true,
            stampNo: true,
            parentId: true,
            primaryCatalogSortKey: true,
            catalogNumbers: { select: { catalogVendorId: true, number: true } },
            stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          },
        },
      },
    }),
    loadCatalogLabelling(context.collectionId),
  ]);
  const areaOf = new Map(issues.map((issue) => [issue.id, issue.collectionAreaId]));
  const byIssue = new Map<string, IssueStampSource[]>();
  for (const { issueId, sortOrder, stamp } of members) {
    // `loadStampLabels`' choice of area — the stamp's own, its issue's where it has none — and the
    // row's issue for the prefix override.
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const labels = labelling.labelFor(link?.collectionAreaId ?? areaOf.get(issueId) ?? null, issueId, stamp.catalogNumbers);
    const source: IssueStampSource = {
      id: stamp.id,
      stampNo: stamp.stampNo,
      parentId: stamp.parentId,
      sortOrder,
      sortKey: stamp.primaryCatalogSortKey,
      catalogNumbers: labels.map((label) => label.label),
    };
    const list = byIssue.get(issueId);
    if (list) list.push(source);
    else byIssue.set(issueId, [source]);
  }
  return new Map([...byIssue].map(([issueId, sources]) => [issueId, issueStamps(sources)]));
}

export const listIssuesOperation: Operation = {
  name: "list_issues",
  method: "GET",
  path: "/issues",
  description:
    "List the issues (series) of an area, held or not — what is already catalogued there — in the Issues list's order: by year, then by the leading catalogue's number. Narrow by `area` (with its sub-areas unless `sub_areas` is false), by a span of years, by `catalogue`, and by `text` matching an issue's name, a stamp's name or a catalogue number, as the Issues list's search does; send at least `area` or `text`. With `include_numbers` each issue lists every stamp filed under it with its catalogue numbers — the stamps outside its declared range too — so the numbers already taken can be seen before writing. Pages run to 200 issues. Call `get_issue` to read one issue in full, and `list_holdings` with its `issue_id` for the copies themselves.",
  writes: false,
  parameters: [
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description: "The area whose issues to list — its name from `get_collection_vocabulary` or `list_areas`, or its id.",
    },
    {
      name: "sub_areas",
      in: "query",
      type: "boolean",
      required: false,
      description: "false to list only the issues filed directly under `area`. Left out, the issues of every area under it are listed too.",
    },
    {
      name: "year_from",
      in: "query",
      type: "integer",
      required: false,
      description: "The earliest year of issue to list, included. For one year send it as both `year_from` and `year_to`. An issue with no year is left out of any span.",
    },
    {
      name: "year_to",
      in: "query",
      type: "integer",
      required: false,
      description: "The latest year of issue to list, included.",
    },
    {
      name: "text",
      in: "query",
      type: "string",
      required: false,
      description:
        "Matches an issue's name, the name of a stamp in it, or a catalogue number in its declared range or of one of its stamps — `Mi PL 200` and `200` both reach Michel 200 — or `#12` for the issue numbered 12.",
    },
    {
      name: "catalogue",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only the issues with numbers in this catalogue — a declared range in it, or a stamp numbered in it. Its name or abbreviation from `get_collection_vocabulary`, or its id.",
    },
    {
      name: "include_numbers",
      in: "query",
      type: "boolean",
      required: false,
      description:
        "true to add `stamps` to each issue: every stamp filed under it, variants included, with its catalogue numbers in every catalogue — including the stamps outside its declared range.",
    },
    INCLUDE_SPECIALISED_PARAMETER,
  ],
  result: {
    kind: "list",
    maxLimit: ISSUE_LIST_MAX_LIMIT,
    description:
      "Issues, each with `issueId`, `issueNo` (its short number, `#12`), `name` and `translatedNames` (by language code), `year`, `area` (the area it is filed under), `catalogRanges` — the range it declares per catalogue, `Mi·PL 1384–1388` — `prefixes`, the catalogue prefixes the issue sets itself in the spelling `update_issue` takes (`\"Mi: GG\"`; absent where it follows its area), `memberCount` (every stamp filed under it, variants included), `requiredCount` (distinct stamps on any of its checklists — standard ones only unless `include_specialised` is sent), `heldCopies` (copies held of any of its stamps — not sold, disposed of or traded away) and `heldByCondition`, the same copies by `condition` in the collection's order, only conditions held. With `include_numbers`, `stamps` lists every stamp filed under the issue in the issue's order — its variant tree depth first — each with `stampId`, `stampNo` (its short number, `st 123`), `catalogNumbers` (every catalogue, the area's primary first, labelled as everywhere else), `isVariant`, and `parentStampId` on a variant. `total` counts every matching issue.",
  },
  handler: async (context, params) => listIssues(context, params),
};
