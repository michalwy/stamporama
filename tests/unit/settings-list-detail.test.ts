import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createdId,
  currentRow,
  moveItem,
  newRowKey,
  parseRowKey,
} from "../../src/app/c/[collectionSlug]/settings/list-detail-model";
import {
  catalogNodeId,
  catalogNodes,
  catalogPane,
} from "../../src/app/c/[collectionSlug]/settings/catalog-tree-model";
import { settingsSearch } from "../../src/app/c/[collectionSlug]/settings/settings-nav";
import type { CatalogVendorData } from "../../src/lib/catalog";

/**
 * List beside detail (#1471; ADR-0059 §5): which row the pane edits, how the address names it, and
 * the Catalogs page's three levels read as one list.
 */
describe("settings list beside detail (#1471)", () => {
  describe("the row in the address", () => {
    it("reads nothing, an add, an add under a parent, and a row", () => {
      assert.deepEqual(parseRowKey(null), { kind: "none" });
      assert.deepEqual(parseRowKey(""), { kind: "none" });
      assert.deepEqual(parseRowKey("new"), { kind: "new", parentId: null });
      assert.deepEqual(parseRowKey("new:v1"), { kind: "new", parentId: "v1" });
      assert.deepEqual(parseRowKey("new:"), { kind: "new", parentId: null });
      assert.deepEqual(parseRowKey("c1"), { kind: "row", id: "c1" });
    });

    it("writes an add the way it reads it back", () => {
      assert.deepEqual(parseRowKey(newRowKey()), { kind: "new", parentId: null });
      assert.deepEqual(parseRowKey(newRowKey("n7")), { kind: "new", parentId: "n7" });
    });

    it("is dropped when the entry or its tab changes — it names a row of the page left", () => {
      const onFormats = new URLSearchParams("tab=formats&row=f1");
      assert.equal(settingsSearch(onFormats, "formats", "multipliers"), "?tab=formats&part=multipliers");
      assert.equal(settingsSearch(onFormats, "conditions", null), "?tab=conditions");
    });
  });

  describe("the row the pane edits", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("is the chosen row", () => {
      assert.equal(currentRow(rows, { kind: "row", id: "b" })?.id, "b");
    });

    it("is the first row when none is chosen, or the chosen one is gone", () => {
      assert.equal(currentRow(rows, { kind: "none" })?.id, "a");
      assert.equal(currentRow(rows, { kind: "row", id: "deleted" })?.id, "a");
    });

    it("is none while a row is being added, or when the list is empty", () => {
      assert.equal(currentRow(rows, { kind: "new", parentId: null }), null);
      assert.equal(currentRow([], { kind: "none" }), null);
    });
  });

  it("moves a dragged row to where it was dropped", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
    // A row that is not on the list any more leaves the order alone.
    assert.deepEqual(moveItem(["a", "b"], -1, 1), ["a", "b"]);
  });

  it("recognises the row an add created in the refreshed list", () => {
    assert.equal(createdId(new Set(["a", "b"]), ["a", "x", "b"]), "x");
    assert.equal(createdId(new Set(["a", "b"]), ["a", "b"]), null);
  });

  describe("the Catalogs tree", () => {
    const tree: CatalogVendorData[] = [
      {
        id: "v1",
        name: "Michel",
        abbreviation: "Mi",
        catalogNames: [
          {
            id: "n1",
            name: "Michel Deutschland",
            currency: "EUR",
            catalogEditions: [
              { id: "e1", year: 2020 },
              { id: "e2", year: 2024 },
            ],
          },
        ],
      },
      { id: "v2", name: "Fischer", abbreviation: "Fi", catalogNames: [] },
    ];

    it("lists every level in the order the tree draws it", () => {
      assert.deepEqual(
        catalogNodes(tree).map((n) => `${n.level}:${catalogNodeId(n)}`),
        ["vendor:v1", "name:n1", "edition:e1", "edition:e2", "vendor:v2"]
      );
    });

    it("opens any level by its id", () => {
      const pane = catalogPane(tree, { kind: "row", id: "e2" });
      assert.equal(pane.kind, "node");
      assert.equal(pane.kind === "node" && pane.node.level, "edition");
      assert.equal(pane.kind === "node" && pane.node.level === "edition" && pane.node.name.id, "n1");
    });

    it("adds a vendor, a catalog name under a vendor, and an edition under a catalog name", () => {
      assert.deepEqual(catalogPane(tree, { kind: "new", parentId: null }), { kind: "new-vendor" });
      const name = catalogPane(tree, { kind: "new", parentId: "v2" });
      assert.equal(name.kind === "new-name" && name.vendor.id, "v2");
      const edition = catalogPane(tree, { kind: "new", parentId: "n1" });
      assert.equal(edition.kind === "new-edition" && edition.name.id, "n1");
    });

    it("falls back to the first vendor for a stale row or a parent that is gone", () => {
      for (const selection of [
        { kind: "none" as const },
        { kind: "row" as const, id: "gone" },
        { kind: "new" as const, parentId: "gone" },
        // An edition has no children, so an add under one is no add at all.
        { kind: "new" as const, parentId: "e1" },
      ]) {
        const pane = catalogPane(tree, selection);
        assert.equal(pane.kind === "node" && catalogNodeId(pane.node), "v1");
      }
      assert.deepEqual(catalogPane([], { kind: "none" }), { kind: "none" });
    });
  });
});
