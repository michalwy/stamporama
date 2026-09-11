// The operation registry (#706) — the single list every wrapper reads.
//
// **It carries the vocabulary read and the collection reads.** #706 built the foundation and shipped
// none; #708 added `get_collection_vocabulary`, which is the operation every later one leans on — it
// is what lets an agent send `"MNH"` instead of a cuid; #710 added the six reads over the collection
// below. #711 adds the offer verbs and #712 wants and trades, and each one adds an entry here and
// nowhere else. The OpenAPI document at `/api/v1/openapi.json` and #709's MCP tool list are both
// generated from this array.
//
// **The order is the order an agent meets them in**, which is the only thing this array decides
// beyond membership: the vocabulary first because a session starts by fetching it, then the search
// that turns text into ids, then the three records those ids open, then the two reads over what is
// held. It is what the generated document lists them in and what a model reads down.
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
import { matchPathTemplate, parsePathTemplate } from "./path-template";
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
  const candidates: OperationMatch[] = [];
  for (const bound of BOUND) {
    const pathValues = matchPathTemplate(bound.template, segments);
    if (pathValues) candidates.push({ operation: bound.operation, pathValues });
  }
  return { candidates };
}

export function pickMethod(match: PathMatch, method: HttpMethod): OperationMatch | null {
  return match.candidates.find((c) => c.operation.method === method) ?? null;
}

export function allowedMethods(match: PathMatch): readonly string[] {
  return match.candidates.map((c) => c.operation.method);
}
