import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  balanceBasis,
  balanceVerdict,
  giveLine,
  receiveLine,
  trade,
  tradeBalance,
  tradeRow,
} from "../../src/lib/agent-api/trade-reads";
import type {
  BalanceRow,
  GiveLineRow,
  ReceiveLineRow,
  SideTotalsRow,
  TradeRow,
  VerdictRow,
} from "../../src/lib/agent-api/trade-reads";

// The trade projections (#712) — what an agent is actually told about an exchange.
//
// **Pure and structurally typed, so this file holds the whole of the decision** (`agent-api.md`,
// *The module layout is the Prisma-free split*). What it cannot hold is that `TradeData` and
// `TradeBalanceRead` satisfy these shapes — `tsc` answers that where the handlers call these
// functions, and `tests/integration/agent-api-trades.test.ts` answers it against a real database.
//
// Four rules are pinned here and every one of them is something a later reader could plausibly
// "simplify" away:
//
//  - **the share block never leaves this layer**, because its address is the one thing on a trade
//    that reaches a counterparty;
//  - **the two valuations are never merged**, in two currencies, ever;
//  - **a missing figure is counted, never summed as zero**;
//  - **a section states its rule whole or inherits the trade's whole**, and says which it did.

const SIDE: SideTotalsRow = {
  lines: 3,
  pieces: 3,
  own: 120,
  ownMissing: 0,
  ownUncertain: 1,
  ownManual: 0,
  agreed: 96,
  agreedMissing: 0,
  agreedUncertain: 0,
  agreedManual: 0,
};

const VERDICT: VerdictRow = {
  byValue: true,
  give: SIDE,
  receive: { ...SIDE, own: 118, agreed: 94, ownMissing: 1 },
  countDiff: 0,
  countTolerance: 0,
  countBalanced: true,
  valueDiff: 2,
  valuePct: 2.08,
  valueTolerancePct: 5,
  valueBalanced: true,
  valueComplete: true,
  ownDiff: 2,
  ownSkewPct: 1.67,
  ownWarnPct: 25,
  ownWarn: false,
  ownIncomplete: true,
};

/** A `TradeData`-shaped row **plus** the share block the real read carries, so the assertion below
 *  is about the projection dropping it rather than about a fixture that never had one. */
const TRADE = {
  id: "trade-1",
  tradeNo: 7,
  partnerId: "contact-1",
  partnerName: "Anna",
  status: "preparing",
  currency: "CZK",
  notes: null,
  sentAt: null,
  receivedAt: null,
  catalogVendorName: "Mi",
  balanceByValue: true,
  countTolerance: 0,
  valueTolerancePct: 5,
  ownValueWarnPct: 25,
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  sections: [
    {
      id: "sec-1",
      name: "Main",
      balanceByValue: null,
      countTolerance: null,
      valueTolerancePct: null,
      ownValueWarnPct: null,
      giveCount: 3,
      receiveCount: 2,
      receiveQuantity: 9,
    },
    {
      id: "sec-2",
      name: "Used",
      balanceByValue: false,
      countTolerance: 2,
      valueTolerancePct: 0,
      ownValueWarnPct: 40,
      giveCount: 1,
      receiveCount: 1,
      receiveQuantity: 1,
    },
  ],
  share: {
    address: { token: "t0ps3cr3t", url: "/t/t0ps3cr3t" },
    showValues: true,
    expiresAt: null,
    createdAt: "2026-09-02T10:00:00.000Z",
    lastUsedAt: null,
  },
} satisfies TradeRow & { share: unknown };

describe("trade (#712)", () => {
  it("drops the partner's share link entirely", () => {
    // **The projection is the guard.** `TradeData.share` carries the address the partner opens the
    // list at, and this surface never reaches a counterparty — so the shortest possible way to
    // reach one must not survive the mapper. #708 measured the same thing about the platform
    // vocabulary: the `where` and the `select` are depth, and the mapper is what actually protects
    // the response. Do not replace it with a spread.
    const projected = trade(TRADE, { contentEditable: true, path: "/c/mine/trades/trade-1" });
    const serialised = JSON.stringify(projected);
    assert.ok(!("share" in projected), "the share block reached the agent");
    assert.ok(!serialised.includes("t0ps3cr3t"), "the share token reached the agent");
    assert.ok(!serialised.includes("/t/"), "the partner's address reached the agent");
  });

  it("resolves a section's rule whole, and says whether it was inherited", () => {
    // ADR-0039 §3: four nullable columns written and cleared as a unit, `balanceByValue` the
    // discriminator. Per-field inheritance was rejected because *tolerance 0 because the trade says
    // so* and *tolerance 0 because this section says so* are indistinguishable from the numbers.
    const projected = trade(TRADE, { contentEditable: true, path: "/c/mine/trades/trade-1" });
    assert.deepEqual(projected.sections[0], {
      sectionId: "sec-1",
      name: "Main",
      giveLines: 3,
      receiveLines: 2,
      receivePieces: 9,
      balanceBy: "value",
      countTolerance: 0,
      valueTolerancePct: 5,
      ownValueWarnPct: 25,
      inherited: true,
    });
    assert.deepEqual(projected.sections[1], {
      sectionId: "sec-2",
      name: "Used",
      giveLines: 1,
      receiveLines: 1,
      receivePieces: 1,
      balanceBy: "pieces",
      countTolerance: 2,
      valueTolerancePct: 0,
      ownValueWarnPct: 40,
      inherited: false,
    });
  });

  it("says pieces or value rather than a boolean nobody can read", () => {
    assert.equal(balanceBasis(true), "value");
    assert.equal(balanceBasis(false), "pieces");
  });

  it("states whether the list may still be written to", () => {
    const locked = trade(TRADE, { contentEditable: false, path: "/c/mine/trades/trade-1" });
    assert.equal(locked.contentEditable, false);
  });
});

describe("tradeRow (#712)", () => {
  it("counts the two sides apart, and the receive pieces apart from its lines", () => {
    // **That difference is the trade**: ten cheap ones for two good ones is an ordinary value
    // exchange, and three lines can be thirty stamps.
    const row = tradeRow(
      {
        id: "trade-1",
        tradeNo: 7,
        partnerName: "Anna",
        status: "shared",
        currency: "CZK",
        balanceByValue: false,
        sectionCount: 2,
        giveCount: 10,
        receiveCount: 3,
        receiveQuantity: 30,
        hasPartnerFeedback: false,
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      "/c/mine/trades/trade-1"
    );
    assert.equal(row.giveLines, 10);
    assert.equal(row.receiveLines, 3);
    assert.equal(row.receivePieces, 30);
    assert.ok(!("partnerResponded" in row), "false is absent");
  });
});

describe("the line projections (#712)", () => {
  const GIVE: GiveLineRow = {
    id: "copy-1",
    itemNo: 41,
    stampId: "stamp-1",
    stampName: "Kościuszko",
    issueName: "Insurgents",
    issueYear: 1938,
    conditionName: "Mint Never Hinged",
    certificateStatusName: null,
    formatName: null,
    locationRef: "A3",
    deliveryState: "delivered",
    value: {
      amount: "50.00",
      currency: "EUR",
      baseAmountDisplay: "50.00",
      unpriced: false,
      uncertain: false,
    },
  };

  const RECEIVE: ReceiveLineRow = {
    stampId: "stamp-2",
    stampName: null,
    unknownVariant: true,
    subtype: null,
    issueName: null,
    issueYear: null,
    conditionName: "Used",
    certificateStatusName: null,
    formatName: null,
    quantity: 12,
    value: {
      amount: null,
      currency: null,
      baseAmountDisplay: null,
      unpriced: true,
      uncertain: false,
    },
  };

  it("gives a give line a copy and a place, and a receive line neither", () => {
    // ADR-0039 §1: a give line names a **concrete copy**, a receive line a `Want`-shaped key about
    // material in nobody's inventory. Drawing the second as a copy row would print an empty copy
    // number and five blank slots and call that consistency.
    const give = giveLine(GIVE, {
      lineId: "line-1",
      sectionId: "sec-1",
      fulfillment: "pending",
      catalogNumbers: [{ label: "Mi·PL 200", isPrimary: true }],
      location: "Szafa 1 › Klaser A",
    });
    assert.equal(give.side, "give");
    assert.equal(give.copyId, "copy-1");
    assert.equal(give.location, "Szafa 1 › Klaser A");
    assert.equal(give.quantity, 1, "a give line is always one copy (ADR-0020)");

    const receive = receiveLine(RECEIVE, {
      lineId: "line-2",
      sectionId: "sec-1",
      fulfillment: "pending",
      catalogNumbers: [{ label: "Mi·PL 201", isPrimary: true }],
      location: null,
    });
    assert.equal(receive.side, "receive");
    assert.ok(!("copyId" in receive), "a receive line names no copy");
    assert.ok(!("location" in receive), "material in nobody's inventory is nowhere");
    assert.equal(receive.quantity, 12, "three lines can be thirty stamps");
    assert.equal(receive.unknownVariant, true);
  });

  it("leaves a null certificate and a null format unspelled", () => {
    // #710's rule, and here it is the *right* one where `want-reads.ts`'s is the opposite: on a line
    // the null is the whole answer, so its absence says exactly what spelling it would. A null
    // certificate **is** "no certificate" (ADR-0006 §2) and a null format **is** the single
    // (ADR-0020), and neither has a dictionary row to name.
    const give = giveLine(GIVE, {
      lineId: "line-1",
      sectionId: "sec-1",
      fulfillment: "pending",
      catalogNumbers: [],
      location: null,
    });
    assert.ok(!("certificate" in give));
    assert.ok(!("format" in give));
  });

  it("states an unpriced line as unpriced rather than as nought", () => {
    const receive = receiveLine(RECEIVE, {
      lineId: "line-2",
      sectionId: "sec-1",
      fulfillment: "withdrawn",
      catalogNumbers: [],
      location: null,
    });
    assert.deepEqual(receive.catalogValue, { unpriced: true });
    assert.equal(receive.fulfillment, "withdrawn");
  });
});

describe("the balance projection (#712)", () => {
  it("keeps the two valuations apart, in two units", () => {
    // ADR-0039 §7. `own` is the collection's base currency and `agreed` the trade's, and the whole
    // failure this module exists to prevent is somebody one day adding 340 to 78.
    const verdict = balanceVerdict(VERDICT);
    assert.equal(verdict.give.own, 120);
    assert.equal(verdict.give.agreed, 96);
    assert.equal(verdict.balanceBy, "value");
  });

  it("counts a missing figure rather than summing it as zero", () => {
    const verdict = balanceVerdict(VERDICT);
    assert.equal(verdict.receive.ownMissing, 1);
    assert.equal(verdict.ownIncomplete, true);
    // …and the total beside it is a partial sum that says so, rather than one quietly short by a
    // line. This is what the `preparing → shared` gate refuses on.
    assert.equal(verdict.receive.own, 118);
  });

  it("keeps the count verdict in value mode and the skew in both", () => {
    // *Am I giving away a thousand for ten* is a question a piece-count trade gets wrong just as
    // easily as a value one, so the own skew is computed whatever the mode.
    const verdict = balanceVerdict({ ...VERDICT, byValue: false });
    assert.equal(verdict.balanceBy, "pieces");
    assert.equal(verdict.countBalanced, true);
    assert.equal(verdict.ownSkewPct, 1.67);
    assert.equal(verdict.ownWarn, false);
  });

  it("names the blockers by line and keeps the trade's own faults line-less", () => {
    const row: BalanceRow = {
      tradeId: "trade-1",
      status: "preparing",
      baseCurrency: "EUR",
      tradeCurrency: "CZK",
      agreedCatalogVendorName: null,
      frozen: false,
      frozenAt: null,
      ratesFrozen: false,
      trade: VERDICT,
      sections: [
        { sectionId: "sec-1", name: "Main", rule: { inherited: true }, verdict: VERDICT },
      ],
      blockers: [
        {
          kind: "own-unvalued",
          message: "This line has no value yet: Mi·PL 202.",
          lines: [{ lineId: "line-9" }],
        },
        {
          kind: "agreed-no-catalog",
          message: "This trade is balanced by value but names no catalogue.",
          lines: [],
        },
      ],
    };
    const projected = tradeBalance(row);
    assert.deepEqual(projected.blockers[0].lineIds, ["line-9"]);
    // **Empty for a fault that is the trade's rather than any line's** — a value-balanced trade
    // naming no catalogue is refused as the one fault it is, never as forty lines each blamed for a
    // figure nobody asked any book for (#638).
    assert.deepEqual(projected.blockers[1].lineIds, []);
    assert.ok(!("agreedCatalog" in projected), "a trade naming no catalogue says nothing");
    assert.ok(!("frozenAt" in projected));
    assert.equal(projected.sections[0].inherited, true);
    assert.equal(projected.sections[0].balanceBy, "value");
  });
});
