import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchPathTemplate,
  parsePathTemplate,
  templateSpecificity,
} from "../../src/lib/agent-api/path-template";
import { isApiError } from "../../src/lib/agent-api/errors";

// Path matching for the `/api/v1` dispatcher (#706). One catch-all route serves the whole surface,
// so this is what decides which operation a request reached — and, just as importantly, what
// separates *no such path* from *that path under a different method*, which is the difference
// between an agent giving up and an agent retrying correctly.

const match = (template: string, path: string) =>
  matchPathTemplate(parsePathTemplate(template), path.split("/").filter((s) => s.length > 0));

describe("agent API path templates", () => {
  it("matches a literal path", () => {
    assert.deepEqual(match("/copies/unlisted", "/copies/unlisted"), {});
    assert.equal(match("/copies/unlisted", "/copies/listed"), null);
  });

  it("captures a path parameter", () => {
    assert.deepEqual(match("/items/{itemId}", "/items/itm_1"), { itemId: "itm_1" });
    assert.deepEqual(match("/items/{itemId}/photos", "/items/itm_1/photos"), { itemId: "itm_1" });
  });

  it("does not match a different number of segments", () => {
    assert.equal(match("/items/{itemId}", "/items"), null);
    assert.equal(match("/items/{itemId}", "/items/itm_1/photos"), null);
  });

  it("does not read an empty segment as an id", () => {
    // `/items//photos` is a malformed request, not a request about the empty-string item — which
    // would otherwise reach a handler and come back as an honest-looking "not found".
    assert.equal(matchPathTemplate(parsePathTemplate("/items/{itemId}"), ["items", ""]), null);
  });

  it("decodes a percent-encoded segment", () => {
    assert.deepEqual(match("/items/{itemId}", "/items/a%2Fb"), { itemId: "a/b" });
  });

  it("treats a malformed escape as a request error the agent can fix", () => {
    try {
      match("/items/{itemId}", "/items/%zz");
      assert.fail("expected a rejection");
    } catch (error) {
      assert.ok(isApiError(error));
      assert.match((error as Error).message, /percent-encoding/);
    }
  });

  it("refuses a malformed template outright, as a programming error", () => {
    // A plain Error: only a bad registry entry reaches these, and they fire at module load.
    assert.throws(() => parsePathTemplate("items"), /must start with/);
    assert.throws(() => parsePathTemplate("/items//x"), /empty segment/);
    assert.throws(() => parsePathTemplate("/items/{a}/{a}"), /repeats the parameter/);
    assert.throws(() => parsePathTemplate("/items/pre{a}"), /neither a literal/);
  });

  it("reports the parameter names in the order they appear", () => {
    assert.deepEqual(parsePathTemplate("/a/{x}/b/{y}").parameterNames, ["x", "y"]);
  });

  it("ranks a literal segment above a parameter at the same length (#711)", () => {
    // Two templates can both match one path, and until #711 the winner was whichever operation was
    // appended to `OPERATIONS` first — so `/copies/unlisted` was dispatched as `get_copy` with an id
    // of `"unlisted"`, and the refusal an agent read was a truthful sentence about the wrong
    // operation. `validateOperations` cannot see it: the two paths are different, so neither the
    // duplicate-name rule nor the duplicate-binding rule has anything to say about them.
    const literal = templateSpecificity(parsePathTemplate("/copies/unlisted"));
    const parameter = templateSpecificity(parsePathTemplate("/copies/{copyId}"));
    assert.ok(literal < parameter, "a literal segment must win");
  });

  it("ranks two all-literal templates equally, so registry order still decides", () => {
    assert.equal(
      templateSpecificity(parsePathTemplate("/offers")),
      templateSpecificity(parsePathTemplate("/holdings"))
    );
    assert.equal(
      templateSpecificity(parsePathTemplate("/offers/{offerId}/price")),
      templateSpecificity(parsePathTemplate("/offers/{offerId}/text"))
    );
  });
});
