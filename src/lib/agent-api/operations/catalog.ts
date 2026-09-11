import "server-only";
import { prisma } from "../../db";
import { buildAreaPrefixNodes, effectivePrefixFor } from "../../area-prefix";
import { catalogNumberRuns, formatCatalogNumber, normalizeCatalogKey } from "../../catalog-number";
import { loadIssuePrefixMap } from "../../issue-prefix";
import { compact } from "../collection-reads";
import { invalidRequest } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalString, stringList } from "../params";
import { acceptedNames, resolveOptionalVocabularyValue } from "../vocabulary";
import {
  catalogVerdict,
  couldMatchForeignCatalogNumber,
  matchesForeignCatalogNumber,
  parseForeignCatalogNumber,
  stampCatalogKeys,
  type AgentCatalogResolution,
  type AgentCatalogStamp,
  type ParsedForeignNumber,
} from "../catalog-resolve";
import { collectionPath, loadCatalogLabelling, loadCollectionHeader } from "./reads-shared";
import type { CollectionHeader } from "./reads-shared";
import type { AreaPrefixNode } from "../../area-prefix";
import type { IssuePrefixMap } from "../../area-vendor";
import type { CatalogLabelling } from "../../collection-search";
import type { Operation, OperationContext, ParsedParams } from "../types";

// `GET /api/v1/catalog/resolve` — foreign catalog strings in, an identity and a verdict each out
// (#1037).
//
// **The matching is `catalog-number.ts`'s and the confidence is this issue's**, which is the split
// the pure `../catalog-resolve.ts` states at length. This file does the part that needs a database
// and nothing else: read the collection's vendors, prefixes and candidate rows, hand them to the
// pure decisions, and project what comes back.
//
// **Nothing here re-answers a question `search_collection` answers.** That operation takes one piece
// of text and shows an agent what is near it, three ways; this one takes twenty strings and says,
// for each, whether it *is* a stamp here. An agent reading an auctioneer's mail needs the second and
// would have to make twenty calls and interpret sixty groups to fake it from the first — which is
// the round-trip shape #1037 names as what makes an agent slow and expensive.

/** What the candidate scan needs off a stamp before its identity can be spelled. */
const STAMP_SELECT = {
  id: true,
  name: true,
  catalogNumbers: { select: { catalogVendorId: true, number: true } },
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  issueMemberships: {
    // `issueId` because an issue may override the area's prefix and so decide the whole catalog
    // identity (#377) — `duplicate-catalog.ts`'s own reason for selecting it.
    select: { issueId: true, issue: { select: { name: true, year: true } } },
    orderBy: { issueId: "asc" },
    take: 1,
  },
} as const;

type StampRow = {
  id: string;
  name: string | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
  issueMemberships: { issueId: string; issue: { name: string | null; year: number | null } }[];
};

interface Vendor {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
}

/**
 * Every prefix this collection actually uses, normalized.
 *
 * **Both levels, because both are catalog identity** (#66/#377): an area's own `catalogPrefix`, its
 * per-vendor rows, and the issues' overrides. The pure parse consults this set twice — to refuse to
 * read a prefix as a catalogue's name, and to refuse to drop one on the way to a bare number — and
 * a prefix missing from it would fail both in the direction that answers about the wrong stamp.
 */
function collectPrefixKeys(
  nodes: Map<string, AreaPrefixNode>,
  issuePrefixes: IssuePrefixMap
): ReadonlySet<string> {
  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const key = normalizeCatalogKey(value ?? "");
    if (key !== "") keys.add(key);
  };
  for (const node of nodes.values()) {
    add(node.catalogPrefix);
    for (const prefix of node.vendorPrefix.values()) add(prefix);
  }
  for (const byVendor of issuePrefixes.values()) {
    for (const prefix of byVendor.values()) add(prefix);
  }
  return keys;
}

/** The recall net for one parsed string, as a Prisma `where` over `StampCatalogNumber.number`.
 *
 *  **`catalogNumberRuns` and not a net of this operation's own** — it is the stamp picker's net
 *  (#104/#435), runs ANDed so they must land inside the *same* stored number, and its reason applies
 *  here unchanged: a net woven on the digits alone catches every number sharing the run, and `7`
 *  would pull thousands of rows to answer about `7cII`. A remainder with no digit run at all (a
 *  bare Roman numeral, #383) falls back to itself. */
function recallClause(parsed: ParsedForeignNumber) {
  const runs = catalogNumberRuns(parsed.restKey);
  const values = runs.length > 0 ? runs : [parsed.restKey];
  return {
    AND: values.map((value) => ({ number: { contains: value, mode: "insensitive" as const } })),
  };
}

export async function readCatalogResolutions(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentCatalogResolution>> {
  // **`params.ts` already refuses both of these over a query string** — a declared `string[]` drops
  // blank entries and a `required` parameter with none left is rejected before a handler runs. They
  // are stated again because that guarantee is a property of *where the value came from*: the same
  // declaration read out of a JSON body keeps the array whole, blanks and all, and a resolver handed
  // `""` would answer `no_match` about nothing.
  const inputs = stringList(params, "numbers").map((value) => value.trim());
  if (inputs.length === 0 || inputs.some((value) => value === "")) {
    throw invalidRequest(
      '"numbers" must carry at least one catalog string and no blank entries — `Mi 123a`, `Michel 123`, `123a`. Drop the blanks and retry.'
    );
  }

  const vendors: Vendor[] = await prisma.catalogVendor.findMany({
    where: { collectionId: context.collectionId },
    select: { id: true, name: true, abbreviation: true },
    orderBy: { name: "asc" },
  });
  // The stated vendor is #708's resolver, against the very list `get_collection_vocabulary` hands
  // over — a name the agent was told to send being refused here is the failure that would be.
  const statedVendorId = resolveOptionalVocabularyValue(
    optionalString(params, "vendor"),
    vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, abbreviation: vendor.abbreviation })),
    { vocabulary: "catalog vendor", parameter: "vendor" }
  );

  const window = parseListWindow(params);
  // Paged over the **strings asked about**, `match_wants`' own answer to the same shape: the caller
  // chose the set, so `total` is what it sent and the cursor walks its own list back to it in order.
  const asked = inputs.slice(window.offset, window.offset + window.limit);

  const [header, areaRows, issuePrefixes, labelling] = await Promise.all([
    loadCollectionHeader(context),
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
    loadCatalogLabelling(context.collectionId),
  ]);
  const nodes = buildAreaPrefixNodes(areaRows);
  const prefixKeys = collectPrefixKeys(nodes, issuePrefixes);
  const vendorAbbr = new Map(vendors.map((vendor) => [vendor.id, vendor.abbreviation]));
  const vendorName = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));

  const parsed = asked.map((input) => parseForeignCatalogNumber(input, vendors, prefixKeys));
  // **An unresolved catalogue word is never looked up**, which is `catalog-resolve.ts`'s stated
  // ordering: an agent that wrote `Fi 456` said *Fischer*, and a `Mi 456` that happens to exist
  // would look exactly like a right answer.
  const lookedUp = parsed.filter((entry) => entry.unknownVendorToken === null && entry.restKey !== "");

  const stamps = lookedUp.length === 0 ? [] : await loadCandidateStamps(context.collectionId, lookedUp);

  const rows = parsed.map((entry) => {
    const vendorId = entry.vendorId ?? statedVendorId;
    const hits =
      entry.unknownVendorToken !== null
        ? []
        : matchStamps(entry, vendorId, stamps, nodes, issuePrefixes, vendorAbbr, labelling, header);
    return compact({
      input: entry.input,
      verdict: catalogVerdict(entry, hits.length),
      vendor: (vendorId !== null ? vendorName.get(vendorId) : undefined) ?? undefined,
      number: entry.number ?? undefined,
      vendorToken: entry.unknownVendorToken ?? undefined,
      acceptedVendors:
        entry.unknownVendorToken !== null ? acceptedNames(vendors) : undefined,
      stamps: hits,
    }) as AgentCatalogResolution;
  });

  return listResponse(rows, inputs.length, window);
}

/**
 * The stamps any of these strings could be about.
 *
 * **Two reads rather than one, and the reason is that a cap here would lie.** The prefix a stamp's
 * number carries depends on its area and its issue, so the exact comparison cannot run until those
 * are loaded — and loading them for every row the recall net pulls back would mean capping the scan,
 * which turns a stamp that was simply row 201 into a `no_match`. So the first read takes the three
 * columns the *necessary* condition needs, and only what survives it is read in full.
 */
async function loadCandidateStamps(
  collectionId: string,
  parsed: readonly ParsedForeignNumber[]
): Promise<StampRow[]> {
  const rows = await prisma.stampCatalogNumber.findMany({
    where: { stamp: { collectionId }, OR: parsed.map(recallClause) },
    select: { stampId: true, number: true },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    if (parsed.some((entry) => couldMatchForeignCatalogNumber(entry, row.number))) {
      ids.add(row.stampId);
    }
  }
  if (ids.size === 0) return [];

  return prisma.stamp.findMany({
    where: { id: { in: [...ids] }, collectionId },
    select: STAMP_SELECT,
  });
}

/** The stamps one string reaches, in a stable order so two calls read the same. */
function matchStamps(
  entry: ParsedForeignNumber,
  vendorId: string | null,
  stamps: readonly StampRow[],
  nodes: Map<string, AreaPrefixNode>,
  issuePrefixes: IssuePrefixMap,
  vendorAbbr: Map<string, string>,
  labelling: CatalogLabelling,
  header: CollectionHeader
): AgentCatalogStamp[] {
  const hits: AgentCatalogStamp[] = [];

  for (const stamp of stamps) {
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const membership = stamp.issueMemberships[0] ?? null;
    const issueId = membership?.issueId ?? null;

    for (const cn of stamp.catalogNumbers) {
      // **The vendor narrows before the key is compared, never after.** A stated or named catalogue
      // is the agent saying which book it read the number out of, and a `Mi 200` answered with a
      // Scott 200 is the wrong stamp wearing a right-looking label.
      if (vendorId !== null && cn.catalogVendorId !== vendorId) continue;
      const prefix = effectivePrefixFor(areaId, cn.catalogVendorId, nodes, issueId, issuePrefixes);
      const abbr = vendorAbbr.get(cn.catalogVendorId) ?? "";
      if (!matchesForeignCatalogNumber(entry, stampCatalogKeys(abbr, prefix, cn.number))) continue;

      hits.push(
        compact({
          stampId: stamp.id,
          matchedNumber: formatCatalogNumber(abbr, prefix, cn.number),
          catalogNumbers: labelling
            .labelFor(areaId, issueId, stamp.catalogNumbers)
            .map((label) => label.label),
          name: stamp.name ?? undefined,
          issue: membership?.issue.name ?? undefined,
          issueYear: membership?.issue.year ?? undefined,
          area: (areaId ? nodes.get(areaId)?.name : undefined) ?? undefined,
          path: collectionPath(header, `/stamps/${stamp.id}`),
        }) as AgentCatalogStamp
      );
      // One stamp answers once however many of its numbers would: the count is what decides
      // `resolved` against `ambiguous`, and a stamp carrying the number in two books is still one
      // stamp.
      break;
    }
  }

  return hits.sort(
    (a, b) => a.matchedNumber.localeCompare(b.matchedNumber, undefined, { numeric: true })
  );
}

/**
 * The registry entry.
 *
 * **A list, and `total` is the count of strings sent rather than of stamps found.** That is the only
 * total this operation measures and it is the one an agent needs: a batch of twenty answered
 * twenty-five rows at a time has to know it is on a page, and how many stamps a *string* reached is
 * already in that string's own row.
 */
export const resolveCatalogNumbersOperation: Operation = {
  name: "resolve_catalog_numbers",
  method: "GET",
  path: "/catalog/resolve",
  description:
    "Turn catalog numbers written the way an auction listing or a dealer writes them — `Mi 123a`, `Michel 123`, `mi123a`, `Fi 456`, a bare `123a` — into the stamps this collection holds, a batch at a time, each answered with how sure the match is. Use this when you have catalog numbers rather than text to search: it says outright whether a number is one stamp here, several, or none, and it never picks between candidates for you. Send the whole batch in one call.",
  writes: false,
  parameters: [
    {
      name: "numbers",
      in: "query",
      type: "string[]",
      required: true,
      description:
        "The catalog strings to resolve, as they were read. Spacing, punctuation and case do not matter, a catalogue's name or abbreviation may lead the number, and an area code between the two is understood. Repeat the parameter once per string rather than separating them with commas, since a comma separates entries.",
    },
    {
      name: "vendor",
      in: "query",
      type: "string",
      required: false,
      description:
        "Which catalogue a number with no catalogue named in it should be read as — a name, an abbreviation or an id from `get_collection_vocabulary`. A string that names its own catalogue keeps it; without this, a bare number is matched against every catalogue and is reported ambiguous if more than one stamp answers.",
    },
  ],
  result: {
    kind: "list",
    description:
      "One row per string sent, in the order they were sent; `total` counts the strings, not the stamps. `verdict` is the answer and there are four: `resolved` (exactly one stamp, in `stamps`), `ambiguous` (several, all returned with their catalog numbers, name, series and area so you can tell them apart — report them, do not pick), `unknown_vendor` (the string names a catalogue this collection does not keep; `vendorToken` is the word and `acceptedVendors` the catalogues it does keep) and `no_match` (the number is simply not held here). `matchedNumber` on a stamp is the number of its own that answered, as the collector reads it. A catalog number is matched exactly rather than loosely, so a near miss is `no_match` and never a quiet approximation; `unknown_vendor` is deliberately not looked up at all, because a number from a book this collection does not keep must not be answered with a same-numbered stamp from one it does. This says what a number *is* — use `list_holdings` or `get_stamp` to find out what is held of it.",
  },
  handler: async (context, params) => readCatalogResolutions(context, params),
};
