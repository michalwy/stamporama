import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import { listStampsPaginated, searchStampsForPicker } from "../../src/lib/stamps";
import { listIssuesPaginated } from "../../src/lib/issues";

// #2529: a catalogue-number search looks only in the catalogues ticked beside it. With Michel and
// Fischer ticked, `200` finds the Mi 200 and the Fi 200 and not the Scott 200 — on the Stamps list,
// on the Copies list and in the stamp picker alike; `Sc 200` typed still finds the Scott 200; and
// with every catalogue ticked every search finds what it always found.

describe("the catalogues a number is searched in (#2529)", () => {
  const ts = Date.now();
  let userId: string;
  let collectionId: string;
  const vendor: Record<"mi" | "fi" | "sc", string> = { mi: "", fi: "", sc: "" };
  const stamp: Record<"mi" | "fi" | "sc", string> = { mi: "", fi: "", sc: "" };
  const copy: Record<"mi" | "fi" | "sc", string> = { mi: "", fi: "", sc: "" };
  const issue: Record<"mi" | "fi" | "sc", string> = { mi: "", fi: "", sc: "" };

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-catscope-${ts}`,
          name: "Catalogue scope",
          email: `test-catscope-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-catscope-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
      })
    ).id;
    const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
    const names = { mi: ["Michel", "Mi"], fi: ["Fischer", "Fi"], sc: ["Scott", "Sc"] } as const;
    for (const key of ["mi", "fi", "sc"] as const) {
      vendor[key] = (
        await prisma.catalogVendor.create({
          data: { collectionId, name: names[key][0], abbreviation: names[key][1] },
        })
      ).id;
      // Each stamp in an issue of its own, so the Issues list answers one row per catalogue.
      issue[key] = (
        await prisma.issue.create({
          data: { collectionId, collectionAreaId: area.id, issueNo: Object.keys(issue).indexOf(key) + 1, name: `Issue ${key}` },
        })
      ).id;
      stamp[key] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${key}`,
            catalogNumbers: { create: [{ catalogVendorId: vendor[key], number: "200" }] },
            issueMemberships: { create: [{ issueId: issue[key] }] },
          },
        })
      ).id;
      copy[key] = (await createItem(userId, collectionId, { stampId: stamp[key], conditionId })).id;
    }
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const sorted = (ids: string[]) => [...ids].sort();
  const miFi = () => [vendor.mi, vendor.fi];

  it("narrows the Stamps list's catalogue box and search box to the ticked catalogues", async () => {
    const box = await listStampsPaginated(userId, collectionId, {
      catalogNumber: "200",
      catalogScope: miFi(),
    });
    assert.deepEqual(sorted(box.items.map((s) => s.id)), sorted([stamp.mi, stamp.fi]));
    const search = await listStampsPaginated(userId, collectionId, {
      search: "200",
      catalogScope: miFi(),
    });
    assert.deepEqual(sorted(search.items.map((s) => s.id)), sorted([stamp.mi, stamp.fi]));
  });

  it("lets a typed prefix win on the Stamps list — Sc 200 with Scott unticked", async () => {
    const box = await listStampsPaginated(userId, collectionId, {
      catalogVendorId: vendor.sc,
      catalogNumber: "200",
      catalogScope: miFi(),
    });
    assert.deepEqual(box.items.map((s) => s.id), [stamp.sc]);
  });

  it("narrows the Copies list's search", async () => {
    const page = await listItemsPaginated(userId, collectionId, {
      search: "200",
      catalogNumber: "200",
      catalogScope: miFi(),
    });
    assert.deepEqual(sorted(page.items.map((i) => i.id)), sorted([copy.mi, copy.fi]));
    const prefixed = await listItemsPaginated(userId, collectionId, {
      search: "Sc 200",
      catalogVendorId: vendor.sc,
      catalogNumber: "200",
      catalogScope: miFi(),
    });
    assert.deepEqual(prefixed.items.map((i) => i.id), [copy.sc]);
  });

  it("narrows the stamp picker, and a typed prefix still wins", async () => {
    const hits = await searchStampsForPicker(userId, collectionId, "200", { catalogScope: miFi() });
    assert.deepEqual(sorted(hits.map((h) => h.stampId)), sorted([stamp.mi, stamp.fi]));
    const sc = await searchStampsForPicker(userId, collectionId, "Sc 200", { catalogScope: miFi() });
    assert.deepEqual(sc.map((h) => h.stampId), [stamp.sc]);
  });

  it("narrows the Issues list's catalogue box", async () => {
    const page = await listIssuesPaginated(userId, collectionId, {
      catalogNumber: "200",
      catalogScope: miFi(),
    });
    assert.deepEqual(sorted(page.items.map((i) => i.id)), sorted([issue.mi, issue.fi]));
  });

  it("finds what it always found with every catalogue ticked", async () => {
    const all = sorted([stamp.mi, stamp.fi, stamp.sc]);
    const box = await listStampsPaginated(userId, collectionId, { catalogNumber: "200" });
    assert.deepEqual(sorted(box.items.map((s) => s.id)), all);
    const hits = await searchStampsForPicker(userId, collectionId, "200");
    assert.deepEqual(sorted(hits.map((h) => h.stampId)), all);
    const copies = await listItemsPaginated(userId, collectionId, { search: "200", catalogNumber: "200" });
    assert.deepEqual(sorted(copies.items.map((i) => i.id)), sorted([copy.mi, copy.fi, copy.sc]));
  });
});
