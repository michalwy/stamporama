import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toAllegroDescriptionHtml } from "../../src/lib/allegro-description";
import { descriptionToUnsafeHtml } from "../../src/lib/description-format";

// Allegro's description field takes seven tags and no attributes. What this asserts is the one thing
// that matters about the conversion: **the words survive and the markup does not** — because the
// alternative, discovered the hard way, is a 422 that names the field and says nothing else.

describe("toAllegroDescriptionHtml", () => {
  it("strips every attribute — the reason a plain description was refused", () => {
    assert.equal(
      toAllegroDescriptionHtml('<p style="white-space:pre-wrap">Ładny zestaw.</p>'),
      "<p>Ładny zestaw.</p>"
    );
  });

  it("maps the tags markdown renders onto the ones Allegro takes", () => {
    assert.equal(toAllegroDescriptionHtml("<p><strong>MNH</strong></p>"), "<p><b>MNH</b></p>");
    assert.equal(toAllegroDescriptionHtml("<h3>Stan</h3>"), "<h2>Stan</h2>");
    assert.equal(toAllegroDescriptionHtml("<h1>Polska</h1>"), "<h1>Polska</h1>");
  });

  it("keeps the words of a tag it drops", () => {
    assert.equal(
      toAllegroDescriptionHtml('<p>See <a href="https://x.test">my shop</a> too.</p>'),
      "<p>See my shop too.</p>"
    );
    assert.equal(toAllegroDescriptionHtml("<p><em>czyste</em></p>"), "<p>czyste</p>");
  });

  it("keeps lists, and drops one that ended up empty", () => {
    assert.equal(
      toAllegroDescriptionHtml("<ul><li>Mi 1</li><li>Mi 2</li></ul>"),
      "<ul><li>Mi 1</li><li>Mi 2</li></ul>"
    );
    assert.equal(toAllegroDescriptionHtml("<ul><li> </li></ul>"), null);
  });

  it("wraps loose text, which Allegro refuses unwrapped", () => {
    assert.equal(toAllegroDescriptionHtml("Bare words"), "<p>Bare words</p>");
    assert.equal(toAllegroDescriptionHtml("<div>Boxed</div>"), "<p>Boxed</p>");
  });

  it("turns a line break into a paragraph, there being no break tag", () => {
    assert.equal(toAllegroDescriptionHtml("<p>One<br>Two</p>"), "<p>One</p><p>Two</p>");
  });

  it("closes a bold the source left open rather than bolding the rest of the listing", () => {
    assert.equal(toAllegroDescriptionHtml("<p><b>Loud</p><p>Quiet</p>"), "<p><b>Loud</b></p><p>Quiet</p>");
  });

  it("puts a stray list item in a paragraph rather than publishing a bare one", () => {
    assert.equal(toAllegroDescriptionHtml("<li>Orphan</li>"), "<p>Orphan</p>");
  });

  it("leaves entities exactly as our own escaping wrote them", () => {
    assert.equal(toAllegroDescriptionHtml("<p>Kmpl &amp; blok</p>"), "<p>Kmpl &amp; blok</p>");
  });

  it("answers null for a description that holds no words", () => {
    assert.equal(toAllegroDescriptionHtml("<p>   </p>"), null);
    assert.equal(toAllegroDescriptionHtml(""), null);
  });

  it("emits only Allegro's tags, over each of the three formats end to end", () => {
    const sources: [string, "plain" | "html" | "markdown"][] = [
      ["Linia jedna\nLinia dwa", "plain"],
      ['<div class="x">Coś <a href="https://x.test">tu</a></div>', "html"],
      ["## Stan\n\n- **MNH**\n- *lekki ślad*", "markdown"],
    ];
    for (const [source, format] of sources) {
      const html = toAllegroDescriptionHtml(descriptionToUnsafeHtml(source, format)) ?? "";
      const tags = [...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]);
      for (const tag of tags) {
        assert.ok(
          ["p", "h1", "h2", "ul", "ol", "li", "b"].includes(tag),
          `${format} produced <${tag}>`
        );
      }
      assert.doesNotMatch(html, /<[a-z0-9]+ /, `${format} produced an attribute`);
    }
  });
});
