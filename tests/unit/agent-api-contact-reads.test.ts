import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CONTACT_ROLES,
  contactRecord,
  contactRoles,
  contactRow,
  parseContactRole,
} from "../../src/lib/agent-api/contact-reads";
import { ApiError } from "../../src/lib/agent-api/errors";
import { resolveSeller } from "../../src/lib/agent-api/purchase-reads";

// The contact projections (#2610) — `src/lib/agent-api/contact-reads.ts`.

const FLAGS = { buyer: false, seller: false, exchangePartner: false, auctionHouse: false, other: false };

const CONTACT = {
  id: "c1",
  name: "anna_de",
  fullName: "Anna Schmidt",
  market: "DE",
  ...FLAGS,
  buyer: true,
  auctionHouse: true,
  email: "anna@example.com",
  phone: "+49 30 1",
  notes: "Prefers registered post.",
  facebookProfileUrls: ["https://www.facebook.com/anna"],
  defaultCurrency: "EUR",
  defaultShippingCost: "4.50",
  buyerPremiumPercent: "18.00",
  buyerPremiumFixed: null,
  freeExtrasMinimumOrder: "100.00",
  freeExtrasBudgetPercent: "5",
  freeExtrasMaximumBudget: null,
  // What a domain read carries beyond the dialog, which the projections must not pass on.
  collectionId: "col",
  createdAt: new Date(),
  referenceCount: 3,
};

describe("contact roles (#2610)", () => {
  it("are words in the edit dialog's order, snake case", () => {
    assert.deepEqual(contactRoles({ ...FLAGS, exchangePartner: true, buyer: true, seller: true }), [
      "seller",
      "buyer",
      "exchange_partner",
    ]);
    assert.deepEqual(contactRoles(FLAGS), []);
  });

  it("parse a word and refuse anything else with the five", () => {
    assert.equal(parseContactRole(" auction_house ", "role"), "auction_house");
    assert.throws(
      () => parseContactRole("auctionHouse", "role"),
      (error: unknown) => error instanceof ApiError && error.accepted?.length === AGENT_CONTACT_ROLES.length
    );
  });
});

describe("the contact projections (#2610)", () => {
  it("keep a row to who the contact is — no email, phone or notes", () => {
    const row = contactRow(CONTACT, "/c/x/contacts/c1");
    assert.deepEqual(row, {
      id: "c1",
      name: "anna_de",
      fullName: "Anna Schmidt",
      roles: ["buyer", "auction_house"],
      market: "DE",
      path: "/c/x/contacts/c1",
    });
  });

  it("read the record in full, and nothing the domain read carries besides", () => {
    const record = contactRecord(CONTACT, {
      auctionPlatform: "Philasearch",
      history: {
        purchases: [4],
        sales: [7, 3],
        trades: [],
        proposals: [1],
        auctionSales: [{ id: "a1", name: "Spring", status: "open" }],
        conversationEntries: 2,
      },
      path: "/c/x/contacts/c1",
    });
    assert.equal(record.email, "anna@example.com");
    assert.equal(record.phone, "+49 30 1");
    assert.equal(record.notes, "Prefers registered post.");
    assert.deepEqual(record.facebookProfiles, ["https://www.facebook.com/anna"]);
    assert.equal(record.auctionPlatform, "Philasearch");
    assert.equal(record.buyerPremiumFixed, null);
    assert.deepEqual(record.sales, [7, 3]);
    assert.equal(record.conversationEntries, 2);
    for (const field of ["collectionId", "createdAt", "referenceCount"]) {
      assert.ok(!(field in record), `${field} reached the agent`);
    }
  });
});

describe("naming a contact to read (#2610)", () => {
  const candidates = [
    { id: "c1", name: "Carl Weber", fullName: null },
    { id: "c2", name: "anna_de", fullName: "Anna Schmidt" },
  ];

  it("resolves an id, a name or a full name exactly", () => {
    assert.equal(resolveSeller("c1", candidates, "contact", null), "c1");
    assert.equal(resolveSeller(" ANNA SCHMIDT ", candidates, "contact", null), "c2");
  });

  it("refuses an unknown one pointing at find_contacts, never at a write", () => {
    assert.throws(
      () => resolveSeller("Carl Webber", candidates, "contact", null),
      (error: unknown) =>
        error instanceof ApiError &&
        /Carl Weber/.test(error.message) &&
        /find_contacts/.test(error.message) &&
        !/create_seller/.test(error.message)
    );
  });
});
