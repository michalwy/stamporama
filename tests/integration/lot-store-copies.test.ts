import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createLot,
  intakeStamps,
  bulkUpdateLotItems,
  bulkUpdateLotItemsScoped,
  countLotBulkScope,
  readLotBulkScope,
} from "../../src/lib/lots";
import { createPurchase, setPurchaseStatus } from "../../src/lib/purchases";
import { getLocationRefUsage } from "../../src/lib/locations";

// Storing sorted copies in one action (#565/#571): a location, an optional in-location ref, a
// disposition and `delivered`, written together. The things pinned here are the ones a collector
// cannot see going wrong until the box is already full — that the ref lands beside the location it
// belongs to, that the counter belongs to the **location** rather than to a lot (the box is shared
// across every purchase), that a selection means what the server resolves and not the rows that
// happened to be loaded, and that storing a batch with *no* location chosen leaves the filings made
// copy by copy standing.

describe("storing sorted copies (#565/#571)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let boxId: string;
  let albumId: string;
  let chopinIssueId: string;
  let sportIssueId: string;
  /** Stamps belonging to each issue, so a copy can be intaken straight into a group. */
  const issueStampId: Record<string, string> = {};

  /** An arrived order with one lot, so its copies are created `to_sort` — the work unit here. */
  async function arrivedLot(): Promise<string> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await setPurchaseStatus(userId, purchase.id, "arrived");
    return createLot(userId, purchase.id, 10);
  }

  async function addCopies(lotId: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [copy] = await intakeStamps(userId, lotId, { stampId, conditionId });
      ids.push(copy.itemId);
    }
    return ids;
  }

  /** Copies of the stamp that belongs to `issueId` — an issue group with `count` copies in it. */
  async function addIssueCopies(
    lotId: string,
    issueId: string,
    count: number
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [copy] = await intakeStamps(userId, lotId, {
        stampId: issueStampId[issueId],
        conditionId,
      });
      ids.push(copy.itemId);
    }
    return ids;
  }

  async function readCopies(ids: string[]) {
    return prisma.item.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        locationId: true,
        locationRef: true,
        deliveryState: true,
        inCollection: true,
        forSale: true,
      },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-store-copies-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User store-copies-${ts}`,
        email: `test-store-copies-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-store-copies-${ts}`,
        name: `Collection store-copies-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } });
    stampId = stamp.id;

    // Two issue groups, so a selection can name one whole group and leave the other standing.
    const areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    for (const [key, name] of [
      ["chopin", "Chopin"],
      ["sport", "Sport"],
    ] as const) {
      const issue = await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: {
          collectionId,
          issueNo: key === "chopin" ? 9101 : 9102,
          collectionAreaId: areaId,
          name,
        },
      });
      const member = await prisma.stamp.create({
        data: { collectionId, name: `${name} stamp` },
      });
      await prisma.issueMember.create({ data: { issueId: issue.id, stampId: member.id } });
      issueStampId[issue.id] = member.id;
      if (key === "chopin") chopinIssueId = issue.id;
      else sportIssueId = issue.id;
    }

    const box = await prisma.location.create({
      data: { collectionId, name: "Stock box", assignable: true },
    });
    boxId = box.id;
    const album = await prisma.location.create({
      data: { collectionId, name: "Album", assignable: true },
    });
    albumId = album.id;
  });

  it("stores a selection into a location under a ref and marks it delivered", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 3);
    // A copy already carrying a disposition, to pin that filing leaves it standing: the work unit
    // is `to sort` whatever the copy is destined for.
    await prisma.item.update({ where: { id: ids[0] }, data: { forSale: true } });

    const result = await bulkUpdateLotItems(userId, ids, {
      markSorted: true,
      keepDisposition: true,
      locationId: boxId,
      locationRef: "A147",
    });
    assert.equal(result.count, 3);

    const copies = await readCopies(ids);
    for (const copy of copies) {
      assert.equal(copy.locationId, boxId);
      assert.equal(copy.locationRef, "A147");
      assert.equal(copy.deliveryState, "delivered");
    }
    assert.equal(copies.find((c) => c.id === ids[0])!.forSale, true);
    assert.equal(copies.find((c) => c.id === ids[1])!.forSale, false);
    // No disposition was written, so nothing was pushed into the collection either.
    assert.equal(copies.every((c) => c.inCollection === false), true);
  });

  it("stores into an album with no ref at all", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 2);

    await bulkUpdateLotItems(userId, ids, {
      markSorted: true,
      keepDisposition: true,
      locationId: albumId,
      locationRef: "",
    });

    for (const copy of await readCopies(ids)) {
      assert.equal(copy.locationId, albumId);
      assert.equal(copy.locationRef, null);
      assert.equal(copy.deliveryState, "delivered");
    }
  });

  it("refuses a ref with no location to sit in", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 1);
    await assert.rejects(
      () => bulkUpdateLotItems(userId, ids, { markSorted: true, locationRef: "A1" }),
      /location is needed/i
    );
  });

  it("clears the ref along with the location", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 1);
    await bulkUpdateLotItems(userId, ids, { locationId: boxId, locationRef: "A900" });

    await bulkUpdateLotItems(userId, ids, { locationId: null });
    const [copy] = await readCopies(ids);
    assert.equal(copy.locationId, null);
    assert.equal(copy.locationRef, null);
  });

  it("counts the refs a location holds, the card it is up to, and the next one", async () => {
    const location = await prisma.location.create({
      data: { collectionId, name: `Counter box ${Date.now()}`, assignable: true },
    });
    const lotId = await arrivedLot();
    const first = await addCopies(lotId, 2);
    await bulkUpdateLotItems(userId, first, { locationId: location.id, locationRef: "A10" });

    const afterFirst = await getLocationRefUsage(userId, collectionId, location.id);
    assert.deepEqual(afterFirst.refs, [{ ref: "A10", count: 2 }]);
    // The card being packed is what the Store dialog opens on (#629); the next free one is what
    // its explicit action and the blank-cards sheet ask for.
    assert.equal(afterFirst.highest, "A10");
    assert.equal(afterFirst.suggestion, "A11");

    // The counter belongs to the **location**, not the lot: a second purchase filing into the same
    // box continues the strip rather than starting its own.
    const otherLotId = await arrivedLot();
    const second = await addCopies(otherLotId, 1);
    await bulkUpdateLotItems(userId, second, { locationId: location.id, locationRef: "A11" });

    const afterSecond = await getLocationRefUsage(userId, collectionId, location.id);
    assert.deepEqual(afterSecond.refs, [
      { ref: "A10", count: 2 },
      { ref: "A11", count: 1 },
    ]);
    assert.equal(afterSecond.highest, "A11");
    assert.equal(afterSecond.suggestion, "A12");

    // Topping the same card up is the ordinary path, and the count is what the dialog confirms on.
    const third = await addCopies(otherLotId, 3);
    await bulkUpdateLotItems(userId, third, { locationId: location.id, locationRef: "A11" });
    const topped = await getLocationRefUsage(userId, collectionId, location.id);
    assert.equal(topped.refs.find((r) => r.ref === "A11")!.count, 4);
  });

  it("offers nothing for a location nothing has ever been ref'd in", async () => {
    const location = await prisma.location.create({
      data: { collectionId, name: `Blank album ${Date.now()}`, assignable: true },
    });
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 1);
    await bulkUpdateLotItems(userId, ids, { locationId: location.id, locationRef: "" });

    const usage = await getLocationRefUsage(userId, collectionId, location.id);
    assert.deepEqual(usage.refs, []);
    assert.equal(usage.highest, null);
    assert.equal(usage.suggestion, null);
  });

  it("stores everything matching the list's filter, not just the loaded rows", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 4);
    // Two copies taken out of the `to sort` worklist by hand, exactly as the chip would show.
    await bulkUpdateLotItems(userId, ids.slice(0, 2), { deliveryState: "delivered" });

    const result = await bulkUpdateLotItemsScoped(
      userId,
      collectionId,
      { lotId, selectors: [{ filter: "to-sort" }] },
      { markSorted: true, keepDisposition: true, locationId: boxId, locationRef: "B1" }
    );
    assert.equal(result.count, 2);

    const copies = await readCopies(ids);
    for (const id of ids.slice(0, 2)) {
      assert.equal(copies.find((c) => c.id === id)!.locationRef, null);
    }
    for (const id of ids.slice(2)) {
      const copy = copies.find((c) => c.id === id)!;
      assert.equal(copy.locationRef, "B1");
      assert.equal(copy.locationId, boxId);
      assert.equal(copy.deliveryState, "delivered");
    }
  });

  it("resolves the unpriced filter, which no column carries", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 3);
    // A copy excluded from the allocation is not a blocker, so the `unpriced` chip skips it — none
    // of these carry a catalog price, so that exclusion is the only thing separating them.
    await bulkUpdateLotItems(userId, ids.slice(0, 1), { deliveryState: "not_delivered" });

    const result = await bulkUpdateLotItemsScoped(
      userId,
      collectionId,
      { lotId, selectors: [{ filter: "unpriced" }] },
      { locationId: boxId, locationRef: "C1" }
    );
    assert.equal(result.count, 2);

    const copies = await readCopies(ids);
    assert.equal(copies.find((c) => c.id === ids[0])!.locationRef, null);
    assert.equal(copies.find((c) => c.id === ids[1])!.locationRef, "C1");
    assert.equal(copies.find((c) => c.id === ids[2])!.locationRef, "C1");
  });

  // A selection is not a list of rows (#571): whole issue groups, copies ticked one by one, and
  // whatever was lifted back out of a container above them, all resolved in one write.

  it("takes whole issue groups and loose copies in the same act", async () => {
    const lotId = await arrivedLot();
    const chopin = await addIssueCopies(lotId, chopinIssueId, 2);
    const sport = await addIssueCopies(lotId, sportIssueId, 2);
    const loose = await addCopies(lotId, 2);

    const scope = { lotId, selectors: [{ issueKey: chopinIssueId }], itemIds: [loose[0]] };
    assert.equal(await countLotBulkScope(userId, collectionId, scope), 3);

    const result = await bulkUpdateLotItemsScoped(userId, collectionId, scope, {
      markSorted: true,
      keepDisposition: true,
      locationId: boxId,
      locationRef: "D1",
    });
    assert.equal(result.count, 3);

    const copies = await readCopies([...chopin, ...sport, ...loose]);
    const ref = (id: string) => copies.find((c) => c.id === id)!.locationRef;
    assert.deepEqual(chopin.map(ref), ["D1", "D1"]);
    assert.equal(ref(loose[0]), "D1");
    // Untouched: a group nobody ticked, and the copy beside the one that was.
    assert.deepEqual(sport.map(ref), [null, null]);
    assert.equal(ref(loose[1]), null);
  });

  it("lifts a copy and a whole group back out of a whole-lot tick", async () => {
    const lotId = await arrivedLot();
    const chopin = await addIssueCopies(lotId, chopinIssueId, 2);
    const sport = await addIssueCopies(lotId, sportIssueId, 2);

    // The whole lot, minus one issue group and minus one copy of what is left.
    const scope = {
      lotId,
      excludeSelectors: [{ issueKey: sportIssueId }],
      excludeItemIds: [chopin[0]],
    };
    assert.equal(await countLotBulkScope(userId, collectionId, scope), 1);

    const result = await bulkUpdateLotItemsScoped(userId, collectionId, scope, {
      markSorted: true,
      keepDisposition: true,
      locationId: boxId,
      locationRef: "E1",
    });
    assert.equal(result.count, 1);

    const copies = await readCopies([...chopin, ...sport]);
    const ref = (id: string) => copies.find((c) => c.id === id)!.locationRef;
    assert.equal(ref(chopin[1]), "E1");
    assert.equal(ref(chopin[0]), null);
    assert.deepEqual(sport.map(ref), [null, null]);
  });

  it("counts a whole-lot selection through the same scope the write uses", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 4);
    await bulkUpdateLotItems(userId, ids.slice(0, 3), { deliveryState: "delivered" });

    assert.equal(await countLotBulkScope(userId, collectionId, { lotId }), 4);
    assert.equal(
      await countLotBulkScope(userId, collectionId, { lotId, selectors: [{ filter: "to-sort" }] }),
      1
    );
  });

  it("reads a selection off the wire exactly as it was sent", () => {
    // The containers travel as JSON because they are records with three optional fields, and the
    // count read and the write must agree about them down to which lot an issue key was paired
    // with. Anything the client did not send, or sent unrecognisably, is simply absent.
    const wire: Record<string, string> = {
      purchaseId: "pur1",
      onlyOpenLots: "true",
      selectors: JSON.stringify([
        { lotId: "lot1", issueKey: "iss1", filter: "to-sort" },
        { lotId: "lot2" },
        { lotId: "lot3", filter: "made-up" },
        "not an object",
      ]),
      excludeSelectors: JSON.stringify([{ issueKey: "iss9" }]),
      itemIds: "i1, i2 ,,i3",
      excludeItemIds: "x1",
    };
    assert.deepEqual(readLotBulkScope((name) => wire[name] ?? null), {
      lotId: undefined,
      purchaseId: "pur1",
      onlyOpenLots: true,
      selectors: [
        { lotId: "lot1", issueKey: "iss1", filter: "to-sort" },
        { lotId: "lot2" },
        // An unknown chip is dropped, not refused: it could only ever narrow the target.
        { lotId: "lot3" },
      ],
      excludeSelectors: [{ issueKey: "iss9" }],
      itemIds: ["i1", "i2", "i3"],
      excludeItemIds: ["x1"],
    });
    // Malformed JSON is no selection at all, rather than a throw on a read.
    assert.deepEqual(readLotBulkScope((name) => (name === "selectors" ? "{oops" : null)), {
      lotId: undefined,
      purchaseId: undefined,
    });
  });

  it("declares a batch sorted without touching where its copies sit", async () => {
    const lotId = await arrivedLot();
    const ids = await addCopies(lotId, 2);
    // Two copies filed one at a time during the pass — the decisions that took the longest.
    await bulkUpdateLotItems(userId, [ids[0]], { locationId: boxId, locationRef: "F1" });
    await bulkUpdateLotItems(userId, [ids[1]], { locationId: albumId });

    // Store with the location left as is: no `locationId` field at all, so nothing is overwritten.
    await bulkUpdateLotItemsScoped(
      userId,
      collectionId,
      { lotId },
      { markSorted: true, keepDisposition: true }
    );

    const copies = await readCopies(ids);
    const first = copies.find((c) => c.id === ids[0])!;
    const second = copies.find((c) => c.id === ids[1])!;
    assert.equal(first.deliveryState, "delivered");
    assert.equal(second.deliveryState, "delivered");
    assert.equal(first.locationId, boxId);
    assert.equal(first.locationRef, "F1");
    assert.equal(second.locationId, albumId);
  });
});
