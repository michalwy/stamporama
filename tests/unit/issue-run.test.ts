import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignInTurn,
  changedRunPrices,
  issueRunSequence,
  overriddenFields,
  repeatedStamps,
  resolveRunCopyDetails,
  runBlockers,
  runPriceSubjects,
  treeOrder,
  type RunCopyDetails,
  type RunMember,
} from "../../src/lib/issue-run";

// Identifying ticked tiles as the stamps of one issue, in turn (#1220): which stamp each tile takes,
// and which answer each copy is created with.

const MI = "vendor-mi";
const SC = "vendor-sc";

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

describe("the issue's stamps, in turn (#1220)", () => {
  describe("the sequence", () => {
    it("is the main stamps in catalogue order, whatever order the tree was arranged in", () => {
      const members = [
        member("s3", "203"),
        member("s1", "201"),
        member("s1a", "201a", { parentId: "s1", actsAsVariant: true }),
        member("s2", "202"),
      ];
      assert.deepEqual(issueRunSequence(members, MI), ["s1", "s2", "s3"]);
    });

    it("leaves variants out but keeps a child that is a catalogue entry of its own", () => {
      const members = [
        member("s1", "201"),
        member("s1a", "201a", { parentId: "s1", actsAsVariant: true }),
        member("s1b", "201b", { parentId: "s1", actsAsVariant: true }),
        // An overprint filed under its base: a child, but not a variant (ADR-0010).
        member("s1o", "205", { parentId: "s1", actsAsVariant: false }),
        member("s2", "202"),
      ];
      assert.deepEqual(issueRunSequence(members, MI), ["s1", "s2", "s1o"]);
    });

    it("treats a variant whose base is on no issue here as a main stamp", () => {
      const members = [member("v", "300a", { parentId: "elsewhere", actsAsVariant: true })];
      assert.deepEqual(issueRunSequence(members, MI), ["v"]);
    });

    it("reads the primary catalogue, and puts the stamps without a number after, in tree order", () => {
      const members: RunMember[] = [
        member("none-b", null),
        {
          stampId: "s2",
          parentId: null,
          actsAsVariant: false,
          catalogNumbers: [
            { catalogVendorId: SC, number: "1" },
            { catalogVendorId: MI, number: "20" },
          ],
        },
        member("none-a", null),
        member("s1", "10"),
      ];
      assert.deepEqual(issueRunSequence(members, MI), ["s1", "s2", "none-b", "none-a"]);
      // With Scott as the primary the order follows Scott's numbers instead.
      assert.deepEqual(issueRunSequence(members, SC)[0], "s2");
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

    it("hands a stamp added to the issue mid-pass to the tile still waiting for one", () => {
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
});
