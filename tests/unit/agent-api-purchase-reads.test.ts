import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isApiError } from "../../src/lib/agent-api/errors";
import {
  closeContacts,
  looseName,
  namesAreClose,
  parseAmount,
  parseIsoDate,
  purchase,
  purchaseRow,
  resolveSeller,
  spend,
} from "../../src/lib/agent-api/purchase-reads";
import type {
  PurchaseDetailRow,
  PurchaseListRow,
  SellerCandidate,
  SpendRow,
} from "../../src/lib/agent-api/purchase-reads";

// The purchase projections and the seller rules (#1390) — what an agent is told about an order, and
// how a name it was handed becomes a contact or does not.
//
// Pure and structurally typed, so this file holds the decisions. That `PurchaseListItem` and
// `PurchaseDetail` satisfy the row shapes is `tsc`'s answer where the handlers call these, and
// `tests/integration/agent-api-purchases.test.ts` answers it against a real database.

function refusal(fn: () => unknown): { message: string; accepted?: readonly string[] } {
  try {
    fn();
  } catch (error) {
    assert.ok(isApiError(error), `expected an ApiError, got ${String(error)}`);
    return { message: error.message, accepted: error.accepted };
  }
  assert.fail("expected a refusal");
}

const CONTACTS: SellerCandidate[] = [
  { id: "c1", name: "bronek_1980", fullName: "Bronisław Kowalski" },
  { id: "c2", name: "Philkam", fullName: null },
  { id: "c3", name: "Jan Nowak", fullName: null },
  { id: "c4", name: "jan nowak", fullName: null },
];

describe("resolveSeller", () => {
  it("takes an id as an id, and a name or full name matching one contact", () => {
    assert.equal(resolveSeller("c2", CONTACTS, "seller"), "c2");
    assert.equal(resolveSeller("  PHILKAM ", CONTACTS, "seller"), "c2");
    // Filed under a login and found by the name one remembers (#463).
    assert.equal(resolveSeller("bronisław kowalski", CONTACTS, "seller"), "c1");
  });

  it("refuses a name matching several, naming them and handing back their ids", () => {
    const { message, accepted } = refusal(() => resolveSeller("Jan Nowak", CONTACTS, "seller"));
    assert.deepEqual(accepted, ["c3", "c4"]);
    assert.match(message, /Jan Nowak \(c3\)/);
    assert.match(message, /jan nowak \(c4\)/);
  });

  it("refuses an unknown name rather than creating one, and names the close contacts", () => {
    const { message, accepted } = refusal(() => resolveSeller("Philkamm", CONTACTS, "seller"));
    assert.deepEqual(accepted, ["Philkam"]);
    assert.match(message, /create_seller/);
  });

  it("says when nothing is close, and still points at creating the seller", () => {
    const { message, accepted } = refusal(() => resolveSeller("Zbigniew", CONTACTS, "seller"));
    assert.deepEqual(accepted, []);
    assert.match(message, /none is close/);
  });

  it("never matches loosely: a near name is refused, not taken", () => {
    // `namesAreClose` says these are the same person mistyped — which is why it may only ever
    // *suggest*. Resolving on it would file a purchase under a guess.
    assert.ok(namesAreClose("Philkamm", "Philkam"));
    assert.throws(() => resolveSeller("Philkamm", CONTACTS, "seller"));
  });
});

describe("namesAreClose", () => {
  it("sets case, accents and punctuation aside", () => {
    assert.equal(looseName("Łukasz  Nowak-Śliwa"), "lukasznowaksliwa");
    assert.ok(namesAreClose("Łukasz Nowak", "lukasz.nowak"));
  });

  it("catches a typo, scaled to the length", () => {
    assert.ok(namesAreClose("Kowalski", "Kowalsky"));
    assert.ok(namesAreClose("Briefmarken Müller", "Briefmarken Muler"));
    assert.ok(namesAreClose("Briefmarken Müller", "Brifmarken Mueller"));
    // Four letters one apart are two names, not one typo.
    assert.ok(!namesAreClose("Anna", "Hanna"));
    assert.ok(!namesAreClose("Jan", "Jen"));
  });

  it("catches one name inside the other when both are long enough to mean something", () => {
    assert.ok(namesAreClose("Kowalski", "Jan Kowalski"));
    assert.ok(!namesAreClose("Jan", "Jan Kowalski"));
  });

  it("leaves unrelated names apart", () => {
    assert.ok(!namesAreClose("Philkam", "Kowalski"));
    assert.ok(!namesAreClose("", "Kowalski"));
  });

  it("compares against the full name as well as what a contact is filed under", () => {
    assert.deepEqual(
      closeContacts(["Bronislaw Kowalsky"], CONTACTS).map((c) => c.id),
      ["c1"]
    );
  });

  it("hands back two fields and nothing personal", () => {
    for (const contact of closeContacts(["Bronislaw Kowalski"], CONTACTS)) {
      assert.deepEqual(Object.keys(contact).sort(), ["id", "name"]);
    }
  });
});

describe("parseAmount and parseIsoDate", () => {
  it("takes an amount to the cent, and refuses anything the screen would not store", () => {
    assert.equal(parseAmount("12.5", "price"), 12.5);
    assert.equal(parseAmount("0", "price"), 0);
    for (const bad of ["-1", "12,50", "1.234", "abc", "", "1e3"]) {
      assert.throws(() => parseAmount(bad, "price"), `${bad} should be refused`);
    }
  });

  it("takes a real calendar date and refuses one that does not exist", () => {
    assert.equal(parseIsoDate("2026-09-26", "purchased_at"), "2026-09-26");
    for (const bad of ["2026-02-30", "26.09.2026", "2026-9-26", "yesterday"]) {
      assert.throws(() => parseIsoDate(bad, "purchased_at"), `${bad} should be refused`);
    }
  });
});

describe("spend", () => {
  const paid = { currency: "CHF", total: "110.00", price: "100.00", shipping: "10.00" };

  it("states both currencies when a rate is frozen", () => {
    const row: SpendRow = {
      tx: paid,
      base: { currency: "EUR", total: "104.50", price: "95.00", shipping: "9.50" },
      baseCurrency: "EUR",
    };
    const result = spend(row);
    assert.equal(result.base?.total, "104.50");
    assert.equal(result.baseMissing, undefined);
  });

  it("says a missing rate in words — never a zero, never a partial figure", () => {
    const result = spend({ tx: paid, base: null, baseCurrency: "EUR" });
    assert.equal(result.base, null);
    assert.match(result.baseMissing ?? "", /No exchange rate to EUR/);
    assert.equal(result.paid.total, "110.00");
  });
});

describe("purchaseRow and purchase", () => {
  const spendRow: SpendRow = {
    tx: { currency: "EUR", total: "55.00", price: "50.00", shipping: "5.00" },
    base: { currency: "EUR", total: "55.00", price: "50.00", shipping: "5.00" },
    baseCurrency: "EUR",
  };

  it("drops what is absent and names the seller in two fields", () => {
    const row: PurchaseListRow = {
      id: "p1",
      purchaseNo: 12,
      contactId: "c2",
      contactName: "Philkam",
      platformName: null,
      purchasedAt: "2026-09-26",
      currency: "EUR",
      status: "preparing",
      shippingCost: null,
      lotCount: 1,
      expenseCount: 0,
      total: "50.00",
      type: "purchase",
    };
    const projected = purchaseRow(row, "/c/x/purchases/p1");
    assert.deepEqual(projected.seller, { id: "c2", name: "Philkam" });
    assert.ok(!("platform" in projected));
    assert.ok(!("shippingCost" in projected));
    assert.ok(!("fromTrade" in projected));
    assert.equal(purchaseRow({ ...row, type: "trade" }, "/x").fromTrade, true);
  });

  it("marks a lot removable only when it is open, empty, and nothing else points at it", () => {
    const lot = { title: null, price: "10.00", status: "open", itemCount: 0, spend: spendRow };
    const detail: PurchaseDetailRow = {
      id: "p1",
      contactId: null,
      contactName: null,
      platformName: "Allegro",
      purchasedAt: "2026-09-26",
      currency: "EUR",
      status: "preparing",
      shippingCost: "5.00",
      spend: spendRow,
      lots: [
        { ...lot, id: "empty" },
        { ...lot, id: "full", itemCount: 3 },
        { ...lot, id: "closed", status: "closed" },
        { ...lot, id: "won" },
      ],
      expenses: [{ id: "e1", label: "Magnifier", price: "4.00" }],
      auctionSale: null,
      trade: null,
    };
    const projected = purchase(detail, { purchaseNo: 3, path: "/x", linkedLotIds: new Set(["won"]) });
    assert.deepEqual(
      projected.lots.map((l) => [l.lotId, l.removable]),
      [["empty", true], ["full", false], ["closed", false], ["won", false]]
    );
    assert.equal(projected.editable, true);
    assert.ok(!("title" in projected.lots[0]));
    assert.deepEqual(projected.expenses, [{ expenseId: "e1", label: "Magnifier", price: "4.00" }]);

    // The incoming half of a trade: read, never written.
    const traded = purchase({ ...detail, trade: { id: "t1" } }, { purchaseNo: 3, path: "/x", linkedLotIds: new Set() });
    assert.equal(traded.editable, false);
    assert.equal(traded.fromTrade, true);
    assert.ok(traded.lots.every((l) => !l.removable));
  });
});
