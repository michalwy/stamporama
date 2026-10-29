import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IntakeGroupNode } from "../../src/lib/intake-groups";
import type { ItemListItem } from "../../src/lib/items";
import {
  copyRowPatch,
  copyRowUndo,
  keepVanishedGroups,
  lotCopiesKeys,
  patchCopyInPages,
  staleAfterCopyEdit,
} from "../../src/app/c/[collectionSlug]/purchases/[purchaseId]/lot-copies-keys";

// A copy's own row edit on a purchase (#2262) — a disposition chip, its delivery status, its
// location. Toggling one chip on a lot of 4,234 copies re-read every page of the lot the collector
// had scrolled through, so each click cost seconds. What is pinned: the row says what the write
// will make of it before the save; no list of copies is re-read, while the counts are; and a
// heading the copy's change empties stays, so the row does not vanish under the cursor.

const C = "col";
const P = "po";

describe("what a row edit draws before the save (#2262)", () => {
  it("sets the flag it was clicked for and nothing else", () => {
    assert.deepEqual(copyRowPatch({ forSale: true }), { forSale: true });
  });

  it("takes a copy set back to a pre-arrival state out of the collection, as the write does", () => {
    assert.deepEqual(copyRowPatch({ deliveryState: "to_sort" }), {
      deliveryState: "to_sort",
      inCollection: false,
    });
    // `delivered` leaves the disposition to the collector.
    assert.deepEqual(copyRowPatch({ deliveryState: "delivered" }), { deliveryState: "delivered" });
  });

  it("clears the ref with the location, and keeps it on a move", () => {
    assert.deepEqual(copyRowPatch({ locationId: null }), { locationId: null, locationRef: null });
    assert.deepEqual(copyRowPatch({ locationId: "loc2" }), { locationId: "loc2" });
  });

  it("puts back exactly the fields it set when the save fails", () => {
    const item = {
      inCollection: true,
      forSale: false,
      forTrade: false,
      deliveryState: "delivered",
      locationId: "loc1",
      locationRef: "A1",
    };
    assert.deepEqual(copyRowUndo(item, copyRowPatch({ deliveryState: "to_sort" })), {
      deliveryState: "delivered",
      inCollection: true,
    });
  });
});

describe("setting one copy's row in a paged list (#2262)", () => {
  const row = (id: string) => ({ id, forSale: false }) as unknown as ItemListItem;
  const data = { pages: [{ items: [row("a"), row("b")] }, { items: [row("c")] }], pageParams: [] };

  it("changes that copy and leaves every other page as it was", () => {
    const next = patchCopyInPages(data, "c", { forSale: true });
    assert.ok(next);
    assert.equal(next.pages[0], data.pages[0]);
    assert.equal(next.pages[1].items[0].forSale, true);
    assert.equal(data.pages[1].items[0].forSale, false);
  });

  it("hands back the same list when the copy is not in it", () => {
    assert.equal(patchCopyInPages(data, "zzz", { forSale: true }), data);
  });
});

describe("what a row edit re-reads (#2262)", () => {
  const lot = new Set(["lot0"]);
  const verdict = (key: readonly unknown[]) => staleAfterCopyEdit(key, C, lot);

  it("re-reads no list of copies, the copy's own lot's included", () => {
    assert.equal(verdict(lotCopiesKeys.list(C, "lot0", { sort: "added" })), "keep");
    assert.equal(verdict(lotCopiesKeys.list(C, "lot1", {})), "keep");
    assert.equal(verdict(lotCopiesKeys.purchaseList(C, P, {})), "keep");
  });

  it("re-reads the counts of the copy's lot and of the order", () => {
    assert.equal(verdict(lotCopiesKeys.summary(C, "lot0", { disposition: "for-sale" }, [])), "summary");
    assert.equal(verdict(lotCopiesKeys.purchaseSummary(C, P, {}, ["issue"])), "summary");
    assert.equal(verdict(lotCopiesKeys.lotReturn(C, "lot0")), "stale");
    assert.equal(verdict(lotCopiesKeys.completeness(C, "lot0")), "stale");
    assert.equal(verdict(lotCopiesKeys.purchaseCompleteness(C, P)), "stale");
    assert.equal(verdict(["lot-copies", C, "selection-count", []]), "stale");
    assert.equal(verdict(["lot-copies", C, "selection-refs", "loc1", []]), "stale");
  });

  it("leaves another lot's header alone, but not its for-sale completeness", () => {
    assert.equal(verdict(lotCopiesKeys.summary(C, "lot1", {}, [])), "keep");
    assert.equal(verdict(lotCopiesKeys.lotReturn(C, "lot1")), "keep");
    assert.equal(verdict(lotCopiesKeys.completeness(C, "lot1")), "stale");
  });

  it("never reaches another collection or another namespace", () => {
    assert.equal(verdict(lotCopiesKeys.summary("other", "lot0", {}, [])), "keep");
    assert.equal(verdict(["purchases", C, "attachable"]), "keep");
  });
});

describe("headings re-read after a row edit (#2262)", () => {
  const node = (key: string, count: number, children: IntakeGroupNode[] = []): IntakeGroupNode => ({
    axis: "issue",
    key,
    label: key,
    count,
    openCount: count,
    path: `issue:${key}`,
    children,
  });

  it("keeps a heading the filters emptied, in its place and holding nothing", () => {
    const prev = [node("a", 3), node("b", 1), node("c", 2)];
    const next = [node("a", 3), node("c", 2)];
    const kept = keepVanishedGroups(prev, next);
    assert.deepEqual(
      kept.map((n) => [n.key, n.count]),
      [
        ["a", 3],
        ["b", 0],
        ["c", 2],
      ]
    );
  });

  it("keeps a first heading first, and a nested one under its parent", () => {
    const area = (children: IntakeGroupNode[]) => ({ ...node("pl", 5, children), axis: "area" as const, path: "area:pl" });
    const prev = [node("a", 1), node("b", 2)];
    assert.deepEqual(
      keepVanishedGroups(prev, [node("b", 2)]).map((n) => n.key),
      ["a", "b"]
    );
    const nested = keepVanishedGroups([area([node("x", 1), node("y", 4)])], [area([node("y", 4)])]);
    assert.deepEqual(
      nested[0].children.map((n) => [n.key, n.count]),
      [
        ["x", 0],
        ["y", 4],
      ]
    );
  });

  it("takes the new counts, and hands back the same headings when none was dropped", () => {
    const next = [node("a", 2), node("b", 5)];
    assert.equal(keepVanishedGroups([node("a", 3), node("b", 5)], next), next);
  });
});
