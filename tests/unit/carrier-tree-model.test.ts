import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  carrierNodeId,
  carrierNodes,
  carrierPane,
} from "../../src/app/c/[collectionSlug]/settings/carrier-tree-model";
import type { CarrierData } from "../../src/lib/carriers";

// The Carriers page's two levels as one list (#1909): a carrier and the services of its rate list,
// selected and added the way the Catalogs tree is.

const service = (id: string, carrierId: string, name: string) => ({
  id,
  carrierId,
  name,
  cost: "9.50",
  currency: "PLN",
  supplies: [],
});

const carriers: CarrierData[] = [
  {
    id: "c1",
    name: "InPost",
    trackingUrlTemplate: null,
    services: [service("s1", "c1", "Paczkomat A")],
  },
  {
    id: "c2",
    name: "Poczta Polska",
    trackingUrlTemplate: null,
    services: [service("s2", "c2", "List polecony"), service("s3", "c2", "Paczka")],
  },
];

describe("carrier tree", () => {
  it("lists each carrier followed by its services", () => {
    assert.deepEqual(carrierNodes(carriers).map(carrierNodeId), ["c1", "s1", "c2", "s2", "s3"]);
  });

  it("opens the selected item of either level", () => {
    const pane = carrierPane(carriers, { kind: "row", id: "s3" });
    assert.equal(pane.kind, "node");
    if (pane.kind !== "node" || pane.node.level !== "service") throw new Error("expected a service");
    assert.equal(pane.node.carrier.id, "c2");
    assert.equal(pane.node.service.name, "Paczka");
  });

  it("adds a carrier at the top, and a service under the carrier it names", () => {
    assert.deepEqual(carrierPane(carriers, { kind: "new", parentId: null }), { kind: "new-carrier" });
    const pane = carrierPane(carriers, { kind: "new", parentId: "c2" });
    assert.equal(pane.kind, "new-service");
    if (pane.kind === "new-service") assert.equal(pane.carrier.id, "c2");
  });

  it("falls back to the first carrier for nothing chosen, a stale row, or an add under a service", () => {
    for (const selection of [
      { kind: "none" } as const,
      { kind: "row", id: "gone" } as const,
      { kind: "new", parentId: "s1" } as const,
    ]) {
      const pane = carrierPane(carriers, selection);
      assert.equal(pane.kind === "node" && carrierNodeId(pane.node), "c1");
    }
  });

  it("has nothing to show without carriers", () => {
    assert.deepEqual(carrierPane([], { kind: "none" }), { kind: "none" });
  });
});
