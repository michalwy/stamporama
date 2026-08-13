import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SELECTION,
  containerBoxState,
  dropFilteredContainers,
  isRowSelected,
  isSelectionEmpty,
  resolveSelection,
  toggleContainer,
  toggleRow,
  type CopyRef,
  type CopySelection,
} from "../../src/lib/lot-selection";

/** A copy, as the selection sees one: its id and the containers it falls under. */
const row = (id: string, lotId: string, issueKey = "__none__"): CopyRef => ({
  id,
  lotId,
  issueKey,
});

const A1 = row("a1", "lotA", "iss1");
const A2 = row("a2", "lotA", "iss1");
const A3 = row("a3", "lotA", "iss2");
const B1 = row("b1", "lotB", "iss1");

function tick(sel: CopySelection, ...rows: CopyRef[]): CopySelection {
  return rows.reduce(toggleRow, sel);
}

describe("row ticking", () => {
  it("selects and deselects one copy at a time", () => {
    let sel = toggleRow(EMPTY_SELECTION, A1);
    assert.equal(isRowSelected(sel, A1), true);
    assert.equal(isRowSelected(sel, A2), false);
    sel = toggleRow(sel, A1);
    assert.equal(isSelectionEmpty(sel), true);
  });

  it("resolves to a plain id list, which needs no scope", () => {
    const sel = tick(EMPTY_SELECTION, A1, B1);
    assert.deepEqual(resolveSelection(sel), { kind: "ids", ids: ["a1", "b1"] });
  });

  it("spans lots, which is the point of holding it above the cards", () => {
    const sel = tick(EMPTY_SELECTION, A1, B1);
    assert.equal(isRowSelected(sel, A1), true);
    assert.equal(isRowSelected(sel, B1), true);
  });
});

describe("container ticking", () => {
  it("takes a whole lot without naming its copies", () => {
    const sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA" });
    assert.equal(containerBoxState(sel, { lotId: "lotA" }), "on");
    // Every copy of the lot reads as ticked, including ones never loaded.
    assert.equal(isRowSelected(sel, row("never-loaded", "lotA")), true);
    assert.equal(isRowSelected(sel, B1), false);
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotA" }] },
    });
  });

  it("makes an issue group inside a ticked lot read as ticked too", () => {
    const sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA" });
    assert.equal(containerBoxState(sel, { lotId: "lotA", issueKey: "iss1" }), "on");
    assert.equal(containerBoxState(sel, { lotId: "lotB", issueKey: "iss1" }), "off");
  });

  it("shows a dash while only some of a container is ticked", () => {
    const sel = tick(EMPTY_SELECTION, A1);
    assert.equal(containerBoxState(sel, { lotId: "lotA" }), "partial");
    assert.equal(containerBoxState(sel, { lotId: "lotA", issueKey: "iss1" }), "partial");
    assert.equal(containerBoxState(sel, { lotId: "lotA", issueKey: "iss2" }), "off");
    // Pressing a dash takes the whole container, absorbing the loose ticks under it.
    const whole = toggleContainer(sel, { lotId: "lotA" });
    assert.deepEqual(resolveSelection(whole), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotA" }] },
    });
  });

  it("falls back to a dash when a copy is lifted out of it", () => {
    let sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA" });
    sel = toggleRow(sel, A1);
    assert.equal(containerBoxState(sel, { lotId: "lotA" }), "partial");
    assert.equal(isRowSelected(sel, A1), false);
    assert.equal(isRowSelected(sel, A2), true);
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotA" }], excludeItemIds: ["a1"] },
    });
    // And putting it back restores the whole container.
    sel = toggleRow(sel, A1);
    assert.equal(containerBoxState(sel, { lotId: "lotA" }), "on");
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotA" }] },
    });
  });

  it("lifts a whole issue group back out of a ticked lot", () => {
    let sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA" });
    sel = toggleContainer(sel, { lotId: "lotA", issueKey: "iss2" });
    assert.equal(containerBoxState(sel, { lotId: "lotA" }), "partial");
    assert.equal(containerBoxState(sel, { lotId: "lotA", issueKey: "iss2" }), "off");
    assert.equal(isRowSelected(sel, A1), true);
    assert.equal(isRowSelected(sel, A3), false);
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: {
        selectors: [{ lotId: "lotA" }],
        excludeSelectors: [{ lotId: "lotA", issueKey: "iss2" }],
      },
    });
  });

  it("carries loose copies from elsewhere alongside a ticked container", () => {
    let sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA" });
    sel = toggleRow(sel, B1);
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotA" }], itemIds: ["b1"] },
    });
  });

  it("takes an issue group across every lot", () => {
    const sel = toggleContainer(EMPTY_SELECTION, { issueKey: "iss1" });
    assert.equal(isRowSelected(sel, A1), true);
    assert.equal(isRowSelected(sel, B1), true);
    assert.equal(isRowSelected(sel, A3), false);
  });

  it("takes everything with an empty container", () => {
    const sel = toggleContainer(EMPTY_SELECTION, {});
    assert.equal(containerBoxState(sel, {}), "on");
    assert.equal(containerBoxState(sel, { lotId: "lotB" }), "on");
    assert.equal(isRowSelected(sel, B1), true);
    assert.deepEqual(resolveSelection(sel), { kind: "scope", scope: { selectors: [{}] } });
    // Pressing it again clears, rather than excluding everything from itself.
    assert.equal(isSelectionEmpty(toggleContainer(sel, {})), true);
  });
});

describe("the filter chip a container was taken under", () => {
  it("travels with it into the write", () => {
    const sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA", filter: "to-sort" });
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotA", filter: "to-sort" }] },
    });
  });

  it("is retired when that chip is pressed — 'all 40 to sort' must not become 'all 900'", () => {
    let sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA", filter: "to-sort" });
    sel = toggleRow(sel, B1);
    sel = dropFilteredContainers(sel, "lotA");
    // The container goes; the loose tick is the collector's own choice and stays.
    assert.deepEqual(resolveSelection(sel), { kind: "ids", ids: ["b1"] });
  });

  it("leaves another lot's containers alone", () => {
    let sel = toggleContainer(EMPTY_SELECTION, { lotId: "lotA", filter: "to-sort" });
    sel = toggleContainer(sel, { lotId: "lotB", filter: "unpriced" });
    sel = dropFilteredContainers(sel, "lotA");
    assert.deepEqual(resolveSelection(sel), {
      kind: "scope",
      scope: { selectors: [{ lotId: "lotB", filter: "unpriced" }] },
    });
  });
});
