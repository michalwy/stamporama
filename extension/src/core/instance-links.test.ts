import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { instanceLinkLabel, linkifyInstanceUrls, registeredOrigins } from "./instance-links";

// Making a marketplace's plain-text Stamporama link clickable (#417). The rule that matters most is
// the negative one: only a registered instance's origin is ever rewritten.

function noteDoc(inner: string): Document {
  return parseHTML(
    `<html><body><div class="_sl-c-entry _sl-private-note"><b>Your private note:</b> ${inner}</div></body></html>`
  ).document as unknown as Document;
}

const ORIGINS = registeredOrigins(["https://stamps.example", "https://stamps.example/"]);

function note(doc: Document): Element {
  return doc.querySelector("._sl-private-note")!;
}

describe("instanceLinkLabel", () => {
  it("reads the offer number out of the short address (#416)", () => {
    assert.deepEqual(instanceLinkLabel(new URL("https://s.example/o/main/42")), {
      text: "Offer #42",
      offerNo: 42,
    });
  });

  it("does not try to read a cuid out of the canonical address", () => {
    assert.deepEqual(
      instanceLinkLabel(new URL("https://s.example/c/main/offers/cms7q5dtf001f69mkczj8robk")),
      { text: "Stamporama offer", offerNo: null }
    );
  });

  it("falls back to the instance name for anything else on it", () => {
    assert.deepEqual(instanceLinkLabel(new URL("https://s.example/c/main/items")), {
      text: "Stamporama",
      offerNo: null,
    });
  });
});

describe("registeredOrigins", () => {
  it("de-duplicates profiles naming one instance and drops unusable values", () => {
    const origins = registeredOrigins([
      "https://a.example",
      "https://a.example/c/other",
      "not a url",
      "",
    ]);
    assert.deepEqual([...origins], ["https://a.example"]);
  });
});

describe("linkifyInstanceUrls", () => {
  it("replaces a registered instance's URL with a labelled link", () => {
    const doc = noteDoc("https://stamps.example/o/main/42");
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, "data:image/png;base64,AAA"), 1);
    const a = doc.querySelector("a")!;
    assert.equal(a.getAttribute("href"), "https://stamps.example/o/main/42");
    assert.equal(a.getAttribute("title"), "https://stamps.example/o/main/42");
    assert.equal(a.textContent, "Offer #42");
    assert.equal(a.querySelector("img")!.getAttribute("src"), "data:image/png;base64,AAA");
    // The address itself is gone from the visible text — that is the point of the label.
    assert.ok(!note(doc).textContent!.includes("https://"));
  });

  it("recognises the canonical address published before the short one existed", () => {
    const doc = noteDoc("https://stamps.example/c/main/offers/cms7q5dtf001f69mkczj8robk");
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 1);
    assert.equal(doc.querySelector("a")!.textContent, "Stamporama offer");
  });

  it("leaves an unregistered origin as plain text", () => {
    const doc = noteDoc("https://evil.example/o/main/42");
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 0);
    assert.equal(doc.querySelector("a"), null);
    assert.ok(note(doc).textContent!.includes("https://evil.example/o/main/42"));
  });

  it("does nothing at all when no profile is registered", () => {
    const doc = noteDoc("https://stamps.example/o/main/42");
    assert.equal(linkifyInstanceUrls(note(doc), new Set(), null), 0);
    assert.equal(doc.querySelector("a"), null);
  });

  it("keeps the collector's surrounding words, and stops at sentence punctuation", () => {
    const doc = noteDoc("Klaser A, 12 — https://stamps.example/o/main/7. Sold as one lot.");
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 1);
    const text = note(doc).textContent!;
    assert.ok(text.includes("Klaser A, 12"));
    assert.ok(text.includes("Offer #7. Sold as one lot."));
  });

  it("is idempotent — a second pass does not nest a link inside the first", () => {
    const doc = noteDoc("https://stamps.example/o/main/42");
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 1);
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 0);
    assert.equal(doc.querySelectorAll("a").length, 1);
  });

  it("leaves a URL the page had already linked to the page", () => {
    const doc = noteDoc('<a href="https://stamps.example/o/main/42">https://stamps.example/o/main/42</a>');
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 0);
    assert.equal(doc.querySelectorAll("a").length, 1);
  });

  it("links several notes' worth of URLs in one run", () => {
    const doc = noteDoc("https://stamps.example/o/main/1 and https://stamps.example/o/main/2");
    assert.equal(linkifyInstanceUrls(note(doc), ORIGINS, null), 2);
    assert.deepEqual(
      [...doc.querySelectorAll("a")].map((a) => a.textContent),
      ["Offer #1", "Offer #2"]
    );
  });

  it("is a no-op on a page with no note element", () => {
    assert.equal(linkifyInstanceUrls(null, ORIGINS, null), 0);
  });
});
