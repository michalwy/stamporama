import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  countItems,
  createItem,
  listIssueGroupCompleteness,
  listItemIssueGroups,
  listItemsPaginated,
  listItemYearFacets,
  type ItemListFiltersPaginated,
} from "../../src/lib/items";
import { issueMatchesCompleteness, type CompletenessFilter } from "../../src/lib/completeness-filter";

// The Copies list's *Complete* filter (#1884): the issue group header's chips (#594/#1859) as a
// narrowing, judged over the copies every other filter lets through.
//
// One collection, two conditions (MNH, MH), two locations (Box, Album), and six issues:
//
//   - **Earlier** — no checklist, one stamp e1, held MNH. Created first, so it is e1's **first**
//     issue and e1's copy is grouped under it — no chips there, so no value keeps that copy.
//   - **Mixed** (3 stamps on its checklist): w1 MNH, w2 MH, and e1 — a member of Mixed too, held
//     through the copy grouped under Earlier. Any 3/3, no single condition whole. Counting the chips
//     under the filter would drop e1's copy and read 2/3, contradicting the filter that kept Mixed.
//   - **Whole** (2 stamps): x1 MNH in the Box, x2 MNH in the Album, x2 MH in the Box — MNH 2/2.
//     Narrowed to the Box it is the mixed case; narrowed to MH it is short of x1.
//   - **Short** (3 stamps): y1 MNH — 1/3. It also carries a **specialised** checklist of y1 alone,
//     complete, which counts only while the switch is on.
//   - **Unlisted** — an issue with no checklist: no chips, so in no value's answer.
//   - **Untouched** (1 stamp on its checklist): its one copy is of a stamp in the issue but not on
//     the checklist — the checklist draws no chip, so the issue is in no value's answer either.
//
// …and a loose copy whose stamp is in no issue at all.

const ts = Date.now();

describe("the Complete filter on the Copies list (#1884)", () => {
  let userId: string;
  let collectionId: string;
  let mnh: string, mh: string;
  let boxId: string, albumId: string;
  const issue: Record<string, string> = {};
  const copy: Record<string, string> = {};

  before(async () => {
    userId = `test-user-completefilter-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User completefilter-${ts}`,
        email: `test-completefilter-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-completefilter-${ts}`, name: "Series", baseCurrency: "EUR", ownerId: userId },
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
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    boxId = (await prisma.location.create({ data: { collectionId, name: "Box", assignable: true } })).id;
    albumId = (await prisma.location.create({ data: { collectionId, name: "Album", assignable: true } })).id;

    let issueNo = 9800;
    let year = 1960;
    /** An issue of `stamps` stamps, each issued a year apart, with a standard checklist of `listed`. */
    const makeIssue = async (name: string, stamps: number, listed: number | null) => {
      const id = (
        await prisma.issue.create({
          // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
          data: { collectionId, issueNo: issueNo++, collectionAreaId: areaId, name, year },
        })
      ).id;
      issue[name] = id;
      const stampIds: string[] = [];
      for (let i = 0; i < stamps; i++) {
        stampIds.push(
          (await prisma.stamp.create({ data: { collectionId, name: `${name} ${i + 1}`, issuedYear: year } })).id
        );
      }
      year += 1;
      await prisma.issueMember.createMany({
        data: stampIds.map((stampId, sortOrder) => ({ issueId: id, stampId, sortOrder })),
      });
      if (listed !== null) {
        await prisma.checklist.create({
          data: {
            collectionId,
            issueId: id,
            name: "Basic",
            sortOrder: 0,
            stamps: { create: stampIds.slice(0, listed).map((stampId) => ({ stampId })) },
          },
        });
      }
      return stampIds;
    };
    const add = async (key: string, stampId: string, conditionId: string, locationId = boxId) => {
      copy[key] = (await createItem(userId, collectionId, { stampId, conditionId, locationId })).id;
    };

    const [e1] = await makeIssue("Earlier", 1, null);
    await add("e1", e1, mnh);

    const [w1, w2] = await makeIssue("Mixed", 2, 2);
    await add("w1", w1, mnh);
    await add("w2", w2, mh);
    await prisma.issueMember.create({ data: { issueId: issue.Mixed, stampId: e1, sortOrder: 2 } });
    const mixedList = await prisma.checklist.findFirstOrThrow({ where: { issueId: issue.Mixed } });
    await prisma.checklist.update({
      where: { id: mixedList.id },
      data: { stamps: { create: [{ stampId: e1 }] } },
    });

    const [x1, x2] = await makeIssue("Whole", 2, 2);
    await add("x1", x1, mnh);
    await add("x2a", x2, mnh, albumId);
    await add("x2b", x2, mh);

    const [y1] = await makeIssue("Short", 3, 3);
    await add("y1", y1, mnh);
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue.Short,
        name: "Plate flaw",
        kind: "specialised",
        sortOrder: 1,
        stamps: { create: [{ stampId: y1 }] },
      },
    });

    const [z1] = await makeIssue("Unlisted", 1, null);
    await add("z1", z1, mnh);

    const [, u2] = await makeIssue("Untouched", 2, 1);
    await add("u2", u2, mnh);

    const loose = await prisma.stamp.create({ data: { collectionId, name: "Loose", issuedYear: 1999 } });
    await add("loose", loose.id, mnh);
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.location.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const listed = async (filters: ItemListFiltersPaginated) =>
    (await listItemsPaginated(userId, collectionId, filters)).items.map((i) => i.id).sort();
  const copiesOf = (...keys: string[]) => keys.map((k) => copy[k]).sort();
  const groupIssues = async (filters: ItemListFiltersPaginated) =>
    (await listItemIssueGroups(userId, collectionId, filters)).groups.map((g) => g.issueId).sort();
  const issuesOf = (...names: string[]) => names.map((n) => issue[n]).sort();

  it("keeps every copy while it is off", async () => {
    assert.equal((await listed({})).length, Object.keys(copy).length);
    // The precondition the chip assertions below stand on: e1's copy sits under Earlier, not Mixed.
    const { groups } = await listItemIssueGroups(userId, collectionId, {});
    assert.equal(groups.find((g) => g.issueId === issue.Earlier)?.count, 1);
    assert.equal(groups.find((g) => g.issueId === issue.Mixed)?.count, 2);
  });

  it("keeps the issues held whole in any conditions, mixed or not", async () => {
    assert.deepEqual(await listed({ complete: "any" }), copiesOf("w1", "w2", "x1", "x2a", "x2b"));
    // Mixed is held whole only through e1's copy under Earlier, which the chips still count.
    const chips = await listIssueGroupCompleteness(userId, collectionId, [issue.Mixed], { complete: "any" });
    assert.deepEqual([chips[issue.Mixed][0].owned, chips[issue.Mixed][0].requiredCount], [3, 3]);
  });

  it("keeps only the issues held whole in a single condition under *one*", async () => {
    assert.deepEqual(await listed({ complete: "one" }), copiesOf("x1", "x2a", "x2b"));
  });

  it("keeps the rest of the issues that have chips under *incomplete*", async () => {
    // Earlier, Unlisted, Untouched and the loose copy have no chips, so no value keeps them.
    assert.deepEqual(await listed({ complete: "incomplete" }), copiesOf("y1"));
  });

  it("judges over the copies the other filters let through", async () => {
    // Narrowed to the Box, *Whole* is MNH 1/2 · MH 1/2 — complete in any condition, not in one.
    assert.deepEqual(
      await listed({ locationId: boxId, complete: "one" }),
      [],
      "x2's MNH copy is in the Album, so no single condition is whole in the Box"
    );
    assert.deepEqual(
      await listed({ locationId: boxId, complete: "any" }),
      copiesOf("w1", "w2", "x1", "x2b")
    );
    // Narrowed to MH, *Whole* is short of x1 and *Mixed* of w1 and e1.
    assert.deepEqual(await listed({ conditionIds: [mh], complete: "any" }), []);
    assert.deepEqual(await listed({ conditionIds: [mh], complete: "incomplete" }), copiesOf("w2", "x2b"));
  });

  it("counts specialised checklists only while the switch is on — any checklist decides", async () => {
    assert.deepEqual(await listed({ complete: "any", completeIncludesSpecialised: false }), copiesOf("w1", "w2", "x1", "x2a", "x2b"));
    assert.deepEqual(
      await listed({ complete: "any", completeIncludesSpecialised: true }),
      copiesOf("w1", "w2", "x1", "x2a", "x2b", "y1"),
      "Short's specialised list of y1 alone is complete"
    );
    assert.deepEqual(await listed({ complete: "incomplete", completeIncludesSpecialised: true }), []);
  });

  it("agrees with the chips under every combination of other filters", async () => {
    const others: [string, ItemListFiltersPaginated][] = [
      ["none", {}],
      ["Box", { locationId: boxId }],
      ["Album", { locationId: albumId }],
      ["MNH", { conditionIds: [mnh] }],
      ["MH", { conditionIds: [mh] }],
      ["MNH + MH", { conditionIds: [mnh, mh] }],
      ["Box, MH", { locationId: boxId, conditionIds: [mh] }],
    ];
    for (const [label, base] of others) {
      for (const includeSpecialised of [false, true]) {
        const shown = await groupIssues(base);
        const chips = await listIssueGroupCompleteness(
          userId,
          collectionId,
          shown.filter((id): id is string => id !== null),
          base,
          includeSpecialised
        );
        for (const value of ["any", "one", "incomplete"] as CompletenessFilter[]) {
          const filters = { ...base, complete: value, completeIncludesSpecialised: includeSpecialised };
          const expected = shown
            .filter((id): id is string => id !== null && issueMatchesCompleteness(chips[id] ?? [], value))
            .sort();
          const context = `${label}, ${value}, specialised ${includeSpecialised}`;
          assert.deepEqual(await groupIssues(filters), expected, context);
          // The chips are not themselves narrowed by the filter they decide — Mixed stays 3/3.
          assert.deepEqual(
            await listIssueGroupCompleteness(userId, collectionId, expected, filters, includeSpecialised),
            Object.fromEntries(expected.map((id) => [id, chips[id]])),
            context
          );
        }
      }
    }
  });

  it("narrows the count and the year rail exactly as it narrows the rows", async () => {
    assert.equal(await countItems(userId, collectionId, { complete: "one" }), 3);
    const years = await listItemYearFacets(userId, collectionId, { complete: "any" });
    // Mixed was issued in 1961, Whole in 1962 — Earlier's 1960 copy is not kept.
    assert.deepEqual(
      years.map((y) => [y.year, y.count]).sort(),
      [[1961, 2], [1962, 3]]
    );
  });

  it("groups the kept issues alone, with their whole counts", async () => {
    assert.deepEqual(await groupIssues({ complete: "any" }), issuesOf("Mixed", "Whole"));
    const { groups } = await listItemIssueGroups(userId, collectionId, { complete: "one" });
    assert.deepEqual(groups.map((g) => [g.issueId, g.count]), [[issue.Whole, 3]]);
  });
});
