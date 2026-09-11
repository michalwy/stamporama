import "server-only";
import { prisma } from "../../db";
import { formatIssueCatalogNumber } from "../../catalog-range";
import { effectivePrefixFor, buildAreaPrefixNodes } from "../../area-prefix";
import { loadIssuePrefixMap } from "../../issue-prefix";
import { getIssueListItem } from "../../issues";
import { listItemsPaginated } from "../../items";
import { getStampListItem } from "../../stamps";
import { copyDetail, issueDetail, stampDetail } from "../collection-reads";
import { notFound } from "../errors";
import { requiredString } from "../params";
import { collectionPath, loadCatalogLabelling, loadCollectionHeader, loadLocationPaths } from "./reads-shared";
import type { AgentCopyDetail, AgentIssueDetail, AgentStampDetail } from "../collection-reads";
import type { Operation, OperationContext, ParsedParams } from "../types";

// One thing in full — a stamp, an issue, a copy (#710).
//
// **Three operations rather than one `get_thing(kind, id)`, and that is the reading of #710's second
// bullet.** It asks for *"one thing in full — a stamp, an issue, a copy — as one call rather than
// three"*, and what the *three* counts is the calls it takes to assemble one record: the stamp, then
// its prices, then its copies. A discriminated resource verb would be the wide parameter surface the
// first decision rules out — *an agent resolves a wide parameter surface by guessing and a named task
// by reading* — and the agent that reaches these has just had an id out of `search_collection`, which
// told it which kind it was holding.
//
// **Each one reads through the list's own enrichment**, which is the rule the detail *pages* already
// follow (`inventory-lists.md`): `getStampListItem` / `getIssueListItem` / `listItemsPaginated`, so a
// record cannot read one way to an agent and another on the screen a collector opens beside it. What
// the projections in `../collection-reads.ts` then do is narrow, never widen — a read model shaped
// for a screen is #706's named example of how to spend an agent's context on nothing.

/**
 * **Every one of these re-scopes to the token's collection before it answers**, and that is
 * load-bearing rather than belt-and-braces.
 *
 * `getStampListItem` and `getItemListItem` are **owner**-scoped: they resolve the collection from
 * the record and assert that the caller owns *that* collection. A collector with two collections
 * therefore passes both checks for a stamp in the other one — correct for a screen, whose URL
 * already named the collection, and wrong here, where the collection comes from the token and from
 * nothing else (#706). So each read below proves membership of `context.collectionId` first, and a
 * record from elsewhere is a `not_found` rather than an answer.
 *
 * `getIssueListItem` takes the collection already and needs no help; it is called with the token's.
 */
async function assertStampInCollection(stampId: string, collectionId: string): Promise<void> {
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId },
    select: { id: true },
  });
  if (!stamp) throw notFoundRecord("stamp", stampId, "search_collection");
}

/** The refusal, in one place, so three operations cannot arrive at three sentences.
 *
 *  It names **where to get a good id**, which is #706's error convention applied to an identifier
 *  rather than to a vocabulary value: an agent told only *no such stamp* retries blind, and one told
 *  which operation hands out stamp ids corrects itself in a turn. */
function notFoundRecord(kind: string, id: string, finder: string) {
  return notFound(
    `No ${kind} with id "${id}" is in this token's collection. Use \`${finder}\` to find the right id, or check that the id belongs to this collection.`
  );
}

export async function readStamp(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentStampDetail> {
  const stampId = requiredString(params, "stamp_id");
  const header = await loadCollectionHeader(context);
  await assertStampInCollection(stampId, context.collectionId);

  const [stamp, labelling] = await Promise.all([
    getStampListItem(context.ownerId, stampId),
    loadCatalogLabelling(context.collectionId),
  ]);

  return stampDetail(context.collectionId, stamp, {
    // The numbers are labelled against the stamp's own area and its **first** issue membership,
    // which is where an issue's per-vendor prefix override lives (#377). `toStampListItem` sorts the
    // memberships so that "the first" is one answer rather than whichever row came back first.
    catalogNumbers: labelling.labelFor(stamp.areaId, stamp.issues[0]?.issueId ?? null, stamp.catalogNumbers),
    area: stamp.areaId ? (labelling.areaName.get(stamp.areaId) ?? null) : null,
    path: collectionPath(header, `/stamps/${stamp.id}`),
  });
}

export async function readIssue(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentIssueDetail> {
  const issueId = requiredString(params, "issue_id");
  const header = await loadCollectionHeader(context);
  const issue = await getIssueListItem(context.ownerId, context.collectionId, issueId);
  if (!issue) throw notFoundRecord("issue", issueId, "search_collection");

  // The declared range is a **span** per vendor rather than a number, so it does not go through the
  // stamp labeller: `formatIssueCatalogNumber` is the app's own spelling of one (`Mi·PL 1298–302`),
  // and the prefix under it is the ordinary three-level walk — the issue's own override, then the
  // nearest area that states one (#675).
  const [vendors, areas, issuePrefixes] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId: context.collectionId },
      select: { id: true, abbreviation: true, name: true },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId: context.collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        catalogPrefix: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
    loadIssuePrefixMap(context.collectionId),
  ]);
  const abbrOf = new Map(vendors.map((vendor) => [vendor.id, vendor.abbreviation]));
  const nodes = buildAreaPrefixNodes(areas);

  return issueDetail(context.collectionId, issue, {
    catalogRanges: issue.catalogNumbers.map((range) =>
      formatIssueCatalogNumber(
        range.firstNumber,
        range.lastNumber,
        abbrOf.get(range.catalogVendorId) ?? "",
        effectivePrefixFor(
          issue.collectionAreaId,
          range.catalogVendorId,
          nodes,
          issue.id,
          issuePrefixes
        )
      )
    ),
    area: areas.find((area) => area.id === issue.collectionAreaId)?.name ?? null,
    path: collectionPath(header, `/issues/${issue.id}`),
  });
}

export async function readCopy(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentCopyDetail> {
  const copyId = requiredString(params, "copy_id");
  const header = await loadCollectionHeader(context);

  // **`listItemsPaginated({ ids })` rather than `getItemListItem`**, which is the copy detail
  // *page*'s own choice and for the same reason (`inventory-lists.md`): that one is owner-scoped,
  // and this caller knows a collection rather than only an owner. The filter is collection-scoped by
  // construction, so a copy from elsewhere comes back as no rows.
  //
  // `includeDisposed` is on here and off in `list_holdings`: this answers *tell me about this copy*,
  // and refusing to describe one the collector has written off would be an odd kind of read.
  const [page, labelling, locations] = await Promise.all([
    listItemsPaginated(context.ownerId, context.collectionId, {
      ids: [copyId],
      includeDisposed: true,
      pageSize: 1,
    }),
    loadCatalogLabelling(context.collectionId),
    loadLocationPaths(context.collectionId),
  ]);
  const copy = page.items[0];
  if (!copy) throw notFoundRecord("copy", copyId, "search_collection");

  return copyDetail(context.collectionId, copy, {
    catalogNumbers: labelling.labelFor(copy.areaId, copy.issueId, copy.catalogNumbers),
    area: copy.areaId ? (labelling.areaName.get(copy.areaId) ?? null) : null,
    location: locations.pathFor(copy.locationId),
    path: collectionPath(header, `/inventory/${copy.id}`),
  });
}

export const getStampOperation: Operation = {
  name: "get_stamp",
  method: "GET",
  path: "/stamps/{stamp_id}",
  description:
    "Everything recorded about one catalogue entry: its numbers, the series it belongs to, its catalogue attributes and size, the headline catalogue price, and how many copies are held of it. Call this when you have a stamp id — from `search_collection` or from a copy — and need the whole picture rather than a list row.",
  writes: false,
  parameters: [
    {
      name: "stamp_id",
      in: "path",
      type: "string",
      required: true,
      description: "The stamp's id, as `search_collection` or `get_copy` reports it.",
    },
  ],
  result: {
    kind: "object",
    description:
      "One stamp. `copies` is how many are held of this stamp exactly and `variantCopies` how many under its variants — two answers to two questions, never added together. `catalogPrice` is the headline figure for the collection's leading condition; on a stamp whose variant is unknown it rolls up from the cheapest priced variant, so treat it as an estimate. `catalogNumbers` lead with the area's primary catalogue. Every field the stamp does not state is absent rather than null.",
  },
  handler: async (context, params) => readStamp(context, params),
};

export const getIssueOperation: Operation = {
  name: "get_issue",
  method: "GET",
  path: "/issues/{issue_id}",
  description:
    "One series in full: what it is called, when it was issued, the catalogue numbers it declares, and its checklists — the named sets of stamps that count as one complete unit — with how many stamps each holds and what they are worth. Call this to find out what a series contains before asking what is held from it.",
  writes: false,
  parameters: [
    {
      name: "issue_id",
      in: "path",
      type: "string",
      required: true,
      description: "The issue's id, as `search_collection` or `get_stamp` reports it.",
    },
  ],
  result: {
    kind: "object",
    description:
      "One issue. `memberCount` is every stamp filed under it, variants included; `requiredCount` is the distinct stamps on any of its checklists — a stamp on two checklists is counted once, so the checklist sizes do not add up to it. `catalogTotal` is stated per checklist for the same reason. To find out what is held from it, call `list_holdings` with this `issue_id`.",
  },
  handler: async (context, params) => readIssue(context, params),
};

export const getCopyOperation: Operation = {
  name: "get_copy",
  method: "GET",
  path: "/copies/{copy_id}",
  description:
    "One physical copy in full: which stamp it is, its condition, certificate and format, where it is filed, what it cost, what the catalogue says it is worth, and what it is being held for. Call this when a holdings row or a search result is not enough.",
  writes: false,
  parameters: [
    {
      name: "copy_id",
      in: "path",
      type: "string",
      required: true,
      description: "The copy's id, as `search_collection` or `list_holdings` reports it.",
    },
  ],
  result: {
    kind: "object",
    description:
      "One copy. A copy with no `certificate` carries none and one with no `format` is a single — neither is a value this collection configures, which is why they are absent rather than named. `inCollection`, `forSale` and `forTrade` are three independent markers and overlap: a duplicate kept until it sells is both. An absent `costBasis` means the figure is still pending — the copy sits in a purchase lot whose pool has not been split — or was never recorded, not that nothing was paid. `deliveryState` says whether it is in hand (`delivered`, `to_sort`) or still on its way (`ordered`, `in_transit`).",
  },
  handler: async (context, params) => readCopy(context, params),
};
