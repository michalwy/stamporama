import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ACCEPTED_VALUES,
  acceptedNames,
  resolveOptionalVocabularyValue,
  resolveVocabularyValue,
  resolveVocabularyValues,
} from "../../src/lib/agent-api/vocabulary";
import { isApiError } from "../../src/lib/agent-api/errors";
import type { VocabularyEntry } from "../../src/lib/agent-api/vocabulary";

// **#708's central decision, and the half a unit test can hold.**
//
// The issue's second decision is *names are accepted wherever a name is unambiguous, and where a
// name is ambiguous the id is required and the error says so*. That is a function of a value and a
// list of entries — no Prisma, no request, no collection — so the whole rule lives here, and only
// the **lookup** that fetches the entries needs a database (`agent-api.md`, *The module layout is
// the Prisma-free split*, which names this resolver as belonging on the pure side).
//
// **This suite may not import `registry.ts`**, which since #708 imports an operation module that
// reads Prisma; `unit-suite-purity.test.ts` walks the graph and would name the chain. Nothing here
// needs it: the resolver knows nothing about operations.

const CONDITIONS: readonly VocabularyEntry[] = [
  { id: "cond_mnh", name: "Mint Never Hinged", abbreviation: "MNH" },
  { id: "cond_mh", name: "Mint Hinged", abbreviation: "MH" },
  { id: "cond_u", name: "Used", abbreviation: "U" },
  { id: "cond_pl", name: "Cancelled to Order", abbreviation: "CTO", label: "Kasowany na życzenie" },
];

const context = { vocabulary: "condition", parameter: "condition" } as const;

/** What the resolver threw, asserted to be renderable by the dispatcher. */
function refusal(value: string, entries: readonly VocabularyEntry[] = CONDITIONS) {
  try {
    resolveVocabularyValue(value, entries, context);
    return null;
  } catch (error) {
    assert.ok(isApiError(error), "a refusal must be an ApiError the dispatcher can render");
    return error;
  }
}

describe("resolving a vocabulary value", () => {
  it("takes an id as an id", () => {
    assert.equal(resolveVocabularyValue("cond_mh", CONDITIONS, context), "cond_mh");
  });

  it("takes the canonical name", () => {
    assert.equal(resolveVocabularyValue("Mint Never Hinged", CONDITIONS, context), "cond_mnh");
  });

  it("takes the abbreviation, which is #708's own example", () => {
    // The issue says an operation taking a condition takes `"MNH"` as readily as its id. An agent
    // reading a listing meets the abbreviation far more often than the full name.
    assert.equal(resolveVocabularyValue("MNH", CONDITIONS, context), "cond_mnh");
  });

  it("takes the display label, so a collector's own wording resolves too", () => {
    assert.equal(resolveVocabularyValue("Kasowany na życzenie", CONDITIONS, context), "cond_pl");
  });

  it("ignores case and surrounding whitespace", () => {
    for (const spelling of ["mnh", "  MNH  ", "mInT nEvEr HiNgEd"]) {
      assert.equal(resolveVocabularyValue(spelling, CONDITIONS, context), "cond_mnh", spelling);
    }
  });

  it("matches an id exactly and never case-folded", () => {
    // A cuid is case-sensitive. Folding it would make two distinct ids collide in principle, and
    // buys nothing: an agent that has an id has it verbatim from this API.
    assert.ok(refusal("COND_MNH"));
  });
});

describe("a value that matches nothing", () => {
  it("is refused as invalid_request with the accepted names", () => {
    const error = refusal("Superb");
    assert.ok(error);
    assert.equal(error.code, "invalid_request");
    assert.equal(error.status, 400);
    assert.deepEqual(error.accepted, acceptedNames(CONDITIONS));
  });

  it("names the value, the vocabulary and the parameter, so the agent can tell which mistake it made", () => {
    const error = refusal("Superb");
    assert.ok(error);
    assert.match(error.message, /"Superb"/);
    assert.match(error.message, /condition/);
  });

  it("answers #708's *Done when*: a wrong condition name returns the collection's actual names", () => {
    // The criterion, verbatim: "An operation given a wrong condition name answers with the
    // collection's actual condition names." The `accepted` field is what carries them, and the
    // dispatcher renders it through `errorResponseBody` with no handler involvement.
    const error = refusal("MintNeverHinged");
    assert.ok(error);
    const accepted = error.accepted ?? [];
    assert.ok(accepted.some((value) => value.includes("Mint Never Hinged")));
    assert.ok(accepted.some((value) => value.includes("Used")));
    assert.equal(accepted.length, CONDITIONS.length);
    // And the body the agent actually receives carries it, not just the thrown object.
    assert.deepEqual(error.toBody().error.accepted, accepted);
  });

  it("says so plainly when the collection has none of this vocabulary configured at all", () => {
    // Certificate statuses start empty by design (#94) — "there are none" is a different problem
    // from "you misspelled one", and an empty `accepted` list would otherwise say nothing.
    const error = refusal("Certificate", []);
    assert.ok(error);
    assert.match(error.message, /no condition configured at all/);
    assert.deepEqual(error.accepted, []);
  });

  it("refuses a blank value rather than resolving it", () => {
    assert.ok(refusal("   "));
  });
});

describe("a name that is ambiguous", () => {
  // Nothing stops a collector naming two areas `Poland` — one a country, one a period under it.
  const AREAS: readonly VocabularyEntry[] = [
    { id: "area_1", name: "Poland" },
    { id: "area_2", name: "Poland" },
    { id: "area_3", name: "Germany" },
  ];
  const areaContext = { vocabulary: "area", parameter: "area" } as const;

  function ambiguous() {
    try {
      resolveVocabularyValue("Poland", AREAS, areaContext);
      return null;
    } catch (error) {
      assert.ok(isApiError(error));
      return error;
    }
  }

  it("is refused rather than guessed", () => {
    // Guessing files a copy under the wrong area silently, which is the one failure on this
    // surface that is both invisible and expensive.
    assert.ok(ambiguous());
  });

  it("says the id is required", () => {
    const error = ambiguous();
    assert.ok(error);
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /the name is not enough/);
  });

  it("hands back the candidate ids and deliberately not their names", () => {
    // Returning the names would return the ambiguity with them, and the agent would retry the same
    // string for ever. The ids are the only thing that distinguishes the candidates.
    const error = ambiguous();
    assert.ok(error);
    assert.deepEqual(error.accepted, ["area_1", "area_2"]);
  });

  it("still resolves either of them by id", () => {
    assert.equal(resolveVocabularyValue("area_2", AREAS, areaContext), "area_2");
  });

  it("does not make an unrelated name ambiguous", () => {
    assert.equal(resolveVocabularyValue("Germany", AREAS, areaContext), "area_3");
  });

  it("treats a name colliding with another row's abbreviation as ambiguous", () => {
    // A collector may abbreviate one condition `Used` and name another `Used`. Both are legitimate
    // and the collision is real, so it takes the ambiguous branch rather than a first-match win.
    const entries: readonly VocabularyEntry[] = [
      { id: "a", name: "Used", abbreviation: "U" },
      { id: "b", name: "Unhinged", abbreviation: "Used" },
    ];
    try {
      resolveVocabularyValue("Used", entries, context);
      assert.fail("a name colliding with an abbreviation must not silently pick one");
    } catch (error) {
      assert.ok(isApiError(error));
      assert.deepEqual(error.accepted, ["a", "b"]);
    }
  });
});

describe("an optional vocabulary value", () => {
  it("reads absence as null, which several of these vocabularies mean something by", () => {
    // A null format **means single** and a null certificate status **means none** (ADR-0006 §2);
    // neither has a row to name, so absence is a real answer rather than a gap.
    for (const absent of [null, undefined, "", "   "]) {
      assert.equal(resolveOptionalVocabularyValue(absent, CONDITIONS, context), null);
    }
  });

  it("resolves a supplied value exactly as the required reader does", () => {
    assert.equal(resolveOptionalVocabularyValue("MH", CONDITIONS, context), "cond_mh");
  });

  it("still refuses a supplied value that matches nothing", () => {
    assert.throws(() => resolveOptionalVocabularyValue("Superb", CONDITIONS, context));
  });
});

describe("resolving a list of values", () => {
  it("keeps order and drops duplicates", () => {
    assert.deepEqual(
      resolveVocabularyValues(["U", "MNH", "Used", "cond_u"], CONDITIONS, context),
      ["cond_u", "cond_mnh"]
    );
  });

  it("is empty for an empty list rather than an error", () => {
    assert.deepEqual(resolveVocabularyValues([], CONDITIONS, context), []);
  });

  it("fails on the first bad value", () => {
    assert.throws(() => resolveVocabularyValues(["MNH", "Superb"], CONDITIONS, context));
  });
});

describe("the accepted-name list", () => {
  it("puts the abbreviation beside the name where they differ", () => {
    assert.ok(acceptedNames(CONDITIONS).includes("Mint Never Hinged (MNH)"));
  });

  it("does not repeat an abbreviation that is the name", () => {
    assert.deepEqual(acceptedNames([{ id: "x", name: "Used", abbreviation: "used" }]), ["Used"]);
  });

  it("is capped, because an error an agent may hit repeatedly must not paste hundreds of rows", () => {
    const many = Array.from({ length: MAX_ACCEPTED_VALUES + 25 }, (_, i) => ({
      id: `a${i}`,
      name: `Area ${i}`,
    }));
    assert.equal(acceptedNames(many).length, MAX_ACCEPTED_VALUES);
  });

  it("is uncapped below the cap, so an ordinary vocabulary comes back whole", () => {
    assert.equal(acceptedNames(CONDITIONS).length, CONDITIONS.length);
  });
});
