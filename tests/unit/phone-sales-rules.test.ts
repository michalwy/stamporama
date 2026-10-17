import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SALES_DASHBOARD_GROUPS, type SaleAwaitingFulfilment } from "../../src/lib/dashboard-sales-rules";
import { phoneSaleGroups, phoneSaleStep } from "../../src/lib/phone-sales-rules";
import { SALE_STATUS_ORDER, asksAboutUnpackedCopies, asksForShipment } from "../../src/lib/sale-status";
import { shipmentGoingBy } from "../../src/lib/sale-rules";

function sale(over: Partial<SaleAwaitingFulfilment> = {}): SaleAwaitingFulfilment {
  return {
    id: "s1",
    saleNo: 12,
    status: "ordered",
    buyerName: "Anna",
    platformName: "Allegro",
    buyerTotal: "84.00",
    currency: "PLN",
    since: new Date("2026-10-01T10:00:00Z"),
    ...over,
  };
}

// The phone's sales to do (#2007).
describe("the phone's sales to do", () => {
  it("are the Dashboard's groups in the Dashboard's order, empty ones kept", () => {
    const groups = phoneSaleGroups([sale({ id: "a", status: "packed" })]);
    assert.deepEqual(
      groups.map((g) => [g.title, g.status, g.sales.length]),
      SALES_DASHBOARD_GROUPS.map((g) => [g.title, g.status, g.status === "packed" ? 1 : 0])
    );
  });

  it("orders a group oldest in its status first, the lower number breaking a tie", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, d));
    const [unpaid] = phoneSaleGroups([
      sale({ id: "new", saleNo: 1, since: at(9) }),
      sale({ id: "tie-hi", saleNo: 7, since: at(3) }),
      sale({ id: "tie-lo", saleNo: 5, since: at(3) }),
    ]);
    assert.deepEqual(
      unpaid.sales.map((s) => s.id),
      ["tie-lo", "tie-hi", "new"]
    );
  });

  it("moves each waiting sale exactly one step forward, and offers nothing elsewhere", () => {
    for (const { status } of SALES_DASHBOARD_GROUPS) {
      const step = phoneSaleStep(status)!;
      assert.equal(step.next, SALE_STATUS_ORDER[SALE_STATUS_ORDER.indexOf(status) + 1], status);
    }
    assert.deepEqual(
      SALES_DASHBOARD_GROUPS.map((g) => phoneSaleStep(g.status)!.label),
      ["Mark paid", "Mark packed", "Mark sent"]
    );
    assert.equal(phoneSaleStep("sent"), null);
    assert.equal(phoneSaleStep("received"), null);
  });
});

// The questions on the way, shared by the desk's sale screen and the phone.
describe("asksAboutUnpackedCopies (#973)", () => {
  it("asks on a forward move to Packed or past it while a copy is unmarked", () => {
    assert.equal(asksAboutUnpackedCopies("paid", "packed", 2), true);
    assert.equal(asksAboutUnpackedCopies("paid", "sent", 1), true);
    assert.equal(asksAboutUnpackedCopies("packed", "sent", 1), true);
  });

  it("asks nothing before Packed, on a step back, or with every copy marked", () => {
    assert.equal(asksAboutUnpackedCopies("ordered", "paid", 3), false);
    assert.equal(asksAboutUnpackedCopies("sent", "packed", 3), false);
    assert.equal(asksAboutUnpackedCopies("paid", "packed", 0), false);
  });
});

describe("asksForShipment (#491)", () => {
  it("asks on the way to Sent while the sale has no tracking number", () => {
    assert.equal(asksForShipment("sent", null), true);
    assert.equal(asksForShipment("sent", "PL123"), false);
    assert.equal(asksForShipment("packed", null), false);
  });
});

describe("shipmentGoingBy (#1923)", () => {
  it("names the service the parcel was sent as when it is not the option's, else the option", () => {
    const base = { sentAsDiffers: false, sentAsServiceName: "Registered letter", shippingOptionName: "Letter" };
    assert.equal(shipmentGoingBy(base), "Letter");
    assert.equal(shipmentGoingBy({ ...base, sentAsDiffers: true }), "Registered letter");
    assert.equal(shipmentGoingBy({ ...base, shippingOptionName: null }), null);
  });
});
