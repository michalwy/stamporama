import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createChecklist, setChecklistStamps } from "../../src/lib/checklists";
import { matchPath, pickMethod } from "../../src/lib/agent-api/registry";
import { parseParameters } from "../../src/lib/agent-api/params";
import type { OperationContext } from "../../src/lib/agent-api/types";
import type { AgentIssueDetail } from "../../src/lib/agent-api/collection-reads";

// `get_issue` returns the issue's one catalogue value (#2661) — the figure #2659 shows on the Issues
// row: its checklists' stamps, each counted once — beside each checklist's own total, unchanged.
// Driven through the registry as the dispatcher drives it, so the binding is exercised too.

const ts = Date.now();

async function getIssue(
  context: OperationContext,
  issueId: string,
  query: Record<string, string> = {}
): Promise<AgentIssueDetail> {
  const match = matchPath(["issues", issueId]);
  const picked = pickMethod(match, "GET");
  assert.ok(picked, "get_issue is not bound to GET /issues/{issue_id}");
  assert.equal(picked.operation.name, "get_issue");
  const params = parseParameters(picked.operation.parameters, {
    path: picked.pathValues,
    query: new URLSearchParams(query),
  });
  return (await picked.operation.handler(context, params)) as AgentIssueDetail;
}

describe("get_issue: the issue's catalogue value across its checklists (#2661)", () => {
  let userId: string;
  let collectionId: string;
  let context: OperationContext;
  let areaId: string;
  let editionId: string;
  let conditionId: string;
  let variantSubtypeId: string;

  before(async () => {
    userId = `test-user-apiisval-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User apiisval-${ts}`,
        email: `test-apiisval-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-apiisval-${ts}`, name: "Value", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    context = { ownerId: userId, collectionId };
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Fischer", currency: "PLN" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  let issueNo = 92661;
  let sortOrder = 0;

  async function newIssue(name: string) {
    return (
      await prisma.issue.create({
        data: { collectionId, issueNo: issueNo++, collectionAreaId: areaId, name },
      })
    ).id;
  }

  async function stamp(
    issueId: string,
    name: string,
    price: string | null,
    parentId: string | null = null
  ) {
    const id = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name,
          parentId,
          subtypeId: parentId ? variantSubtypeId : null,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
    await prisma.issueMember.create({ data: { issueId, stampId: id, sortOrder: sortOrder++ } });
    if (price !== null) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: id,
          catalogEditionId: editionId,
          conditionId,
          certificateStatusId: null,
          price,
          currency: "PLN",
        },
      });
    }
    return id;
  }

  it("returns Monuments (Unissued)'s ~300 PLN beside its two checklists' totals", async () => {
    const issueId = await newIssue("Monuments (Unissued)");
    // `a1` has no price of its own and is priced from its lowest variant (#238): the `~`.
    const a1 = await stamp(issueId, "a1", null);
    await stamp(issueId, "a1a", "100", a1);
    const a2 = await stamp(issueId, "a2", "80");
    const b1 = await stamp(issueId, "b1", "120");
    const imperf = await createChecklist(userId, collectionId, { issueId, name: "Imperforate (A)" });
    const perf = await createChecklist(userId, collectionId, { issueId, name: "Perforated (B)" });
    await setChecklistStamps(userId, imperf, [a1, a2]);
    await setChecklistStamps(userId, perf, [b1]);

    const issue = await getIssue(context, issueId);
    assert.deepEqual(issue.catalogValue, {
      amount: "300.00",
      currency: "PLN",
      baseCurrency: "PLN",
      approximate: true,
    });
    assert.deepEqual(
      issue.checklists.map((list) => [list.name, list.catalogTotal?.amount]),
      [
        ["Imperforate (A)", "180.00"],
        ["Perforated (B)", "120.00"],
      ]
    );
  });

  it("counts a stamp its checklists share once", async () => {
    const issueId = await newIssue("Shared");
    const s1 = await stamp(issueId, "s1", "10");
    const s2 = await stamp(issueId, "s2", "20");
    const s3 = await stamp(issueId, "s3", "5");
    const basic = await createChecklist(userId, collectionId, { issueId, name: "Basic" });
    const plates = await createChecklist(userId, collectionId, { issueId, name: "Plates" });
    await setChecklistStamps(userId, basic, [s1, s2]);
    await setChecklistStamps(userId, plates, [s1, s3]);

    const issue = await getIssue(context, issueId);
    // 10 + 20 + 5, not 30 + 15.
    assert.equal(issue.catalogValue?.amount, "35.00");
    assert.equal("approximate" in (issue.catalogValue ?? {}), false);
    assert.equal("olderEdition" in (issue.catalogValue ?? {}), false);
    assert.deepEqual(
      issue.checklists.map((list) => list.catalogTotal?.amount),
      ["30.00", "15.00"]
    );
  });

  it("follows include_specialised as the union count does", async () => {
    const issueId = await newIssue("Shades");
    const s1 = await stamp(issueId, "s1", "10");
    const shade = await stamp(issueId, "shade", "5");
    const basic = await createChecklist(userId, collectionId, { issueId, name: "Basic" });
    const shades = await createChecklist(userId, collectionId, {
      issueId,
      name: "Shades",
      kind: "specialised",
    });
    await setChecklistStamps(userId, basic, [s1]);
    await setChecklistStamps(userId, shades, [s1, shade]);

    assert.equal((await getIssue(context, issueId)).catalogValue?.amount, "10.00");
    const on = await getIssue(context, issueId, { include_specialised: "true" });
    assert.equal(on.catalogValue?.amount, "15.00");
    assert.equal(on.requiredCount, 2);
  });

  it("returns the value with one checklist, equal to its total, and none with no checklist", async () => {
    const one = await newIssue("One");
    const x = await stamp(one, "x", "7.50");
    const y = await stamp(one, "y", "2.50");
    const set = await createChecklist(userId, collectionId, { issueId: one, name: "Set" });
    await setChecklistStamps(userId, set, [x, y]);
    const issue = await getIssue(context, one);
    assert.equal(issue.catalogValue?.amount, "10.00");
    assert.deepEqual(issue.catalogValue, { ...issue.checklists[0].catalogTotal });

    const bare = await newIssue("Bare");
    await stamp(bare, "z", "3");
    assert.equal("catalogValue" in (await getIssue(context, bare)), false);
  });
});
