import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseParameters, requiredString, stringList } from "../../src/lib/agent-api/params";
import { isApiError } from "../../src/lib/agent-api/errors";
import type { ParameterSpec } from "../../src/lib/agent-api/types";

// The agent API's parameter parsing (#706). **No validation library** — this project uses none, and
// four types with hand-written parsers is what a spec-generating surface actually needs here.
//
// What is worth testing is not that a string parses. It is that every rejection is an error an agent
// can act on: a stable code, a sentence saying what to do next, and — where the value was checked
// against a closed set — the values that would have been accepted. An agent that is merely told "no"
// retries the same way.

const SPECS: readonly ParameterSpec[] = [
  { name: "q", in: "query", type: "string", required: true, description: "What to search for." },
  {
    name: "condition",
    in: "query",
    type: "string",
    required: false,
    description: "One condition.",
    values: ["MNH", "MH", "used"],
  },
  { name: "year", in: "query", type: "integer", required: false, description: "One year." },
  { name: "held", in: "query", type: "boolean", required: false, description: "Only held ones." },
  { name: "areas", in: "query", type: "string[]", required: false, description: "Areas." },
];

const parse = (query: string, extra?: { path?: Record<string, string>; body?: unknown }) =>
  parseParameters(SPECS, {
    path: extra?.path ?? {},
    query: new URLSearchParams(query),
    body: extra?.body,
  });

/** The thrown error, asserted to be an agent-facing one rather than a defect. */
function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(isApiError(error), "an agent-facing error, not a defect");
    return error;
  }
  return assert.fail("expected a rejection");
}

describe("agent API parameter parsing", () => {
  it("parses each declared type", () => {
    const params = parse("q=poland&condition=MNH&year=1948&held=true&areas=PL,DE");
    assert.equal(params.q, "poland");
    assert.equal(params.condition, "MNH");
    assert.equal(params.year, 1948);
    assert.equal(params.held, true);
    assert.deepEqual(params.areas, ["PL", "DE"]);
  });

  it("takes a repeated parameter and a comma-separated one alike", () => {
    assert.deepEqual(parse("q=x&areas=PL&areas=DE").areas, ["PL", "DE"]);
    assert.deepEqual(parse("q=x&areas=PL,DE").areas, ["PL", "DE"]);
  });

  it("leaves an unsupplied optional parameter undefined, and an unsupplied list empty", () => {
    const params = parse("q=x");
    assert.equal(params.condition, undefined);
    assert.deepEqual(stringList(params, "areas"), []);
  });

  it("treats an empty query value as absent rather than as an empty string", () => {
    assert.equal(parse("q=x&condition=").condition, undefined);
    assert.equal(parse("q=x&condition=%20%20").condition, undefined);
  });

  it("names the parameter and says what to do when a required one is missing", () => {
    const error = rejection(() => parse("condition=MNH"));
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /"q" is required/);
    assert.match(error.message, /retry/i);
  });

  it("hands back the accepted values when a vocabulary value is rejected", () => {
    const error = rejection(() => parse("q=x&condition=mint"));
    assert.equal(error.code, "invalid_request");
    assert.deepEqual(error.accepted, ["MNH", "MH", "used"]);
  });

  it("checks every element of a list against its vocabulary", () => {
    const withVocab: ParameterSpec[] = [
      { ...SPECS[4], values: ["PL", "DE"] },
      { ...SPECS[0], required: false },
    ];
    const run = () =>
      parseParameters(withVocab, { path: {}, query: new URLSearchParams("areas=PL,FR") });
    assert.deepEqual(rejection(run).accepted, ["PL", "DE"]);
  });

  it("rejects a non-integer rather than reading it as zero", () => {
    assert.equal(rejection(() => parse("q=x&year=nineteen")).code, "invalid_request");
    assert.equal(rejection(() => parse("q=x&year=1948.5")).code, "invalid_request");
  });

  it("takes both spellings of a boolean and refuses the rest", () => {
    assert.equal(parse("q=x&held=1").held, true);
    assert.equal(parse("q=x&held=0").held, false);
    assert.deepEqual(rejection(() => parse("q=x&held=yes")).accepted, ["true", "false"]);
  });

  it("rejects an undeclared query parameter and names the ones that exist", () => {
    const error = rejection(() => parse("q=x&filter=all"));
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /no query parameter "filter"/);
    assert.ok(error.accepted?.includes("condition"));
    // The window parameters are always allowed, because `list.ts` reads them beside this.
    assert.ok(error.accepted?.includes("limit"));
    assert.ok(error.accepted?.includes("cursor"));
  });

  it("allows the window parameters through without an operation declaring them", () => {
    assert.doesNotThrow(() => parse("q=x&limit=10&cursor=25"));
  });

  it("reads a path value, and reads body fields on a writing method", () => {
    const specs: ParameterSpec[] = [
      { name: "itemId", in: "path", type: "string", required: true, description: "The item." },
      { name: "note", in: "body", type: "string", required: false, description: "A note." },
      { name: "count", in: "body", type: "integer", required: true, description: "How many." },
    ];
    const params = parseParameters(specs, {
      path: { itemId: "itm_1" },
      query: new URLSearchParams(),
      body: { note: "  keep  ", count: 3 },
    });
    assert.equal(requiredString(params, "itemId"), "itm_1");
    assert.equal(params.note, "keep");
    assert.equal(params.count, 3);
  });

  it("refuses a body that is not a JSON object", () => {
    const specs: ParameterSpec[] = [
      { name: "note", in: "body", type: "string", required: false, description: "A note." },
    ];
    const run = (body: unknown) =>
      parseParameters(specs, { path: {}, query: new URLSearchParams(), body });
    assert.match(rejection(() => run(["a"])).message, /must be a JSON object/);
    assert.match(rejection(() => run("a")).message, /must be a JSON object/);
    assert.doesNotThrow(() => run(undefined));
  });

  it("reads a JSON null as absent rather than as a value", () => {
    const specs: ParameterSpec[] = [
      { name: "note", in: "body", type: "string", required: false, description: "A note." },
    ];
    const params = parseParameters(specs, {
      path: {},
      query: new URLSearchParams(),
      body: { note: null },
    });
    assert.equal(params.note, undefined);
  });

  it("returns only declared names, frozen", () => {
    const params = parse("q=x");
    assert.deepEqual(Object.keys(params).sort(), ["areas", "condition", "held", "q", "year"]);
    assert.ok(Object.isFrozen(params));
  });

  it("treats a reader used against the wrong type as a defect, not as a request error", () => {
    const params = parse("q=x&year=1948");
    // A plain Error: only a bad registry entry reaches this, and an agent did nothing wrong.
    assert.throws(() => requiredString(params, "year"), (error: unknown) => !isApiError(error));
  });
});
