// Whether a token's scope covers an operation (#707) — the decision, on the pure side of the layer.
//
// #706 put `writes` on every `Operation` and said in as many words that one place decides it. This
// is that place. `route-auth.ts` is the *enforcement point*, beside the collection pinning, and it
// calls this: what a token may do is checked server-side and never in a caller, but the check
// itself needs neither Prisma nor a request, so it belongs where a unit test can hold it
// (`agent-api.md`, *The module layout is the Prisma-free split*).
//
// **#711 landed the first writing operations, and this stopped being a fixture claim.**
// `draft_offer`, `set_offer_price` and `set_offer_text` declare `writes: true`, so a `read` token is
// refused on a real operation, by the real dispatcher, over a real hashed row —
// `tests/integration/agent-api-offers.test.ts`, *a read token is refused on the wire*.
//
// **What stood here until then is quoted rather than deleted**, because it was true when it was
// written and will go on arriving in anything copied from it: *nothing on `main` writes yet, so the
// refusal is exercised against a fixture operation rather than against a domain one — adding an
// operation in order to make a test real would breach the* Out of scope *of whichever issue did it.*
// The premise had been corrected twice without the conclusion moving ("the registry is empty until
// #710", then "#708 filled it, whose one operation declares `writes: false`"), which is the part
// worth carrying: what the criterion waited for was a **writing** operation and not a populated
// registry.
//
// `tests/unit/agent-api-scope.test.ts` still exercises the decision over **fixtures**, and that is
// unchanged rather than left over: `tests/unit/` may not import `registry.ts`, which carries
// handlers and so reaches Prisma (`agent-api.md`).
//
// Pure: no Prisma, no `next/server`, no `server-only`.

import { forbidden } from "./errors";
import {
  ASSISTANT_TOKEN_SCOPES,
  scopeAllowsWrite,
  scopeRequiredForWrites,
  type AssistantTokenScope,
} from "../assistant-token-scope";
import type { Operation } from "./types";

/** What the check needs of an operation: its name, for the message, and whether it writes. */
export type ScopedOperation = Pick<Operation, "name" | "writes">;

/**
 * Refuse a token whose scope does not cover this operation.
 *
 * The message is the agent-facing convention of #706 — a stable code, one English sentence saying
 * what to do next, and the accepted values where a value was rejected against a closed set. Here
 * the rejected value is the token's own scope, so `accepted` is the scopes that would have worked
 * and the sentence names the one to mint. An agent cannot widen its own token; what it can do is
 * stop retrying and say which scope the collector needs to grant, and that is worth the sentence.
 */
export function assertOperationScope(
  scope: AssistantTokenScope,
  operation: ScopedOperation
): void {
  if (!operation.writes || scopeAllowsWrite(scope)) return;
  const required = scopeRequiredForWrites(operation.writes);
  throw forbidden(
    `\`${operation.name}\` writes, and this token is \`${scope}\`. It needs a token with the \`${required}\` scope — mint one in Settings → Assistant.`,
    ASSISTANT_TOKEN_SCOPES
  );
}
