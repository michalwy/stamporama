import "server-only";
import { searchCollection } from "../../collection-search";
import { compact, mayBeTrimmed, searchCopy, searchStamp } from "../collection-reads";
import { requiredString } from "../params";
import type { AgentSearchResult } from "../collection-reads";
import type { Operation, OperationContext, ParsedParams } from "../types";

// `GET /api/v1/search` — one text, three answers (#710).
//
// **This is `collection-search.ts` exposed, not a fourth search.** That module was built for the
// browser extension's *have I got this?* window (#529) and it deliberately runs three searches
// rather than one: the stamp half is the inventory picker's own (#104/#73), the issue half the issue
// picker's (#73), the copy half the Copies list's (#106). Inventing a single notion of a match here
// would answer a question none of the collector's own screens would then repeat — which is the
// module's own argument, and it applies to an agent for the same reason a person meets it: the agent
// is being asked about a collection a person reads through those screens.
//
// **What it adds is the trimming flag**, and only because a search cannot say what a list says. Every
// list on this surface states its full `total` so that a trimmed page is visible as one (#706); the
// three searches behind this take a fixed number of rows and count none of the rest, so the honest
// statement is *this group came back full and may be trimmed* rather than a total nothing measured.
// The alternative — counting the matches for each of three searches — would mean changing all three,
// which is the reinvention this issue says not to do.

/** The caps the three searches take. Stated here because the answer depends on them and nothing in
 *  the returned rows does: a group that came back at its cap is a group of unknown completeness.
 *
 *  **Read off `collection-search.ts` rather than imported**, because they are not exported and two
 *  of them are the pickers' own numbers rather than that module's. They are therefore checked at
 *  runtime in the only way that costs nothing — the comparison below is `>=`, so a cap that moves
 *  *down* keeps working and one that moves *up* only under-reports trimming on a full page. Either
 *  way the flag never claims completeness it does not have. */
const STAMP_CAP = 20;
const ISSUE_CAP = 20;
const COPY_CAP = 10;

export async function readCollectionSearch(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentSearchResult> {
  const query = requiredString(params, "query");
  const result = await searchCollection(context.ownerId, context.collectionId, query);
  return compact({
    query: result.query,
    stamps: result.stamps.map((row) => searchStamp(context.collectionId, row)),
    stampsMayBeTrimmed: mayBeTrimmed(result.stamps.length, STAMP_CAP),
    issues: result.issues.map((row) =>
      compact({
        issueId: row.issueId,
        name: row.name ?? undefined,
        year: row.year ?? undefined,
        path: row.path,
      })
    ),
    issuesMayBeTrimmed: mayBeTrimmed(result.issues.length, ISSUE_CAP),
    copies: result.copies.map((row) => searchCopy(context.collectionId, row)),
    copiesMayBeTrimmed: mayBeTrimmed(result.copies.length, COPY_CAP),
  });
}

/**
 * The registry entry.
 *
 * **`kind: "object"` and not `"list"`, which is the judgement in this operation.** A list gets
 * `limit` and `cursor` appended and promises a `total`, and this answers with three groups produced
 * by three searches with three different notions of relevance — there is no single sequence for a
 * cursor to walk and no total any of them computed. Declaring it a list would put a promise in the
 * generated document that the handler cannot keep, which is worse than the honest shape.
 *
 * **An empty query is an empty answer rather than an error.** That is `searchCollection`'s own rule
 * and it is right here too: a model that passed through a blank selection has made no mistake it
 * could act on a refusal about. What `parseParameters` still refuses is an absent or whitespace-only
 * `query`, because a required parameter nobody sent is a call that was not finished.
 */
export const searchCollectionOperation: Operation = {
  name: "search_collection",
  method: "GET",
  path: "/search",
  description:
    "Search the whole collection with one piece of text — a catalog number, a stamp or series name, a shelf reference, or a copy's own number. Use this first when you have been given something to look up and no id: it is what turns text into the stamp, issue and copy ids every other operation takes. A catalog number written with its catalogue in front (`Mi PL 200`) resolves as readily as the bare number.",
  writes: false,
  parameters: [
    {
      name: "query",
      in: "query",
      type: "string",
      required: true,
      description:
        "The text to look for. Matched against stamp and series names, catalog numbers, a copy's shelf reference and a copy's own number.",
    },
  ],
  result: {
    kind: "object",
    description:
      "Three groups, tagged by which they are: `stamps` (the catalogue entries that matched, each saying how many copies are held of it and how many under its variants — two figures, never added together), `issues` (the series) and `copies` (the pieces in hand). Each group is capped, and `stampsMayBeTrimmed` / `issuesMayBeTrimmed` / `copiesMayBeTrimmed` say whether that group came back full and so may be missing matches — use `list_holdings` for the exhaustive answer about copies. A copy with no `certificate` carries none and one with no `format` is a single; neither is a value this collection configures. `path` is where the record lives in the app, relative to this instance.",
  },
  handler: async (context, params) => readCollectionSearch(context, params),
};
