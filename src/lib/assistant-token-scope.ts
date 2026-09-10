// What an Assistant token is allowed to do, and what kind of client it was minted for (#707).
//
// `AssistantToken` (#253) was minted for the browser extension, which does a small, known set of
// things around Colnect, and it grants **full owner rights on one collection** — proportionate for
// that client. An agent is a different caller: a much wider surface (`/api/v1`, #706), invoked
// autonomously. So a token now declares two things, and both are the token's own rather than the
// caller's to assert per request.
//
// **One token model, one Settings screen.** A separate `AgentToken` with per-area scopes
// (`offers:write`, `trades:write`, …) is better hygiene in the abstract and more surface to maintain
// in a single-user project than the control is worth here. `read` / `read_write` widens into
// per-area scopes later without a second model, which is why the pair is deliberately coarse.
//
// **This module is pure and that is load-bearing.** `api-tokens.ts` carries `server-only` and
// reaches Prisma, and Settings → Assistant is a `"use client"` panel that has to render the pickers
// and the list — so the vocabulary cannot live in either of them. A constant both halves read
// belongs in a pure `src/lib/` module neither owns (`platform.md`, on `MAX_REF_CARDS`), and the
// decision belongs here too so that a unit test can hold it.

/** What a token may do. Ordered widest-last, which is the order the picker offers them in. */
export const ASSISTANT_TOKEN_SCOPES = ["read", "read_write"] as const;

export type AssistantTokenScope = (typeof ASSISTANT_TOKEN_SCOPES)[number];

/** What kind of client the token was minted for. A label, never a permission — see below. */
export const ASSISTANT_TOKEN_KINDS = ["extension", "agent"] as const;

export type AssistantTokenKind = (typeof ASSISTANT_TOKEN_KINDS)[number];

/**
 * The widest scope, and what a token that predates #707 is.
 *
 * Existing tokens are extension tokens doing extension work, and narrowing them would break a
 * working install — so the migration backfills them to this. It is **not** a default for new
 * tokens: every mint states its scope, which `createAssistantToken` enforces by taking it as a
 * required field rather than by defaulting it.
 */
export const WIDEST_ASSISTANT_TOKEN_SCOPE: AssistantTokenScope = "read_write";

/** What a token that predates #707 was minted for, for the same reason. */
export const LEGACY_ASSISTANT_TOKEN_KIND: AssistantTokenKind = "extension";

export function isAssistantTokenScope(value: unknown): value is AssistantTokenScope {
  return typeof value === "string" && (ASSISTANT_TOKEN_SCOPES as readonly string[]).includes(value);
}

export function isAssistantTokenKind(value: unknown): value is AssistantTokenKind {
  return typeof value === "string" && (ASSISTANT_TOKEN_KINDS as readonly string[]).includes(value);
}

/**
 * Read a scope off something untrusted — a form field, a stored row written by an older build —
 * falling back to the widest scope.
 *
 * **The fallback is the widest one on purpose, and only because of where it is read.** A stored
 * value is either one of the two or it predates the column, and a row that predates the column is
 * an extension token that must go on working; falling back to `read` there would silently break the
 * install the migration exists to preserve. Form input is not trusted to this: the server action
 * rejects an unknown value rather than widening it.
 */
export function assistantTokenScopeOrWidest(value: unknown): AssistantTokenScope {
  return isAssistantTokenScope(value) ? value : WIDEST_ASSISTANT_TOKEN_SCOPE;
}

/** The same, for the client kind. */
export function assistantTokenKindOrLegacy(value: unknown): AssistantTokenKind {
  return isAssistantTokenKind(value) ? value : LEGACY_ASSISTANT_TOKEN_KIND;
}

/**
 * Whether a token with this scope may perform a writing operation. The whole of the decision, in
 * one place, so that the enforcement point (`route-auth.ts`) and the OpenAPI document cannot come
 * to two readings of it.
 */
export function scopeAllowsWrite(scope: AssistantTokenScope): boolean {
  return scope === "read_write";
}

/**
 * The scope a caller would need in order to perform an operation with this `writes` declaration.
 * A reading operation needs `read`, which every token has — so this answers `read` rather than
 * `null`, and the refusal message can quote it without a special case.
 */
export function scopeRequiredForWrites(writes: boolean): AssistantTokenScope {
  return writes ? "read_write" : "read";
}

/** How a scope reads to a person: the Settings list, the picker, and the refusal message. */
export const ASSISTANT_TOKEN_SCOPE_LABELS: Record<AssistantTokenScope, string> = {
  read: "Read only",
  read_write: "Read and write",
};

/** How a client kind reads to a person. */
export const ASSISTANT_TOKEN_KIND_LABELS: Record<AssistantTokenKind, string> = {
  extension: "Extension",
  agent: "Agent",
};
