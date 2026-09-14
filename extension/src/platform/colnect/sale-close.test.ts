import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  colnectCloseSaleBody,
  colnectCloseSalePath,
  readColnectCloseSaleAnswer,
} from "./sale-close";

// The request behind closing one Colnect sale (#729).
//
// Asserted here rather than in a browser for `list-write.test.ts`'s reason: Colnect owes nobody the
// stability of this endpoint, and the one outcome that must never happen is an offer withdrawn over an
// answer that did not close anything.

describe("colnectCloseSalePath (#729)", () => {
  it("posts in the page's own language, same-origin", () => {
    assert.equal(colnectCloseSalePath("en"), "/en/sell/close_sale");
    assert.equal(colnectCloseSalePath("PL"), "/pl/sell/close_sale");
  });

  it("falls back to English rather than putting a misread prefix in the path", () => {
    assert.equal(colnectCloseSalePath(""), "/en/sell/close_sale");
    assert.equal(colnectCloseSalePath("../item"), "/en/sell/close_sale");
  });
});

describe("colnectCloseSaleBody (#729)", () => {
  it("names the sale by its code", () => {
    assert.equal(colnectCloseSaleBody("h5UXNh"), "sale_id=h5UXNh");
  });

  it("escapes rather than passing a code through as form syntax", () => {
    assert.equal(colnectCloseSaleBody(" a&b=c "), "sale_id=a%26b%3Dc");
  });

  it("refuses to build a close about no sale at all", () => {
    assert.throws(() => colnectCloseSaleBody("   "), /No Colnect sale code/);
  });
});

describe("readColnectCloseSaleAnswer (#729)", () => {
  it("takes OK as closed", () => {
    assert.deepEqual(readColnectCloseSaleAnswer(200, "OK"), { status: "closed" });
    assert.deepEqual(readColnectCloseSaleAnswer(200, "  OK\n"), { status: "closed" });
  });

  it("reads 404 as no such sale", () => {
    assert.deepEqual(readColnectCloseSaleAnswer(404, "<html>Not found</html>"), { status: "missing" });
  });

  it("never takes a 200 that does not say OK as closed", () => {
    // An anti-bot interstitial and a sign-in page are both served 200.
    const page = readColnectCloseSaleAnswer(200, "<!doctype html><title>Checking your browser</title>");
    assert.equal(page.status, "refused");
    assert.match((page as { reason: string }).reason, /signed in/);

    const word = readColnectCloseSaleAnswer(200, "OKAY");
    assert.equal(word.status, "refused");

    const empty = readColnectCloseSaleAnswer(200, "");
    assert.equal(empty.status, "refused");
  });

  it("quotes a short sentence and summarises a page", () => {
    assert.deepEqual(readColnectCloseSaleAnswer(200, "KO Sale is paused"), {
      status: "refused",
      reason: "Colnect did not close the listing: KO Sale is paused",
    });
    assert.deepEqual(readColnectCloseSaleAnswer(500, "<html>" + "x".repeat(500)), {
      status: "refused",
      reason: "Colnect answered HTTP 500 and did not close the listing.",
    });
    assert.deepEqual(readColnectCloseSaleAnswer(403, "Forbidden"), {
      status: "refused",
      reason: "Colnect answered HTTP 403: Forbidden",
    });
  });
});
