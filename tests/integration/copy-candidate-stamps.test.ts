import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  listItemIssueGroups,
  listItemsPaginated,
  resolveItemVariant,
  updateItem,
  valuateItemsByIds,
} from "../../src/lib/items";
import { setCopyStamp } from "../../src/lib/item-candidates";
import { setItemStamps } from "../../src/lib/item-stamps";
import { countCopiesByStamp, loadStampCopyCounts } from "../../src/lib/copy-counts";
import { createWantsForStamps, findWantsSatisfiedBy } from "../../src/lib/wants";
import { setSubtypeActsAsVariant } from "../../src/lib/subtypes";
import { deleteStamp } from "../../src/lib/stamps";
import { recomputeStampSortKeys } from "../../src/lib/catalog-sort-key-recompute";
import { resolveListedStampIds } from "../../src/lib/listing-catalog-ids";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { GET, PATCH } from "../../src/app/api/v1/[...path]/route";
import type { AgentCopyDetail, AgentHolding } from "../../src/lib/agent-api/collection-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// A copy identified as **one of several candidate stamps** (#1651, ADR-0065).
//
//   Mi 123                         Mi 85        Mi 101        (two issues, told apart by watermark)
//   ├─ 123a  ├─ 123aI   10 €
//   │        └─ 123aII  20 €
//   └─ 123b  ├─ 123bI    5 €
//            └─ 123bII  30 €
//
// Pinned here is what the pure rules cannot see: that the write derives the pointer and the tree
// count from the catalogue and keeps them in step when the catalogue changes, that the valuation,
// the counts, the wants and the listing read the set rather than the pointer, and that the agent API
// sets, reports and settles it with the app's own checks.

const ts = Date.now();

function v1(token: string, method: string, path: string, body?: unknown) {
  const [pathname, search] = path.split("?");
  return {
    request: new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    context: { params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }) },
  };
}

describe("a copy that is one of several candidate stamps (#1651)", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let vendorId: string;
  let editionId: string;
  let areaId: string;
  let variantSubtypeId: string;
  let token: string;
  const s: Record<string, string> = {};

  async function stamp(
    key: string,
    number: string,
    opts: { parent?: string; price?: string; colnectId?: string } = {}
  ): Promise<string> {
    const row = await prisma.stamp.create({
      data: {
        collectionId,
        name: `Stamp ${number}`,
        parentId: opts.parent ? s[opts.parent] : null,
        subtypeId: opts.parent ? variantSubtypeId : null,
        colnectId: opts.colnectId ?? null,
      },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: row.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: row.id, catalogVendorId: vendorId, number },
    });
    if (opts.price) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: row.id,
          catalogEditionId: editionId,
          conditionId: mnhId,
          certificateStatusId: null,
          price: opts.price,
          currency: "EUR",
        },
      });
    }
    s[key] = row.id;
    return row.id;
  }

  async function copyOn(key: string): Promise<string> {
    return (await createItem(userId, collectionId, { stampId: s[key], conditionId: mnhId, forSale: true })).id;
  }

  async function shape(itemId: string) {
    const row = await prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        stampId: true,
        candidateTrees: true,
        candidates: { select: { stampId: true } },
        stamps: { select: { stampId: true } },
      },
    });
    return {
      stampId: row.stampId,
      trees: row.candidateTrees,
      candidates: row.candidates.map((c) => c.stampId).sort(),
      leading: row.stamps.map((e) => e.stampId),
    };
  }

  const ids = (...keys: string[]) => keys.map((k) => s[k]).sort();

  before(async () => {
    userId = `test-user-candidates-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User candidates-${ts}`,
        email: `test-candidates-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-candidates-${ts}`, name: `Candidates ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const catalogNameId = (
      await prisma.catalogName.create({ data: { vendorId, name: "Michel Katalog", currency: "EUR" } })
    ).id;
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Deutsches Reich", primaryCatalogNameId: catalogNameId },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: areaId, catalogNameId } });
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: areaId, catalogVendorId: vendorId, areaPrefix: null },
    });
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;

    await stamp("123", "123");
    await stamp("123a", "123a", { parent: "123" });
    await stamp("123aI", "123aI", { parent: "123a", price: "10", colnectId: "7001" });
    await stamp("123aII", "123aII", { parent: "123a", price: "20", colnectId: "7002" });
    await stamp("123b", "123b", { parent: "123" });
    await stamp("123bI", "123bI", { parent: "123b", price: "5", colnectId: "7003" });
    await stamp("123bII", "123bII", { parent: "123b", price: "30", colnectId: "7004" });
    await stamp("85", "85", { price: "12" });
    await stamp("101", "101", { price: "7" });
    await recomputeStampSortKeys(collectionId);

    token = (
      await createAssistantToken(userId, collectionId, { label: "candidates", scope: "read_write", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("the write", () => {
    it("points a one-tree set at the stamp the candidates share", async () => {
      const copy = await copyOn("123aI");
      const result = await setCopyStamp(userId, copy, [s["123bI"], s["123aI"]], "colour unreadable");
      assert.equal(result.stampId, s["123"]);
      assert.deepEqual(await shape(copy), {
        stampId: s["123"],
        trees: 1,
        candidates: ids("123aI", "123bI"),
        leading: [s["123"]],
      });
      const history = await prisma.itemVariantHistory.findMany({ where: { itemId: copy } });
      assert.equal(history.length, 1, "re-pointing the copy is a re-identification");
      assert.equal(history[0].note, "colour unreadable");
    });

    it("stores every variant of one umbrella as the umbrella, at every depth", async () => {
      const copy = await copyOn("123");
      await setCopyStamp(userId, copy, [s["123aI"], s["123aII"], s["123bI"]]);
      assert.deepEqual((await shape(copy)).candidates, ids("123a", "123bI"));
      await setCopyStamp(userId, copy, [s["123aI"], s["123aII"], s["123bI"], s["123bII"]]);
      assert.deepEqual(await shape(copy), { stampId: s["123"], trees: 0, candidates: [], leading: [s["123"]] });
    });

    it("counts the trees of a set across issues", async () => {
      const copy = await copyOn("85");
      await setCopyStamp(userId, copy, [s["85"], s["101"]]);
      const read = await shape(copy);
      assert.equal(read.trees, 2);
      assert.deepEqual(read.candidates, ids("85", "101"));
    });

    it("refuses a set on a copy carrying several stamps", async () => {
      const copy = await copyOn("85");
      await setItemStamps(userId, copy, [{ stampId: s["85"] }, { stampId: s["101"] }]);
      await assert.rejects(setCopyStamp(userId, copy, [s["123aI"], s["123bI"]]), /several stamps/);
    });

    it("drops the set when the copy is re-identified as one stamp by an edit", async () => {
      const copy = await copyOn("123");
      await setCopyStamp(userId, copy, [s["123aI"], s["123bI"]]);
      await updateItem(userId, copy, { stampId: s["85"] });
      assert.deepEqual(await shape(copy), { stampId: s["85"], trees: 0, candidates: [], leading: [s["85"]] });
    });

    it("settles to a candidate or a variant of one, and nowhere else", async () => {
      const copy = await copyOn("123");
      await setCopyStamp(userId, copy, [s["123a"], s["123bI"]]);
      await assert.rejects(resolveItemVariant(userId, copy, s["85"]), /one of its candidates/);
      await resolveItemVariant(userId, copy, s["123aII"], "type II after all");
      assert.deepEqual(await shape(copy), {
        stampId: s["123aII"],
        trees: 0,
        candidates: [],
        leading: [s["123aII"]],
      });
    });

    it("refuses to delete a stamp still named as a candidate", async () => {
      const copy = await copyOn("85");
      await setCopyStamp(userId, copy, [s["85"], s["101"]]);
      await assert.rejects(deleteStamp(userId, s["101"]), /possible variants of copy/);
    });

    it("re-derives the tree count when the catalogue stops treating the children as variants", async () => {
      const copy = await copyOn("123");
      await setCopyStamp(userId, copy, [s["123aI"], s["123bI"]]);
      await setSubtypeActsAsVariant(userId, variantSubtypeId, false);
      try {
        const split = await shape(copy);
        assert.equal(split.trees, 2, "with no variant edges every candidate is its own tree");
        assert.notEqual(split.stampId, s["123"]);
      } finally {
        await setSubtypeActsAsVariant(userId, variantSubtypeId, true);
      }
      assert.deepEqual(await shape(copy), {
        stampId: s["123"],
        trees: 1,
        candidates: ids("123aI", "123bI"),
        leading: [s["123"]],
      });
    });
  });

  describe("the copy dialog's save (#1651)", () => {
    it("creates a copy as one of several stamps in the create's own transaction", async () => {
      const copy = await createItem(userId, collectionId, {
        stampId: s["123aI"],
        conditionId: mnhId,
        candidateStampIds: [s["123aI"], s["123bI"]],
      });
      assert.deepEqual(await shape(copy.id), {
        stampId: s["123"],
        trees: 1,
        candidates: ids("123aI", "123bI"),
        leading: [s["123"]],
      });
      assert.equal(copy.stampId, s["123"], "the copy is returned as it now stands");
    });

    it("sets, keeps and drops a set on an edit", async () => {
      const copy = await copyOn("85");
      await updateItem(userId, copy, { candidateStampIds: [s["85"], s["101"]] });
      assert.equal((await shape(copy)).trees, 2);
      await updateItem(userId, copy, { notes: "watermark under UV tomorrow" });
      assert.equal((await shape(copy)).trees, 2, "an edit that does not name the set leaves it");
      await updateItem(userId, copy, { candidateStampIds: [] });
      const dropped = await shape(copy);
      assert.equal(dropped.trees, 0);
      assert.deepEqual(dropped.candidates, []);
    });
  });

  describe("what the copy is worth, counts as and is listed under", () => {
    let oneTree: string;
    let acrossTrees: string;

    before(async () => {
      oneTree = await copyOn("123");
      await setCopyStamp(userId, oneTree, [s["123aI"], s["123bII"]]);
      acrossTrees = await copyOn("85");
      await setCopyStamp(userId, acrossTrees, [s["85"], s["101"]]);
    });

    it("is valued at its cheapest candidate, naming it, flagged uncertain", async () => {
      const values = await valuateItemsByIds(collectionId, [oneTree, acrossTrees]);
      assert.equal(values.get(oneTree)?.amount, "10.00", "123aI at 10 against 123bII at 30");
      assert.equal(values.get(oneTree)?.sourceStampId, s["123aI"]);
      assert.equal(values.get(oneTree)?.uncertain, true);
      assert.equal(values.get(acrossTrees)?.amount, "7.00");
      assert.equal(values.get(acrossTrees)?.sourceStampId, s["101"]);
    });

    it("counts towards neither candidate when they lie in several trees", async () => {
      const total = async () => {
        const counts = await countCopiesByStamp(collectionId, [s["85"], s["101"]]);
        return [counts.get(s["85"])?.total ?? 0, counts.get(s["101"])?.total ?? 0];
      };
      const [before85, before101] = await total();
      const copy = await copyOn("85");
      assert.deepEqual(await total(), [before85 + 1, before101], "an ordinary copy of Mi 85 counts");
      await setCopyStamp(userId, copy, [s["85"], s["101"]]);
      assert.deepEqual(
        await total(),
        [before85, before101],
        "as *Mi 85 or Mi 101* it is certainly neither — its pointer included"
      );
    });

    it("answers no want, not even one on the stamp its candidates share", async () => {
      await createWantsForStamps(userId, collectionId, [{ stampId: s["123"] }]);
      const matches = await findWantsSatisfiedBy(userId, collectionId, [
        { itemId: oneTree, itemNo: 1, stampId: s["123"], conditionId: mnhId, certificateStatusId: null, formatId: null },
      ]);
      assert.deepEqual(matches, []);
    });

    it("is listed under its cheapest candidate, never under the pointer", async () => {
      const listed = await resolveListedStampIds(collectionId, [
        {
          itemId: oneTree,
          stampId: s["123"],
          conditionId: mnhId,
          certificateStatusId: null,
          formatId: null,
          unknownVariant: true,
          ownCatalogItemId: null,
          candidateStampIds: [s["123aI"], s["123bII"]],
        },
      ]);
      assert.equal(listed.get(oneTree), s["123aI"]);
    });
  });

  describe("possibly this copy, under each candidate (#1651, ADR-0065 §8)", () => {
    let issue85: string;
    let issue101: string;
    let copy: string;

    before(async () => {
      for (const [key, name, no] of [["85", "Watermark A", 1], ["101", "Watermark B", 2]] as const) {
        const issue = await prisma.issue.create({
          data: { collectionId, issueNo: 7700 + no, collectionAreaId: areaId, name, year: 1923 },
        });
        await prisma.issueMember.create({ data: { issueId: issue.id, stampId: s[key] } });
        if (key === "85") issue85 = issue.id;
        else issue101 = issue.id;
      }
      copy = await copyOn("85");
      await setCopyStamp(userId, copy, [s["85"], s["101"]]);
    });

    it("lists the copy under neither stamp, and under each as possibly", async () => {
      for (const key of ["85", "101"]) {
        const certain = await listItemsPaginated(userId, collectionId, { stampId: s[key], pageSize: 500 });
        assert.equal(certain.items.some((i) => i.id === copy), false, `not certainly Mi ${key}`);
        const possible = await listItemsPaginated(userId, collectionId, { possibleStampId: s[key] });
        assert.ok(possible.items.some((i) => i.id === copy), `possibly Mi ${key}`);
      }
      const byIssue = await listItemsPaginated(userId, collectionId, { possibleIssueId: issue101 });
      assert.ok(byIssue.items.some((i) => i.id === copy));
    });

    it("counts it apart under each candidate's issue group, and in neither group's own figure", async () => {
      const { groups } = await listItemIssueGroups(userId, collectionId, { pageSize: 500 });
      const a = groups.find((g) => g.issueId === issue85)!;
      const b = groups.find((g) => g.issueId === issue101)!;
      assert.ok(a.possibleCount >= 1 && b.possibleCount >= 1);
      // The members a group row reads back — its issue, carriers left to their own bucket.
      const certainIn85 = await listItemsPaginated(userId, collectionId, {
        issueId: issue85,
        multiStamp: "exclude",
        pageSize: 500,
      });
      assert.equal(a.count, certainIn85.items.length, "the group's own figure is what its members list");
    });

    it("puts a possibly figure on each candidate's copy count", async () => {
      const counts = await loadStampCopyCounts(collectionId, [s["85"], s["101"], s["123"]]);
      assert.ok((counts.possible.get(s["85"]) ?? 0) >= 1);
      assert.ok((counts.possible.get(s["101"]) ?? 0) >= 1);
      assert.equal(counts.possible.get(s["123"]) ?? 0, 0, "a one-tree set is an umbrella copy, never possibly");
    });
  });

  describe("the agent API", () => {
    async function call<T>(method: "GET" | "PATCH", path: string, body?: unknown) {
      const { request, context } = v1(token, method, path, body);
      const response = await (method === "GET" ? GET : PATCH)(request, context);
      return { status: response.status, body: (await response.json()) as T };
    }

    it("sets a set with `set_copy_stamp`, and every copy read reports it", async () => {
      const copy = await copyOn("85");
      const set = await call<AgentCopyDetail>("PATCH", `/copies/${copy}/stamp`, {
        stamp_ids: [s["123aI"], s["123bI"]],
        note: "type I, colour unreadable",
      });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(set.body.variantToSettle, true);
      assert.equal(set.body.candidates?.label, "Mi 123aI or 123bI");
      assert.equal(set.body.candidates?.sharedStampId, s["123"]);
      assert.equal(set.body.catalogValue.amount, "5.00");

      const holdings = await call<ListResponse<AgentHolding>>("GET", "/holdings?variant_to_settle=true&limit=100");
      assert.equal(holdings.status, 200, JSON.stringify(holdings.body));
      const row = holdings.body.items.find((h) => h.copyId === copy);
      assert.equal(row?.candidates?.stamps.length, 2);
      assert.ok(holdings.body.items.every((h) => h.variantToSettle), "the filter keeps only copies to settle");

      const settled = await call<AgentCopyDetail>("PATCH", `/copies/${copy}/stamp`, { stamp_ids: [s["123bI"]] });
      assert.equal(settled.body.stampId, s["123bI"]);
      assert.equal("candidates" in settled.body, false);
    });

    it("refuses an empty list and a stamp from nowhere, changing nothing", async () => {
      const copy = await copyOn("85");
      const empty = await call<{ error: { code: string } }>("PATCH", `/copies/${copy}/stamp`, { stamp_ids: [] });
      assert.equal(empty.status, 400);
      const nowhere = await call<{ error: { code: string } }>("PATCH", `/copies/${copy}/stamp`, {
        stamp_ids: [s["85"], "no-such-stamp"],
      });
      assert.equal(nowhere.status, 400);
      assert.deepEqual(await shape(copy), { stampId: s["85"], trees: 0, candidates: [], leading: [s["85"]] });
    });
  });
});
