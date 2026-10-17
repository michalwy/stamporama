import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHONE_PURCHASE_STAMP_LIMIT,
  notedStampNumbers,
  notedStampTitle,
  readPhonePurchaseFields,
  type PhonePurchaseFields,
} from "../../src/lib/phone-purchase-rules";
import { phonePurchaseNewPath, phonePurchasePath } from "../../src/lib/phone";

// Starting a purchase on the phone (#2006): what the form must say before anything is written, and
// how a noted stamp is named on the desk's card and the phone's screen.

const TODAY = "2026-10-17";

const fields: PhonePurchaseFields = {
  sellerContactId: "",
  sellerName: "  Kowalski ",
  amount: "120,5",
  currency: "PLN",
  purchasedAt: "2026-10-17",
  description: "  Stockbook Poland 1950s ",
  stampIds: ["s1", "s2", "s1", " "],
  photoUploadIds: ["u1", "u1", "u2", ""],
};

function read(patch: Partial<PhonePurchaseFields>) {
  return readPhonePurchaseFields({ ...fields, ...patch }, TODAY);
}

describe("readPhonePurchaseFields (#2006)", () => {
  it("reads the form: trimmed, the amount to two places, each stamp and photo once in order", () => {
    assert.deepEqual(read({}), {
      input: {
        sellerContactId: null,
        sellerName: "Kowalski",
        amount: 120.5,
        currency: "PLN",
        purchasedAt: "2026-10-17",
        description: "Stockbook Poland 1950s",
        stampIds: ["s1", "s2"],
        photoUploadIds: ["u1", "u2"],
      },
    });
  });

  it("keeps a picked seller's id beside its name", () => {
    const r = read({ sellerContactId: " c1 " });
    assert.ok("input" in r);
    assert.equal(r.input.sellerContactId, "c1");
  });

  it("takes no description and no stamps", () => {
    const r = read({ description: "  ", stampIds: [] });
    assert.ok("input" in r);
    assert.equal(r.input.description, null);
    assert.deepEqual(r.input.stampIds, []);
  });

  it("requires the seller, the amount, the currency and the date", () => {
    assert.deepEqual(read({ sellerName: " " }), { error: "Who was it bought from?" });
    assert.deepEqual(read({ amount: "" }), { error: "How much was paid?" });
    assert.deepEqual(read({ amount: "-3" }), { error: "The amount paid is not an amount." });
    assert.deepEqual(read({ currency: "XYZ" }), { error: "Choose the currency it was paid in." });
    assert.deepEqual(read({ purchasedAt: "" }), { error: "When was it bought?" });
    assert.deepEqual(read({ purchasedAt: "2026-10-18" }), { error: "The date cannot be after today." });
  });

  it("evaluates an amount typed as a sum, as every amount field does", () => {
    const r = read({ amount: "100+20" });
    assert.ok("input" in r);
    assert.equal(r.input.amount, 120);
  });

  it("notes at most the limit of stamps", () => {
    const many = Array.from({ length: PHONE_PURCHASE_STAMP_LIMIT + 1 }, (_, i) => `s${i}`);
    assert.ok("error" in read({ stampIds: many }));
    assert.ok("input" in read({ stampIds: many.slice(1) }));
  });
});

describe("a noted stamp's name (#2006)", () => {
  it("is its name, else its leading catalogue number, else its short number", () => {
    const stamp = { stampNo: 901, name: "Chopin", catalogNumbers: ["Mi·PL 200", "Fi 180"] };
    assert.equal(notedStampTitle(stamp), "Chopin");
    assert.equal(notedStampTitle({ ...stamp, name: null }), "Mi·PL 200");
    assert.equal(notedStampTitle({ ...stamp, name: null, catalogNumbers: [] }), "Stamp #901");
    assert.equal(notedStampNumbers(stamp), "Mi·PL 200 · Fi 180 · #901");
  });
});

describe("the phone purchase addresses (#2006)", () => {
  it("live under the collection's phone start", () => {
    assert.equal(phonePurchaseNewPath("poland"), "/c/poland/phone/purchases/new");
    assert.equal(phonePurchasePath("poland", "p1"), "/c/poland/phone/purchases/p1");
  });
});
