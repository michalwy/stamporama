import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentIssueDetail, AgentStampDetail } from "../../src/lib/agent-api/collection-reads";
import type { AgentCreatedStamp } from "../../src/lib/agent-api/operations/catalog-edits";
import type { CollectionVocabulary } from "../../src/lib/agent-api/vocabulary";

// **Building the catalogue through the agent API (#1438), driven through the real route with real
// tokens.** `tests/unit/agent-api-catalog-edits.test.ts` holds the entry grammar, the date bounds and
// the duplicate sentence; `tests/unit/agent-api-operation-boundary.test.ts` holds *nothing is
// deleted, moved or reordered* as a fact about imports. This file holds the *Done when* as calls: an
// issue created with its stamps generated from catalogue ranges, stamps and variant runs added,
// names, translations, numbers and attributes corrected with only what was sent changing, a number
// already held refused naming the stamp that holds it — in a collection whose duplicate setting is
// only a warning — a grouping-only area refused, and a read-only token refused on every write.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, method: Method, path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown) {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

type CreatedIssue = AgentIssueDetail & { createdStamps: AgentCreatedStamp[] };
type Created = { createdStamps: AgentCreatedStamp[] };

const CATALOG_OPERATIONS = ["create_issue", "add_issue_stamps", "add_stamp_variants", "update_issue", "update_stamp"];

describe("the catalogue writes (#1438)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let europeId: string;
  let polandId: string;
  let michelId: string;
  let fischerId: string;
  let presetId: string;
  let perforationSubtypeId: string;
  let redId: string;
  /** Catalogued `Mi·PL 900`, on no issue — the number every duplicate below collides with. */
  let heldStamp: string;

  const stampCount = () => prisma.stamp.count({ where: { collectionId } });
  const issueCount = () => prisma.issue.count({ where: { collectionId } });

  before(async () => {
    userId = `test-user-catedit-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User catedit-${ts}`,
        email: `test-catedit-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // The default duplicate setting — a warning, which lets a person type a duplicate on purpose.
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-catedit-${ts}`, name: "Catalogue edits", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    fischerId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } })).id;
    // A catalogue the collection has and Poland does not keep.
    await prisma.catalogVendor.create({ data: { collectionId, name: "Scott", abbreviation: "Sc" } });
    europeId = (await prisma.collectionArea.create({ data: { collectionId, name: "Europe", assignable: false } })).id;
    polandId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          parentId: europeId,
          catalogPrefix: "PL",
          primaryCatalogVendorId: michelId,
          collectionAreaVendors: {
            create: [
              { catalogVendorId: michelId, areaPrefix: null },
              { catalogVendorId: fischerId, areaPrefix: "" },
            ],
          },
        },
      })
    ).id;
    // A marketplace listing in German is what makes German a translation language (#293).
    await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true, titleLanguage: "de" } });
    await prisma.stampSubtype.create({ data: { collectionId, name: "Color", actsAsVariant: true, isDefault: true, sortOrder: 0 } });
    perforationSubtypeId = (
      await prisma.stampSubtype.create({ data: { collectionId, name: "Perforation", actsAsVariant: true, sortOrder: 1 } })
    ).id;
    redId = (await prisma.stampColor.create({ data: { collectionId, name: "Red", sortOrder: 0 } })).id;
    presetId = (
      await prisma.stampSizePreset.create({ data: { collectionId, widthMm: 21.5, heightMm: 25, name: "Small", sortOrder: 0 } })
    ).id;
    heldStamp = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Already here",
          catalogNumbers: { create: [{ catalogVendorId: michelId, number: "900" }] },
          stampAreaLinks: { create: [{ collectionAreaId: polandId, isPrimary: true }] },
        },
      })
    ).id;

    token = (await createAssistantToken(userId, collectionId, { label: "catalogue agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "catalogue agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.updateMany({ where: { collectionId }, data: { parentId: null } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampSizePreset.deleteMany({ where: { collectionId } });
    await prisma.stampColor.deleteMany({ where: { collectionId } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("creating an issue", () => {
    it("generates its stamps from each catalogue's range, matched by position, sized and on its checklist", async () => {
      const issue = await ok<CreatedIssue>(token, "POST", "/issues", {
        area: "Poland",
        year: 1924,
        name: "Definitives",
        names: ["de: Freimarken"],
        catalog_numbers: ["Mi: 100-102", "Fi: 200-202"],
        size_preset: "Small",
      });
      assert.equal(issue.name, "Definitives");
      assert.equal(issue.year, 1924);
      assert.equal(issue.area, "Poland");
      assert.deepEqual(issue.catalogRanges.sort(), ["Fi 200–02", "Mi·PL 100–02"]);
      assert.equal(issue.memberCount, 3);
      assert.equal(issue.requiredCount, 3);
      assert.deepEqual(
        issue.createdStamps.map((stamp) => stamp.catalogNumbers),
        [
          ["Mi·PL 100", "Fi 200"],
          ["Mi·PL 101", "Fi 201"],
          ["Mi·PL 102", "Fi 202"],
        ]
      );

      const rows = await prisma.stamp.findMany({
        where: { id: { in: issue.createdStamps.map((stamp) => stamp.stampId) } },
        select: { id: true, issuedYear: true, widthMm: true, heightMm: true, issueMemberships: { select: { sortOrder: true } } },
      });
      for (const row of rows) {
        assert.equal(row.issuedYear, 1924);
        assert.deepEqual([row.widthMm?.toNumber(), row.heightMm?.toNumber()], [21.5, 25]);
      }
      const order = issue.createdStamps.map((stamp) => rows.find((row) => row.id === stamp.stampId)!.issueMemberships[0].sortOrder);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), "the stamps take the issue's order as the numbers were given");

      const translation = await prisma.issueTranslation.findUnique({
        where: { issueId_language: { issueId: issue.issueId, language: "de" } },
      });
      assert.equal(translation?.name, "Freimarken");
    });

    it("generates from the catalogues named in stamps_from, and only declares the others' ranges", async () => {
      const issue = await ok<CreatedIssue>(token, "POST", "/issues", {
        area: polandId,
        year: 1925,
        catalog_numbers: ["Mi: 110-111", "Fi: 210-214"],
        stamps_from: ["Mi"],
      });
      assert.deepEqual(issue.createdStamps.map((stamp) => stamp.catalogNumbers), [["Mi·PL 110"], ["Mi·PL 111"]]);
      assert.deepEqual(issue.catalogRanges.sort(), ["Fi 210–14", "Mi·PL 110–11"]);
    });

    it("creates an issue with no stamps when told not to generate any", async () => {
      const issue = await ok<CreatedIssue>(token, "POST", "/issues", {
        area: "Poland",
        name: "Empty",
        catalog_numbers: ["Mi: 120-125"],
        generate_stamps: false,
      });
      assert.equal(issue.memberCount, 0);
      assert.deepEqual(issue.createdStamps, []);
    });

    it("refuses catalogues whose spans differ, and writes nothing", async () => {
      const before = [await issueCount(), await stampCount()];
      const err = await refused(token, "POST", "/issues", { area: "Poland", catalog_numbers: ["Mi: 130-132", "Fi: 230-231"] });
      assert.equal(err.status, 400);
      assert.match(err.error.message, /stamps_from/);
      assert.deepEqual([await issueCount(), await stampCount()], before);
    });

    it("refuses a grouping-only area, naming the areas under it", async () => {
      const before = await issueCount();
      const err = await refused(token, "POST", "/issues", { area: "Europe", name: "Nowhere" });
      assert.equal(err.status, 400);
      assert.match(err.error.message, /grouping-only/);
      assert.deepEqual(err.error.accepted, ["Poland"]);
      assert.equal(await issueCount(), before);
    });

    it("refuses a catalogue the area does not keep, naming the ones it does", async () => {
      const err = await refused(token, "POST", "/issues", { area: "Poland", catalog_numbers: ["Sc: 1-2"] });
      assert.equal(err.status, 400);
      assert.deepEqual(err.error.accepted, ["Fischer (Fi)", "Michel (Mi)"]);
    });

    it("refuses a catalogue number the collection already has, naming the stamp, although duplicates only warn here", async () => {
      const before = [await issueCount(), await stampCount()];
      const err = await refused(token, "POST", "/issues", { area: "Poland", catalog_numbers: ["Mi: 899-901"] });
      assert.equal(err.status, 400);
      assert.match(err.error.message, /Mi·PL 900 is already "Already here"/);
      assert.deepEqual(err.error.accepted, [heldStamp]);
      assert.deepEqual([await issueCount(), await stampCount()], before);
    });

    it("refuses a translation in a language the collection does not keep", async () => {
      const err = await refused(token, "POST", "/issues", { area: "Poland", names: ["fr: Timbres"] });
      assert.deepEqual(err.error.accepted, ["de"]);
    });
  });

  describe("adding stamps and variants", () => {
    let issue: CreatedIssue;
    before(async () => {
      issue = await ok<CreatedIssue>(token, "POST", "/issues", {
        area: "Poland",
        year: 1930,
        name: "Airmail",
        catalog_numbers: ["Mi: 300-301"],
      });
    });

    it("adds stamps at the end of the issue's order, on its checklist, with its year", async () => {
      const added = await ok<Created>(token, "POST", `/issues/${issue.issueId}/stamps`, {
        catalog_numbers: ["Mi: 302, 304"],
        size_preset: presetId,
      });
      assert.deepEqual(added.createdStamps.map((stamp) => stamp.catalogNumbers), [["Mi·PL 302"], ["Mi·PL 304"]]);
      const members = await prisma.issueMember.findMany({
        where: { issueId: issue.issueId },
        orderBy: { sortOrder: "asc" },
        select: { stampId: true },
      });
      assert.deepEqual(
        members.map((member) => member.stampId),
        [...issue.createdStamps, ...added.createdStamps].map((stamp) => stamp.stampId)
      );
      const reread = await ok<AgentIssueDetail>(token, "GET", `/issues/${issue.issueId}`);
      assert.equal(reread.requiredCount, 4);
      const row = await prisma.stamp.findUniqueOrThrow({ where: { id: added.createdStamps[0].stampId }, select: { issuedYear: true } });
      assert.equal(row.issuedYear, 1930);
    });

    it("refuses a number already held, and adds nothing", async () => {
      const before = await stampCount();
      const err = await refused(token, "POST", `/issues/${issue.issueId}/stamps`, { catalog_numbers: ["Mi: 305, 900"] });
      assert.deepEqual(err.error.accepted, [heldStamp]);
      assert.equal(await stampCount(), before);
    });

    it("adds a variant run under a stamp, with its subtype and the base stamp's year, on no checklist", async () => {
      const base = issue.createdStamps[0].stampId;
      const variants = await ok<Created>(token, "POST", `/stamps/${base}/variants`, { numbers: "a-c", subtype: "Perforation" });
      assert.deepEqual(variants.createdStamps.map((stamp) => stamp.catalogNumbers), [["Mi·PL 300a"], ["Mi·PL 300b"], ["Mi·PL 300c"]]);
      const rows = await prisma.stamp.findMany({
        where: { id: { in: variants.createdStamps.map((stamp) => stamp.stampId) } },
        select: { parentId: true, subtypeId: true, issuedYear: true, checklistEntries: { select: { checklistId: true } } },
      });
      for (const row of rows) {
        assert.equal(row.parentId, base);
        assert.equal(row.subtypeId, perforationSubtypeId);
        assert.equal(row.issuedYear, 1930);
        assert.deepEqual(row.checklistEntries, []);
      }
    });

    it("refuses a variant number already held, and adds nothing", async () => {
      const base = issue.createdStamps[1].stampId;
      await ok<Created>(token, "POST", `/stamps/${base}/variants`, { numbers: "a" });
      const before = await stampCount();
      const err = await refused(token, "POST", `/stamps/${base}/variants`, { numbers: "a-b" });
      assert.match(err.error.message, /Mi·PL 301a is already/);
      assert.equal(await stampCount(), before);
    });
  });

  describe("editing", () => {
    let issue: CreatedIssue;
    before(async () => {
      issue = await ok<CreatedIssue>(token, "POST", "/issues", {
        area: "Poland",
        year: 1933,
        name: "Castles",
        catalog_numbers: ["Mi: 400-401", "Fi: 500-501"],
      });
    });

    it("corrects an issue's name, keeping its year, and one catalogue's range, keeping the other's", async () => {
      const updated = await ok<AgentIssueDetail>(token, "PATCH", `/issues/${issue.issueId}`, {
        name: "Castles and towns",
        names: ["de: Burgen"],
        catalog_numbers: ["Mi: 400-405"],
      });
      assert.equal(updated.name, "Castles and towns");
      assert.equal(updated.year, 1933);
      assert.deepEqual(updated.catalogRanges.sort(), ["Fi 500–01", "Mi·PL 400–05"]);
      assert.equal(updated.memberCount, 2, "a range edit creates no stamp");

      const cleared = await ok<AgentIssueDetail>(token, "PATCH", `/issues/${issue.issueId}`, { clear: ["year"], clear_names: ["de"] });
      assert.equal(cleared.year, undefined);
      assert.equal(cleared.name, "Castles and towns");
      assert.equal(await prisma.issueTranslation.count({ where: { issueId: issue.issueId } }), 0);
    });

    it("corrects a stamp, changing only what was sent", async () => {
      const stampId = issue.createdStamps[0].stampId;
      await prisma.stamp.update({ where: { id: stampId }, data: { denomination: "5 gr", perforation: "12" } });

      const updated = await ok<AgentStampDetail>(token, "PATCH", `/stamps/${stampId}`, {
        name: "Wawel",
        names: ["de: Wawel-Burg"],
        issued_month: 5,
        catalog_numbers: ["Mi: 400a"],
        color: "red",
        clear: ["perforation"],
      });
      assert.equal(updated.name, "Wawel");
      assert.equal(updated.issuedYear, 1933, "the year was not sent and stays");
      assert.equal(updated.issuedMonth, 5);
      assert.deepEqual(updated.catalogNumbers, ["Mi·PL 400a", "Fi 500"]);
      assert.equal(updated.color, "Red");
      assert.equal(updated.denomination, "5 gr", "not sent, not cleared");
      assert.equal(updated.perforation, undefined);
      const row = await prisma.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { colorId: true, translations: { select: { language: true, name: true } } },
      });
      assert.equal(row.colorId, redId);
      assert.deepEqual(row.translations, [{ language: "de", name: "Wawel-Burg" }]);
    });

    it("refuses a stamp number another stamp has, and writes nothing", async () => {
      const stampId = issue.createdStamps[1].stampId;
      const err = await refused(token, "PATCH", `/stamps/${stampId}`, { name: "Renamed", catalog_numbers: ["Mi: 900"] });
      assert.deepEqual(err.error.accepted, [heldStamp]);
      const row = await prisma.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { name: true, catalogNumbers: { where: { catalogVendorId: michelId }, select: { number: true } } },
      });
      assert.equal(row.name, null);
      assert.deepEqual(row.catalogNumbers, [{ number: "401" }]);
    });

    it("keeps a stamp's own number when it is sent back unchanged", async () => {
      const stampId = issue.createdStamps[1].stampId;
      const updated = await ok<AgentStampDetail>(token, "PATCH", `/stamps/${stampId}`, { catalog_numbers: ["Mi: 401"] });
      assert.deepEqual(updated.catalogNumbers, ["Mi·PL 401", "Fi 501"]);
    });

    it("refuses a run where one number belongs, and an edit that changes nothing", async () => {
      const stampId = issue.createdStamps[1].stampId;
      const run = await refused(token, "PATCH", `/stamps/${stampId}`, { catalog_numbers: ["Mi: 401-402"] });
      assert.match(run.error.message, /one number in each catalogue/);
      const nothing = await refused(token, "PATCH", `/stamps/${stampId}`, {});
      assert.match(nothing.error.message, /Nothing to change/);
    });
  });

  describe("the vocabulary", () => {
    it("carries the attribute dictionaries update_stamp takes", async () => {
      const vocabulary = await ok<CollectionVocabulary>(token, "GET", "/vocabulary");
      assert.deepEqual(vocabulary.colors, [{ id: redId, name: "Red" }]);
      assert.deepEqual([vocabulary.watermarks, vocabulary.papers, vocabulary.printings], [[], [], []]);
    });
  });

  describe("the boundary", () => {
    it("refuses a read-only token on every catalogue write, and writes nothing", async () => {
      const issue = await prisma.issue.findFirstOrThrow({ where: { collectionId }, select: { id: true } });
      const before = [await issueCount(), await stampCount()];
      const calls: [Method, string][] = [
        ["POST", "/issues"],
        ["POST", `/issues/${issue.id}/stamps`],
        ["POST", `/stamps/${heldStamp}/variants`],
        ["PATCH", `/issues/${issue.id}`],
        ["PATCH", `/stamps/${heldStamp}`],
      ];
      for (const [method, path] of calls) {
        const err = await refused(readOnlyToken, method, path, { name: "x" });
        assert.equal(err.status, 403, `${method} ${path}`);
        assert.equal(err.error.code, "forbidden");
        assert.ok(err.error.accepted?.includes("read_write"));
      }
      assert.deepEqual([await issueCount(), await stampCount()], before);
    });

    it("publishes exactly these catalogue writes, and nothing that deletes, moves or reorders an issue or a stamp", () => {
      const catalogue = OPERATIONS.filter((op) => /^\/(issues|stamps)(\/|$)/.test(op.path) && op.writes).map((op) => op.name);
      assert.deepEqual(catalogue.sort(), [...CATALOG_OPERATIONS].sort());
      for (const name of CATALOG_OPERATIONS) {
        assert.equal(OPERATIONS.find((op) => op.name === name)?.writes, true, name);
      }
      const destructive = OPERATIONS.filter(
        (op) =>
          op.method === "DELETE" && /^\/(issues|stamps)/.test(op.path) ||
          /^(delete|remove|move|merge|reorder|reparent)_.*(issue|stamp|variant)/.test(op.name)
      );
      assert.deepEqual(destructive.map((op) => op.name), []);
    });
  });
});
