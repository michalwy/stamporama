import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyMarkPatch,
  clearMarkPatch,
  faultTogglePatch,
  fillPatch,
  keeperAnswers,
  keeperGroups,
  keyPatch,
  markKeys,
  matchMarkKey,
  mergedMark,
  normalizeMark,
  pairedMark,
  parseTileOwnAnswers,
  sameMark,
  seedFaults,
  seedField,
  seedTags,
  tagTogglePatch,
  unmarkedCounts,
  type TileMark,
} from "../../src/lib/tile-marks";

const mark = (conditionId: string | null, certificateStatusId: string | null = null): TileMark => ({
  conditionId,
  certificateStatusId,
});
const at = (iso: string) => new Date(iso);

describe("normalizeMark", () => {
  it("is null when neither half is given", () => {
    assert.equal(normalizeMark(null), null);
    assert.equal(normalizeMark({ conditionId: null, certificateStatusId: null }), null);
    assert.equal(normalizeMark({ conditionId: "", certificateStatusId: "" }), null);
  });
  it("keeps either half alone", () => {
    assert.deepEqual(normalizeMark({ conditionId: "mnh" }), mark("mnh"));
    assert.deepEqual(normalizeMark({ certificateStatusId: "cert" }), mark(null, "cert"));
  });
});

describe("mergedMark — a merged box keeps a mark only when both halves agreed", () => {
  it("keeps the shared mark", () => {
    assert.deepEqual(mergedMark([mark("mng"), mark("mng")]), mark("mng"));
  });
  it("drops a mark the halves disagree on", () => {
    assert.equal(mergedMark([mark("mng"), mark("mh")]), null);
  });
  it("drops a mark only one half had", () => {
    assert.equal(mergedMark([mark("mng"), null]), null);
  });
  it("has nothing for halves with no marks", () => {
    assert.equal(mergedMark([null, null]), null);
  });
  it("compares the certificate too", () => {
    assert.equal(mergedMark([mark("mnh", "cert"), mark("mnh")]), null);
  });
});

describe("applyMarkPatch", () => {
  it("changes only the halves the patch names", () => {
    assert.deepEqual(applyMarkPatch(mark("mnh", "cert"), { conditionId: "mh" }), mark("mh", "cert"));
  });
  it("clears a half with null, and the whole mark when nothing is left", () => {
    assert.deepEqual(applyMarkPatch(mark("mnh", "cert"), { certificateStatusId: null }), mark("mnh"));
    assert.equal(applyMarkPatch(mark("mnh"), { conditionId: null }), null);
  });
});

describe("fillPatch — marking all unmarked fills only the empty halves", () => {
  it("gives a condition only to a mark without one, whatever its certificate", () => {
    assert.deepEqual(fillPatch(null, { conditionId: "mh" }), { conditionId: "mh" });
    assert.deepEqual(fillPatch(mark(null, "cert"), { conditionId: "mh" }), { conditionId: "mh" });
    assert.deepEqual(fillPatch(mark("mng"), { conditionId: "mh" }), {});
  });
  it("gives a certificate only to a mark without one", () => {
    assert.deepEqual(fillPatch(mark("mng"), { certificateStatusId: "cert" }), {
      certificateStatusId: "cert",
    });
    assert.deepEqual(fillPatch(mark("mng", "other"), { certificateStatusId: "cert" }), {});
  });
  it("never clears", () => {
    assert.deepEqual(fillPatch(mark("mng", "cert"), { conditionId: null, certificateStatusId: null }), {});
    assert.deepEqual(fillPatch(null, { conditionId: null }), {});
  });
});

describe("unmarkedCounts", () => {
  it("counts each half apart", () => {
    assert.deepEqual(unmarkedCounts([null, mark("mng"), mark(null, "cert"), mark("mh", "cert")]), {
      condition: 2,
      certificate: 2,
    });
    assert.deepEqual(unmarkedCounts([]), { condition: 0, certificate: 0 });
  });
});

describe("pairedMark — a paired back and front are one tile", () => {
  it("takes the only mark there is", () => {
    const r = pairedMark(
      { mark: null, markedAt: null },
      { mark: mark("mng"), markedAt: at("2026-10-03T10:00:00Z") }
    );
    assert.deepEqual(r.mark, mark("mng"));
    assert.equal(r.replaced, null);
    const f = pairedMark(
      { mark: mark("mh"), markedAt: at("2026-10-03T10:00:00Z") },
      { mark: null, markedAt: null }
    );
    assert.deepEqual(f.mark, mark("mh"));
    assert.equal(f.replaced, null);
  });
  it("lets the mark given last win, and names what it replaced", () => {
    const backLater = pairedMark(
      { mark: mark("mnh"), markedAt: at("2026-10-03T10:00:00Z") },
      { mark: mark("mng"), markedAt: at("2026-10-03T11:00:00Z") }
    );
    assert.deepEqual(backLater.mark, mark("mng"));
    assert.deepEqual(backLater.replaced, mark("mnh"));
    const frontLater = pairedMark(
      { mark: mark("mnh"), markedAt: at("2026-10-03T12:00:00Z") },
      { mark: mark("mng"), markedAt: at("2026-10-03T11:00:00Z") }
    );
    assert.deepEqual(frontLater.mark, mark("mnh"));
    assert.deepEqual(frontLater.replaced, mark("mng"));
  });
  it("reads a mark with no time as given just now", () => {
    const r = pairedMark(
      { mark: mark("mnh"), markedAt: at("2026-10-03T12:00:00Z") },
      { mark: mark("mng"), markedAt: null }
    );
    assert.deepEqual(r.mark, mark("mng"));
  });
  it("replaces nothing when the two agree", () => {
    const r = pairedMark(
      { mark: mark("mng"), markedAt: at("2026-10-03T10:00:00Z") },
      { mark: mark("mng"), markedAt: at("2026-10-03T11:00:00Z") }
    );
    assert.deepEqual(r.mark, mark("mng"));
    assert.equal(r.replaced, null);
  });
});

describe("matchMarkKey — typing an abbreviation", () => {
  const keys = markKeys(
    [
      { id: "mnh", abbreviation: "MNH" },
      { id: "mh", abbreviation: "MH" },
      { id: "mng", abbreviation: "MNG" },
      { id: "u", abbreviation: "U" },
    ],
    [{ id: "cert", abbreviation: "Cert" }]
  );
  it("applies at once when nothing longer could be meant", () => {
    assert.deepEqual(matchMarkKey("u", keys), { match: keys[3], final: true });
    assert.equal(matchMarkKey("mh", keys).match?.id, "mh");
    assert.equal(matchMarkKey("mh", keys).final, true);
  });
  it("waits while a prefix could still grow", () => {
    assert.deepEqual(matchMarkKey("m", keys), { match: null, final: false });
    assert.deepEqual(matchMarkKey("mn", keys), { match: null, final: false });
  });
  it("ignores case, and reaches certificates", () => {
    assert.equal(matchMarkKey("MNG", keys).match?.id, "mng");
    assert.equal(matchMarkKey("cert", keys).match?.kind, "certificate");
  });
  it("prefers the condition where a certificate shares its abbreviation", () => {
    const clash = markKeys([{ id: "c", abbreviation: "X" }], [{ id: "s", abbreviation: "X" }]);
    assert.equal(matchMarkKey("x", clash).match?.kind, "condition");
  });
});

describe("keyPatch — a typed abbreviation toggles", () => {
  const mng = { kind: "condition" as const, id: "mng", abbreviation: "MNG" };
  it("marks the targets that do not all carry it", () => {
    assert.deepEqual(keyPatch(mng, [null, mark("mng")]), { conditionId: "mng" });
  });
  it("clears it when every target already carries it", () => {
    assert.deepEqual(keyPatch(mng, [mark("mng"), mark("mng", "cert")]), { conditionId: null });
  });
});

describe("seedField — what the identification step opens on", () => {
  const lastUsed = { value: "mh", origin: "last-used" as const };
  it("opens one marked tile on its mark", () => {
    assert.deepEqual(seedField([{ tileId: "t1", marked: "mng" }], lastUsed), {
      value: "mng",
      origin: "marked",
      keepers: [],
    });
  });
  it("opens an unmarked tile on the last used choice", () => {
    assert.deepEqual(seedField([{ tileId: "t1", marked: null }], lastUsed), {
      value: "mh",
      origin: "last-used",
      keepers: [],
    });
  });
  it("labels nothing when there was nothing to seed", () => {
    assert.equal(seedField([{ tileId: "t1", marked: null }], { value: "", origin: "last-used" }).origin, null);
  });
  it("opens tiles all marked alike on the mark, and nobody keeps anything apart", () => {
    const seed = seedField(
      [
        { tileId: "t1", marked: "mng" },
        { tileId: "t2", marked: "mng" },
      ],
      lastUsed
    );
    assert.equal(seed.value, "mng");
    assert.equal(seed.origin, "marked");
    assert.deepEqual(seed.keepers, []);
  });
  it("lets marked tiles keep their marks when only some are marked", () => {
    const seed = seedField(
      [
        { tileId: "t1", marked: "mng" },
        { tileId: "t2", marked: null },
        { tileId: "t3", marked: "mng" },
      ],
      lastUsed
    );
    assert.equal(seed.value, "mh");
    assert.equal(seed.origin, "last-used");
    assert.deepEqual(seed.keepers, [
      { tileId: "t1", value: "mng" },
      { tileId: "t3", value: "mng" },
    ]);
    assert.deepEqual(keeperGroups(seed.keepers), [{ value: "mng", count: 2 }]);
  });
  it("lets every tile keep its own when the marks disagree", () => {
    const seed = seedField(
      [
        { tileId: "t1", marked: "mng" },
        { tileId: "t2", marked: "mh" },
      ],
      lastUsed
    );
    assert.equal(seed.origin, "last-used");
    assert.equal(seed.keepers.length, 2);
  });
});

describe("keeperAnswers and parseTileOwnAnswers", () => {
  it("joins the two fields per tile and round-trips through the form", () => {
    const answers = keeperAnswers(
      { value: "", origin: null, keepers: [{ tileId: "t1", value: "mng" }] },
      {
        value: "",
        origin: null,
        keepers: [
          { tileId: "t1", value: "cert" },
          { tileId: "t2", value: "cert" },
        ],
      }
    );
    assert.deepEqual(answers, [
      { tileId: "t1", conditionId: "mng", certificateStatusId: "cert" },
      { tileId: "t2", certificateStatusId: "cert" },
    ]);
    assert.deepEqual(parseTileOwnAnswers(JSON.stringify(answers)), answers);
  });
  it("drops what is malformed rather than guessing", () => {
    assert.deepEqual(parseTileOwnAnswers("not json"), []);
    assert.deepEqual(parseTileOwnAnswers(null), []);
    assert.deepEqual(parseTileOwnAnswers(JSON.stringify([{ tileId: "t1" }, { conditionId: "x" }])), []);
  });
});

// ── Faults (#1558) ──────────────────────────────────────────────────────────────────────────────

const faulted = (
  conditionId: string | null,
  faultIds: string[],
  certificateStatusId: string | null = null
): TileMark => ({ conditionId, certificateStatusId, faultIds });

describe("faults in a mark (#1558)", () => {
  it("are a mark on their own, and absent rather than empty on a mark without any", () => {
    assert.deepEqual(normalizeMark({ faultIds: ["crease"] }), faulted(null, ["crease"]));
    assert.deepEqual(normalizeMark({ conditionId: "mnh", faultIds: [] }), mark("mnh"));
    assert.equal(normalizeMark({ faultIds: ["", ""] }), null);
  });
  it("are compared as a set", () => {
    assert.equal(sameMark(faulted("mnh", ["a", "b"]), faulted("mnh", ["b", "a"])), true);
    assert.equal(sameMark(faulted("mnh", ["a"]), mark("mnh")), false);
  });
  it("are added and removed by a patch, leaving the halves and the other faults alone", () => {
    assert.deepEqual(
      applyMarkPatch(faulted("mnh", ["a"]), { addFaultIds: ["b"] }),
      faulted("mnh", ["a", "b"])
    );
    assert.deepEqual(applyMarkPatch(faulted("mnh", ["a", "b"]), { removeFaultIds: ["a"] }), faulted("mnh", ["b"]));
    assert.equal(applyMarkPatch(faulted(null, ["a"]), { removeFaultIds: ["a"] }), null);
    assert.deepEqual(applyMarkPatch(faulted("mnh", ["a"]), { conditionId: "mh" }), faulted("mh", ["a"]));
  });
  it("toggle: on every target lacking it, off when all carry it", () => {
    assert.deepEqual(faultTogglePatch("a", [faulted(null, ["a"]), null]), { addFaultIds: ["a"] });
    assert.deepEqual(faultTogglePatch("a", [faulted(null, ["a"]), faulted("mh", ["a", "b"])]), {
      removeFaultIds: ["a"],
    });
  });
  it("are cleared with the mark", () => {
    const patch = clearMarkPatch([faulted("mnh", ["a"]), faulted(null, ["b"])]);
    assert.deepEqual(patch, { conditionId: null, certificateStatusId: null, removeFaultIds: ["a", "b"] });
    assert.equal(applyMarkPatch(faulted("mnh", ["a"]), patch), null);
  });
  it("are never part of a fill", () => {
    assert.deepEqual(fillPatch(null, { conditionId: "mnh", addFaultIds: ["a"] }), { conditionId: "mnh" });
  });
  it("merge as the union, while the halves still need to agree", () => {
    assert.deepEqual(mergedMark([faulted("mng", ["a"]), faulted("mng", ["b"])]), faulted("mng", ["a", "b"]));
    assert.deepEqual(mergedMark([faulted("mng", ["a"]), mark("mh")]), faulted(null, ["a"]));
  });
  it("pair as the union, the halves going to the mark given last", () => {
    const paired = pairedMark(
      { mark: faulted("mnh", ["crease"]), markedAt: at("2026-10-03T10:00:00Z") },
      { mark: faulted("mng", ["thin-gum"]), markedAt: at("2026-10-03T11:00:00Z") }
    );
    assert.deepEqual(paired.mark, faulted("mng", ["crease", "thin-gum"]));
    assert.deepEqual(paired.replaced, mark("mnh"), "what was replaced is the halves alone");
    assert.deepEqual(paired.markedAt, at("2026-10-03T11:00:00Z"));
  });
  it("pair without a replacement when only faults differ", () => {
    const paired = pairedMark(
      { mark: faulted("mnh", ["crease"]), markedAt: at("2026-10-03T10:00:00Z") },
      { mark: faulted(null, ["thin-gum"]), markedAt: null }
    );
    assert.deepEqual(paired.mark, faulted("mnh", ["crease", "thin-gum"]));
    assert.equal(paired.replaced, null);
  });
  it("keep a time when the faults are all there is", () => {
    const paired = pairedMark(
      { mark: faulted(null, ["crease"]), markedAt: at("2026-10-03T10:00:00Z") },
      { mark: null, markedAt: null }
    );
    assert.deepEqual(paired.markedAt, at("2026-10-03T10:00:00Z"));
  });
});

describe("seedFaults — what the faults field opens on (#1558)", () => {
  it("opens on the faults every tile is marked with alike", () => {
    assert.deepEqual(seedFaults([{ tileId: "t1", faultIds: ["a", "b"] }]), {
      faultIds: ["a", "b"],
      origin: "marked",
      keepers: [],
    });
    assert.deepEqual(
      seedFaults([
        { tileId: "t1", faultIds: ["a", "b"] },
        { tileId: "t2", faultIds: ["b", "a"] },
      ]).origin,
      "marked"
    );
  });
  it("opens empty on an unmarked tile — never on the last used", () => {
    assert.deepEqual(seedFaults([{ tileId: "t1", faultIds: [] }]), {
      faultIds: [],
      origin: null,
      keepers: [],
    });
  });
  it("opens empty where the tiles differ, the marked ones keeping theirs", () => {
    assert.deepEqual(
      seedFaults([
        { tileId: "t1", faultIds: ["a"] },
        { tileId: "t2", faultIds: [] },
      ]),
      { faultIds: [], origin: null, keepers: [{ tileId: "t1", faultIds: ["a"] }] }
    );
  });
  it("hands the keepers to the write, and the form carries them back", () => {
    const none = { value: "", origin: null, keepers: [] };
    const answers = keeperAnswers(none, none, {
      faultIds: [],
      origin: null,
      keepers: [{ tileId: "t1", faultIds: ["a"] }],
    });
    assert.deepEqual(answers, [{ tileId: "t1", faultIds: ["a"] }]);
    assert.deepEqual(parseTileOwnAnswers(JSON.stringify(answers)), answers);
    assert.deepEqual(parseTileOwnAnswers(JSON.stringify([{ tileId: "t1", faultIds: [1, ""] }])), []);
  });
});

// ── Tags (#1599) ────────────────────────────────────────────────────────────────────────────────

const tagged = (conditionId: string | null, tagIds: string[]): TileMark => ({
  conditionId,
  certificateStatusId: null,
  tagIds,
});

describe("tags in a mark (#1599)", () => {
  it("are a mark on their own, and absent rather than empty on a mark without any", () => {
    assert.deepEqual(normalizeMark({ tagIds: ["check"] }), tagged(null, ["check"]));
    assert.deepEqual(normalizeMark({ conditionId: "mnh", tagIds: [] }), mark("mnh"));
    assert.equal(normalizeMark({ tagIds: [""] }), null);
  });
  it("sit beside the faults without either replacing the other", () => {
    assert.deepEqual(normalizeMark({ faultIds: ["crease"], tagIds: ["check"] }), {
      conditionId: null,
      certificateStatusId: null,
      faultIds: ["crease"],
      tagIds: ["check"],
    });
  });
  it("are compared as a set", () => {
    assert.equal(sameMark(tagged("mnh", ["a", "b"]), tagged("mnh", ["b", "a"])), true);
    assert.equal(sameMark(tagged("mnh", ["a"]), mark("mnh")), false);
  });
  it("are added and removed by a patch, leaving everything else alone", () => {
    assert.deepEqual(applyMarkPatch(tagged("mnh", ["a"]), { addTagIds: ["b"] }), tagged("mnh", ["a", "b"]));
    assert.deepEqual(applyMarkPatch(tagged("mnh", ["a", "b"]), { removeTagIds: ["a"] }), tagged("mnh", ["b"]));
    assert.equal(applyMarkPatch(tagged(null, ["a"]), { removeTagIds: ["a"] }), null);
    assert.deepEqual(applyMarkPatch(tagged("mnh", ["a"]), { addFaultIds: ["crease"] }), {
      ...tagged("mnh", ["a"]),
      faultIds: ["crease"],
    });
  });
  it("toggle: on every target lacking it, off when all carry it", () => {
    assert.deepEqual(tagTogglePatch("a", [tagged(null, ["a"]), null]), { addTagIds: ["a"] });
    assert.deepEqual(tagTogglePatch("a", [tagged(null, ["a"]), tagged("mh", ["a", "b"])]), {
      removeTagIds: ["a"],
    });
  });
  it("are cleared with the mark", () => {
    const patch = clearMarkPatch([tagged("mnh", ["a"]), tagged(null, ["b"])]);
    assert.deepEqual(patch, { conditionId: null, certificateStatusId: null, removeTagIds: ["a", "b"] });
    assert.equal(applyMarkPatch(tagged("mnh", ["a"]), patch), null);
  });
  it("are never part of a fill", () => {
    assert.deepEqual(fillPatch(null, { conditionId: "mnh", addTagIds: ["a"] }), { conditionId: "mnh" });
  });
  it("merge and pair as the union", () => {
    assert.deepEqual(mergedMark([tagged("mng", ["a"]), tagged("mh", ["b"])]), tagged(null, ["a", "b"]));
    const paired = pairedMark(
      { mark: tagged(null, ["check"]), markedAt: at("2026-10-04T10:00:00Z") },
      { mark: tagged(null, ["box"]), markedAt: null }
    );
    assert.deepEqual(paired.mark, tagged(null, ["check", "box"]));
    assert.equal(paired.replaced, null);
    assert.equal(paired.markedAt, null, "given just now beats the stored time");
  });
});

describe("seedTags — what the tags field opens on (#1599)", () => {
  it("opens on one tile's marked tags", () => {
    assert.deepEqual(seedTags([{ tileId: "t1", tagIds: ["a", "b"] }]), {
      tagIds: ["a", "b"],
      origin: "marked",
      keepers: [],
    });
  });
  it("opens empty without marks — never on the last used", () => {
    assert.deepEqual(seedTags([{ tileId: "t1", tagIds: [] }]), { tagIds: [], origin: null, keepers: [] });
    assert.deepEqual(seedTags([]), { tagIds: [], origin: null, keepers: [] });
  });
  it("opens on the tags every tile shares, the tiles marked with more keeping those too", () => {
    assert.deepEqual(
      seedTags([
        { tileId: "t1", tagIds: ["a", "b"] },
        { tileId: "t2", tagIds: ["a"] },
        { tileId: "t3", tagIds: ["c", "a"] },
      ]),
      {
        tagIds: ["a"],
        origin: "marked",
        keepers: [
          { tileId: "t1", tagIds: ["b"] },
          { tileId: "t3", tagIds: ["c"] },
        ],
      }
    );
    assert.deepEqual(
      seedTags([
        { tileId: "t1", tagIds: ["a"] },
        { tileId: "t2", tagIds: [] },
      ]),
      { tagIds: [], origin: null, keepers: [{ tileId: "t1", tagIds: ["a"] }] }
    );
  });
  it("hands the keepers to the write, and the form carries them back", () => {
    const none = { value: "", origin: null, keepers: [] };
    const answers = keeperAnswers(none, none, undefined, {
      tagIds: [],
      origin: null,
      keepers: [{ tileId: "t1", tagIds: ["a"] }],
    });
    assert.deepEqual(answers, [{ tileId: "t1", tagIds: ["a"] }]);
    assert.deepEqual(parseTileOwnAnswers(JSON.stringify(answers)), answers);
    assert.deepEqual(parseTileOwnAnswers(JSON.stringify([{ tileId: "t1", tagIds: [1, ""] }])), []);
  });
});
