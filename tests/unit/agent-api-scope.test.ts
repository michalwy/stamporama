import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertOperationScope } from "../../src/lib/agent-api/scope";
import { isApiError } from "../../src/lib/agent-api/errors";
import {
  ASSISTANT_TOKEN_KINDS,
  ASSISTANT_TOKEN_SCOPES,
  assistantTokenKindOrLegacy,
  assistantTokenScopeOrWidest,
  isAssistantTokenKind,
  isAssistantTokenScope,
  scopeAllowsWrite,
  scopeRequiredForWrites,
} from "../../src/lib/assistant-token-scope";
import type { Operation } from "../../src/lib/agent-api/types";

// **This is the file that answers #707's *Done when*, and it is a fixture suite on purpose.**
//
// The criterion is *a `read` token is refused on any writing operation and accepted on every
// reading one*. #706 deliberately ships **no** domain operation, so on today's `main` there is
// nothing writing for a real refusal to happen on — and adding one in order to make a test real
// would breach #706's own *Out of scope*. What is testable is the thing that actually decides:
// `assertOperationScope` is a pure function of a scope and an operation's own `writes`
// declaration, and the dispatcher composes it over the real registry, so an operation added there
// is refused or admitted by exactly this function.
//
// The other half of the criterion is exercised against a real hashed row in
// `tests/integration/agent-api-auth.test.ts`, which is where a token's scope actually comes from.

const reading: Pick<Operation, "name" | "writes"> = { name: "find_unlisted_copies", writes: false };
const writing: Pick<Operation, "name" | "writes"> = { name: "set_offer_price", writes: true };

/** What `assertOperationScope` threw, or `null` when it allowed the call. */
function refusal(scope: "read" | "read_write", operation: Pick<Operation, "name" | "writes">) {
  try {
    assertOperationScope(scope, operation);
    return null;
  } catch (error) {
    assert.ok(isApiError(error), "the refusal must be an ApiError the dispatcher can render");
    return error;
  }
}

describe("the token scope vocabulary", () => {
  it("is the two values, widest last", () => {
    assert.deepEqual([...ASSISTANT_TOKEN_SCOPES], ["read", "read_write"]);
    assert.deepEqual([...ASSISTANT_TOKEN_KINDS], ["extension", "agent"]);
  });

  it("recognises its own values and nothing else", () => {
    for (const scope of ASSISTANT_TOKEN_SCOPES) assert.ok(isAssistantTokenScope(scope));
    for (const kind of ASSISTANT_TOKEN_KINDS) assert.ok(isAssistantTokenKind(kind));
    for (const other of ["", "READ", "read-write", "readwrite", "write", "admin"]) {
      assert.equal(isAssistantTokenScope(other), false, other);
    }
    for (const other of ["", "Extension", "browser", "mcp"]) {
      assert.equal(isAssistantTokenKind(other), false, other);
    }
    assert.equal(isAssistantTokenScope(undefined), false);
    assert.equal(isAssistantTokenScope(null), false);
    assert.equal(isAssistantTokenKind(7), false);
  });

  it("reads a stored row that predates the columns as the extension token it is", () => {
    // The migration backfills, so this should not arise from the database — but the columns are
    // TEXT and the fallback is what keeps a working install working if one ever does. Narrowing
    // here would break exactly the extension the migration exists to preserve.
    assert.equal(assistantTokenScopeOrWidest(undefined), "read_write");
    assert.equal(assistantTokenScopeOrWidest(""), "read_write");
    assert.equal(assistantTokenKindOrLegacy(undefined), "extension");
    assert.equal(assistantTokenKindOrLegacy("something-else"), "extension");
  });

  it("does not widen a value it does recognise", () => {
    assert.equal(assistantTokenScopeOrWidest("read"), "read");
    assert.equal(assistantTokenKindOrLegacy("agent"), "agent");
  });

  it("says which scope may write, and which scope an operation needs", () => {
    assert.equal(scopeAllowsWrite("read"), false);
    assert.equal(scopeAllowsWrite("read_write"), true);
    assert.equal(scopeRequiredForWrites(true), "read_write");
    // A reading operation needs `read`, which every token has — so the refusal message can quote
    // the requirement without a special case for the half that never refuses.
    assert.equal(scopeRequiredForWrites(false), "read");
  });
});

describe("scope enforcement against an operation", () => {
  it("refuses a read token on a writing operation", () => {
    const error = refusal("read", writing);
    assert.ok(error, "a read token must not reach a writing operation");
    assert.equal(error.code, "forbidden");
    assert.equal(error.status, 403);
  });

  it("accepts a read token on a reading operation", () => {
    assert.equal(refusal("read", reading), null);
  });

  it("accepts a read_write token on either", () => {
    assert.equal(refusal("read_write", reading), null);
    assert.equal(refusal("read_write", writing), null);
  });

  it("says which scope would have worked, and names the operation", () => {
    // The agent-facing convention of #706: a stable code, one English sentence saying what to do
    // next, and the accepted values where a value was rejected against a closed set. The agent
    // cannot widen its own token — what this buys is that it stops retrying and can say which
    // scope the collector has to grant.
    const error = refusal("read", writing);
    assert.ok(error);
    assert.match(error.message, /read_write/);
    assert.match(error.message, /set_offer_price/);
    assert.deepEqual([...(error.accepted ?? [])], [...ASSISTANT_TOKEN_SCOPES]);
  });

  it("is the operation's own `writes` that decides, not its name", () => {
    // `writes` is declared in one place and read in one place. An operation that writes and
    // declares `false` is a security defect with no test that can see it (`agent-api.md`), so the
    // check deliberately reads nothing else — a verb in the name buys no protection.
    assert.equal(refusal("read", { name: "delete_everything", writes: false }), null);
    assert.ok(refusal("read", { name: "list_things", writes: true }));
  });
});
