import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DESCRIPTION_FORMAT,
  DESCRIPTION_ALLOWED_ATTR,
  DESCRIPTION_ALLOWED_TAGS,
  DESCRIPTION_FORMATS,
  descriptionToUnsafeHtml,
  escapeHtml,
  hasDescriptionContent,
  normalizeDescriptionFormat,
} from "../../src/lib/description-format";

describe("normalizeDescriptionFormat", () => {
  it("accepts every configured format", () => {
    for (const format of DESCRIPTION_FORMATS) {
      assert.equal(normalizeDescriptionFormat(format), format);
    }
  });

  it("is forgiving about case and padding", () => {
    assert.equal(normalizeDescriptionFormat("  MarkDown "), "markdown");
  });

  it("falls back to plain text for anything unknown", () => {
    // A value written by an older/newer version, or a hand-edited row, must not break a read.
    assert.equal(normalizeDescriptionFormat("rtf"), DEFAULT_DESCRIPTION_FORMAT);
    assert.equal(normalizeDescriptionFormat(""), DEFAULT_DESCRIPTION_FORMAT);
    assert.equal(normalizeDescriptionFormat(null), DEFAULT_DESCRIPTION_FORMAT);
    assert.equal(normalizeDescriptionFormat(undefined), DEFAULT_DESCRIPTION_FORMAT);
  });
});

describe("descriptionToUnsafeHtml", () => {
  it("has nothing to render for a blank description", () => {
    for (const format of DESCRIPTION_FORMATS) {
      assert.equal(descriptionToUnsafeHtml("", format), "");
      assert.equal(descriptionToUnsafeHtml("   \n ", format), "");
      assert.equal(descriptionToUnsafeHtml(null, format), "");
    }
  });

  it("escapes plain text and keeps its line breaks", () => {
    const html = descriptionToUnsafeHtml("Mi 1 <mint>\nsigned & fine", "plain");
    assert.equal(html, '<p style="white-space:pre-wrap">Mi 1 &lt;mint&gt;\nsigned &amp; fine</p>');
  });

  it("passes HTML through as written", () => {
    const source = "<p>Mi <strong>1</strong></p>";
    assert.equal(descriptionToUnsafeHtml(source, "html"), source);
  });

  it("renders Markdown, treating a pressed Enter as a line break", () => {
    const html = descriptionToUnsafeHtml("**Mi 1**\nsigned\n\n- one\n- two", "markdown");
    assert.match(html, /<strong>Mi 1<\/strong>/);
    assert.match(html, /<br\s*\/?>/);
    assert.match(html, /<li>one<\/li>/);
  });

  it("does not sanitise — that is the renderer's job", () => {
    // The contract the "unsafe" in the name states: nothing here strips a script, so no caller may
    // inject the result without going through `RenderedDescription` (ADR-0019 §2).
    const source = '<img src=x onerror="alert(1)">';
    assert.equal(descriptionToUnsafeHtml(source, "html"), source);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could open markup", () => {
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("the sanitiser allowlist", () => {
  it("carries the markup a listing writes and nothing executable", () => {
    for (const tag of ["p", "br", "strong", "ul", "li", "a", "img", "table"]) {
      assert.ok((DESCRIPTION_ALLOWED_TAGS as readonly string[]).includes(tag), `${tag} allowed`);
    }
    for (const tag of ["script", "style", "iframe", "object", "form", "input"]) {
      assert.ok(!(DESCRIPTION_ALLOWED_TAGS as readonly string[]).includes(tag), `${tag} refused`);
    }
    assert.ok(!DESCRIPTION_ALLOWED_ATTR.some((a) => a.toLowerCase().startsWith("on")));
  });
});

describe("hasDescriptionContent", () => {
  it("reads blank and whitespace-only the same", () => {
    assert.equal(hasDescriptionContent("Mi 1"), true);
    assert.equal(hasDescriptionContent("  \n "), false);
    assert.equal(hasDescriptionContent(null), false);
  });
});
