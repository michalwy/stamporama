import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMatchHandoff } from "./match-handoff";

// Same job as the listing handoff's parser: tell a task apart from a node that exists but holds
// nothing yet. Plus one this one owns — the URL is handed to `chrome.tabs.create`, so a scheme we
// would not want opened must not survive parsing.

const url = "https://colnect.com/en/stamps/list/catalog_code/PL+865";
const handoff = { v: 1, requestId: "req_1", task: { url, label: "Mi·PL 865" } };

describe("parseMatchHandoff", () => {
  it("reads a whole handoff", () => {
    const parsed = parseMatchHandoff(JSON.stringify(handoff));
    assert.equal(parsed?.requestId, "req_1");
    assert.equal(parsed?.task.url, url);
    assert.equal(parsed?.task.label, "Mi·PL 865");
  });

  it("reads a handoff with no label — it is only there for the page's own message", () => {
    const parsed = parseMatchHandoff(JSON.stringify({ ...handoff, task: { url } }));
    assert.equal(parsed?.task.label, undefined);
  });

  it("treats an empty or unparseable node as no handoff", () => {
    assert.equal(parseMatchHandoff(null), null);
    assert.equal(parseMatchHandoff("   "), null);
    assert.equal(parseMatchHandoff("{"), null);
    assert.equal(parseMatchHandoff("[]"), null);
  });

  it("refuses a handoff missing the spine every consumer dereferences", () => {
    assert.equal(parseMatchHandoff(JSON.stringify({ ...handoff, v: 2 })), null);
    assert.equal(parseMatchHandoff(JSON.stringify({ ...handoff, requestId: "  " })), null);
    assert.equal(parseMatchHandoff(JSON.stringify({ v: 1, requestId: "req_1" })), null);
    assert.equal(
      parseMatchHandoff(JSON.stringify({ ...handoff, task: { url: "  " } })),
      null
    );
  });

  it("refuses a URL we would not want opened on the collector's behalf", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "colnect.com"]) {
      assert.equal(parseMatchHandoff(JSON.stringify({ ...handoff, task: { url: bad } })), null, bad);
    }
  });
});
