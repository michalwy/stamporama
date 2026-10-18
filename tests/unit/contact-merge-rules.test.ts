import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  mergedContactDetails,
  mergedNotes,
  type ContactMergeDetails,
} from "../../src/lib/contact-merge-rules";

const blank: ContactMergeDetails = {
  name: "",
  notes: null,
  fullName: null,
  email: null,
  phone: null,
  market: null,
  facebookProfileUrls: [],
  buyer: false,
  seller: false,
  exchangePartner: false,
  auctionHouse: false,
  other: false,
  defaultCurrency: null,
  defaultShippingCost: null,
  buyerPremiumPercent: null,
  buyerPremiumFixed: null,
};

const contact = (data: Partial<ContactMergeDetails>): ContactMergeDetails => ({ ...blank, ...data });

describe("mergedContactDetails (#2043)", () => {
  it("keeps the remaining contact's name and the details it has", () => {
    const merged = mergedContactDetails(
      contact({ name: "Jan", email: "jan@example.com", phone: "123" }),
      contact({ name: "jan_2", email: "other@example.com", phone: "456" })
    );
    assert.equal(merged.name, "Jan");
    assert.equal(merged.email, "jan@example.com");
    assert.equal(merged.phone, "123");
  });

  it("takes the details the remaining contact lacks from the other", () => {
    const merged = mergedContactDetails(
      contact({ name: "Jan" }),
      contact({ name: "jan_2", fullName: "Jan Kowalski", email: "j@example.com", phone: "9", market: "DE" })
    );
    assert.equal(merged.fullName, "Jan Kowalski");
    assert.equal(merged.email, "j@example.com");
    assert.equal(merged.phone, "9");
    assert.equal(merged.market, "DE");
  });

  it("gives the merged contact both sets of roles", () => {
    const merged = mergedContactDetails(
      contact({ buyer: true }),
      contact({ seller: true, exchangePartner: true })
    );
    assert.deepEqual(
      [merged.buyer, merged.seller, merged.exchangePartner, merged.auctionHouse, merged.other],
      [true, true, true, false, false]
    );
  });

  it("keeps both contacts' Facebook profiles, the remaining one's first, none twice", () => {
    const merged = mergedContactDetails(
      contact({ facebookProfileUrls: ["https://www.facebook.com/a"] }),
      contact({ facebookProfileUrls: ["https://www.facebook.com/b", "https://www.facebook.com/a"] })
    );
    assert.deepEqual(merged.facebookProfileUrls, ["https://www.facebook.com/a", "https://www.facebook.com/b"]);
  });

  it("adds the other's notes under the remaining contact's own", () => {
    const merged = mergedContactDetails(contact({ notes: "Pays fast" }), contact({ notes: "Second account" }));
    assert.equal(merged.notes, "Pays fast\n\nSecond account");
  });

  it("takes the auction defaults as one set — the other's only when the remaining has none", () => {
    const theirs = contact({ defaultCurrency: "EUR", buyerPremiumPercent: "20.00" });
    assert.deepEqual(
      pickTerms(mergedContactDetails(contact({ defaultCurrency: "CHF" }), theirs)),
      ["CHF", null, null, null]
    );
    assert.deepEqual(pickTerms(mergedContactDetails(contact({}), theirs)), ["EUR", null, "20.00", null]);
  });
});

function pickTerms(c: ContactMergeDetails) {
  return [c.defaultCurrency, c.defaultShippingCost, c.buyerPremiumPercent, c.buyerPremiumFixed];
}

describe("mergedNotes (#2043)", () => {
  it("is whichever has notes when only one does", () => {
    assert.equal(mergedNotes("Mine", null), "Mine");
    assert.equal(mergedNotes(null, "Theirs"), "Theirs");
    assert.equal(mergedNotes("  ", "Theirs"), "Theirs");
  });

  it("is none when neither has notes", () => {
    assert.equal(mergedNotes(null, ""), null);
  });
});

// `mergeContacts` moves every record naming the other contact before deleting it; a relation it does
// not know about would make the delete fail on that key (#2043). So each foreign key to `Contact` in
// the schema must be one the merge re-points.
describe("mergeContacts covers every relation to a contact (#2043)", () => {
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const domain = readFileSync(path.join(ROOT, "src/lib/contacts.ts"), "utf8");
  const merge = domain.slice(domain.indexOf("export async function mergeContacts("));
  const keys = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].flatMap(([, model, body]) =>
    [...body.matchAll(/^\s+\w+\s+Contact\??\s+@relation\((?:"\w+",\s*)?fields: \[(\w+)\]/gm)].map(
      ([, field]) => ({ model: model[0].toLowerCase() + model.slice(1), field })
    )
  );

  it("finds the relations", () => {
    assert.ok(keys.length >= 6, `found only ${keys.length}`);
  });

  for (const { model, field } of keys) {
    it(`moves ${model}.${field}`, () => {
      assert.match(
        merge,
        new RegExp(`tx\\.${model}\\.updateMany\\(\\{\\s*where: \\{ ${field}: otherId \\},\\s*data: \\{ ${field}: remainingId \\}`)
      );
    });
  }
});
