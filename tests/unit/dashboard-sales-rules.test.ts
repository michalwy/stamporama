import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SALES_DASHBOARD_GROUPS,
  SALES_WAITING_STATUSES,
  saleDashboardItem,
  salesDashboardGroups,
  type SaleAwaitingFulfilment,
} from "../../src/lib/dashboard-sales-rules";

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

describe("the Sales section's groups (#1809)", () => {
  it("are awaiting payment, to pack and to send — ordered, paid, packed — in that order", () => {
    assert.deepEqual(
      SALES_DASHBOARD_GROUPS.map((g) => [g.title, g.status]),
      [
        ["Awaiting payment", "ordered"],
        ["To pack", "paid"],
        ["To send", "packed"],
      ]
    );
    assert.deepEqual([...SALES_WAITING_STATUSES], ["ordered", "paid", "packed"]);
  });

  it("puts each sale in its status's group and links each group to the list's status chip", () => {
    const groups = salesDashboardGroups([
      sale({ id: "a", status: "ordered" }),
      sale({ id: "b", status: "paid" }),
      sale({ id: "c", status: "packed" }),
      sale({ id: "d", status: "paid" }),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.id, g.count, g.items.map((i) => i.key), g.href]),
      [
        ["sales-awaiting-payment", 1, ["a"], "sales?status=ordered"],
        ["sales-to-pack", 2, ["b", "d"], "sales?status=paid"],
        ["sales-to-send", 1, ["c"], "sales?status=packed"],
      ]
    );
  });

  it("keeps every group when nothing is waiting, each at zero", () => {
    const groups = salesDashboardGroups([]);
    assert.equal(groups.length, 3);
    assert.ok(groups.every((g) => g.count === 0 && g.items.length === 0));
  });

  it("lists the longest in its status first, the lower sale number breaking a tie", () => {
    const groups = salesDashboardGroups([
      sale({ id: "new", saleNo: 1, since: new Date("2026-10-09T00:00:00Z") }),
      sale({ id: "old", saleNo: 2, since: new Date("2026-10-02T00:00:00Z") }),
      sale({ id: "tie-hi", saleNo: 9, since: new Date("2026-10-05T00:00:00Z") }),
      sale({ id: "tie-lo", saleNo: 3, since: new Date("2026-10-05T00:00:00Z") }),
    ]);
    assert.deepEqual(
      groups[0].items.map((i) => i.key),
      ["old", "tie-lo", "tie-hi", "new"]
    );
  });
});

describe("a sale's row", () => {
  it("names the sale and its buyer, then the platform and what the buyer pays, aged from entering its status", () => {
    assert.deepEqual(saleDashboardItem(sale()), {
      key: "s1",
      label: "#12 · Anna",
      detail: "Allegro · 84.00 PLN",
      at: "2026-10-01T10:00:00.000Z",
      href: "sales/s1",
    });
  });

  it("is the sale number alone when the buyer is not known", () => {
    assert.equal(saleDashboardItem(sale({ buyerName: null })).label, "#12");
  });
});
