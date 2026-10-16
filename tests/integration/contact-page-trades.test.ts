import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createTrade } from "../../src/lib/trades";
import { getContactPage } from "../../src/lib/contact-page";

// A contact page's trades section (#1710), read back out of Prisma: what it values each way, in the
// collector's own valuation, with a cancelled trade counted but not valued. The page's platform
// section went with #1955 (ADR-0071) — a marketplace is a platform, not a contact, and its figures
// belong on the platform's own page — so a platform's id opens no contact page at all.

const TS = Date.now();
const TODAY = "2026-10-09";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("contact page — trades (#1710)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  /** A role-less partner with three trades. */
  let partnerId: string;
  /** Not a partner, and nothing recorded. */
  let plainId: string;

  before(async () => {
    userId = `test-user-contactpagept-${TS}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-contactpagept-${TS}`, name: "Contact page", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Unpriced" } })).id;

    platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformModule: "allegro" },
      })
    ).id;
    partnerId = (await prisma.contact.create({ data: { collectionId, name: "Partner" } })).id;
    plainId = (await prisma.contact.create({ data: { collectionId, name: "Plain" } })).id;

    // ── Trades with the partner ────────────────────────────────────────────────────────────────
    const trade = async (status: string, createdAt: string) => {
      const t = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
      await prisma.trade.update({ where: { id: t.id }, data: { status, createdAt: day(createdAt) } });
      return { tradeId: t.id, sectionId: t.sections[0].id };
    };
    const give = async (ids: { tradeId: string; sectionId: string }, manualValue: string | null) => {
      const item = await createItem(userId, collectionId, { stampId, conditionId });
      await prisma.tradeLine.create({
        data: { ...ids, side: "give", itemId: item.id, manualValue },
      });
    };
    const receive = (
      ids: { tradeId: string; sectionId: string },
      quantity: number,
      manualValue: string | null
    ) =>
      prisma.tradeLine.create({
        data: { ...ids, side: "receive", stampId, conditionId, quantity, manualValue },
      });

    // This year, being prepared: 10 out, two pieces at 4 in.
    const t1 = await trade("preparing", "2026-02-01");
    await give(t1, "10.00");
    await receive(t1, 2, "4.00");
    // This year, cancelled: counted and listed, never valued.
    const t2 = await trade("cancelled", "2026-04-01");
    await give(t2, "100.00");
    // Last year, shared: 5 out, and a piece in that nothing values.
    const t3 = await trade("shared", "2025-06-01");
    await give(t3, "5.00");
    await receive(t3, 1, null);
  });

  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("opens no contact page for a platform — a marketplace is no contact (#1955)", async () => {
    assert.equal(await getContactPage(userId, platformId, "all", TODAY), null);
  });

  it("shows a role-less partner's trades, valued in the collector's own valuation", async () => {
    const page = (await getContactPage(userId, partnerId, "year", TODAY))!;
    const t = page.trades!;
    assert.equal(t.count, 2);
    assert.equal(t.openCount, 1);
    // The cancelled trade's 100 is not in it.
    assert.deepEqual(t.given, { total: "10.00", missingLines: 0 });
    assert.deepEqual(t.received, { total: "8.00", missingLines: 0 });
    assert.deepEqual(
      t.rows.map((r) => [r.createdAt, r.status, r.givePieces, r.receivePieces, r.ownGiven, r.ownReceived]),
      [
        ["2026-04-01", "cancelled", 1, 0, null, null],
        ["2026-02-01", "preparing", 1, 2, 10, 8],
      ]
    );
  });

  it("counts a line with no value as missing rather than as zero", async () => {
    const t = (await getContactPage(userId, partnerId, "all", TODAY))!.trades!;
    assert.equal(t.count, 3);
    assert.equal(t.openCount, 2);
    assert.deepEqual(t.given, { total: "15.00", missingLines: 0 });
    assert.deepEqual(t.received, { total: "8.00", missingLines: 1 });
    assert.equal(t.rows[2].ownMissing, 1);
  });

  it("shows no trades section for a contact that is no partner, with nothing recorded", async () => {
    const page = (await getContactPage(userId, plainId, "all", TODAY))!;
    assert.equal(page.trades, null);
  });
});
