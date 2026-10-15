import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  countItems,
  createItem,
  getHoldingsValuation,
  listIssueGroupCompleteness,
  listItemDuplicateGroups,
  listItemLocationGroups,
  listItemsPaginated,
  type ItemListFiltersPaginated,
} from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import type { CopyGroupAxes } from "../../src/lib/copy-groups";
import type { HeldFilter } from "../../src/lib/held-filter";

// The Copies list's *Held* filter (#1932): the `×N` duplicate grouping draws, as a narrowing — counted
// by the grouping's own key, under its *Split by …* switches, over the copies every other filter
// lets through.
//
// One collection, two conditions (MNH, MH), a pair format, two locations (Box, Album):
//
//   - **A** — MNH single in the Box, MNH single in the Album, MH pair in the Box. ×3 whole; split by
//     condition MNH ×2 · MH ×1; split by format single ×2 · pair ×1.
//   - **B** — one MNH single in the Box, and a **disposed** MNH single, which no stack counts.
//   - **C** — MH single and MH pair, both in the Box: ×2 whole, two singles split by format.
//   - **D** — an MNH single in the Album, and a copy whose candidates span variant trees, filed
//     under D in the Box: ×2 in the grouping, though a read pinned to D leaves that copy out.
//   - a **carrier** of A and B, in the Box: in no stack, so kept only by *Any*.
//
// A and B are the two stamps of the issue **Pair**, whose checklist lists both.

const ts = Date.now();

const AXES: CopyGroupAxes[] = [false, true].flatMap((condition) =>
  [false, true].flatMap((format) =>
    [false, true].map((certificate) => ({ condition, format, certificate }))
  )
);

describe("the Held filter on the Copies list (#1932)", () => {
  let userId: string;
  let collectionId: string;
  let mnh: string, mh: string, pair: string;
  let boxId: string, albumId: string;
  let pairIssueId: string;
  const stamp: Record<string, string> = {};
  const copy: Record<string, string> = {};

  before(async () => {
    userId = `test-user-heldfilter-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User heldfilter-${ts}`,
        email: `test-heldfilter-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-heldfilter-${ts}`, name: "Stacks", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    mnh = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    mh = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint hinged", abbreviation: "MH", sortOrder: 1 },
      })
    ).id;
    pair = (
      await prisma.stampFormat.create({ data: { collectionId, name: "Pair", abbreviation: "pr", sortOrder: 1 } })
    ).id;
    boxId = (await prisma.location.create({ data: { collectionId, name: "Box", assignable: true } })).id;
    albumId = (await prisma.location.create({ data: { collectionId, name: "Album", assignable: true } })).id;

    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    for (const name of ["A", "B", "C", "D"]) {
      stamp[name] = (await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1970 } })).id;
    }
    pairIssueId = (
      await prisma.issue.create({
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9900, collectionAreaId: areaId, name: "Pair", year: 1970 },
      })
    ).id;
    await prisma.issueMember.createMany({
      data: [
        { issueId: pairIssueId, stampId: stamp.A, sortOrder: 0 },
        { issueId: pairIssueId, stampId: stamp.B, sortOrder: 1 },
      ],
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: pairIssueId,
        name: "Basic",
        sortOrder: 0,
        stamps: { create: [{ stampId: stamp.A }, { stampId: stamp.B }] },
      },
    });

    const add = async (
      key: string,
      name: string,
      conditionId: string,
      locationId: string,
      formatId?: string
    ) => {
      copy[key] = (
        await createItem(userId, collectionId, { stampId: stamp[name], conditionId, locationId, formatId })
      ).id;
    };
    await add("a1", "A", mnh, boxId);
    await add("a2", "A", mnh, albumId);
    await add("a3", "A", mh, boxId, pair);
    await add("b1", "B", mnh, boxId);
    await add("bGone", "B", mnh, boxId);
    await prisma.item.update({
      where: { id: copy.bGone },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });
    await add("c1", "C", mh, boxId);
    await add("c2", "C", mh, boxId, pair);
    await add("d1", "D", mnh, albumId);
    await add("dMaybe", "D", mnh, boxId);
    // The counts read only `candidateTrees` and the pointer (ADR-0065), so this is the whole of it.
    await prisma.item.update({ where: { id: copy.dMaybe }, data: { candidateTrees: 2 } });
    await add("carrier", "A", mnh, boxId);
    await setItemStamps(userId, copy.carrier, [{ stampId: stamp.A }, { stampId: stamp.B }]);
  });

  after(async () => {
    await prisma.itemStamp.deleteMany({ where: { item: { collectionId } } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.location.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const listed = async (filters: ItemListFiltersPaginated) =>
    (await listItemsPaginated(userId, collectionId, filters)).items.map((i) => i.id).sort();
  const copiesOf = (...keys: string[]) => keys.map((k) => copy[k]).sort();
  const stacks = async (filters: ItemListFiltersPaginated, axes: CopyGroupAxes) =>
    (await listItemDuplicateGroups(userId, collectionId, { ...filters, axes, pageSize: 100 })).groups
      .map((g) => `${g.key} ×${g.count}`)
      .sort();

  it("keeps every copy while it is off", async () => {
    assert.deepEqual(
      await listed({}),
      copiesOf("a1", "a2", "a3", "b1", "c1", "c2", "d1", "dMaybe", "carrier")
    );
  });

  it("ungrouped, keeps the copies of the stamps held more than once — or once", async () => {
    assert.deepEqual(
      await listed({ held: "several" }),
      copiesOf("a1", "a2", "a3", "c1", "c2", "d1", "dMaybe"),
      "the disposed copy of B does not make B a stack of two, and the carrier is in no stack"
    );
    assert.deepEqual(await listed({ held: "once" }), copiesOf("b1"));
  });

  it("keeps exactly the stacks of 2+ — or of 1 — under every split and every other filter", async () => {
    const others: [string, ItemListFiltersPaginated][] = [
      ["none", {}],
      ["Box", { locationId: boxId }],
      ["Album", { locationId: albumId }],
      ["MNH", { conditionIds: [mnh] }],
      ["MH", { conditionIds: [mh] }],
      ["no longer held too", { includeDisposed: true }],
      ["Box, MNH", { locationId: boxId, conditionIds: [mnh] }],
    ];
    for (const [label, base] of others) {
      for (const axes of AXES) {
        const shown = (await listItemDuplicateGroups(userId, collectionId, { ...base, axes, pageSize: 100 })).groups;
        for (const held of ["once", "several"] as HeldFilter[]) {
          const expected = shown
            .filter((g) => (held === "once" ? g.count === 1 : g.count >= 2))
            .map((g) => `${g.key} ×${g.count}`)
            .sort();
          const context = `${label}, ${JSON.stringify(axes)}, ${held}`;
          assert.deepEqual(await stacks({ ...base, held, heldAxes: axes }, axes), expected, context);
        }
      }
    }
  });

  it("splits its stacks by the switches the grouping is split by", async () => {
    const byCondition = { condition: true, format: false, certificate: false };
    assert.deepEqual(
      await listed({ held: "several", heldAxes: byCondition }),
      copiesOf("a1", "a2", "c1", "c2", "d1", "dMaybe"),
      "A's MH pair is a stack of its own"
    );
    const byFormat = { condition: false, format: true, certificate: false };
    assert.deepEqual(await listed({ held: "several", heldAxes: byFormat }), copiesOf("a1", "a2", "d1", "dMaybe"));
    assert.deepEqual(await listed({ held: "once", heldAxes: byFormat }), copiesOf("a3", "b1", "c1", "c2"));
  });

  it("leaves the pieces carrying several stamps to *Any* alone", async () => {
    const { multiStampGroup } = await listItemDuplicateGroups(userId, collectionId, { held: "several" });
    assert.equal(multiStampGroup, null);
    assert.equal(await countItems(userId, collectionId, { multiStamp: "only", held: "once" }), 0);
  });

  it("keeps what the list kept when a group's members are read over the list's own filters", async () => {
    const list: ItemListFiltersPaginated = { held: "several" };
    // D's group: the pinned stamp leaves out the copy filed under D across trees, so counted over
    // the members alone D would be a single and its group would open empty.
    const dMembers = { ...list, stampId: stamp.D, multiStamp: "exclude" as const };
    assert.deepEqual(await listed(dMembers), []);
    assert.deepEqual(await listed({ ...dMembers, heldScope: list }), copiesOf("d1"));
    // The Album's filing group: A is held once there and twice elsewhere — still held three times.
    const { groups } = await listItemLocationGroups(userId, collectionId, list);
    assert.equal(groups.find((g) => g.locationId === albumId)?.count, 2);
    const albumMembers = { ...list, locationId: albumId, locationExact: true, heldScope: list };
    assert.deepEqual(await listed(albumMembers), copiesOf("a2", "d1"));
  });

  it("totals the copies of the kept stacks, a disposed one with its stamp's stack", async () => {
    const once = await getHoldingsValuation(userId, collectionId, { held: "once" });
    assert.equal(once.writeOff.count, 1, "B is held once, and its lost copy is written off beside it");
    const several = await getHoldingsValuation(userId, collectionId, { held: "several" });
    assert.equal(several.writeOff.count, 0);
  });

  it("composes with Complete: the series held whole, each stamp more than once", async () => {
    // Pair is complete — A and B both held — but B only once, so not complete in duplicate.
    assert.deepEqual(await listed({ complete: "any" }), copiesOf("a1", "a2", "a3", "b1"));
    assert.deepEqual(await listed({ complete: "any", held: "several" }), []);
    assert.deepEqual(await listed({ complete: "incomplete", held: "several" }), copiesOf("a1", "a2", "a3"));
    // The chips count under *Held* too, so they say why: 1/2 in duplicate.
    const chips = await listIssueGroupCompleteness(userId, collectionId, [pairIssueId], {
      complete: "incomplete",
      held: "several",
    });
    assert.deepEqual([chips[pairIssueId][0].owned, chips[pairIssueId][0].requiredCount], [1, 2]);
  });
});
