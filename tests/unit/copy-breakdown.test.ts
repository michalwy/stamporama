import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  breakDownCopies,
  copyLineParts,
  mergeCopyLines,
  type StampCopyLine,
} from "../../src/lib/copy-breakdown";

// The copy count chip's hover panel (#1243): under each disposition, one line per condition ×
// certificate × format held. What is worth pinning down is that the lines are combinations (so the
// certificate stays attached to its condition), that the markers overlap (a copy lands in every
// group it is marked for), that the defaults are left off a line, that the order is the settings'
// order, and that every total is the sum of its lines.

const MNH = "cond-mnh";
const MH = "cond-mh";
const U = "cond-u";
const SIG = "cert-sig";
const PHOTO = "cert-photo";
const HPAIR = "fmt-hpair";
const BLOCK = "fmt-block";

// The dictionaries in their settings order — deliberately not alphabetical, so a sort by id or by
// name would show up.
const ORDER = {
  conditionIds: [MNH, MH, U],
  certificateStatusIds: [SIG, PHOTO],
  formatIds: [HPAIR, BLOCK],
};

function line(partial: Partial<StampCopyLine> & { conditionId: string; count: number }): StampCopyLine {
  return {
    certificateStatusId: null,
    formatId: null,
    inCollection: true,
    forSale: false,
    forTrade: false,
    ...partial,
  };
}

describe("breakDownCopies", () => {
  it("lists one line per condition × certificate × format under each disposition", () => {
    const groups = breakDownCopies(
      [
        line({ conditionId: MNH, count: 2 }),
        line({ conditionId: MNH, certificateStatusId: SIG, formatId: HPAIR, count: 1 }),
        line({ conditionId: U, count: 3 }),
      ],
      [],
      ORDER
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, "inCollection");
    assert.deepEqual(
      groups[0].lines.map((l) => [l.conditionId, l.certificateStatusId, l.formatId, l.own]),
      [
        [MNH, null, null, 2],
        [MNH, SIG, HPAIR, 1],
        [U, null, null, 3],
      ]
    );
  });

  it("keeps the certificate on the condition that carries it", () => {
    // Three separate tallies would say "1 MNH, 1 U, 1 signed" and lose which one is signed.
    const groups = breakDownCopies(
      [
        line({ conditionId: MNH, count: 1 }),
        line({ conditionId: U, certificateStatusId: SIG, count: 1 }),
      ],
      [],
      ORDER
    );
    const signed = groups[0].lines.find((l) => l.certificateStatusId === SIG);
    assert.equal(signed?.conditionId, U);
  });

  it("puts a copy under every disposition it carries, and the unmarked ones last", () => {
    const groups = breakDownCopies(
      [
        line({ conditionId: MNH, inCollection: true, forSale: true, count: 1 }),
        line({ conditionId: U, inCollection: false, forTrade: true, count: 2 }),
        line({ conditionId: MH, inCollection: false, count: 1 }),
      ],
      [],
      ORDER
    );
    assert.deepEqual(
      groups.map((g) => [g.key, g.own]),
      [
        ["inCollection", 1],
        ["forSale", 1],
        ["forTrade", 2],
        ["unmarked", 1],
      ]
    );
    assert.equal(groups[1].lines[0].conditionId, MNH);
  });

  it("merges rows that differ only by a marker another group is about", () => {
    // One MNH copy in the collection alone, one in the collection and for sale: two database rows,
    // one line of 2 under *In collection*.
    const groups = breakDownCopies(
      [
        line({ conditionId: MNH, count: 1 }),
        line({ conditionId: MNH, forSale: true, count: 1 }),
      ],
      [],
      ORDER
    );
    assert.deepEqual(
      groups.find((g) => g.key === "inCollection")?.lines.map((l) => l.own),
      [2]
    );
  });

  it("follows the settings' order: condition, then certificate, then format, defaults first", () => {
    const groups = breakDownCopies(
      [
        line({ conditionId: U, count: 1 }),
        line({ conditionId: MNH, formatId: BLOCK, count: 1 }),
        line({ conditionId: MNH, certificateStatusId: PHOTO, count: 1 }),
        line({ conditionId: MNH, certificateStatusId: SIG, formatId: BLOCK, count: 1 }),
        line({ conditionId: MNH, certificateStatusId: SIG, count: 1 }),
        line({ conditionId: MNH, formatId: HPAIR, count: 1 }),
        line({ conditionId: MNH, count: 1 }),
        line({ conditionId: MH, count: 1 }),
      ],
      [],
      ORDER
    );
    assert.deepEqual(
      groups[0].lines.map((l) => `${l.conditionId}|${l.certificateStatusId}|${l.formatId}`),
      [
        `${MNH}|null|null`,
        `${MNH}|null|${HPAIR}`,
        `${MNH}|null|${BLOCK}`,
        `${MNH}|${SIG}|null`,
        `${MNH}|${SIG}|${BLOCK}`,
        `${MNH}|${PHOTO}|null`,
        `${MH}|null|null`,
        `${U}|null|null`,
      ]
    );
  });

  it("sorts an id the dictionary does not hold after the ones it does", () => {
    const groups = breakDownCopies(
      [line({ conditionId: "cond-gone", count: 1 }), line({ conditionId: U, count: 1 })],
      [],
      ORDER
    );
    assert.deepEqual(
      groups[0].lines.map((l) => l.conditionId),
      [U, "cond-gone"]
    );
  });

  it("keeps the variants' copies in their own figure, on the same lines", () => {
    // #528: the two numbers are never added together, so a line carries both.
    const groups = breakDownCopies(
      [line({ conditionId: MNH, count: 1 })],
      [line({ conditionId: MNH, count: 2 }), line({ conditionId: U, count: 1 })],
      ORDER
    );
    assert.deepEqual(
      groups[0].lines.map((l) => [l.conditionId, l.own, l.variant]),
      [
        [MNH, 1, 2],
        [U, 0, 1],
      ]
    );
    assert.equal(groups[0].own, 1);
    assert.equal(groups[0].variant, 3);
  });

  it("makes every total the sum of its lines", () => {
    const own = [
      line({ conditionId: MNH, forSale: true, count: 2 }),
      line({ conditionId: MNH, certificateStatusId: SIG, count: 1 }),
      line({ conditionId: U, inCollection: false, forTrade: true, formatId: HPAIR, count: 4 }),
      line({ conditionId: MH, inCollection: false, count: 3 }),
    ];
    const variant = [line({ conditionId: U, forSale: true, count: 5 })];
    for (const g of breakDownCopies(own, variant, ORDER)) {
      assert.equal(g.own, g.lines.reduce((n, l) => n + l.own, 0), g.key);
      assert.equal(g.variant, g.lines.reduce((n, l) => n + l.variant, 0), g.key);
    }
  });

  it("shows no group for a disposition nothing carries", () => {
    assert.deepEqual(breakDownCopies([], [], ORDER), []);
  });
});

describe("copyLineParts", () => {
  it("names only the condition on a plain single copy", () => {
    assert.deepEqual(copyLineParts({ conditionId: MNH, certificateStatusId: null, formatId: null }), [
      { axis: "condition", id: MNH },
    ]);
  });

  it("names a certificate or a format as soon as it is not the default", () => {
    assert.deepEqual(copyLineParts({ conditionId: MNH, certificateStatusId: SIG, formatId: null }), [
      { axis: "condition", id: MNH },
      { axis: "certificate", id: SIG },
    ]);
    assert.deepEqual(copyLineParts({ conditionId: U, certificateStatusId: null, formatId: HPAIR }), [
      { axis: "condition", id: U },
      { axis: "format", id: HPAIR },
    ]);
    assert.deepEqual(copyLineParts({ conditionId: MNH, certificateStatusId: SIG, formatId: HPAIR }), [
      { axis: "condition", id: MNH },
      { axis: "certificate", id: SIG },
      { axis: "format", id: HPAIR },
    ]);
  });
});

describe("mergeCopyLines", () => {
  it("adds up the same combination with the same markers across stamps", () => {
    const merged = mergeCopyLines([
      [line({ conditionId: MNH, count: 1 }), line({ conditionId: MNH, forSale: true, count: 1 })],
      [line({ conditionId: MNH, count: 2 })],
    ]);
    assert.deepEqual(
      merged.map((l) => [l.conditionId, l.forSale, l.count]),
      [
        [MNH, false, 3],
        [MNH, true, 1],
      ]
    );
  });

  it("does not write into the lines it was given", () => {
    const first = [line({ conditionId: MNH, count: 1 })];
    mergeCopyLines([first, [line({ conditionId: MNH, count: 1 })]]);
    assert.equal(first[0].count, 1);
  });
});
