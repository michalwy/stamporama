import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getPhoneCollectionId, rememberPhoneCollection } from "../../src/lib/phone-collection";
import { phoneStart } from "../../src/lib/phone";
import { getCollectionsByOwner } from "../../src/lib/collections";

// The collection the phone opens on its next start (#2574): remembered for the account when a phone
// screen of it is opened, never for someone else's collection, and forgotten once it is deleted — so
// the next start shows the list. Where `/phone` goes with it is `tests/unit/phone.test.ts`.

describe("the collection the phone opens (#2574)", () => {
  const ts = Date.now();
  const userId = `test-user-phone-col-${ts}`;
  const otherId = `test-user-phone-col-other-${ts}`;
  let poland: { id: string; slug: string };
  let topicals: { id: string; slug: string };
  let othersSlug: string;

  async function user(id: string) {
    await prisma.user.create({
      data: {
        id,
        name: `Test User ${id}`,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async function start() {
    return phoneStart(await getCollectionsByOwner(userId), await getPhoneCollectionId(userId));
  }

  before(async () => {
    await user(userId);
    await user(otherId);
    const select = { id: true, slug: true } as const;
    poland = await prisma.collection.create({
      data: { slug: `polska-${ts}`, name: "Polska", baseCurrency: "PLN", ownerId: userId },
      select,
    });
    topicals = await prisma.collection.create({
      data: { slug: `topicals-${ts}`, name: "Topicals", baseCurrency: "PLN", ownerId: userId },
      select,
    });
    await prisma.collection.create({
      data: { slug: `classics-${ts}`, name: "Classics", baseCurrency: "PLN", ownerId: userId },
      select,
    });
    othersSlug = (
      await prisma.collection.create({
        data: { slug: `others-${ts}`, name: "Others", baseCurrency: "PLN", ownerId: otherId },
        select,
      })
    ).slug;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("offers the list before any collection was opened on the phone", async () => {
    assert.equal(await getPhoneCollectionId(userId), null);
    assert.deepEqual(await start(), { kind: "choose" });
  });

  it("opens the collection last opened on the phone", async () => {
    await rememberPhoneCollection(userId, poland.slug);
    assert.deepEqual(await start(), { kind: "collection", href: `/c/${poland.slug}/phone` });

    await rememberPhoneCollection(userId, topicals.slug);
    assert.deepEqual(await start(), { kind: "collection", href: `/c/${topicals.slug}/phone` });
  });

  it("never remembers a collection that is not the collector's", async () => {
    await rememberPhoneCollection(userId, othersSlug);
    assert.equal(await getPhoneCollectionId(userId), topicals.id);
  });

  it("offers the list again once the remembered collection is deleted", async () => {
    await prisma.collection.delete({ where: { id: topicals.id } });
    assert.equal(await getPhoneCollectionId(userId), null);
    assert.deepEqual(await start(), { kind: "choose" });
  });
});
