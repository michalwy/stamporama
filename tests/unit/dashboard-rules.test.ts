import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_ROW_LIMIT,
  auctionLotRowDetail,
  DASHBOARD_SECTIONS,
  capGroup,
  dashboardGroupFromBell,
  dashboardSectionSpec,
  isDashboardSectionId,
  isEmptyGroup,
  remainingCount,
  sectionTotal,
  type DashboardGroup,
  type DashboardItem,
} from "../../src/lib/dashboard-rules";
import { sectionForPath } from "../../src/app/c/[collectionSlug]/nav-sections";

function item(n: number): DashboardItem {
  return { key: `k${n}`, label: `Item ${n}`, detail: null, at: null, href: `offers/o${n}` };
}

function group(count: number, shown = count): DashboardGroup {
  return {
    id: "g",
    title: "Group",
    count,
    items: Array.from({ length: shown }, (_, i) => item(i)),
    href: "offers?needsAction=true",
  };
}

describe("DASHBOARD_SECTIONS", () => {
  it("is the five sections decided with the collector, in order (#1808)", () => {
    assert.deepEqual(
      DASHBOARD_SECTIONS.map((s) => s.id),
      ["sales", "incoming-purchases", "offers", "auctions", "trades"]
    );
  });

  it("links each section to a screen that sits in a sidebar section, so it has a tint", () => {
    const base = "/c/main";
    for (const spec of DASHBOARD_SECTIONS) {
      assert.notEqual(sectionForPath(`${base}/${spec.href}`, base), null, spec.id);
    }
  });

  it("recognises its own ids and nothing else", () => {
    assert.equal(isDashboardSectionId("trades"), true);
    assert.equal(isDashboardSectionId("overview"), false);
    assert.equal(dashboardSectionSpec("offers").title, "Offers to handle");
    assert.throws(() => dashboardSectionSpec("nope" as never));
  });
});

describe("groups", () => {
  it("calls a group empty by its count, so an empty group is kept and shown with its zero", () => {
    assert.equal(isEmptyGroup(group(0)), true);
    assert.equal(isEmptyGroup(group(1)), false);
  });

  it("caps the rows and keeps the count, so the rest is a link rather than lost", () => {
    const capped = capGroup(group(25));
    assert.equal(capped.items.length, DASHBOARD_ROW_LIMIT);
    assert.equal(capped.count, 25);
    assert.equal(remainingCount(capped), 25 - DASHBOARD_ROW_LIMIT);
  });

  it("leaves a group under the cap untouched", () => {
    const g = group(3);
    assert.equal(capGroup(g), g);
    assert.equal(remainingCount(g), 0);
  });

  it("totals a section over its groups' counts, not the rows listed", () => {
    assert.equal(sectionTotal({ groups: [group(25, 10), group(0), group(2)] }), 27);
    assert.equal(sectionTotal({ groups: [] }), 0);
  });
});

describe("dashboardGroupFromBell", () => {
  it("carries what a bell group is and leaves its panel's severity and collapse behind", () => {
    const bell = {
      id: "offer-sold-elsewhere",
      title: "Sold elsewhere",
      severity: "critical" as const,
      collapsed: true,
      count: 7,
      items: [{ ...item(1), extra: "x" }],
      href: "offers?needsAction=sold",
    };
    assert.deepEqual(dashboardGroupFromBell(bell), {
      id: "offer-sold-elsewhere",
      title: "Sold elsewhere",
      count: 7,
      items: [item(1)],
      href: "offers?needsAction=sold",
    });
  });
});

describe("auctionLotRowDetail (#1812)", () => {
  it("names the sale and the seller beside a lot of its own name", () => {
    assert.equal(
      auctionLotRowDetail({ label: "Danzig 1920 set", saleName: "Spring sale", sellerName: "Heinrich" }),
      "Spring sale · Heinrich"
    );
  });

  it("does not repeat the sale an untitled lot is already called by", () => {
    assert.equal(
      auctionLotRowDetail({ label: "Spring sale", saleName: "Spring sale", sellerName: "Heinrich" }),
      "Heinrich"
    );
  });

  it("does not repeat a seller the sale is named after, whatever the case", () => {
    assert.equal(
      auctionLotRowDetail({ label: "Lot 12", saleName: "Köhler 385", sellerName: "köhler" }),
      "Köhler 385"
    );
  });

  it("is null when the row has already said both", () => {
    assert.equal(
      auctionLotRowDetail({ label: "Philkam · Allegro", saleName: "Philkam · Allegro", sellerName: "Philkam" }),
      null
    );
  });
});
