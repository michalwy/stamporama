import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CONTACT_ROLES,
  contactChangeNote,
  contactChanges,
  contactFieldChanges,
  contactRecord,
  contactRoles,
  contactRow,
  parseContactRole,
  refuseSellerOnlyFields,
  roleFlags,
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
  language: "de",
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
    assert.equal(record.language, "de");
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

// ── The writes (#2611) ──────────────────────────────────────────────────────

const LOG_CONTACT = {
  name: "jan",
  fullName: null,
  market: null,
  ...FLAGS,
  seller: true,
  email: null,
  phone: "+48 1",
  notes: null,
  language: null,
  facebookProfileUrls: ["https://www.facebook.com/jan"],
  defaultCurrency: null,
  defaultShippingCost: null,
  buyerPremiumPercent: null,
  buyerPremiumFixed: null,
  freeExtrasMinimumOrder: null,
  freeExtrasBudgetPercent: null,
  freeExtrasMaximumBudget: null,
};

const asSent = (sent: Record<string, string>) => (param: string) => sent[param] ?? null;
const refused = (pattern: RegExp) => (error: unknown) => error instanceof ApiError && pattern.test(error.message);

describe("the fields a contact write sends (#2611)", () => {
  it("are only the ones named, with clear as null", () => {
    const changes = contactFieldChanges(asSent({ email: "jan@example.de", language: "de" }), new Set(["notes"]), (raw) => raw);
    assert.deepEqual(changes, { email: "jan@example.de", notes: null, language: "de" });
  });

  it("read an amount as the dialog does, and refuse one it would drop", () => {
    const normalise = (raw: string) => raw.replace(",", ".");
    assert.deepEqual(contactFieldChanges(asSent({ default_shipping_cost: "5,50" }), new Set(), normalise), {
      defaultShippingCost: "5.50",
    });
    assert.throws(() => contactFieldChanges(asSent({ default_shipping_cost: "five" }), new Set(), normalise), refused(/"default_shipping_cost" is an amount/));
    assert.throws(() => contactFieldChanges(asSent({ buyer_premium_fixed: "-1" }), new Set(), normalise), refused(/buyer_premium_fixed/));
  });

  it("refuse a field both sent and cleared", () => {
    assert.throws(() => contactFieldChanges(asSent({ email: "a@b.c" }), new Set(["email"]), (raw) => raw), refused(/both sent and named in "clear"/));
  });

  it("refuse a seller's default on a contact that sells nothing to the collector", () => {
    assert.throws(
      () => refuseSellerOnlyFields({ defaultShippingCost: "5.00", email: "x" }, roleFlags(["buyer"]), '"jan"'),
      refused(/"default_shipping_cost" belongs to a seller or an auction house/)
    );
    refuseSellerOnlyFields({ defaultShippingCost: "5.00" }, roleFlags(["auction_house"]), '"jan"');
    // Clearing one is always allowed.
    refuseSellerOnlyFields({ market: null }, roleFlags([]), '"jan"');
  });
});

describe("the note a contact write leaves (#2611)", () => {
  it("names what changed, with the old and new values", () => {
    const after = {
      ...LOG_CONTACT,
      email: "jan@example.de",
      language: "de",
      defaultShippingCost: "5.00",
      facebookProfileUrls: ["https://www.facebook.com/jan", "https://www.facebook.com/jan.k"],
    };
    const note = contactChangeNote(contactChanges(LOG_CONTACT, after), false);
    assert.equal(note?.summary, "Contact changed by the Assistant: email, language, default shipping cost, Facebook profiles.");
    assert.equal(
      note?.quote,
      [
        "email: (none) → jan@example.de",
        "language: (none) → de",
        "default shipping cost: (none) → 5.00",
        "Facebook profiles: added https://www.facebook.com/jan.k",
      ].join("\n")
    );
  });

  it("states roles and a removed profile", () => {
    const after = { ...LOG_CONTACT, buyer: true, facebookProfileUrls: [] };
    const note = contactChangeNote(contactChanges(LOG_CONTACT, after), false);
    assert.equal(note?.quote, "roles: seller → seller, buyer\nFacebook profiles: removed https://www.facebook.com/jan");
  });

  it("lists what a new contact was created with", () => {
    const note = contactChangeNote(contactChanges(null, LOG_CONTACT), true);
    assert.equal(note?.summary, "Contact created by the Assistant with name, phone, roles, Facebook profiles.");
    assert.match(note?.quote ?? "", /^name: jan\nphone: \+48 1\nroles: seller\n/);
  });

  it("is nothing when nothing changed", () => {
    assert.equal(contactChangeNote(contactChanges(LOG_CONTACT, { ...LOG_CONTACT }), false), null);
  });
});
