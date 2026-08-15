import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RECENT_ENTITY_LIMIT,
  parseRecentEntities,
  recordRecentEntity,
  serializeRecentEntities,
  type RecentEntity,
} from "../../src/lib/recent-entities";

function entry(overrides: Partial<RecentEntity> = {}): RecentEntity {
  return {
    kind: "purchase",
    id: "p1",
    href: "/c/main/purchases/p1",
    label: "Purchase #7",
    at: 1_000,
    ...overrides,
  };
}

describe("recordRecentEntity", () => {
  it("puts the newest visit first", () => {
    const list = recordRecentEntity(
      [entry({ id: "p1", at: 1 })],
      entry({ id: "p2", label: "Purchase #8", at: 2 })
    );
    assert.deepEqual(
      list.map((e) => e.id),
      ["p2", "p1"]
    );
  });

  it("moves a revisited record to the front instead of repeating it", () => {
    const list = recordRecentEntity(
      [entry({ id: "p2", at: 2 }), entry({ id: "p1", at: 1 })],
      entry({ id: "p1", at: 3 })
    );
    assert.deepEqual(
      list.map((e) => e.id),
      ["p1", "p2"]
    );
    assert.equal(list.length, 2);
    assert.equal(list[0].at, 3);
  });

  it("takes the new visit's label, so a renamed record reads by its current name", () => {
    const list = recordRecentEntity(
      [entry({ label: "Old name" })],
      entry({ label: "New name", at: 2 })
    );
    assert.equal(list[0].label, "New name");
  });

  it("tells two kinds sharing an id apart", () => {
    const list = recordRecentEntity(
      [entry({ kind: "purchase", id: "x" })],
      entry({ kind: "sale", id: "x", href: "/c/main/sales/x", at: 2 })
    );
    assert.equal(list.length, 2);
  });

  it("caps the list, dropping the oldest", () => {
    let list: RecentEntity[] = [];
    for (let i = 0; i < RECENT_ENTITY_LIMIT + 5; i++) {
      list = recordRecentEntity(list, entry({ id: `p${i}`, at: i }));
    }
    assert.equal(list.length, RECENT_ENTITY_LIMIT);
    assert.equal(list[0].id, `p${RECENT_ENTITY_LIMIT + 4}`);
    assert.equal(list.at(-1)?.id, `p${5}`);
  });
});

describe("parseRecentEntities", () => {
  it("reads back what was written", () => {
    const list = [entry(), entry({ kind: "item", id: "i1", href: "/c/main/inventory/i1" })];
    assert.deepEqual(parseRecentEntities(serializeRecentEntities(list)), list);
  });

  it("treats nothing stored, junk and a non-array as an empty list", () => {
    assert.deepEqual(parseRecentEntities(null), []);
    assert.deepEqual(parseRecentEntities(""), []);
    assert.deepEqual(parseRecentEntities("not json"), []);
    assert.deepEqual(parseRecentEntities('{"kind":"purchase"}'), []);
  });

  it("drops entries whose shape has moved on rather than failing", () => {
    const raw = JSON.stringify([
      entry({ id: "good" }),
      { kind: "unknownKind", id: "x", href: "/x", label: "x", at: 1 },
      { kind: "purchase", id: "x", label: "no href", at: 1 },
      { kind: "purchase", id: "x", href: "/x", label: "no instant" },
      null,
    ]);
    assert.deepEqual(
      parseRecentEntities(raw).map((e) => e.id),
      ["good"]
    );
  });

  it("refuses an absolute href — nothing here writes a link off this app", () => {
    const raw = JSON.stringify([entry({ href: "https://example.com/phish" })]);
    assert.deepEqual(parseRecentEntities(raw), []);
  });

  it("caps an over-long stored list", () => {
    const raw = JSON.stringify(
      Array.from({ length: RECENT_ENTITY_LIMIT + 10 }, (_, i) => entry({ id: `p${i}` }))
    );
    assert.equal(parseRecentEntities(raw).length, RECENT_ENTITY_LIMIT);
  });
});
