import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../src/lib/agent-api/errors";
import {
  assertUnits,
  carrier,
  packingSupply,
  parseMoney,
  parseSupplyEntry,
  resolveNamedRow,
  serviceRows,
  shippingOption,
  supplyRows,
  supplyUse,
} from "../../src/lib/agent-api/shipping-reads";

// The pure half of #1910: the money and supply-entry grammars, naming a supply or a carrier service,
// and what an agent is told about each row. The operations themselves are
// `tests/integration/agent-api-shipping.test.ts`.

function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (e) {
    assert.ok(e instanceof ApiError, `expected an ApiError, got ${String(e)}`);
    return e;
  }
  assert.fail("expected a refusal");
}

describe("parseMoney (#1910)", () => {
  it("takes an amount to the cent and answers it as the domain stores it", () => {
    assert.equal(parseMoney("9.5", "cost"), "9.50");
    assert.equal(parseMoney(" 12 ", "cost"), "12.00");
    assert.equal(parseMoney("0", "price"), "0.00");
  });

  it("refuses a third decimal, a comma or a sign rather than rounding", () => {
    for (const bad of ["9.505", "9,50", "-1", "abc", "1e3"]) {
      const e = refusal(() => parseMoney(bad, "cost"));
      assert.equal(e.code, "invalid_request");
      assert.match(e.message, /"cost"/);
    }
  });
});

describe("assertUnits (#1910)", () => {
  it("takes a whole number of at least one", () => {
    assert.equal(assertUnits(3, "quantity"), 3);
    refusal(() => assertUnits(0, "quantity"));
    refusal(() => assertUnits(-2, "quantity"));
  });
});

describe("parseSupplyEntry (#1910)", () => {
  it("reads a supply and its quantity", () => {
    assert.deepEqual(parseSupplyEntry("C6 envelope: 1", "supplies"), { supply: "C6 envelope", quantity: 1 });
    assert.deepEqual(parseSupplyEntry("  Transport card A6 :2 ", "supplies"), {
      supply: "Transport card A6",
      quantity: 2,
    });
  });

  it("takes the quantity after the last colon, so a name may carry one", () => {
    assert.deepEqual(parseSupplyEntry("Box: small: 3", "supplies"), { supply: "Box: small", quantity: 3 });
  });

  it("requires the quantity — a guessed 1 would be the agent's figure", () => {
    for (const bad of ["C6 envelope", "C6 envelope:", ": 2", "C6 envelope: two", "C6 envelope: 0"]) {
      const e = refusal(() => parseSupplyEntry(bad, "supplies"));
      assert.match(e.message, /"supplies"/);
    }
  });
});

describe("resolveNamedRow (#1910)", () => {
  const supplies = supplyRows([
    { id: "s1", name: "C6 envelope" },
    { id: "s2", name: "Transport card A6" },
  ]);
  const context = { what: "packing supply", parameter: "supply", listedBy: "list_packing_supplies" };

  it("takes an id exactly, or a name with case and space set aside", () => {
    assert.equal(resolveNamedRow("s2", supplies, context), "s2");
    assert.equal(resolveNamedRow("  c6 ENVELOPE ", supplies, context), "s1");
  });

  it("refuses an unknown name with the names it would take", () => {
    const e = refusal(() => resolveNamedRow("C5 envelope", supplies, context));
    assert.deepEqual(e.accepted, ["C6 envelope", "Transport card A6"]);
    assert.match(e.message, /list_packing_supplies/);
  });

  it("says so when the collection has none at all", () => {
    const e = refusal(() => resolveNamedRow("C6 envelope", [], context));
    assert.match(e.message, /has none yet/);
  });

  it("names a service by its label, or by its own name where only one carrier uses it", () => {
    const services = serviceRows([
      { name: "Poczta Polska", services: [{ id: "a", name: "List polecony" }, { id: "b", name: "Paczka" }] },
      { name: "InPost", services: [{ id: "c", name: "Paczka" }] },
    ]);
    const ctx = { what: "carrier service", parameter: "service", listedBy: "list_carriers" };
    assert.equal(resolveNamedRow("Poczta Polska / List polecony", services, ctx), "a");
    assert.equal(resolveNamedRow("list polecony", services, ctx), "a");
    assert.equal(resolveNamedRow("InPost / Paczka", services, ctx), "c");
    const e = refusal(() => resolveNamedRow("Paczka", services, ctx));
    assert.deepEqual(e.accepted, ["b", "c"]);
  });
});

describe("the projections (#1910)", () => {
  it("states a carrier's rate list with each service's label and how many options use it", () => {
    const row = carrier(
      {
        id: "k1",
        name: "Poczta Polska",
        trackingUrlTemplate: null,
        services: [
          {
            id: "a",
            name: "List polecony",
            cost: "9.50",
            currency: "PLN",
            supplies: [{ supplyId: "s1", name: "C6 envelope", quantity: 1 }],
          },
        ],
      },
      new Map([["a", 2]])
    );
    assert.deepEqual(row, {
      carrierId: "k1",
      name: "Poczta Polska",
      services: [
        {
          serviceId: "a",
          name: "List polecony",
          label: "Poczta Polska / List polecony",
          cost: "9.50",
          currency: "PLN",
          supplies: [{ supplyId: "s1", name: "C6 envelope", quantity: 1 }],
          optionCount: 2,
        },
      ],
    });
    assert.equal(
      carrier({ id: "k2", name: "DHL", trackingUrlTemplate: "https://dhl/{code}", services: [] }, new Map()).trackingUrl,
      "https://dhl/{code}"
    );
  });

  it("leaves `service` off an option linked to none", () => {
    const base = { id: "o1", platformId: "p1", name: "Registered", price: "12.00", currency: "PLN" };
    assert.equal("service" in shippingOption({ ...base, service: null }, "Allegro"), false);
    assert.deepEqual(
      shippingOption(
        { ...base, service: { id: "a", carrierName: "Poczta Polska", name: "List polecony", cost: "9.50", currency: "PLN" } },
        "Allegro"
      ).service,
      { serviceId: "a", label: "Poczta Polska / List polecony", cost: "9.50", currency: "PLN" }
    );
  });

  it("states a supply's stock, its batches and how many uses it has, and leaves out what is zero", () => {
    const row = packingSupply({
      id: "s1",
      name: "C6 envelope",
      onHand: 40,
      valueBase: null,
      unvaluedBatches: 1,
      shortUnits: 0,
      ownShortUnits: 0,
      batches: [
        {
          id: "l1",
          purchase: { id: "p1", purchaseNo: 12, kind: "purchase", purchasedAt: "2026-10-01" },
          quantity: 50,
          onHand: 40,
          currency: "EUR",
          costTx: "5.00",
          unitCostBase: null,
        },
      ],
      history: [{}, {}],
    });
    assert.deepEqual(row, {
      supplyId: "s1",
      name: "C6 envelope",
      onHand: 40,
      unvaluedBatches: 1,
      batches: [
        {
          lineId: "l1",
          purchaseId: "p1",
          purchaseNo: 12,
          purchaseKind: "purchase",
          boughtOn: "2026-10-01",
          quantity: 50,
          onHand: 40,
          cost: "5.00",
          currency: "EUR",
        },
      ],
      uses: 2,
    });
  });

  it("gives an own use its id and a sale's line its sale, never the line's id", () => {
    const shared = { usedOn: "2026-10-10", quantity: 2, costBase: "0.40", shortUnits: 0, unratedUnits: 0 };
    assert.deepEqual(supplyUse({ kind: "own", id: "u1", note: "storage", ...shared }), {
      kind: "own",
      useId: "u1",
      usedOn: "2026-10-10",
      quantity: 2,
      costBase: "0.40",
      note: "storage",
    });
    const sale = supplyUse({
      kind: "sale",
      id: "line-1",
      sale: { id: "x1", saleNo: 7, platformName: "Allegro" },
      ...shared,
      shortUnits: 1,
    });
    assert.equal("useId" in sale, false);
    assert.deepEqual(sale.sale, { saleId: "x1", saleNo: 7, platform: "Allegro" });
    assert.equal(sale.shortUnits, 1);
  });
});
