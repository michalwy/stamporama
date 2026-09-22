import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RECENT_ENTITY_GROUP_LIMIT,
  groupRecentEntities,
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

function offer(id: string, at: number): RecentEntity {
  return entry({ kind: "offer", id, href: `/c/main/offers/${id}`, label: `Offer ${id}`, at });
}

function stamp(id: string, at: number): RecentEntity {
  return entry({ kind: "stamp", id, href: `/c/main/stamps/${id}`, label: `Stamp ${id}`, at });
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

  it("caps each kind, dropping that kind's oldest", () => {
    let list: RecentEntity[] = [];
    for (let i = 0; i < RECENT_ENTITY_GROUP_LIMIT + 5; i++) {
      list = recordRecentEntity(list, entry({ id: `p${i}`, at: i }));
    }
    assert.equal(list.length, RECENT_ENTITY_GROUP_LIMIT);
    assert.equal(list[0].id, `p${RECENT_ENTITY_GROUP_LIMIT + 4}`);
    assert.equal(list.at(-1)?.id, "p5");
  });

  // #1370: a session spent on one kind of thing must not push out everything else.
  it("keeps a stamp visited before many offers", () => {
    let list = recordRecentEntity([], stamp("s1", 0));
    for (let i = 1; i <= 20; i++) list = recordRecentEntity(list, offer(`o${i}`, i));
    assert.ok(list.some((e) => e.kind === "stamp" && e.id === "s1"));
    assert.equal(list.filter((e) => e.kind === "offer").length, RECENT_ENTITY_GROUP_LIMIT);
  });

  it("lets a new visit displace only an older entry of its own kind", () => {
    let list: RecentEntity[] = [];
    for (let i = 0; i < RECENT_ENTITY_GROUP_LIMIT; i++) {
      list = recordRecentEntity(list, stamp(`s${i}`, i));
      list = recordRecentEntity(list, offer(`o${i}`, i));
    }
    const next = recordRecentEntity(list, offer("new", 99));
    assert.deepEqual(
      next.filter((e) => e.kind === "stamp").map((e) => e.id),
      list.filter((e) => e.kind === "stamp").map((e) => e.id)
    );
    assert.deepEqual(
      next.filter((e) => e.kind === "offer").map((e) => e.id),
      ["new", ...list.filter((e) => e.kind === "offer").map((e) => e.id)].slice(
        0,
        RECENT_ENTITY_GROUP_LIMIT
      )
    );
  });
});

describe("groupRecentEntities", () => {
  it("orders the groups by their most recent visit, each most recent first", () => {
    const list = [offer("o2", 5), stamp("s1", 4), offer("o1", 3), entry({ id: "p1", at: 1 })];
    assert.deepEqual(
      groupRecentEntities(list).map((g) => [g.kind, g.entries.map((e) => e.id)]),
      [
        ["offer", ["o2", "o1"]],
        ["stamp", ["s1"]],
        ["purchase", ["p1"]],
      ]
    );
  });

  it("shows no group for a kind with nothing in it", () => {
    assert.deepEqual(groupRecentEntities([]), []);
    assert.deepEqual(
      groupRecentEntities([stamp("s1", 1)]).map((g) => g.kind),
      ["stamp"]
    );
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

  it("caps each kind of an over-long stored list, keeping the most recent", () => {
    // What a build from before #1370 left behind: one shared cap, filled by a single kind.
    const raw = JSON.stringify([
      ...Array.from({ length: 12 }, (_, i) => offer(`o${i}`, 100 - i)),
      stamp("s1", 1),
    ]);
    const list = parseRecentEntities(raw);
    assert.deepEqual(
      list.map((e) => e.id),
      [...Array.from({ length: RECENT_ENTITY_GROUP_LIMIT }, (_, i) => `o${i}`), "s1"]
    );
  });
});
