import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  API_BASE_PATH,
  buildOpenApiDocument,
  validateOperations,
} from "../../src/lib/agent-api/openapi";
import type { Operation } from "../../src/lib/agent-api/types";

// **This is the file that answers #706's *Done when*.**
//
// The criterion is that an operation added to the registry appears in `/api/v1/openapi.json` with no
// second place to edit — and #706 deliberately ships **no** domain operation, so nothing in the real
// registry can demonstrate it. What can is that `buildOpenApiDocument` is a pure function of the
// operation list: a fixture operation goes in, and every part of the document it produces is traced
// back to the declaration it came from. The route composes that same function over the real
// `OPERATIONS` array, so adding an entry there is the only edit.
//
// It is also why the generator is pure and carries no `server-only`. **That constraint is live as
// of #708**, not pending as this comment used to say of #710: the registry now imports an operation
// module that carries `server-only` and reads Prisma, so this suite could not import it —
// `unit-suite-purity.test.ts` walks the import graph and would name the chain. Everything asserted
// below is built from fixture operations for exactly that reason, and `build([])` stays the right
// way to ask what an empty document looks like: it is a question about the generator, not a claim
// about what `main`'s registry holds.

const handler = async () => ({ ok: true });

const FIND_UNLISTED: Operation = {
  name: "find_unlisted_copies",
  method: "GET",
  path: "/copies/unlisted",
  description: "Find copies that are not listed in any offer.",
  writes: false,
  parameters: [
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description: "Restrict to one collection area, by id.",
    },
    {
      name: "condition",
      in: "query",
      type: "string",
      required: false,
      description: "Restrict to one condition.",
      values: ["MNH", "MH", "used"],
    },
  ],
  result: { kind: "list", description: "The copies with no offer against them." },
  handler,
};

const DRAFT_OFFER: Operation = {
  name: "draft_offer",
  method: "POST",
  path: "/offers",
  description: "Draft an offer for a copy, without publishing it anywhere.",
  writes: true,
  parameters: [
    {
      name: "copyId",
      in: "body",
      type: "string",
      required: true,
      description: "The copy the offer is for.",
    },
    {
      name: "note",
      in: "body",
      type: "string",
      required: false,
      description: "A private note on the offer.",
    },
  ],
  result: { kind: "object", description: "The drafted offer." },
  handler,
};

const ONE_ITEM: Operation = {
  name: "get_item",
  method: "GET",
  path: "/items/{itemId}",
  description: "One item in full.",
  writes: false,
  parameters: [
    { name: "itemId", in: "path", type: "string", required: true, description: "The item's id." },
  ],
  result: { kind: "object", description: "The item." },
  handler,
};

// Readers rather than `any`. The document is deliberately typed `Record<string, unknown>` — it is
// JSON, and pretending to a shape here would test the assertion rather than the generator.
function obj(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object", "expected an object");
  return value as Record<string, unknown>;
}

function arr(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "expected an array");
  return value;
}

/** Walk a path of keys into the document, asserting an object at each step. */
function dig(root: unknown, ...keys: string[]): Record<string, unknown> {
  return keys.reduce((node, key) => obj(obj(node)[key]), obj(root));
}

const names = (parameters: unknown): string[] =>
  arr(parameters).map((p) => String(obj(p).name));

function build(operations: readonly Operation[]): Record<string, unknown> {
  return buildOpenApiDocument(operations, { appVersion: "test" });
}

describe("agent API OpenAPI document", () => {
  it("publishes an operation with no second place to edit", () => {
    const get = dig(build([FIND_UNLISTED]), "paths", `${API_BASE_PATH}/copies/unlisted`, "get");
    assert.equal(get.operationId, FIND_UNLISTED.name);
    assert.equal(get.summary, FIND_UNLISTED.description);
    assert.ok(String(get.description).startsWith(FIND_UNLISTED.result.description));

    // Every declared parameter, and nothing the declaration did not carry.
    const declared = arr(get.parameters).filter(
      (p) => obj(p).name !== "limit" && obj(p).name !== "cursor"
    );
    assert.deepEqual(names(declared), ["area", "condition"]);
    assert.equal(obj(declared[0]).description, FIND_UNLISTED.parameters[0].description);
    assert.deepEqual(obj(declared[1]).schema, { type: "string", enum: ["MNH", "MH", "used"] });
  });

  it("appends the shared window parameters to a list, and only to a list", () => {
    const list = dig(build([FIND_UNLISTED]), "paths", `${API_BASE_PATH}/copies/unlisted`, "get");
    assert.ok(names(list.parameters).includes("limit"));
    assert.ok(names(list.parameters).includes("cursor"));
    assert.equal(
      dig(list, "responses", "200", "content", "application/json", "schema").$ref,
      "#/components/schemas/ListResponse"
    );

    const single = dig(build([ONE_ITEM]), "paths", `${API_BASE_PATH}/items/{itemId}`, "get");
    assert.ok(!names(single.parameters).includes("limit"));
    assert.ok(!names(single.parameters).includes("cursor"));
  });

  it("says in the document that a list states its full total", () => {
    const doc = build([FIND_UNLISTED]);
    const envelope = dig(doc, "components", "schemas", "ListResponse");
    assert.deepEqual(envelope.required, ["items", "total", "nextCursor"]);
    const get = dig(doc, "paths", `${API_BASE_PATH}/copies/unlisted`, "get");
    assert.match(String(get.description), /full `total`/);
  });

  it("turns body parameters into a request body and leaves them out of the query", () => {
    const post = dig(build([DRAFT_OFFER]), "paths", `${API_BASE_PATH}/offers`, "post");
    assert.deepEqual(post.parameters, []);
    const schema = dig(post, "requestBody", "content", "application/json", "schema");
    assert.deepEqual(Object.keys(obj(schema.properties)), ["copyId", "note"]);
    assert.deepEqual(schema.required, ["copyId"]);
    assert.equal(obj(post.requestBody).required, true);
    assert.equal(post["x-stamporama-writes"], true);
  });

  it("marks a path parameter required whatever the declaration said", () => {
    const get = dig(build([ONE_ITEM]), "paths", `${API_BASE_PATH}/items/{itemId}`, "get");
    const first = obj(arr(get.parameters)[0]);
    assert.equal(first.in, "path");
    assert.equal(first.required, true);
  });

  it("puts two methods on one path under one key", () => {
    const both: Operation[] = [
      DRAFT_OFFER,
      { ...DRAFT_OFFER, name: "list_offers", method: "GET", writes: false, parameters: [] },
    ];
    const path = dig(build(both), "paths", `${API_BASE_PATH}/offers`);
    assert.deepEqual(Object.keys(path).sort(), ["get", "post"]);
  });

  it("is a structurally valid 3.1 document with no operations at all", () => {
    const doc = build([]);
    assert.equal(doc.openapi, "3.1.0");
    assert.equal(typeof dig(doc, "info").title, "string");
    assert.equal(typeof dig(doc, "info").version, "string");
    assert.deepEqual(doc.paths, {});
    assert.equal(
      dig(doc, "components", "securitySchemes", "assistantToken").scheme,
      "bearer"
    );
    assert.deepEqual(doc.security, [{ assistantToken: [] }]);
    // It round-trips as JSON — the route serialises it, so a value that cannot would be a 500.
    assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
  });

  it("describes the error shape the agent can act on", () => {
    const error = dig(build([]), "components", "schemas", "Error", "properties", "error");
    assert.deepEqual(error.required, ["code", "message"]);
    const properties = obj(error.properties);
    assert.ok(arr(obj(properties.code).enum).includes("invalid_request"));
    assert.ok(arr(obj(properties.code).enum).includes("forbidden"));
    assert.equal(obj(properties.accepted).type, "array");
  });
});

describe("agent API registry validation", () => {
  const rejects = (operations: Operation[], pattern: RegExp) =>
    assert.throws(() => validateOperations(operations), pattern);

  it("accepts the fixtures", () => {
    validateOperations([FIND_UNLISTED, DRAFT_OFFER, ONE_ITEM]);
  });

  it("rejects a name that is not snake_case", () => {
    rejects([{ ...FIND_UNLISTED, name: "findUnlistedCopies" }], /snake_case/);
  });

  it("rejects two operations with one name", () => {
    rejects([FIND_UNLISTED, { ...FIND_UNLISTED, path: "/other" }], /named/);
  });

  it("rejects two operations on one method and path", () => {
    rejects([FIND_UNLISTED, { ...FIND_UNLISTED, name: "other" }], /bound to/);
  });

  it("rejects a path parameter with nothing declaring it", () => {
    rejects([{ ...ONE_ITEM, parameters: [] }], /no matching parameter/);
  });

  it("rejects a declared path parameter the path does not carry", () => {
    rejects([{ ...FIND_UNLISTED, parameters: [...ONE_ITEM.parameters] }], /path does not carry/);
  });

  it("rejects a body parameter on GET", () => {
    rejects([{ ...ONE_ITEM, parameters: [...DRAFT_OFFER.parameters] }], /body parameter on GET/);
  });

  it("rejects a list operation redeclaring the shared window parameters", () => {
    rejects(
      [
        {
          ...FIND_UNLISTED,
          parameters: [
            {
              name: "limit",
              in: "query",
              type: "integer",
              required: false,
              description: "How many.",
            },
          ],
        },
      ],
      /redeclares the shared list parameter/
    );
  });

  it("runs from buildOpenApiDocument, so it cannot be skipped", () => {
    assert.throws(() => build([{ ...FIND_UNLISTED, name: "Bad" }]), /snake_case/);
  });
});
