import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getDashboardSection } from "../../src/lib/dashboard";
import {
  countTrades,
  createTrade,
  listTradesPaginated,
  setTradeShipping,
  setTradeStatus,
} from "../../src/lib/trades";

// The dashboard's Trades section (#1813): agreed trades waiting on a parcel, read through the trades
// list's own `shipping` filter, and the `agreedAt` moment the *To send* group measures from.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
}

async function seed(suffix: string): Promise<Fixtures> {
  const user = await prisma.user.create({
    data: {
      id: `test-user-dash-trades-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-dash-trades-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-dash-trades-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId: user.id },
  });
  const partner = await prisma.contact.create({
    data: { collectionId: collection.id, name: `Karel ${suffix}`, exchangePartner: true },
  });
  return { userId: user.id, collectionId: collection.id, partnerId: partner.id };
}

async function cleanup(userId: string) {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function agreedTrade(f: Fixtures): Promise<string> {
  const { id } = await createTrade(f.userId, f.collectionId, { partnerId: f.partnerId, currency: "EUR" });
  await setTradeStatus(f.userId, id, "shared");
  await setTradeStatus(f.userId, id, "agreed");
  return id;
}

async function agreedAtOf(id: string): Promise<Date | null> {
  return (await prisma.trade.findUniqueOrThrow({ where: { id }, select: { agreedAt: true } })).agreedAt;
}

describe("Trade.agreedAt (#1813)", () => {
  let f: Fixtures;
  before(async () => {
    f = await seed(`agreed-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("is stamped on agreeing, cleared on reopening, and kept through closing", async () => {
    const id = await agreedTrade(f);
    assert.ok(await agreedAtOf(id));

    await setTradeStatus(f.userId, id, "shared");
    assert.equal(await agreedAtOf(id), null);

    await setTradeStatus(f.userId, id, "agreed");
    const agreedAt = await agreedAtOf(id);
    assert.ok(agreedAt);

    await setTradeShipping(f.userId, id, { sentAt: new Date(), receivedAt: new Date() });
    await setTradeStatus(f.userId, id, "closed");
    assert.deepEqual(await agreedAtOf(id), agreedAt);
  });

  it("is never stamped on a trade that was not agreed", async () => {
    const { id } = await createTrade(f.userId, f.collectionId, { partnerId: f.partnerId, currency: "EUR" });
    await setTradeStatus(f.userId, id, "shared");
    await setTradeStatus(f.userId, id, "cancelled");
    assert.equal(await agreedAtOf(id), null);
  });
});

describe("the dashboard's Trades section (#1813)", () => {
  let f: Fixtures;
  const ids: Record<string, string> = {};
  before(async () => {
    f = await seed(`section-${Date.now()}`);
    // Composing: on neither list.
    await createTrade(f.userId, f.collectionId, { partnerId: f.partnerId, currency: "EUR" });
    // To send, two of them — the older agreement first whatever order they were made in.
    ids.newerToSend = await agreedTrade(f);
    ids.olderToSend = await agreedTrade(f);
    await prisma.trade.update({ where: { id: ids.olderToSend }, data: { agreedAt: new Date("2026-09-01") } });
    await prisma.trade.update({ where: { id: ids.newerToSend }, data: { agreedAt: new Date("2026-10-01") } });
    // The partner's parcel came first: the collector still owes theirs.
    ids.receivedFirst = await agreedTrade(f);
    await prisma.trade.update({ where: { id: ids.receivedFirst }, data: { agreedAt: new Date("2026-10-05") } });
    await setTradeShipping(f.userId, ids.receivedFirst, { receivedAt: new Date("2026-10-06") });
    // Waiting for the partner.
    ids.waiting = await agreedTrade(f);
    await setTradeShipping(f.userId, ids.waiting, { sentAt: new Date("2026-10-03") });
    // Both parcels accounted for: waits on closing, not the post.
    ids.settled = await agreedTrade(f);
    await setTradeShipping(f.userId, ids.settled, { sentAt: new Date(), receivedAt: new Date() });
  });
  after(() => cleanup(f.userId));

  it("lists To send and Waiting for the partner, longest waiting first, each row opening its trade", async () => {
    const section = await getDashboardSection(f.userId, f.collectionId, "trades");
    assert.deepEqual(
      section.groups.map((g) => [g.id, g.count]),
      [
        ["trades-to-send", 3],
        ["trades-awaiting-partner", 1],
      ]
    );

    const [toSend, waiting] = section.groups;
    assert.deepEqual(
      toSend.items.map((i) => i.key),
      [ids.olderToSend, ids.newerToSend, ids.receivedFirst]
    );
    assert.equal(toSend.items[0].at, new Date("2026-09-01").toISOString());
    assert.equal(toSend.items[0].href, `trades/${ids.olderToSend}`);
    assert.match(toSend.items[0].label, /^Karel/);
    assert.match(toSend.items[0].detail ?? "", /^#\d+ · I give 0 · I receive 0$/);

    assert.deepEqual(waiting.items.map((i) => i.key), [ids.waiting]);
    assert.equal(waiting.items[0].at, new Date("2026-10-03").toISOString());
  });

  it("counts exactly what its group's link opens on the trades list", async () => {
    const section = await getDashboardSection(f.userId, f.collectionId, "trades");
    for (const group of section.groups) {
      const stage = new URLSearchParams(group.href.split("?")[1]).get("shipping");
      assert.ok(stage === "to-send" || stage === "awaiting-partner");
      const listed = await listTradesPaginated(f.userId, f.collectionId, { shipping: stage });
      assert.deepEqual(
        listed.items.map((t) => t.id).sort(),
        group.items.map((i) => i.key).sort()
      );
      assert.equal(await countTrades(f.userId, f.collectionId, { shipping: stage }), group.count);
    }
  });

  it("keeps both groups at zero on a collection with nothing waiting", async () => {
    const empty = await seed(`empty-${Date.now()}`);
    try {
      const section = await getDashboardSection(empty.userId, empty.collectionId, "trades");
      assert.deepEqual(
        section.groups.map((g) => [g.title, g.count, g.items.length]),
        [
          ["To send", 0, 0],
          ["Waiting for the partner", 0, 0],
        ]
      );
    } finally {
      await cleanup(empty.userId);
    }
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(() => getDashboardSection("someone-else", f.collectionId, "trades"));
  });
});
