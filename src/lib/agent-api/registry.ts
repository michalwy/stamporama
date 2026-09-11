// The operation registry (#706) — the single list every wrapper reads.
//
// **It carries the vocabulary read, the collection reads and the offer verbs.** #706 built the
// foundation and shipped none; #708 added `get_collection_vocabulary`, which is the operation every
// later one leans on — it is what lets an agent send `"MNH"` instead of a cuid; #710 added the six
// reads over the collection; #711 added the six offer verbs, the **first three writes on this
// surface**. #712 adds wants and trades, and each one adds an entry here and nowhere else. The
// OpenAPI document at `/api/v1/openapi.json` and #709's MCP tool list are both generated from this
// array.
//
// **The order is the order an agent meets them in**, which is the only thing this array decides
// beyond membership: the vocabulary first because a session starts by fetching it, then the search
// that turns text into ids, then the three records those ids open, then the two reads over what is
// held — then the offer workflow in the order it is walked, finding what is unlisted before
// drafting a listing and drafting one before pricing and wording it. It is what the generated
// document lists them in and what a model reads down.
//
// **Nothing here publishes to a marketplace, and that is enforced by there being no such entry**
// (#711, `agent-api.md`, *What is deliberately absent*). It is not a flag: a switch is something
// that can be flipped, and an operation that does not exist cannot be. Two tests keep it that way —
// `tests/integration/agent-api-offers.test.ts` fails on a publish-shaped **name** in this array, and
// `tests/unit/agent-api-operation-boundary.test.ts` fails on an operation module reaching the domain
// functions that publish, record a listing or move a state, which is the half that still works when
// somebody adds an operation called something else entirely.
//
// **The import direction is one-way and it matters.** This module imports the operation modules; an
// operation module imports the types and the helpers beside it, never this file. A registry that
// imported handlers which imported the registry back is exactly the `src/lib` cycle that typechecks,
// passes every test, and then throws `Cannot access 'X' before initialization` at module-init in the
// real app (`platform.md`, #658).
//
// **And nothing in `tests/unit/` may import this module.** Once it carries handlers it reaches
// Prisma, and `tests/unit/unit-suite-purity.test.ts` walks the unit suite's import graph and fails
// on any path that does. What is worth unit-testing is the machinery — `openapi.ts`,
// `path-template.ts`, `params.ts`, `list.ts` — and every one of those is reachable without this
// file. The integration suite is where a real operation gets exercised end to end.

import { getCollectionVocabularyOperation } from "./operations/vocabulary";
import { searchCollectionOperation } from "./operations/search";
import { getCopyOperation, getIssueOperation, getStampOperation } from "./operations/records";
import { listHoldingsOperation, summarizeValuationOperation } from "./operations/holdings";
import {
  draftOfferOperation,
  findUnlistedCopiesOperation,
  getOfferOperation,
  listOffersOperation,
  setOfferPriceOperation,
  setOfferTextOperation,
} from "./operations/offers";
import { matchPathTemplate, parsePathTemplate, templateSpecificity } from "./path-template";
import type { HttpMethod, Operation } from "./types";
import type { PathTemplate } from "./path-template";

export const OPERATIONS: readonly Operation[] = [
  getCollectionVocabularyOperation,
  searchCollectionOperation,
  getStampOperation,
  getIssueOperation,
  getCopyOperation,
  listHoldingsOperation,
  summarizeValuationOperation,
  findUnlistedCopiesOperation,
  listOffersOperation,
  getOfferOperation,
  draftOfferOperation,
  setOfferPriceOperation,
  setOfferTextOperation,
];

interface Bound {
  readonly operation: Operation;
  readonly template: PathTemplate;
}

/** Templates parsed once, at module load, so a malformed path fails loudly rather than per request. */
const BOUND: readonly Bound[] = OPERATIONS.map((operation) => ({
  operation,
  template: parsePathTemplate(operation.path),
}));

export interface OperationMatch {
  readonly operation: Operation;
  readonly pathValues: Readonly<Record<string, string>>;
}

export interface PathMatch {
  /** Everything bound to this path, whatever the method. */
  readonly candidates: readonly OperationMatch[];
}

/**
 * What is bound to `segments`, across every method. The dispatcher picks by method from this, which
 * is what lets it tell *no such path* (404) from *not under this method* (405) — and answer the
 * second with the methods that would have worked, so an agent that sent a `GET` where a `POST` was
 * wanted corrects itself in one turn.
 */
export function matchPath(segments: readonly string[]): PathMatch {
  const candidates: { match: OperationMatch; specificity: number }[] = [];
  for (const bound of BOUND) {
    const pathValues = matchPathTemplate(bound.template, segments);
    if (pathValues) {
      candidates.push({
        match: { operation: bound.operation, pathValues },
        specificity: templateSpecificity(bound.template),
      });
    }
  }
  // **Most specific first**, so a literal segment beats a `{name}` — `/copies/unlisted` is
  // `find_unlisted_copies` and not `get_copy` with an id of `"unlisted"` (#711). The comparison is
  // in the pure `path-template.ts`, where a unit test holds it and where the reasoning lives; a
  // stable sort keeps registry order between templates of equal specificity, which is what decides
  // the `405` message's method order.
  candidates.sort((a, b) => a.specificity - b.specificity);
  return { candidates: candidates.map((candidate) => candidate.match) };
}

export function pickMethod(match: PathMatch, method: HttpMethod): OperationMatch | null {
  return match.candidates.find((c) => c.operation.method === method) ?? null;
}

export function allowedMethods(match: PathMatch): readonly string[] {
  return match.candidates.map((c) => c.operation.method);
}
