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
  type AgentIssueListRow,
} from "../issue-list-reads";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalInteger, optionalString } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { areaEntries } from "./catalog-prices";
import { includeSpecialisedParam, INCLUDE_SPECIALISED_PARAMETER } from "./checklist-type-params";
import { collectionPath, loadCollectionHeader, loadIssueLabelling } from "./reads-shared";
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

async function listIssues(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentIssueListRow>> {
  const window = parseListWindow(params);
  const area = optionalString(params, "area")?.trim() || null;
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

  let search: Pick<IssueListFilterOpts, "search" | "searchCatalogVendorId" | "searchCatalogNumber"> = {};
  if (text !== null) {
    const vendors = await prisma.catalogVendor.findMany({
      where: { collectionId: context.collectionId },
      select: { id: true, abbreviation: true },
    });
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
        path: collectionPath(header, `/issues/${issue.id}`),
      })
    ),
    total,
    window
  );
}

export const listIssuesOperation: Operation = {
  name: "list_issues",
  method: "GET",
  path: "/issues",
  description:
    "List the issues (series) of an area, held or not — what is already catalogued there — in the Issues list's order: by year, then by the leading catalogue's number. Narrow by `area` (with its sub-areas unless `sub_areas` is false), by a span of years, and by `text` matching an issue's name, a stamp's name or a catalogue number, as the Issues list's search does; send at least `area` or `text`. Call `get_issue` to read one issue in full, and `list_holdings` with its `issue_id` for the copies themselves.",
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
    INCLUDE_SPECIALISED_PARAMETER,
  ],
  result: {
    kind: "list",
    description:
      "Issues, each with `issueId`, `issueNo` (its short number, `#12`), `name` and `translatedNames` (by language code), `year`, `area` (the area it is filed under), `catalogRanges` — the range it declares per catalogue, `Mi·PL 1384–1388` — `prefixes`, the catalogue prefixes the issue sets itself in the spelling `update_issue` takes (`\"Mi: GG\"`; absent where it follows its area), `memberCount` (every stamp filed under it, variants included), `requiredCount` (distinct stamps on any of its checklists — standard ones only unless `include_specialised` is sent), `heldCopies` (copies held of any of its stamps — not sold, disposed of or traded away) and `heldByCondition`, the same copies by `condition` in the collection's order, only conditions held. `total` counts every matching issue.",
  },
  handler: async (context, params) => listIssues(context, params),
};
