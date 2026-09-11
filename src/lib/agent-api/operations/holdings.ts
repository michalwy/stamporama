import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { countItems, countItemsByCondition, getHoldingsValuation, listItemsPaginated } from "../../items";
import { conditionCounts, holding, valuationSummary } from "../collection-reads";
import { notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import { optionalInteger, optionalString } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { readCollectionVocabulary } from "./vocabulary";
import { loadCatalogLabelling, loadLocationPaths } from "./reads-shared";
import type { AgentConditionCount, AgentHolding, AgentValuationSummary } from "../collection-reads";
import type { ListResponse } from "../list";
import type { CollectionVocabulary } from "../vocabulary";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// What the collection holds, and what it is worth (#710).
//
// **Two operations over one scope, and that is the reason they share a file.** `list_holdings` pages
// the copies a scope matches and `summarize_valuation` values the same scope; they resolve the same
// parameters through the same code, and the domain functions behind them — `listItemsPaginated`,
// `countItems`, `countItemsByCondition`, `getHoldingsValuation` — already narrow through one private
// `buildItemWhere` in `items.ts` for exactly this reason: *a count that disagrees with the rows under
// it is worse than no count.* Resolving the scope twice, in two files, is how that guarantee would be
// lost one refactor later.
//
// **Nothing here computes a figure.** The valuation is `getHoldingsValuation`'s, which is the Copies
// screen's own summary bar (#134/#458), and the projection in `../collection-reads.ts` narrows it.
// `valuation.md`'s standing rule survives the narrowing unchanged: a total never travels without the
// counts saying how much of the collection is behind it.

// ── The scope ────────────────────────────────────────────────────────────────

/**
 * The scoping parameters, declared once and shared by both operations.
 *
 * **Six named scopes and not a filter surface**, which is #710's first decision. Each names something
 * a collector would say out loud — *what have I got from this series, from this country, from this
 * year, of this stamp, in this drawer, in this grade* — and they compose with AND. What is
 * deliberately **not** here is the rest of the Copies list's two dozen filters: an agent resolves a
 * wide parameter surface by guessing, and every knob added is one more thing for it to guess wrong.
 *
 * **There is no *where is this copy* verb**, and this is where it went. #710's fifth bullet asks for
 * *where a copy is, by location*; every row below already states its own `location` and
 * `locationRef`, which answers *where is it* without a second call — and that is what lets the
 * issue's *Done when* pair happen in one call rather than three. The other half of the bullet, *what
 * is in this drawer*, is the `location` scope here. A separate operation would have been a third way
 * of asking one question.
 */
const SCOPE_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "issue_id",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to copies of stamps in this series. Get the id from `search_collection` or `get_issue`.",
  },
  {
    name: "stamp_id",
    in: "query",
    type: "string",
    required: false,
    description: "Restrict to copies of this one catalogue entry exactly. Variants are not rolled in — a variant's copies are its own.",
  },
  {
    name: "area",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to copies whose stamp sits in this collecting area, and in every area nested under it. Takes the area's name from `get_collection_vocabulary` or its id.",
  },
  {
    name: "year",
    in: "query",
    type: "integer",
    required: false,
    description: "Restrict to copies whose stamp was issued in this year.",
  },
  {
    name: "location",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to copies filed in this storage location, and in every location nested under it. Takes the location's name from `get_collection_vocabulary` or its id.",
  },
  {
    name: "condition",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to copies in this grade. Takes the condition's name or abbreviation from `get_collection_vocabulary` (`MNH` works) or its id.",
  },
];

/** The scope as `items.ts` takes it. */
interface HoldingScope {
  readonly issueId?: string;
  readonly stampId?: string;
  readonly areaIds?: string[];
  readonly year?: number;
  readonly locationId?: string;
  readonly conditionIds?: string[];
}

/**
 * Turn what the agent sent into what `items.ts` takes.
 *
 * **A named scope that matches nothing is a refusal rather than an empty answer**, which is the one
 * judgement in this function. An agent handed `[]` cannot tell *you hold none of these* from *that id
 * was wrong*, and the first is an answer while the second is a mistake it could fix — so an
 * `issue_id` or `stamp_id` naming nothing in this collection is `not_found`, and a bad area,
 * location or condition is `resolveVocabularyValue`'s own refusal, which hands back the accepted
 * names (#708). Both are the same convention: an agent told what would have worked corrects itself
 * in one turn.
 *
 * **The vocabulary is read only when a vocabulary value was sent**, and it is read through
 * `readCollectionVocabulary` — the very endpoint the agent took those names from. Resolving against a
 * narrower query would be a second place for a dictionary row to be spelled, and the failure would be
 * a name the agent was told to send being refused.
 */
async function resolveScope(
  context: OperationContext,
  params: ParsedParams
): Promise<HoldingScope> {
  const issueId = optionalString(params, "issue_id");
  const stampId = optionalString(params, "stamp_id");
  const area = optionalString(params, "area");
  const year = optionalInteger(params, "year");
  const location = optionalString(params, "location");
  const condition = optionalString(params, "condition");

  const vocabulary: CollectionVocabulary | null =
    area !== null || location !== null || condition !== null
      ? await readCollectionVocabulary(context)
      : null;

  const scope: HoldingScope = {
    ...(issueId !== null ? { issueId } : {}),
    ...(stampId !== null ? { stampId } : {}),
    ...(year !== null ? { year } : {}),
    ...(condition !== null && vocabulary
      ? {
          conditionIds: [
            resolveVocabularyValue(condition, vocabulary.conditions, {
              vocabulary: "condition",
              parameter: "condition",
            }),
          ],
        }
      : {}),
    ...(location !== null && vocabulary
      ? {
          locationId: resolveVocabularyValue(location, vocabulary.locations, {
            vocabulary: "location",
            parameter: "location",
          }),
        }
      : {}),
  };

  if (issueId !== null) await assertIssue(issueId, context.collectionId);
  if (stampId !== null) await assertStamp(stampId, context.collectionId);

  if (area !== null && vocabulary) {
    const areaId = resolveVocabularyValue(area, vocabulary.areas, {
      vocabulary: "area",
      parameter: "area",
    });
    // The area **plus every area nested under it**, which is what a collector means by "Poland":
    // `areaIds` is documented as the resolved subtree and `items.ts` does not walk the tree itself.
    // `areaSubtreeIds` keeps the root, exactly as the bulk-lot builder needs it to (#759).
    return { ...scope, areaIds: await areaSubtreeIds(context.collectionId, areaId) };
  }
  return scope;
}

async function assertIssue(issueId: string, collectionId: string): Promise<void> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, collectionId },
    select: { id: true },
  });
  if (!issue) {
    throw notFound(
      `No series with id "${issueId}" is in this token's collection. Use \`search_collection\` to find the right id.`
    );
  }
}

async function assertStamp(stampId: string, collectionId: string): Promise<void> {
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId },
    select: { id: true },
  });
  if (!stamp) {
    throw notFound(
      `No stamp with id "${stampId}" is in this token's collection. Use \`search_collection\` to find the right id.`
    );
  }
}

/**
 * What *held* means, and it is the Copies screen's own answer rather than a new one.
 *
 * `excludeGone` drops the copies that have **left** — sold on a sale line, or given away on a closed
 * trade's give line (#644) — and leaving `includeDisposed` off drops the ones written off after
 * delivery (#394). What is left is what the collector still has, in-flight copies included: a copy in
 * the post is bought (ADR-0032 §7), which is why each row states its own `deliveryState` rather than
 * this filter pretending it has arrived.
 */
const HELD = { excludeGone: true } as const;

// ── list_holdings ────────────────────────────────────────────────────────────

export interface AgentHoldingsResponse extends ListResponse<AgentHolding> {
  /** The condition breakdown over the **whole** match, not over this page. */
  readonly byCondition: AgentConditionCount[];
}

export async function readHoldings(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentHoldingsResponse> {
  const scope = await resolveScope(context, params);
  const window = parseListWindow(params);
  const filters = { ...scope, ...HELD };

  const [page, total, byCondition, vocabulary, labelling, locations] = await Promise.all([
    listItemsPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // **The match count, never `items.length`** (#706): a total derived from its own page always
    // claims to be complete, which is the failure the envelope exists to prevent.
    countItems(context.ownerId, context.collectionId, filters),
    countItemsByCondition(context.ownerId, context.collectionId, filters),
    readCollectionVocabulary(context),
    loadCatalogLabelling(context.collectionId),
    loadLocationPaths(context.collectionId),
  ]);

  const conditionNames = new Map(vocabulary.conditions.map((row) => [row.id, row.name]));

  return {
    ...listResponse(
      page.items.map((copy) =>
        holding(copy, {
          catalogNumbers: labelling.labelFor(copy.areaId, copy.issueId, copy.catalogNumbers),
          location: locations.pathFor(copy.locationId),
        })
      ),
      total,
      window
    ),
    byCondition: conditionCounts(byCondition, conditionNames),
  };
}

export const listHoldingsOperation: Operation = {
  name: "list_holdings",
  method: "GET",
  path: "/holdings",
  description:
    "What the collection actually holds, narrowed to a series, a stamp, an area, a year, a storage location or a grade — any of them, in combination. Each row says which stamp it is, what condition it is in and where it is filed, so one call answers what is held and where it sits. This is the operation for `what do I have from …` questions; sold copies and ones written off are not in it.",
  writes: false,
  parameters: SCOPE_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The copies held in the scope asked for, in the order they were added to the collection. `byCondition` counts the **whole** match by grade, not just this page, so the question `in what condition` is answered even when the rows were trimmed. A copy with no `certificate` carries none and one with no `format` is a single. `deliveryState` separates what is in hand (`delivered`, `to_sort`) from what is still on its way (`ordered`, `in_transit`) — both are held. `location` is the full filing path and `locationRef` the mark written on the shelf; a ref only means anything inside its own location. With no scope given this is the whole collection.",
  },
  handler: async (context, params) => readHoldings(context, params),
};

// ── summarize_valuation ──────────────────────────────────────────────────────

export async function readValuation(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentValuationSummary> {
  const scope = await resolveScope(context, params);
  const summary = await getHoldingsValuation(context.ownerId, context.collectionId, {
    ...scope,
    ...HELD,
  });
  return valuationSummary(summary);
}

export const summarizeValuationOperation: Operation = {
  name: "summarize_valuation",
  method: "GET",
  path: "/holdings/valuation",
  description:
    "What a part of the collection is worth, four ways at once: the catalogue's list price, what the market has actually paid for copies like these, what the collector paid, and what the copies in the same scope that are gone had cost. Takes the same scope as `list_holdings`, so `what is my Poland 1920s worth` is one call. Every total comes with the counts saying how many copies are behind it — read them: a figure resting on a fifth of the copies is not the collection's worth.",
  writes: false,
  parameters: SCOPE_PARAMETERS,
  result: {
    kind: "object",
    description:
      "Four totals over one scope, every amount in `baseCurrency`. `catalogue` is what a published catalogue lists, with `unpricedCount` (no catalogue row matched the copy), `unconvertibleCount` (priced in a currency with no rate) and `uncertainCount` (the stamp's variant is unknown, so the figure is the cheapest of its priced variants — an estimate). `market` is what auction results say, and `noEvidenceCount` is the copies with no results at all, which contribute nothing rather than a catalogue-derived stand-in. `cost` is what was paid, with `pendingCount` for copies in a purchase lot not yet split and `noneCount` for ones never costed. `writeOff` is what the copies in scope that are no longer held had cost — so this reads over a wider set than `list_holdings`, whose rows are the held ones only; the two are not meant to agree.",
  },
  handler: async (context, params) => readValuation(context, params),
};
