// The list conventions every `/api/v1` list obeys (#706).
//
// **Every list response states the full total.** That is the one convention here that is not
// obvious, and it is the important one: an agent that receives twenty-five rows and no total has no
// way to know whether it saw the collection or a twenty-fifth of it, so it answers confidently about
// a slice. `total` is what turns a trimmed answer into a known-trimmed one, and `nextCursor` is what
// lets the agent decide whether the rest is worth its context.
//
// The cursor is the next **offset**, as a decimal string. That is this project's existing spelling
// (`wants.ts`, `sales.ts`, `items.ts` and nine others all return `nextCursor: hasMore ? String(offset
// + pageSize) : null`), so the domain layer's own paging drops straight in and no operation has to
// translate between two schemes. It is opaque to the agent by contract — the sentence on the `cursor`
// parameter says to send back what the last response gave — which leaves it free to become something
// else later without a version bump.
//
// Pure: no Prisma, no `next/server`. Unit-testable, and unit-tested.

import { invalidRequest } from "./errors";
import { optionalInteger, optionalString } from "./params";
import type { ParameterSpec, ParsedParams } from "./types";

/** What a list returns when the agent asks for no particular size. */
export const DEFAULT_LIST_LIMIT = 25;

/**
 * The most rows one call will ever return. It is a **hard** cap rather than a default an agent may
 * raise: the constraint being protected is the agent's context window, and an agent optimising its
 * own round trips is exactly the caller that would raise it to 5000 and then be unable to read the
 * answer.
 */
export const MAX_LIST_LIMIT = 100;

/**
 * The window parameters, declared once and appended to every list operation by the OpenAPI
 * generator and by #709's tool generation. An operation does not restate them — that would be the
 * second place to edit that this whole registry exists to avoid.
 */
export const LIST_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "limit",
    in: "query",
    type: "integer",
    required: false,
    description: `How many rows to return, 1 to ${MAX_LIST_LIMIT}; ${DEFAULT_LIST_LIMIT} when omitted.`,
  },
  {
    name: "cursor",
    in: "query",
    type: "string",
    required: false,
    description:
      "Where to continue from. Send back the `nextCursor` from the previous response; omit it for the first page.",
  },
];

export interface ListWindow {
  readonly limit: number;
  readonly offset: number;
}

export interface ListResponse<T> {
  readonly items: readonly T[];
  /** How many rows match in total, whatever this page holds. */
  readonly total: number;
  /** The `cursor` for the next page, or `null` when this page is the last. */
  readonly nextCursor: string | null;
}

/**
 * The window a list call asked for. Reads `limit` and `cursor` off the already-parsed parameters, so
 * a malformed `limit` has been rejected as a non-integer before this sees it and what is left to
 * check is the range.
 */
export function parseListWindow(params: ParsedParams): ListWindow {
  const requested = optionalInteger(params, "limit");
  if (requested !== null && (requested < 1 || requested > MAX_LIST_LIMIT)) {
    throw invalidRequest(
      `"limit" must be between 1 and ${MAX_LIST_LIMIT}. Ask for a smaller page and follow "nextCursor" for the rest.`
    );
  }
  return { limit: requested ?? DEFAULT_LIST_LIMIT, offset: parseCursor(optionalString(params, "cursor")) };
}

function parseCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  if (!/^\d+$/.test(cursor)) {
    throw invalidRequest(
      'The "cursor" is not one this API issued. Send back the `nextCursor` from the previous response, or omit it to start at the beginning.'
    );
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) {
    throw invalidRequest(
      'The "cursor" is out of range. Omit it to start at the beginning.'
    );
  }
  return offset;
}

/**
 * A list response. `total` is the full match count and is not derived from `items` — passing
 * `items.length` would produce a response that always claims to be complete, which is the failure
 * this envelope exists to prevent.
 */
export function listResponse<T>(
  items: readonly T[],
  total: number,
  window: ListWindow
): ListResponse<T> {
  const consumed = window.offset + items.length;
  return { items, total, nextCursor: consumed < total ? String(consumed) : null };
}
