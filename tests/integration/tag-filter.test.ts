import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createTag, listTags, setIssueTags, setItemTags, setStampTags } from "../../src/lib/tags";
import { listIssuesPaginated, listIssueYearFacets } from "../../src/lib/issues";
import { listStampsPaginated } from "../../src/lib/stamps";
import { createItem, listItemsPaginated } from "../../src/lib/items";

// Filtering a list by tag, *any* and *all* (#1182).
//
// Both readings are run against the **same three rows on the same three lists**, because the whole
// hazard of this feature is that they are hard to tell apart: *all* returns a subset of what *any*
// returns, so an `all` that is quietly an `any` passes every test that only asserts "the filter
// narrowed something". The shape the three lists share — `a`, `b` and `a+b` — is what makes the two
// answers different counts under both readings, in both directions.
//
// The other thing pinned here is that **the filter composes with the others and narrows the facet
// rails with them**, which is what stops a rail promising a row count the list will not produce.
// `tests/unit/tag-filter.test.ts` owns the `where` builder's shape and the URL round trip; this file
// is the part no pure test can answer: that Prisma resolves the clauses against real join rows.

const ts = Date.now();

describe("filtering the lists by tag (#1182)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;

  /** The three tags: two the rows carry, and one nothing carries. */
  let birdsId: string;
  let checkId: string;
  let unusedId: string;

  /** Three issues, three stamps, three copies: one carrying `birds`, one carrying `to check`, one
   *  carrying both. A fourth of each carries nothing at all. */
  const issues: Record<string, string> = {};
  const stamps: Record<string, string> = {};
  const copies: Record<string, string> = {};

  before(async () => {
    userId = `test-user-tag-filter-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Tag filter",
        email: `test-tag-filter-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-tag-filter-${ts}`,
          name: "Tag filter",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: `Michel ${ts}`, abbreviation: "Mi" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polska", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogNameId: catalog.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "**", sortOrder: 0 },
      })
    ).id;

    // Four of each, named for what they will carry. The years differ so the year facet has
    // something to say, and `none` has no year at all.
    const keys = ["birds", "check", "both", "none"] as const;
    for (const [i, key] of keys.entries()) {
      issues[key] = (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: 91820 + i,
            collectionAreaId: areaId,
            name: `Issue ${key}`,
            year: 1920 + i,
          },
        })
      ).id;
      stamps[key] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${key}`,
            issuedYear: 1920 + i,
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number: `${200 + i}` }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.issueMember.create({
        data: { issueId: issues[key], stampId: stamps[key], sortOrder: 0 },
      });
      copies[key] = (
        await createItem(userId, collectionId, { stampId: stamps[key], conditionId })
      ).id;
    }

    await createTag(userId, collectionId, { name: "Birds", color: "green" });
    await createTag(userId, collectionId, { name: "To check", color: "amber" });
    await createTag(userId, collectionId, { name: "Unused", color: null });
    const tags = await listTags(userId, collectionId);
    birdsId = tags.find((t) => t.name === "Birds")!.id;
    checkId = tags.find((t) => t.name === "To check")!.id;
    unusedId = tags.find((t) => t.name === "Unused")!.id;

    const assignments: [key: string, tagIds: string[]][] = [
      ["birds", [birdsId]],
      ["check", [checkId]],
      ["both", [birdsId, checkId]],
      ["none", []],
    ];
    for (const [key, tagIds] of assignments) {
      await setIssueTags(userId, issues[key], tagIds);
      await setStampTags(userId, stamps[key], tagIds);
      await setItemTags(userId, copies[key], tagIds);
    }
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** The three lists under one filter, each as the set of row keys it returned. */
  async function rows(filter: {
    tagIds?: string[];
    tagMode?: "any" | "all";
  }): Promise<{ issues: string[]; stamps: string[]; copies: string[] }> {
    const issueIds = new Map(Object.entries(issues).map(([k, v]) => [v, k]));
    const stampIds = new Map(Object.entries(stamps).map(([k, v]) => [v, k]));
    const copyIds = new Map(Object.entries(copies).map(([k, v]) => [v, k]));
    const [issuePage, stampPage, copyPage] = await Promise.all([
      listIssuesPaginated(userId, collectionId, filter),
      listStampsPaginated(userId, collectionId, filter),
      listItemsPaginated(userId, collectionId, filter),
    ]);
    const keys = (page: { items: { id: string }[] }, names: Map<string, string>) =>
      page.items.flatMap((r) => {
        const key = names.get(r.id);
        return key ? [key] : [];
      }).sort();
    return {
      issues: keys(issuePage, issueIds),
      stamps: keys(stampPage, stampIds),
      copies: keys(copyPage, copyIds),
    };
  }

  it("lists everything when no tag is named", async () => {
    for (const filter of [{}, { tagIds: [] }, { tagIds: [], tagMode: "all" as const }]) {
      const got = await rows(filter);
      assert.deepEqual(got.issues, ["birds", "both", "check", "none"], JSON.stringify(filter));
      assert.deepEqual(got.stamps, ["birds", "both", "check", "none"], JSON.stringify(filter));
      assert.deepEqual(got.copies, ["birds", "both", "check", "none"], JSON.stringify(filter));
    }
  });

  it("narrows to one tag, on all three lists", async () => {
    const got = await rows({ tagIds: [birdsId] });
    assert.deepEqual(got.issues, ["birds", "both"]);
    assert.deepEqual(got.stamps, ["birds", "both"]);
    assert.deepEqual(got.copies, ["birds", "both"]);
  });

  it("with two tags, *any* returns the rows carrying at least one", async () => {
    for (const filter of [
      { tagIds: [birdsId, checkId] },
      { tagIds: [birdsId, checkId], tagMode: "any" as const },
    ]) {
      const got = await rows(filter);
      assert.deepEqual(got.issues, ["birds", "both", "check"]);
      assert.deepEqual(got.stamps, ["birds", "both", "check"]);
      assert.deepEqual(got.copies, ["birds", "both", "check"]);
    }
  });

  it("with two tags, *all* returns only the rows carrying both", async () => {
    const got = await rows({ tagIds: [birdsId, checkId], tagMode: "all" });
    assert.deepEqual(got.issues, ["both"]);
    assert.deepEqual(got.stamps, ["both"]);
    assert.deepEqual(got.copies, ["both"]);
  });

  it("*all* with a tag nothing carries returns nothing, where *any* still returns its mates", async () => {
    const all = await rows({ tagIds: [birdsId, unusedId], tagMode: "all" });
    assert.deepEqual(all, { issues: [], stamps: [], copies: [] });
    const any = await rows({ tagIds: [birdsId, unusedId] });
    assert.deepEqual(any.issues, ["birds", "both"]);
    assert.deepEqual(any.stamps, ["birds", "both"]);
    assert.deepEqual(any.copies, ["birds", "both"]);
  });

  it("inherits nothing: a tag on an issue does not make its stamps or copies match", async () => {
    // `none` carries nothing itself. Tag its **issue** and its **stamp**, and neither the stamp nor
    // the copy may appear under that tag — the rule #152 settled, and the one a filter is most
    // likely to break quietly by reading through a relation for convenience.
    await setIssueTags(userId, issues.none, [unusedId]);
    await setStampTags(userId, stamps.none, [unusedId]);
    const got = await rows({ tagIds: [unusedId] });
    assert.deepEqual(got.issues, ["none"]);
    assert.deepEqual(got.stamps, ["none"]);
    assert.deepEqual(got.copies, [], "a stamp's tag is not on the copies of it");
    await setIssueTags(userId, issues.none, []);
    await setStampTags(userId, stamps.none, []);
  });

  it("composes with the other filters rather than replacing them", async () => {
    // `both` is the only row carrying the two tags, and it is the 1922 one — so the same filter plus
    // a different year has to come back empty rather than ignoring one of the two.
    const hit = await listIssuesPaginated(userId, collectionId, {
      tagIds: [birdsId, checkId],
      tagMode: "all",
      year: 1922,
    });
    assert.deepEqual(hit.items.map((i) => i.name), ["Issue both"]);
    const miss = await listIssuesPaginated(userId, collectionId, {
      tagIds: [birdsId, checkId],
      tagMode: "all",
      year: 1920,
    });
    assert.deepEqual(miss.items, []);
    // And the search box, on the stamp list, narrows the tagged set rather than widening it.
    const searched = await listStampsPaginated(userId, collectionId, {
      tagIds: [birdsId],
      search: "Stamp both",
    });
    assert.deepEqual(searched.items.map((s) => s.name), ["Stamp both"]);
  });

  it("narrows the facet rails too, so a row cannot promise a count the list will not produce", async () => {
    // Unfiltered, the years are the four the fixture created.
    const unfiltered = await listIssueYearFacets(userId, collectionId, {});
    assert.deepEqual(
      unfiltered.map((f) => [f.year, f.count]),
      [
        [1920, 1],
        [1921, 1],
        [1922, 1],
        [1923, 1],
      ]
    );
    // Under *any* of the two tags, the untagged 1923 issue is gone from the rail as well as the list.
    const any = await listIssueYearFacets(userId, collectionId, {
      tagIds: [birdsId, checkId],
    });
    assert.deepEqual(
      any.map((f) => [f.year, f.count]),
      [
        [1920, 1],
        [1921, 1],
        [1922, 1],
      ]
    );
    // Under *all*, only the year of the one issue carrying both.
    const all = await listIssueYearFacets(userId, collectionId, {
      tagIds: [birdsId, checkId],
      tagMode: "all",
    });
    assert.deepEqual(
      all.map((f) => [f.year, f.count]),
      [[1922, 1]]
    );
  });

  it("matches nothing for a tag id that is not this collection's", async () => {
    // Not refused — the picker cannot offer one, so a request naming it is not something the
    // collector did, and `collectionId` scopes the read anyway. It simply matches no join row.
    const got = await rows({ tagIds: [`${birdsId}-not-a-tag`] });
    assert.deepEqual(got, { issues: [], stamps: [], copies: [] });
  });
});
