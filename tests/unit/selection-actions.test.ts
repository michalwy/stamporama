import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSelectionActions,
  selectionMenuActions,
  type SelectionActionInput,
} from "../../src/app/c/[collectionSlug]/inventory/selection-actions";

const noop = () => {};

function input(overrides: Partial<SelectionActionInput> = {}): SelectionActionInput {
  return {
    inView: 5,
    listable: 5,
    collision: null,
    exclusion: null,
    quickOffer: null,
    isPending: false,
    on: {
      bulkEdit: noop,
      setExclusion: noop,
      newOffer: noop,
      addToOffer: noop,
      addToCollisionOffer: noop,
    },
    ...overrides,
  };
}

/** The selection bar and the gutter menu on a ticked row are drawn from one array (#991). */
describe("selection actions", () => {
  it("offers nothing while no ticked copy is in view", () => {
    assert.deepEqual(buildSelectionActions(input({ inView: 0, listable: 0 })), []);
  });

  it("gives the menu every action the bar has, in the bar's order", () => {
    const actions = buildSelectionActions(
      input({
        collision: { offerRef: "#12", offerLabel: "Poland 1950", platformName: "Colnect" },
        exclusion: { platformName: "Colnect", excluded: false },
      })
    );
    assert.deepEqual(
      selectionMenuActions(actions).map((a) => a.key),
      actions.map((a) => a.key)
    );
    assert.deepEqual(
      actions.map((a) => a.key),
      [
        "add-to-collision-offer",
        "bulk-edit",
        "platform-exclusion",
        "new-offer-one-set",
        "new-offer-per-copy",
        "add-to-offer",
      ]
    );
  });

  it("names the count on every menu entry", () => {
    const menu = selectionMenuActions(
      buildSelectionActions(
        input({
          inView: 5,
          listable: 3,
          collision: { offerRef: "#12", offerLabel: "Poland 1950", platformName: "Colnect" },
          exclusion: { platformName: "Delcampe", excluded: false },
        })
      )
    );
    assert.deepEqual(
      menu.map((a) => a.label),
      [
        "Add 3 to #12 instead",
        "Bulk edit 5 copies…",
        "Never list 5 on Delcampe",
        "New offer · one set of 3",
        "New offer · 3 sets",
        "Add 3 to offer",
      ]
    );
  });

  it("collapses the new-offer pair into one entry for a single listable copy", () => {
    const menu = selectionMenuActions(buildSelectionActions(input({ inView: 1, listable: 1 })));
    assert.deepEqual(
      menu.map((a) => a.label),
      ["Bulk edit 1 copy…", "New offer · 1 copy", "Add 1 to offer"]
    );
  });

  it("leaves the listing entries out when nothing in view can be listed", () => {
    const actions = buildSelectionActions(input({ inView: 4, listable: 0 }));
    assert.deepEqual(actions.map((a) => a.key), ["bulk-edit"]);
  });

  it("carries the collision warning as a hint on the listing entries only", () => {
    const actions = buildSelectionActions(
      input({
        collision: { offerRef: "#12", offerLabel: "Poland 1950", platformName: "Colnect" },
        quickOffer: { platformName: "Colnect", stateLabel: "Preparing" },
      })
    );
    const hints = Object.fromEntries(actions.map((a) => [a.key, a.hint]));
    const warning = "Already offered on Colnect in this condition.";
    assert.equal(hints["bulk-edit"], undefined);
    assert.equal(hints["new-offer-one-set"], warning);
    assert.equal(hints["new-offer-per-copy"], warning);
    assert.equal(hints["add-to-offer"], warning);
    assert.ok(actions.filter((a) => a.tone !== "link" && a.key !== "bulk-edit").every((a) => a.colliding));
  });

  it("says quick offer mode on the new-offer entries when nothing collides", () => {
    const actions = buildSelectionActions(
      input({ quickOffer: { platformName: "Colnect", stateLabel: "Preparing" } })
    );
    const entry = actions.find((a) => a.key === "new-offer-one-set");
    assert.equal(entry?.hint, "Created straight away on Colnect as Preparing, with no dialog.");
  });

  it("routes each entry to its own handler", () => {
    const calls: string[] = [];
    const actions = buildSelectionActions(
      input({
        collision: { offerRef: "#12", offerLabel: "Poland 1950", platformName: "Colnect" },
        exclusion: { platformName: "Colnect", excluded: true },
        on: {
          bulkEdit: () => calls.push("bulkEdit"),
          setExclusion: (excluded) => calls.push(`setExclusion:${excluded}`),
          newOffer: (packaging) => calls.push(`newOffer:${packaging}`),
          addToOffer: () => calls.push("addToOffer"),
          addToCollisionOffer: () => calls.push("addToCollisionOffer"),
        },
      })
    );
    for (const entry of selectionMenuActions(actions)) entry.onSelect?.();
    assert.deepEqual(calls, [
      "addToCollisionOffer",
      "bulkEdit",
      "setExclusion:false",
      "newOffer:one-set",
      "newOffer:per-copy",
      "addToOffer",
    ]);
  });

  it("disables the exclusion entry while a write is under way", () => {
    const menu = selectionMenuActions(
      buildSelectionActions(
        input({ isPending: true, exclusion: { platformName: "Colnect", excluded: false } })
      )
    );
    assert.equal(menu.find((a) => a.key === "platform-exclusion")?.disabled, true);
  });
});
