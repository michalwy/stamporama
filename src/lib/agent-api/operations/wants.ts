import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { getChecklistsForIssue } from "../../checklists";
import {
  countWants,
  findWantsMatching,
  listWantsPaginated,
  loadWantCopyCounts,
  previewIssueMissingWants,
} from "../../wants";
import { WANT_PRIORITIES, isWantPriority } from "../../want-rules";
import type { WantPriority } from "../../want-rules";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import { optionalInteger, optionalString, requiredString, stringList } from "../params";
import {
  resolveOptionalVocabularyValue,
  resolveVocabularyValue,
  resolveVocabularyValues,
} from "../vocabulary";
import {
  ANY_VALUE,
  NO_CERTIFICATE,
  SINGLE_FORMAT,
  checklistGap,
  want,
  wantMatch,
} from "../want-reads";
import { readCollectionVocabulary } from "./vocabulary";
import { collectionPath, loadCatalogLabelling, loadCollectionHeader } from "./reads-shared";
import type { AcceptanceNames } from "../want-reads";
import type { AgentChecklistGaps, AgentWant, AgentWantMatch } from "../want-reads";
import type { CollectionVocabulary } from "../vocabulary";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Wants and checklists (#712) — the reading half of the third agent workflow: *what am I looking
// for, what would a counterparty's material answer, and what is this set still missing*.
//
// ## Three verbs, and what each of the issue's bullets became
//
// | #712's bullet | here |
// | --- | --- |
// | list and read wants, with their conditions, formats and certificate statuses | `list_wants` |
// | match wants against stock — the collector's wants against what is held | every `list_wants` row's own two copy tallies |
// | …and the mirror direction for a trade | `match_wants` |
// | checklist gaps: what is missing from a checklist | `find_checklist_gaps` |
// | …and which held copies would fill one | `list_holdings` (#710), scoped by `issue_id` |
//
// **Two of those are the issue's list being refined rather than followed, and both refinements are
// #710's own move**: a holdings row states its own `location`, so there is no *where is this copy*
// verb; an unlisted-copy row states its own worth (#711), so there is no *what is this copy worth*
// verb. Here a **want row states what the collection already holds of its stamp**, both per stamp
// and per want, so *the collector's wants against what is held* is answered by the row rather than
// by a fourth operation. And a checklist's held half is the copies themselves, which `list_holdings`
// already states with their ids, locations and grades — a verb of its own would be a third way of
// asking one question.
//
// ## Nothing here writes
//
// All three declare `writes: false` and a `read` token reaches every one of them. **There is no
// operation that creates, narrows or closes a want**, and that is absence rather than an oversight:
// ADR-0032 §7 makes closing and narrowing the collector's decision at the moment a copy reaches
// their hands — *nothing closes automatically, because that would discard a record of intent* — and
// an agent is not that moment. The gap generator (`createWantsForMissing`) is the same decision one
// level up: it is a button the collector presses on the completeness card, having looked at it.
//
// ## And nothing here computes a figure or decides a rule
//
// `wantMatchesCopy` is the one thing that says what satisfies a want (ADR-0032 §1) and it is called
// rather than restated; the gap is `wantGapForStamps` through `previewIssueMissingWants`, which
// reads held-ness through the variant rollup (#661) exactly as the completeness card does. A second
// matching rule here would let the agent and the screen disagree about what is missing, and nothing
// would ever go red over it.

// ── Shared ───────────────────────────────────────────────────────────────────

/** The dictionaries an acceptance set's ids are read back through — the very entries the agent was
 *  told to send, so a name it reads here is a name it can send anywhere else. */
function acceptanceNamesOf(vocabulary: CollectionVocabulary): AcceptanceNames {
  const names = (entries: readonly { id: string; name: string }[]) =>
    new Map(entries.map((entry) => [entry.id, entry.name]));
  return {
    conditions: names(vocabulary.conditions),
    certificateStatuses: names(vocabulary.certificateStatuses),
    formats: names(vocabulary.formats),
  };
}

// ── list_wants ───────────────────────────────────────────────────────────────

const WANT_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "status",
    in: "query",
    type: "string",
    required: false,
    description:
      "Which wants to list. `open` is the list's subject and the default — what is still being looked for. `closed` is what the collector has marked found or given up on, and `all` is both.",
    values: ["open", "closed", "all"],
  },
  {
    name: "priority",
    in: "query",
    type: "string[]",
    required: false,
    description: "Restrict to wants at these urgencies.",
    values: WANT_PRIORITIES,
  },
  {
    name: "condition",
    in: "query",
    type: "string[]",
    required: false,
    description:
      "Restrict to wants that would take a copy in one of these grades. A want with an empty acceptance set means *any grade*, so it matches every grade named here — exactly as it does when a copy actually arrives. Takes names or abbreviations from `get_collection_vocabulary` (`MNH` works), or ids.",
  },
  {
    name: "area",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to wants whose stamp sits in this collecting area, and in every area nested under it. Takes the area's name from `get_collection_vocabulary` or its id.",
  },
  {
    name: "year",
    in: "query",
    type: "integer",
    required: false,
    description: "Restrict to wants whose stamp was issued in this year.",
  },
  {
    name: "stamp_id",
    in: "query",
    type: "string",
    required: false,
    description:
      "One stamp's wants, from `search_collection` or `get_stamp`. A stamp can carry several: mint with a certificate at high urgency, and anything at all at low.",
  },
  {
    name: "issue_id",
    in: "query",
    type: "string",
    required: false,
    description: "Restrict to wants whose stamp belongs to this series, from `search_collection`.",
  },
  {
    name: "search",
    in: "query",
    type: "string",
    required: false,
    description:
      "Free text matched against the stamp's name and catalogue numbers, its series name, and the want's own note.",
  },
];

export async function readWants(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentWant>> {
  const vocabulary = await readCollectionVocabulary(context);
  const area = optionalString(params, "area");
  const conditions = stringList(params, "condition");
  const year = optionalInteger(params, "year");
  const priorities = stringList(params, "priority");
  const stampId = optionalString(params, "stamp_id");
  const issueId = optionalString(params, "issue_id");
  const search = optionalString(params, "search");

  // The parser has already refused anything outside `values`, so this is narrowing a `string` to
  // the domain's own union rather than validating it twice.
  const filters = {
    status: (optionalString(params, "status") ?? "open") as "open" | "closed" | "all",
    ...(priorities.length > 0
      ? { priorities: priorities.filter(isWantPriority) as WantPriority[] }
      : {}),
    ...(conditions.length > 0
      ? {
          conditionIds: [
            ...resolveVocabularyValues(conditions, vocabulary.conditions, {
              vocabulary: "condition",
              parameter: "condition",
            }),
          ],
        }
      : {}),
    ...(year !== null ? { year: String(year) } : {}),
    ...(stampId !== null ? { stampId } : {}),
    ...(issueId !== null ? { issueId } : {}),
    ...(search !== null ? { search } : {}),
    ...(area !== null
      ? {
          areaIds: await areaSubtreeIds(
            context.collectionId,
            resolveVocabularyValue(area, vocabulary.areas, { vocabulary: "area", parameter: "area" })
          ),
        }
      : {}),
  };

  const window = parseListWindow(params);
  const [page, total, header, labelling] = await Promise.all([
    listWantsPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // The match count and never `items.length` (#706).
    countWants(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
    loadCatalogLabelling(context.collectionId),
  ]);

  const names = acceptanceNamesOf(vocabulary);
  return listResponse(
    page.items.map((row) =>
      want(row, {
        catalogNumbers: labelling.labelFor(row.areaId, row.issueId, row.catalogNumbers),
        names,
        // A want has no screen of its own; the stamp's does, and it carries the Wants card the
        // collector acts on (#532). An address a person is about to follow points at the page that
        // can do something.
        path: collectionPath(header, `/stamps/${encodeURIComponent(row.stampId)}`),
      })
    ),
    total,
    window
  );
}

export const listWantsOperation: Operation = {
  name: "list_wants",
  method: "GET",
  path: "/wants",
  description:
    "What this collection is looking for. Each row states the stamp, the grades, certificate statuses and formats the collector would accept, how urgent it is, what the catalogue says such a copy costs, and what the collection already holds of that stamp — both in total and of the kind this particular want would take. Narrow it to open or closed wants, to an urgency, a grade, an area, a year, a series or one stamp.",
  writes: false,
  parameters: WANT_PARAMETERS,
  result: {
    kind: "list",
    description:
      `The wants, open ones first and then by urgency. **An acceptance set of \`["${ANY_VALUE}"]\` means the want takes anything on that axis** — the collector narrowed nothing, not that nothing is acceptable. \`"${NO_CERTIFICATE}"\` and \`"${SINGLE_FORMAT}"\` are real members, not gaps: a want may accept an uncertificated copy, or a single as against a block. **"At least this grade" is not expressible and is not missing** — grades are a dictionary rather than a scale, so an upgrade is simply a used copy failing a mint-only want. \`copiesOfStamp\` is everything held of the stamp whichever want it answers, which is the upgrade context; \`copiesMatching\` is the only figure that may be read as *one is already on its way*. \`catalogRange\` is computed from the catalogue now, over the combinations the want accepts — it is never a ceiling the collector set, because a want carries no price at all.`,
  },
  handler: async (context, params) => readWants(context, params),
};

// ── match_wants ──────────────────────────────────────────────────────────────

const MATCH_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "stamp_ids",
    in: "query",
    type: "string[]",
    required: true,
    description:
      "The stamps to ask about — what a counterparty is holding, resolved to this collection's own stamp ids with `search_collection`. Ask about one grade at a time: send the stamps a partner offers used in one call and the mint ones in another.",
  },
  {
    name: "condition",
    in: "query",
    type: "string",
    required: true,
    description:
      "The grade the material is in. Required, and not for tidiness: a want accepts a *set* of grades, so *would I want this* is unanswerable about material whose grade is unstated. Takes a name or abbreviation from `get_collection_vocabulary` (`MNH` works) or an id.",
  },
  {
    name: "certificate",
    in: "query",
    type: "string",
    required: false,
    description:
      "The certificate the material carries. Leave it out for material with none — which is itself a value a want can be narrowed to, not a gap.",
  },
  {
    name: "format",
    in: "query",
    type: "string",
    required: false,
    description:
      "The physical format: a pair, a block, a strip. Leave it out for a single, which is what most material is and is itself a value.",
  },
];

export async function readWantMatches(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentWantMatch>> {
  const vocabulary = await readCollectionVocabulary(context);
  const stampIds = [...new Set(stringList(params, "stamp_ids"))];
  if (stampIds.length === 0) {
    throw invalidRequest(
      '"stamp_ids" is empty. Resolve the counterparty\'s stamps with `search_collection` and send their ids.'
    );
  }

  const conditionId = resolveVocabularyValue(
    requiredString(params, "condition"),
    vocabulary.conditions,
    { vocabulary: "condition", parameter: "condition" }
  );
  const certificateStatusId = resolveOptionalVocabularyValue(
    optionalString(params, "certificate"),
    vocabulary.certificateStatuses,
    { vocabulary: "certificate status", parameter: "certificate" }
  );
  const formatId = resolveOptionalVocabularyValue(
    optionalString(params, "format"),
    vocabulary.formats,
    { vocabulary: "format", parameter: "format" }
  );

  const window = parseListWindow(params);
  // Paged over the **stamps asked about**, which is the only set with a size here: the caller chose
  // it, so `total` is what it sent and the cursor walks its own list back to it in order.
  const asked = stampIds.slice(window.offset, window.offset + window.limit);

  const [stamps, matches, tallies, labelling] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: asked }, collectionId: context.collectionId },
      select: {
        id: true,
        name: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        issueMemberships: {
          select: { issueId: true, issue: { select: { name: true, year: true } } },
          orderBy: { issueId: "asc" },
          take: 1,
        },
      },
    }),
    findWantsMatching(
      context.ownerId,
      context.collectionId,
      asked.map((stampId) => ({
        key: stampId,
        stampId,
        conditionId,
        certificateStatusId,
        formatId,
      }))
    ),
    // **The tally is read separately and deliberately.** `findWantsMatching` reports a want with
    // its counts zeroed — the intake review names the copy arriving, not the pile behind it — so
    // reading `copies` off a matched want would report *nothing held* about every stamp, which is
    // the one wrong answer this row exists to prevent. This is `loadWantCopyCounts`, the very read
    // the want list's own badges come from.
    loadWantCopyCounts(context.collectionId, asked),
    loadCatalogLabelling(context.collectionId),
  ]);

  const found = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const unknown = asked.filter((id) => !found.has(id));
  if (unknown.length > 0) {
    // **A refusal rather than a silently short answer.** A row simply missing from the result would
    // read as *not wanted*, which is the one wrong answer an agent cannot tell from a right one —
    // and the mistake it is made by is a stamp id from somewhere other than this collection.
    throw notFound(
      `${unknown.length === 1 ? "This stamp is" : `${unknown.length} of these stamps are`} not in this token's collection: ${unknown.slice(0, 5).join(", ")}. Resolve them with \`search_collection\` first.`
    );
  }

  const byStamp = new Map<string, typeof matches>();
  for (const match of matches) {
    const bucket = byStamp.get(match.key);
    if (bucket) bucket.push(match);
    else byStamp.set(match.key, [match]);
  }

  const condition = vocabulary.conditions.find((entry) => entry.id === conditionId)?.name ?? conditionId;
  const certificate =
    certificateStatusId === null
      ? NO_CERTIFICATE
      : (vocabulary.certificateStatuses.find((entry) => entry.id === certificateStatusId)?.name ??
        certificateStatusId);
  const format =
    formatId === null
      ? SINGLE_FORMAT
      : (vocabulary.formats.find((entry) => entry.id === formatId)?.name ?? formatId);

  return listResponse(
    asked.map((stampId) => {
      const stamp = found.get(stampId)!;
      const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
      const membership = stamp.issueMemberships[0] ?? null;
      const hits = byStamp.get(stampId) ?? [];
      return wantMatch(
        {
          stampId,
          stampName: stamp.name,
          issueName: membership?.issue.name ?? null,
          issueYear: membership?.issue.year ?? null,
          wants: hits.map((hit) => ({
            id: hit.want.id,
            priority: hit.want.priority,
            notes: hit.want.notes,
          })),
          // Per **stamp** — everything held of it, whichever want it does or does not answer. A
          // stamp with no counted copy is simply absent from the map, which is nought of each.
          copies: tallies.get(stampId) ?? { held: 0, toSort: 0, ordered: 0, inTransit: 0 },
        },
        {
          catalogNumbers: labelling.labelFor(
            link?.collectionAreaId ?? null,
            membership?.issueId ?? null,
            stamp.catalogNumbers
          ),
          condition,
          certificate,
          format,
        }
      );
    }),
    stampIds.length,
    window
  );
}

export const matchWantsOperation: Operation = {
  name: "match_wants",
  method: "GET",
  path: "/wants/matches",
  description:
    "Given stamps a counterparty holds and the grade they are in, say which of the collector's open wants each would satisfy — and what the collection already has of that stamp. This is the question a trade starts from: what does this person have that I want, and do I have one already.",
  writes: false,
  parameters: MATCH_PARAMETERS,
  result: {
    kind: "list",
    description:
      "One row per stamp asked about, in the order they were sent. `wants` is **empty rather than absent** when nothing matches — *no* is an answer, not a dropped row. A want with no acceptance set on an axis takes anything on it, so a wide-open want matches every grade. `copiesOfStamp` is the other half of the decision: a stamp that is wanted *and* already held three times over is a different proposition from one that is wanted and missing. A stamp id that is not in this collection is refused rather than answered, because a missing row would read as *not wanted*.",
  },
  handler: async (context, params) => readWantMatches(context, params),
};

// ── find_checklist_gaps ──────────────────────────────────────────────────────

export async function readChecklistGaps(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentChecklistGaps> {
  const issueId = requiredString(params, "issueId");
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, collectionId: context.collectionId },
    select: { id: true, name: true, year: true },
  });
  if (!issue) {
    throw notFound(
      `No series with id "${issueId}" is in this token's collection. Use \`search_collection\` to find the right id.`
    );
  }

  const [checklists, gaps, header, labelling] = await Promise.all([
    getChecklistsForIssue(context.ownerId, context.collectionId, issue.id),
    previewIssueMissingWants(context.ownerId, context.collectionId, issue.id),
    loadCollectionHeader(context),
    loadCatalogLabelling(context.collectionId),
  ]);

  const missingIds = [...new Set(gaps.flatMap((gap) => gap.missingStampIds))];
  const stamps = await prisma.stamp.findMany({
    where: { id: { in: missingIds }, collectionId: context.collectionId },
    select: {
      id: true,
      name: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
    },
  });
  const byId = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const sizeById = new Map(checklists.map((list) => [list.id, list.stampIds.length]));

  return {
    issueId: issue.id,
    ...(issue.name ? { issue: issue.name } : {}),
    ...(issue.year !== null ? { issueYear: issue.year } : {}),
    checklists: gaps.map((gap) => {
      const wanted = new Set(gap.toCreateStampIds);
      return checklistGap({
        checklistId: gap.checklistId,
        name: gap.name,
        required: sizeById.get(gap.checklistId) ?? gap.missingStampIds.length,
        missing: gap.missingStampIds.map((stampId) => {
          const stamp = byId.get(stampId);
          const link =
            stamp?.stampAreaLinks.find((l) => l.isPrimary) ?? stamp?.stampAreaLinks[0] ?? null;
          return {
            stampId,
            stampName: stamp?.name ?? null,
            catalogNumbers: labelling.labelFor(
              link?.collectionAreaId ?? null,
              issue.id,
              stamp?.catalogNumbers ?? []
            ),
            // `toCreateStampIds` is the gap **minus** what already carries an open want, so a stamp
            // missing from it is one already being looked for — the same rule that makes pressing
            // *add what is missing* twice a no-op.
            alreadyWanted: !wanted.has(stampId),
          };
        }),
      });
    }),
    path: collectionPath(header, `/issues/${encodeURIComponent(issue.id)}`),
  };
}

export const findChecklistGapsOperation: Operation = {
  name: "find_checklist_gaps",
  method: "GET",
  path: "/issues/{issueId}/checklist-gaps",
  description:
    "What a series' checklists are still missing. A checklist is a named set of stamps that counts as one complete unit, and a series may carry several — a basic set beside a specialized one — so the gap is stated per checklist and never over their union. Each missing stamp says whether an open want already covers it.",
  writes: false,
  parameters: [
    {
      name: "issueId",
      in: "path",
      type: "string",
      required: true,
      description: "The series' id, from `search_collection` or `get_issue`.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The series' checklists with their gaps. `required` is how many stamps the checklist names and `held` how many the collection has a copy of — read **through the variant tree**, so a copy filed under a variant of a listed stamp counts as a copy of it, exactly as the completeness card on the same screen counts it. `missing` names the rest; `alreadyWanted` marks the ones an open, unnarrowed want already covers, so what is left is the shopping list. A *narrower* want for the same stamp does not count as covering it, which is the app's own rule: wanting a mint copy and wanting any copy are two different intents about one stamp. Which copies answer the held ones is `list_holdings` with this same `issue_id` — each of its rows states its own copy id, grade and filing place.",
  },
  handler: async (context, params) => readChecklistGaps(context, params),
};
