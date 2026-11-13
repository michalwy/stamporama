import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listSidebarPins,
  pinToSidebar,
  refreshSidebarPin,
  reorderSidebarPins,
  SidebarPinInvalidError,
  unpinFromSidebar,
} from "../../src/lib/sidebar-pins";

// The Pinned section of the sidebar (#2504) — the server half: pins are collection data, scoped and
// owner-checked, kept in the order dragged into, and a pinned record deleted since is left out.

const ts = Date.now();

describe("sidebar pins (#2504)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;

  before(async () => {
    userId = `test-user-sidebarpin-${ts}`;
    otherUserId = `test-user-sidebarpin-other-${ts}`;
    for (const [id, tag] of [
      [userId, "sidebarpin"],
      [otherUserId, "sidebarpin-other"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${tag}-${ts}`,
          email: `test-${tag}-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sidebarpin-${ts}`, name: "Pins", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-sidebarpin-2-${ts}`, name: "Pins 2", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const screen = (path: string) => ({ kind: "screen", target: path, href: path });

  it("starts empty, pins screens in order and unpins them", async () => {
    assert.deepEqual(await listSidebarPins(userId, collectionId), []);
    await pinToSidebar(userId, collectionId, screen("/offers/prepare"));
    await pinToSidebar(userId, collectionId, screen("/offers/posts"));
    assert.deepEqual(
      (await listSidebarPins(userId, collectionId)).map((p) => [p.kind, p.target, p.label]),
      [
        ["screen", "/offers/prepare", null],
        ["screen", "/offers/posts", null],
      ]
    );
    // Pinning again keeps one pin, in its place.
    await pinToSidebar(userId, collectionId, screen("/offers/prepare"));
    assert.equal((await listSidebarPins(userId, collectionId)).length, 2);

    await unpinFromSidebar(userId, collectionId, "screen", "/offers/prepare");
    assert.deepEqual(
      (await listSidebarPins(userId, collectionId)).map((p) => p.target),
      ["/offers/posts"]
    );
    await unpinFromSidebar(userId, collectionId, "screen", "/offers/posts");
  });

  it("pins a record by the name its screen gives it, and keeps that name in step", async () => {
    const contact = await prisma.contact.create({ data: { collectionId, name: "Klaser dealer" } });
    await pinToSidebar(userId, collectionId, {
      kind: "contact",
      target: contact.id,
      href: `/contacts/${contact.id}`,
      label: "Klaser dealer",
    });
    let [pin] = await listSidebarPins(userId, collectionId);
    assert.equal(pin.label, "Klaser dealer");
    assert.equal(pin.href, `/contacts/${contact.id}`);

    await refreshSidebarPin(userId, collectionId, {
      kind: "contact",
      target: contact.id,
      href: `/contacts/${contact.id}`,
      label: "Klaser dealer (Kraków)",
    });
    [pin] = await listSidebarPins(userId, collectionId);
    assert.equal(pin.label, "Klaser dealer (Kraków)");

    // A deleted record leaves Pinned by itself.
    await prisma.contact.delete({ where: { id: contact.id } });
    assert.deepEqual(await listSidebarPins(userId, collectionId), []);
    await prisma.sidebarPin.deleteMany({ where: { collectionId } });
  });

  it("reorders by the ids given", async () => {
    for (const path of ["/offers", "/sales", "/purchases"]) {
      await pinToSidebar(userId, collectionId, screen(path));
    }
    const ids = (await listSidebarPins(userId, collectionId)).map((p) => p.id);
    await reorderSidebarPins(userId, collectionId, [ids[2], ids[0], ids[1]]);
    assert.deepEqual(
      (await listSidebarPins(userId, collectionId)).map((p) => p.target),
      ["/purchases", "/offers", "/sales"]
    );
    // A new pin goes last.
    await pinToSidebar(userId, collectionId, screen("/wants"));
    assert.equal((await listSidebarPins(userId, collectionId)).at(-1)?.target, "/wants");
    await prisma.sidebarPin.deleteMany({ where: { collectionId } });
  });

  it("refuses what cannot be pinned", async () => {
    const elsewhere = await prisma.contact.create({
      data: { collectionId: otherCollectionId, name: "Not here" },
    });
    await assert.rejects(
      pinToSidebar(userId, collectionId, {
        kind: "contact",
        target: elsewhere.id,
        href: `/contacts/${elsewhere.id}`,
        label: "Not here",
      }),
      SidebarPinInvalidError
    );
    await assert.rejects(
      pinToSidebar(userId, collectionId, { kind: "stamp", target: "x", href: "/stamps/x" }),
      SidebarPinInvalidError
    );
    await assert.rejects(
      pinToSidebar(userId, collectionId, { kind: "screen", target: "//evil", href: "//evil" }),
      SidebarPinInvalidError
    );
    await assert.rejects(pinToSidebar(otherUserId, collectionId, screen("/offers")));
    await assert.rejects(listSidebarPins(otherUserId, collectionId));
  });
});
