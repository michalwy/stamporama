import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignInTurn,
  changedRunPrices,
  overriddenFields,
  repeatedStamps,
  resolveRunCopyDetails,
  runBlockers,
  runChoices,
  runPriceSubjects,
  runValueSlots,
  runValueTabTarget,
  treeOrder,
  type RunCopyDetails,
  type RunMember,
} from "../../src/lib/issue-run";

// Identifying ticked tiles as the stamps of a checklist, in turn (#1220, #1225): which stamp each tile
// takes, which stamps it can be corrected to, and which answer each copy is created with.

const MI = "vendor-mi";

const member = (
  stampId: string,
  number: string | null,
  extra: Partial<RunMember> = {}
): RunMember => ({
  stampId,
  parentId: null,
  actsAsVariant: false,
  catalogNumbers: number ? [{ catalogVendorId: MI, number }] : [],
  ...extra,
});

const ids = (nodes: readonly RunMember[]) => nodes.map((m) => m.stampId);

describe("a checklist's stamps, in turn (#1220, #1225)", () => {
  describe("the choices a tile is corrected among", () => {
    const members = [
      member("s1", "201"),
      member("s1a", "201a", { parentId: "s1", actsAsVariant: true }),
      member("s2", "202"),
      member("s3", "203"),
    ];

    it("offers the checklist's stamps first, in its own order and variants included, not catalogue order", () => {
      // The checklist's hand-set order (#764): 203 before 201a before 201.
      const choices = runChoices(["s3", "s1a", "s1"], [{ issueId: "i1", members }]);
      assert.deepEqual(ids(choices.onChecklist), ["s3", "s1a", "s1"]);
      // …then every other stamp of the issue, so a tile off the checklist still has somewhere to go.
      assert.deepEqual(
        choices.others.map((g) => [g.issueId, g.nodes.map((n) => [n.node.stampId, n.depth])]),
        [["i1", [["s2", 0]]]]
      );
    });

    it("indents another stamp only under an ancestor drawn in the same group", () => {
      const tree = [
        member("b", null),
        member("b1", null, { parentId: "b" }),
        member("c", null),
        member("c1", null, { parentId: "c", actsAsVariant: true }),
      ];
      // `c` is on the checklist, so its variant is not indented under a row that is not there.
      const choices = runChoices(["c"], [{ issueId: "i1", members: tree }]);
      assert.deepEqual(
        choices.others[0].nodes.map((n) => [n.node.stampId, n.depth]),
        [
          ["b", 0],
          ["b1", 1],
          ["c1", 0],
        ]
      );
    });

    it("groups a checklist spanning issues by issue, offers a shared stamp once, and skips what is not read yet", () => {
      const choices = runChoices(
        ["not-loaded", "a1", "b1"],
        [
          { issueId: "ia", members: [member("a1", "1"), member("shared", "2")] },
          { issueId: "ib", members: [member("shared", "2"), member("b1", "3"), member("b2", "4")] },
        ]
      );
      assert.deepEqual(ids(choices.onChecklist), ["a1", "b1"]);
      assert.deepEqual(
        choices.others.map((g) => [g.issueId, g.nodes.map((n) => n.node.stampId)]),
        [
          ["ia", ["shared"]],
          ["ib", ["b2"]],
        ]
      );
    });

    it("walks the tree depth first in the order the members arrived", () => {
      const members = [
        member("b", null),
        member("a1", null, { parentId: "a" }),
        member("a", null),
        member("b1", null, { parentId: "b" }),
      ];
      assert.deepEqual(treeOrder(members).map((m) => m.stampId), ["b", "b1", "a", "a1"]);
    });
  });

  describe("assigning in the order the tiles were ticked", () => {
    const sequence = ["s1", "s2", "s3", "s4"];

    it("gives the first ticked tile the first stamp, the second the second", () => {
      const run = assignInTurn(["t7", "t2", "t5"], sequence);
      assert.deepEqual(
        run.map((a) => [a.tileId, a.stampId, a.corrected]),
        [
          ["t7", "s1", false],
          ["t2", "s2", false],
          ["t5", "s3", false],
        ]
      );
      assert.deepEqual(runBlockers(run), []);
    });

    it("leaves the tiles past the last stamp without one, and blocks until they are dealt with", () => {
      const run = assignInTurn(["t1", "t2", "t3", "t4", "t5", "t6"], sequence);
      assert.deepEqual(
        run.map((a) => a.stampId),
        ["s1", "s2", "s3", "s4", null, null]
      );
      assert.deepEqual(runBlockers(run), ["t5", "t6"]);
      // Given a stamp, one is no longer in the way; taken out of the run, the other is gone.
      const fixed = assignInTurn(["t1", "t2", "t3", "t4", "t5"], sequence, new Map([["t5", "s2"]]));
      assert.deepEqual(runBlockers(fixed), []);
    });

    it("keeps a correction and lets every other tile keep its own turn", () => {
      const run = assignInTurn(["t1", "t2", "t3"], sequence, new Map([["t2", "s3"]]));
      assert.deepEqual(
        run.map((a) => [a.stampId, a.corrected]),
        [
          ["s1", false],
          ["s3", true],
          ["s3", false],
        ]
      );
      // Two tiles on one stamp is allowed, and said.
      assert.deepEqual([...repeatedStamps(run)], ["s3"]);
    });

    it("moves the tiles after one taken out of the run up a turn", () => {
      assert.deepEqual(
        assignInTurn(["t1", "t3"], sequence).map((a) => a.stampId),
        ["s1", "s2"]
      );
    });

    it("hands a stamp added to the checklist mid-pass to the tile still waiting for one", () => {
      const before = assignInTurn(["t1", "t2"], ["s1"]);
      assert.deepEqual(runBlockers(before), ["t2"]);
      const after = assignInTurn(["t1", "t2"], ["s1", "s2"]);
      assert.deepEqual(after.map((a) => a.stampId), ["s1", "s2"]);
    });

    it("says nothing is repeated when nothing is, and ignores the tiles with no stamp", () => {
      assert.equal(repeatedStamps(assignInTurn(["t1", "t2", "t3"], ["s1"])).size, 0);
    });
  });

  describe("copy details: once for all, overridden per tile", () => {
    const shared: RunCopyDetails = {
      conditionId: "used",
      certificateStatusId: "cert",
      formatId: "",
      lotId: "lot-1",
      location: { locationId: "box", locationRef: "A1" },
      disposition: { inCollection: true, forSale: false, forTrade: false },
    };

    it("gives a tile with no overrides the shared answers", () => {
      assert.deepEqual(resolveRunCopyDetails(shared, undefined), shared);
      assert.deepEqual(resolveRunCopyDetails(shared, {}), shared);
    });

    it("lets a tile's own value win, field by field", () => {
      const own = resolveRunCopyDetails(shared, {
        conditionId: "mint",
        location: { locationId: "album", locationRef: "" },
      });
      assert.equal(own.conditionId, "mint");
      assert.deepEqual(own.location, { locationId: "album", locationRef: "" });
      assert.equal(own.certificateStatusId, "cert");
      assert.equal(own.lotId, "lot-1");
    });

    it("reads an emptied field as the tile's own answer, not as no override", () => {
      // *This one has no certificate* while the rest of the run carries one.
      const own = resolveRunCopyDetails(shared, { certificateStatusId: "" });
      assert.equal(own.certificateStatusId, "");
    });

    it("keeps an override when the shared value changes afterwards", () => {
      const overrides = { conditionId: "mint" };
      const changed = { ...shared, conditionId: "damaged", certificateStatusId: "" };
      const own = resolveRunCopyDetails(changed, overrides);
      assert.equal(own.conditionId, "mint");
      // …while the fields it does not override follow the change.
      assert.equal(own.certificateStatusId, "");
    });

    it("names the fields a tile holds of its own, in the order the step draws them", () => {
      assert.deepEqual(
        overriddenFields({ disposition: shared.disposition, conditionId: "mint" }),
        ["conditionId", "disposition"]
      );
      assert.deepEqual(overriddenFields(undefined), []);
    });
  });

  describe("catalogue values (#1220, following #593)", () => {
    const details = (conditionId: string, certificateStatusId = ""): RunCopyDetails => ({
      conditionId,
      certificateStatusId,
      formatId: "",
      lotId: "",
      location: { locationId: "", locationRef: "" },
      disposition: { inCollection: false, forSale: false, forTrade: false },
    });

    it("prices a stamp in a condition once, however many tiles share it, and skips what cannot be priced", () => {
      const run = assignInTurn(["t1", "t2", "t3", "t4", "t5"], ["s1", "s1", "s2", "s1"]);
      const resolved = [details("used"), details("used"), details("mint"), details("used", "cert"), details("used")];
      const subjects = runPriceSubjects(run, resolved);
      assert.deepEqual(
        subjects.map((s) => [s.stampId, s.conditionId, s.certificateStatusId]),
        [
          ["s1", "used", null],
          ["s2", "mint", null],
          ["s1", "used", "cert"],
        ]
      );
      // A tile with no condition has nothing to record against.
      assert.deepEqual(runPriceSubjects(run.slice(0, 1), [details("")]), []);
    });

    it("writes only what says something new", () => {
      const run = assignInTurn(["t1", "t2", "t3"], ["s1", "s2", "s3"]);
      const subjects = runPriceSubjects(run, [details("used"), details("used"), details("used")]);
      const fields = new Map([
        // Typed over nothing.
        [subjects[0].key, { catalogNameId: "mi", amount: "4,50", recorded: null, loading: false }],
        // The prefill, retyped as a different spelling of the same number.
        [subjects[1].key, { catalogNameId: "mi", amount: "12", recorded: "12.00", loading: false }],
        // Left blank.
        [subjects[2].key, { catalogNameId: "mi", amount: "", recorded: null, loading: false }],
      ]);
      assert.deepEqual(changedRunPrices(subjects, (key) => fields.get(key) ?? null), [
        {
          stampId: "s1",
          conditionId: "used",
          certificateStatusId: null,
          entries: [{ catalogNameId: "mi", amount: "4,50" }],
        },
      ]);
      // No primary catalogue is no field and nothing to write.
      assert.deepEqual(changedRunPrices(subjects, () => null), []);
    });
  });

  describe("values on the run's rows (#1229)", () => {
    const shared: RunCopyDetails = {
      conditionId: "used",
      certificateStatusId: "",
      formatId: "",
      lotId: "",
      location: { locationId: "", locationRef: "" },
      disposition: { inCollection: false, forSale: false, forTrade: false },
    };
    const entries = (
      run: ReturnType<typeof assignInTurn>,
      overrides: ReadonlyArray<Partial<RunCopyDetails> | undefined>
    ) =>
      runValueSlots(
        run,
        run.map((_, i) => resolveRunCopyDetails(shared, overrides[i]))
      ).map((slot) => slot.entryIndex);

    it("gives the first tile of a stamp × condition × certificate the field, and points the rest at it", () => {
      const run = assignInTurn(["t1", "t2", "t3", "t4", "t5"], ["s1", "s2", "s1", "s1", "s1"]);
      const overrides = [undefined, undefined, undefined, { certificateStatusId: "cert" }, { conditionId: "mint" }];
      assert.deepEqual(entries(run, overrides), [0, 1, 0, 3, 4]);
      // The keys are the subjects the values are read and written under, once each.
      const resolved = run.map((_, i) => resolveRunCopyDetails(shared, overrides[i]));
      const slots = runValueSlots(run, resolved);
      assert.equal(slots[2].key, slots[0].key);
      assert.deepEqual(
        [...new Set(slots.map((s) => s.key))],
        runPriceSubjects(run, resolved).map((s) => s.key)
      );
    });

    it("follows the run's order, not the order the stamps are listed in", () => {
      // The second tile ticked is the first of its stamp, so it carries the field.
      const run = assignInTurn(["t1", "t2", "t3"], ["s2", "s1", "s2"], new Map([["t3", "s1"]]));
      assert.deepEqual(entries(run, []), [0, 1, 1]);
    });

    it("has no field for a tile without a stamp or a condition", () => {
      const run = assignInTurn(["t1", "t2", "t3", "t4"], ["s1", "s1", "s1"]);
      assert.deepEqual(entries(run, [{ conditionId: "" }]), [null, 1, 1, null]);
    });

    it("moves the field when a tile's condition or certificate changes", () => {
      const run = assignInTurn(["t1", "t2", "t3"], ["s1", "s1", "s1"]);
      assert.deepEqual(entries(run, []), [0, 0, 0]);
      // A certificate of its own: no longer sharing with the tile above, so a field of its own.
      assert.deepEqual(entries(run, [undefined, { certificateStatusId: "cert" }]), [0, 1, 0]);
      // …and the tile after it, changed onto the same certificate, shares that one.
      assert.deepEqual(
        entries(run, [undefined, { certificateStatusId: "cert" }, { certificateStatusId: "cert" }]),
        [0, 1, 1]
      );
      // The first tile changed away hands the field to the next tile still on the old condition.
      assert.deepEqual(entries(run, [{ conditionId: "mint" }]), [0, 1, 1]);
      // Changing it back makes the second tile's field the shared kind again.
      assert.deepEqual(entries(run, [{ conditionId: "used" }]), [0, 0, 0]);
    });

    describe("Tab", () => {
      const keys = ["a", "b", "c"];

      it("moves to the next value and Shift+Tab to the previous, with nothing between", () => {
        assert.deepEqual(runValueTabTarget(keys, "a", false, true), { key: "b" });
        assert.deepEqual(runValueTabTarget(keys, "c", true, true), { key: "b" });
      });

      it("goes from the last value to confirming the run, never to Back", () => {
        assert.equal(runValueTabTarget(keys, "c", false, true), "confirm");
        // A disabled confirm cannot hold focus, so the browser's own order stands.
        assert.equal(runValueTabTarget(keys, "c", false, false), null);
      });

      it("leaves Shift+Tab off the first value, and a key it does not know, to the browser", () => {
        assert.equal(runValueTabTarget(keys, "a", true, true), null);
        assert.equal(runValueTabTarget(keys, "zz", false, true), null);
      });
    });
  });
});
