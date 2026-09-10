// Whether a token's scope covers an operation (#707) — the decision, on the pure side of the layer.
//
// #706 put `writes` on every `Operation` and said in as many words that one place decides it. This
// is that place. `route-auth.ts` is the *enforcement point*, beside the collection pinning, and it
// calls this: what a token may do is checked server-side and never in a caller, but the check
// itself needs neither Prisma nor a request, so it belongs where a unit test can hold it
// (`agent-api.md`, *The module layout is the Prisma-free split*).
//
// **The registry is empty until #710**, so nothing on `main` writes yet and the refusal is
// exercised against a fixture operation rather than against a domain one. That is deliberate:
// adding an operation in order to make a test real would breach #706's own *Out of scope*.
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
