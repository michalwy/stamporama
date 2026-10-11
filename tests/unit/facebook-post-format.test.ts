import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatFacebookPost } from "../../src/lib/facebook-post-format";
import {
  renderFacebookPostParts,
  renderFacebookPostText,
  type FacebookPostLotText,
  type FacebookPostPart,
} from "../../src/lib/facebook-post-rules";

// A Facebook post's formatting (#1772): the template's Markdown — only what Facebook's group post
// editor offers — as HTML for the kit and the clipboard's `text/html`, and as plain text with no
// markup symbols for `text/plain`. A placeholder's value is text, never formatting.

function lot(overrides: Partial<FacebookPostLotText> = {}): FacebookPostLotText {
  return {
    lotNo: null,
    offerNo: 412,
    listingType: "auction",
    title: "Austria 1850 Mercury",
    description: "Mercury, 1850, unused",
    catalog: "",
    startingPrice: "10.00 PLN",
    increment: "1.00 PLN",
    closesAt: "Sun 5 Oct, 20:00",
    price: "",
    ...overrides,
  };
}

/** A template alone, with no placeholders. */
function markup(text: string): FacebookPostPart[] {
  return [{ value: false, text }];
}

function format(template: string, overrides: Partial<FacebookPostLotText> = {}, note = "") {
  return formatFacebookPost(renderFacebookPostParts({ auction: template, quickBuy: "" }, note, [lot(overrides)]));
}

describe("formatFacebookPost — what Facebook offers is formatting (#1772)", () => {
  it("makes bold, italic, a heading and a subheading", () => {
    const post = formatFacebookPost(markup("# Big\n## Small\n**bold** and *italic* and _also_"));
    assert.equal(
      post.html,
      "<h1>Big</h1><h2>Small</h2><p><strong>bold</strong> and <em>italic</em> and <em>also</em></p>"
    );
    assert.equal(post.plain, "Big\nSmall\nbold and italic and also");
  });

  it("makes bulleted and numbered lists, and a quote", () => {
    const post = formatFacebookPost(markup("- one\n- two\n\n1. first\n2. second\n\n> said"));
    assert.equal(
      post.html,
      "<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol><blockquote><p>said</p></blockquote>"
    );
    assert.equal(post.plain, "• one\n• two\n\n1. first\n2. second\n\nsaid");
  });

  it("numbers a list from where it starts, and indents a nested one", () => {
    const post = formatFacebookPost(markup("3. three\n4. four\n   - inner"));
    assert.equal(post.plain, "3. three\n4. four\n   • inner");
  });

  it("keeps the template's line breaks and blank lines", () => {
    const post = formatFacebookPost(markup("line one\nline two\n\nafter a gap"));
    assert.equal(post.html, "<p>line one<br>line two</p><p>after a gap</p>");
    assert.equal(post.plain, "line one\nline two\n\nafter a gap");
  });
});

describe("formatFacebookPost — anything else stays as typed (#1772)", () => {
  it("leaves a third heading level, a rule, links, code and strikethrough alone", () => {
    const source = "### small\n---\n[a link](https://example.com) `code` ~~gone~~";
    const post = formatFacebookPost(markup(source));
    assert.equal(post.plain, source);
    assert.ok(!/<(h3|hr|a|code|del|s)\b/.test(post.html), post.html);
  });

  it("escapes HTML typed into a template rather than passing it through", () => {
    const post = formatFacebookPost(markup("<b>not bold</b> & <script>x</script>"));
    assert.equal(post.html, "<p>&lt;b&gt;not bold&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt;</p>");
    assert.equal(post.plain, "<b>not bold</b> & <script>x</script>");
  });

  it("drops a backslash escape's backslash, so a literal asterisk can be typed", () => {
    const post = formatFacebookPost(markup("\\*not italic\\*"));
    assert.equal(post.html, "<p>*not italic*</p>");
    assert.equal(post.plain, "*not italic*");
  });

  it("does not read a line underlined with dashes or equals signs as a heading", () => {
    const post = formatFacebookPost(markup("Lot one\n---\nLot two\n==="));
    assert.ok(!/<h\d/.test(post.html), post.html);
    assert.equal(post.plain, "Lot one\n---\nLot two\n===");
  });

  it("does not mistake a hash with no space for a heading", () => {
    assert.equal(formatFacebookPost(markup("#412")).html, "<p>#412</p>");
  });
});

describe("formatFacebookPost — a placeholder's value is text (#1772)", () => {
  it("formats a placeholder the template formats", () => {
    const post = format("**{title}**\n# {startingPrice}");
    assert.equal(post.html, "<p><strong>Austria 1850 Mercury</strong></p><h1>10.00 PLN</h1>");
    assert.equal(post.plain, "Austria 1850 Mercury\n10.00 PLN");
  });

  it("never reads a value as formatting", () => {
    const post = format("{title}\n{description}", {
      title: "**Rare** # 1 <b>",
      description: "- not a list\n> not a quote",
    });
    assert.equal(
      post.html,
      "<p>**Rare** # 1 &lt;b&gt;<br>- not a list<br>&gt; not a quote</p>"
    );
    assert.equal(post.plain, "**Rare** # 1 <b>\n- not a list\n> not a quote");
  });

  it("keeps an empty value's formatting harmless", () => {
    const post = format("Start: **{startingPrice}**", { startingPrice: "" });
    assert.equal(post.html, "<p>Start: <strong></strong></p>");
    assert.equal(post.plain, "Start: ");
  });

  it("formats the note placed by {terms} as text too", () => {
    const post = format("{title}\n\n{terms}", {}, "*Shipping* 7 PLN");
    assert.equal(post.plain, "Austria 1850 Mercury\n\n*Shipping* 7 PLN");
  });

  it("formats a post of several lots, each from its own template", () => {
    const lots = [lot({ lotNo: 1, title: "One" }), lot({ lotNo: 2, title: "Two", listingType: "fixed", price: "5.00 PLN" })];
    const templates = { auction: "## Lot {lot}: {title}", quickBuy: "**{title}** for {price}" };
    const post = formatFacebookPost(renderFacebookPostParts(templates, "", lots));
    assert.equal(post.html, "<h2>Lot 1: One</h2><p><strong>Two</strong> for 5.00 PLN</p>");
    assert.equal(post.plain, "Lot 1: One\n\nTwo for 5.00 PLN");
  });

  it("leaves the source as typed — the post's text, markup and values together", () => {
    assert.equal(
      renderFacebookPostText({ auction: "**{title}**", quickBuy: "" }, "", [lot()]),
      "**Austria 1850 Mercury**"
    );
  });

  it("formats an empty post as nothing", () => {
    assert.deepEqual(format("  \n"), { html: "", plain: "" });
  });
});
