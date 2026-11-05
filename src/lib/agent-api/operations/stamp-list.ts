import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { parseCatalogSearch } from "../../catalog-number";
import { countStamps, listStampsPaginated, type StampListFilterOpts } from "../../stamps";
import { stampListRow, type AgentStampListRow } from "../collection-reads";
import { issueFormatFilterParameter, resolveIssueFormatFilter } from "../issue-formats";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalInteger, optionalString, stringList } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { areaEntries } from "./catalog-prices";
import { loadIssueFormatEntries } from "./issue-formats";
import { collectionPath, loadCatalogLabelling, loadCollectionHeader } from "./reads-shared";
import type { Operation, OperationContext, ParsedParams } from "../types";

// `GET /api/v1/stamps` — the Stamps list, read (#2445).
//
// **The stamp search the issue format needed**, and the first operation that lists catalogue entries
// rather than finding a few by text (`search_collection`, capped) or listing series (`list_issues`).
// *Which of my stamps taken out of souvenir sheets have no format yet* is a question about stamps,
// asked over an area — so it is the Stamps list's own `listStampsPaginated`, with its own filters and
// its own order (by date of issue, then the leading catalogue's number), and `countStamps` over the
// same `where` for the total. The collector settled on a list of its own on 2026-11-05 rather than
// reading stamps through `list_issues`.
//
// **A short set of narrowings, not the screen's dozen**, by #710's argument for `list_holdings`: an
// area, a span of years, a piece of text and the issue format — what a collector would say out loud.

async function listStamps(context: OperationContext, params: ParsedParams): Promise<ListResponse<AgentStampListRow>> {
  const window = parseListWindow(params);
  const area = optionalString(params, "area")?.trim() || null;
  const text = optionalString(params, "text")?.trim() || null;
  const yearFrom = optionalInteger(params, "year_from");
  const yearTo = optionalInteger(params, "year_to");
  const issueFormatRefs = stringList(params, "issue_format");
  const header = await loadCollectionHeader(context);

  const filter: StampListFilterOpts = {
    ...(yearFrom !== null ? { yearFrom } : {}),
    ...(yearTo !== null ? { yearTo } : {}),
  };
  if (area !== null) {
    const areaId = resolveVocabularyValue(area, await areaEntries(context), { vocabulary: "area", parameter: "area" });
    filter.areaIds = (optionalBoolean(params, "sub_areas") ?? true)
      ? await areaSubtreeIds(context.collectionId, areaId)
      : [areaId];
  }
  if (issueFormatRefs.length > 0) {
    filter.issueFormatIds = resolveIssueFormatFilter(issueFormatRefs, await loadIssueFormatEntries(context), "issue_format");
  }
  if (text !== null) {
    // A number written with its catalogue in front (`Mi 200`) is that catalogue's number, as the
    // Stamps list's catalogue filter takes it; anything else is the list's search box.
    const vendors = await prisma.catalogVendor.findMany({
      where: { collectionId: context.collectionId },
      select: { id: true, abbreviation: true },
    });
    const parsed = parseCatalogSearch(text, vendors);
    if (parsed.vendorId && parsed.number) {
      filter.catalogVendorId = parsed.vendorId;
      filter.catalogNumber = parsed.number;
    } else {
      filter.search = text;
    }
  }

  const [page, total, labelling] = await Promise.all([
    listStampsPaginated(context.ownerId, context.collectionId, { ...filter, offset: window.offset, pageSize: window.limit }),
    countStamps(context.ownerId, context.collectionId, filter),
    loadCatalogLabelling(context.collectionId),
  ]);
  return listResponse(
    page.items.map((stamp) =>
      stampListRow(stamp, {
        catalogNumbers: labelling.labelFor(stamp.areaId, stamp.issues[0]?.issueId ?? null, stamp.catalogNumbers),
        area: stamp.areaId ? (labelling.areaName.get(stamp.areaId) ?? null) : null,
        path: collectionPath(header, `/stamps/${stamp.id}`),
      })
    ),
    total,
    window
  );
}

export const listStampsOperation: Operation = {
  name: "list_stamps",
  method: "GET",
  path: "/stamps",
  description:
    "List the stamps of the catalogue — held or not, variants included — as the Stamps list reads them: by date of issue, then by the leading catalogue's number. Narrow by `area` (with its sub-areas unless `sub_areas` is false), by a span of years, by `text` (a stamp's or its issue's name, a catalogue number — `Mi 200` is Michel 200 exactly — a denomination or a perforation), and by `issue_format`, the form a stamp was issued in, `none` for the ordinary stamps: `area=Poland&issue_format=none` is every Polish stamp with no issue format yet. Call `get_stamp` for one stamp in full, `update_stamp` or `update_stamps` to change them.",
  writes: false,
  parameters: [
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description: "The area whose stamps to list — its name from `get_collection_vocabulary` or `list_areas`, or its id.",
    },
    {
      name: "sub_areas",
      in: "query",
      type: "boolean",
      required: false,
      description: "false to list only the stamps filed directly under `area`. Left out, the stamps of every area under it are listed too.",
    },
    {
      name: "year_from",
      in: "query",
      type: "integer",
      required: false,
      description: "The earliest year of issue to list, included. A stamp with no year is left out of any span.",
    },
    { name: "year_to", in: "query", type: "integer", required: false, description: "The latest year of issue to list, included." },
    {
      name: "text",
      in: "query",
      type: "string",
      required: false,
      description:
        "Matches a stamp's name, its issue's name, a catalogue number, a denomination or a perforation; a number with its catalogue in front (`Mi 200`) matches that catalogue's number exactly.",
    },
    issueFormatFilterParameter("stamps"),
  ],
  result: {
    kind: "list",
    description:
      "Stamps, each with `stampId`, `stampNo` (its short number, `st 123`), `name`, `issuedYear`, `parentStampId` on a variant, `subtype` on a variant of a subtype other than the default, `issueFormat` (absent on an ordinary stamp), `catalogNumbers` (every catalogue, the area's primary first), `area`, `issue` and `issueYear` (its first issue), and `copies` and `variantCopies` — copies held of the stamp itself and under its variants, two figures never added together. `total` counts every matching stamp.",
  },
  handler: async (context, params) => listStamps(context, params),
};
