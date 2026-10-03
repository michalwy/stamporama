import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyMarkPatch,
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
  seedField,
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
