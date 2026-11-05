import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentStampNumbersBatch } from "../../src/lib/agent-api/operations/catalog-edits";

// **A stamp's issue format through the agent API (#2445), driven through the real route with real
// tokens.** `tests/unit/agent-api-issue-formats.test.ts` holds the pure rules — `none`, the filter's
// values, the refusal for a name already answered to. This file holds the *Done when* as calls: the
// dictionary added to, corrected and ordered and never deleted; the issue format set on one stamp
// and on many in one batch; the stamps with none listed in an area; and every read that names a
// stamp's attributes naming its issue format, a copy reading its stamp's.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH";
const HANDLERS = { GET, POST, PATCH };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

interface IssueFormatAnswer {
  id: string;
  name: string;
  abbreviation: string;
  color?: string;
  stampCount: number;
}

interface ListAnswer<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

interface StampRow {
  stampId: string;
  stampNo: number;
  name?: string;
  issueFormat?: string;
  catalogNumbers: string[];
  area?: string;
  copies: number;
}

async function call(token: string, method: Method, path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path.replaceAll(" ", "%20")}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
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

describe("the issue format through the agent API (#2445)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let sheetId: string;
  let exSheetId: string;
  /** Poland: a souvenir sheet, two stamps taken out of it, and an ordinary stamp. Germany: one stamp. */
  let bl1: string, s101: string, s102: string, s200: string, de1: string;
  let copyOfS101: string;

  const issueFormatOf = async (stampId: string) =>
    (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { issueFormatId: true } })).issueFormatId;

  before(async () => {
    userId = `test-user-issueformats-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User issueformats-${ts}`,
        email: `test-issueformats-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-issueformats-${ts}`, name: "Issue formats", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const area = (name: string) =>
      prisma.collectionArea.create({
        data: {
          collectionId,
          name,
          primaryCatalogVendorId: michel.id,
          collectionAreaVendors: { create: [{ catalogVendorId: michel.id }] },
        },
      });
    const poland = await area("Poland");
    const germany = await area("Germany");
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: 1, collectionAreaId: poland.id, name: "Philatelic exhibition", year: 1938 },
    });
    const stamp = async (number: string, areaId: string, sortOrder: number) => {
      const created = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Exhibition ${number}`,
          issuedYear: 1938,
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      if (areaId === poland.id) await prisma.issueMember.create({ data: { issueId: issue.id, stampId: created.id, sortOrder } });
      return created.id;
    };
    bl1 = await stamp("Bl 1", poland.id, 0);
    s101 = await stamp("101", poland.id, 1);
    s102 = await stamp("102", poland.id, 2);
    s200 = await stamp("200", poland.id, 3);
    de1 = await stamp("50", germany.id, 0);
    copyOfS101 = (
      await prisma.item.create({ data: { collectionId, itemNo: 1, stampId: s101, conditionId: condition.id } })
    ).id;
    await prisma.item.create({ data: { collectionId, itemNo: 2, stampId: s200, conditionId: condition.id } });

    token = (await createAssistantToken(userId, collectionId, { label: "formats agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "formats agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampIssueFormat.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("the dictionary", () => {
    it("adds issue formats at the end of the order, with their colour, and the vocabulary lists them", async () => {
      const sheet = await ok<IssueFormatAnswer>(token, "POST", "/issue-formats", {
        name: "Souvenir sheet",
        abbreviation: "Bl",
        color: "indigo",
      });
      assert.deepEqual(
        { ...sheet, id: undefined },
        { id: undefined, name: "Souvenir sheet", abbreviation: "Bl", color: "indigo", stampCount: 0 }
      );
      sheetId = sheet.id;
      exSheetId = (
        await ok<IssueFormatAnswer>(token, "POST", "/issue-formats", { name: "Stamp from a souvenir sheet", abbreviation: "exBl" })
      ).id;
      await ok(token, "POST", "/issue-formats", { name: "Booklet pane", abbreviation: "HBl", color: "amber" });

      const vocabulary = await ok<{ issueFormats: { id: string; name: string; abbreviation: string; color?: string }[] }>(
        token,
        "GET",
        "/vocabulary"
      );
      assert.deepEqual(vocabulary.issueFormats, [
        { id: sheetId, name: "Souvenir sheet", abbreviation: "Bl", color: "indigo" },
        { id: exSheetId, name: "Stamp from a souvenir sheet", abbreviation: "exBl" },
        { id: vocabulary.issueFormats[2].id, name: "Booklet pane", abbreviation: "HBl", color: "amber" },
      ]);
    });

    it("refuses a name or an abbreviation another issue format answers to, and `none`, adding nothing", async () => {
      const count = () => prisma.stampIssueFormat.count({ where: { collectionId } });
      const before = await count();
      const byName = await refused(token, "POST", "/issue-formats", { name: "souvenir SHEET", abbreviation: "SS" });
      assert.match(byName.error.message, /already has an issue format answering to "souvenir SHEET"/);
      assert.deepEqual(byName.error.accepted, [sheetId]);
      const byAbbreviation = await refused(token, "POST", "/issue-formats", { name: "Block", abbreviation: "BL" });
      assert.deepEqual(byAbbreviation.error.accepted, [sheetId]);
      await refused(token, "POST", "/issue-formats", { name: "None", abbreviation: "N" });
      await refused(token, "POST", "/issue-formats", { name: "Coil", abbreviation: "Co", color: "beige" });
      assert.equal(await count(), before);
    });

    it("renames, recolours and makes a chip neutral — only what is sent changes — naming it by name or abbreviation", async () => {
      const renamed = await ok<IssueFormatAnswer>(token, "PATCH", "/issue-formats/HBl", { name: "Booklet pane (se-tenant)" });
      assert.deepEqual([renamed.name, renamed.abbreviation, renamed.color], ["Booklet pane (se-tenant)", "HBl", "amber"]);
      const recoloured = await ok<IssueFormatAnswer>(token, "PATCH", `/issue-formats/${renamed.id}`, { color: "teal" });
      assert.equal(recoloured.color, "teal");
      const neutral = await ok<IssueFormatAnswer>(token, "PATCH", "/issue-formats/Booklet pane (se-tenant)", { clear: ["color"] });
      assert.equal(neutral.color, undefined);
      assert.equal(neutral.name, "Booklet pane (se-tenant)");

      const clash = await refused(token, "PATCH", `/issue-formats/${renamed.id}`, { abbreviation: "exbl" });
      assert.deepEqual(clash.error.accepted, [exSheetId]);
      // Its own words in another case are not a clash.
      await ok(token, "PATCH", `/issue-formats/${sheetId}`, { abbreviation: "BL" });
      await ok(token, "PATCH", `/issue-formats/${sheetId}`, { abbreviation: "Bl" });
      await refused(token, "PATCH", `/issue-formats/${sheetId}`, {});
    });

    it("orders them: those sent lead, the rest follow in their order", async () => {
      const answer = await ok<{ issueFormats: { id: string; name: string; position: number }[]; placed: number; keptAfter: number }>(
        token,
        "POST",
        "/issue-formats/order",
        { issue_formats: ["HBl"] }
      );
      assert.deepEqual(
        answer.issueFormats.map((row) => [row.name, row.position]),
        [["Booklet pane (se-tenant)", 1], ["Souvenir sheet", 2], ["Stamp from a souvenir sheet", 3]]
      );
      assert.deepEqual([answer.placed, answer.keptAfter], [1, 2]);
      await ok(token, "POST", "/issue-formats/order", { issue_formats: ["Bl", "exBl"] });
      const vocabulary = await ok<{ issueFormats: { name: string }[] }>(token, "GET", "/vocabulary");
      assert.deepEqual(vocabulary.issueFormats.map((row) => row.name), ["Souvenir sheet", "Stamp from a souvenir sheet", "Booklet pane (se-tenant)"]);
    });

    it("has no operation that deletes one, and a read-only token writes none", async () => {
      assert.deepEqual(
        OPERATIONS.filter((op) => op.path.startsWith("/issue-formats")).map((op) => `${op.method} ${op.path}`).sort(),
        ["PATCH /issue-formats/{issue_format_id}", "POST /issue-formats", "POST /issue-formats/order"]
      );
      const denied = await refused(readOnlyToken, "POST", "/issue-formats", { name: "Coil stamp", abbreviation: "Coil" });
      assert.equal(denied.status, 403);
    });
  });

  describe("a stamp's issue format", () => {
    it("is set by `update_stamp` by abbreviation, read back by `get_stamp`, and cleared", async () => {
      const set = await ok<{ issueFormat?: string; catalogNumbers: string[] }>(token, "PATCH", `/stamps/${bl1}`, { issue_format: "bl" });
      assert.equal(set.issueFormat, "Souvenir sheet");
      assert.equal(set.catalogNumbers.length, 1, "the stamp's number is restated, not touched");
      assert.equal(await issueFormatOf(bl1), sheetId);
      const read = await ok<{ issueFormat?: string }>(token, "GET", `/stamps/${bl1}`);
      assert.equal(read.issueFormat, "Souvenir sheet");

      const cleared = await ok<{ issueFormat?: string }>(token, "PATCH", `/stamps/${bl1}`, { clear: ["issue_format"] });
      assert.equal(cleared.issueFormat, undefined);
      assert.equal(await issueFormatOf(bl1), null);
      const unknown = await refused(token, "PATCH", `/stamps/${bl1}`, { issue_format: "Coil stamp" });
      assert.match(unknown.error.message, /issue format/);
      await refused(token, "PATCH", `/stamps/${bl1}`, { issue_format: "Bl", clear: ["issue_format"] });
    });

    it("is set on many stamps in one `update_stamps` batch, each answered on its own", async () => {
      const answer = await ok<AgentStampNumbersBatch>(token, "PATCH", "/stamps", {
        updates: [
          "stamp=Mi Bl 1; issue_format=Souvenir sheet",
          `stamp=${s101}; issue_format=exBl`,
          "stamp=Mi 102; issue_format=Stamp from a souvenir sheet; catalog_numbers=Mi: 102",
          "stamp=Mi 200; issue_format=none",
          "stamp=Mi 50; issue_format=Coil stamp",
          "stamp=Mi 200",
        ],
      });
      assert.deepEqual([answer.written, answer.unchanged, answer.refused], [3, 1, 2], JSON.stringify(answer.updates));
      assert.deepEqual(
        answer.updates.map((update) => update.status),
        ["written", "written", "written", "unchanged", "refused", "refused"]
      );
      const first = answer.updates[0];
      assert.ok(first.status === "written");
      assert.deepEqual([first.issueFormat, first.replacedIssueFormat], ["Souvenir sheet", "none"]);
      const ordinary = answer.updates[3];
      assert.ok(ordinary.status === "unchanged");
      assert.equal(ordinary.issueFormat, undefined);
      const unknown = answer.updates[4];
      assert.ok(unknown.status === "refused");
      assert.match(unknown.reason, /"Coil stamp" is not an issue format in this collection/);
      const nothing = answer.updates[5];
      assert.ok(nothing.status === "refused");
      assert.match(nothing.reason, /nothing to change/);
      assert.deepEqual(
        [await issueFormatOf(bl1), await issueFormatOf(s101), await issueFormatOf(s102), await issueFormatOf(s200), await issueFormatOf(de1)],
        [sheetId, exSheetId, exSheetId, null, null]
      );

      // `none` takes it off again, naming what it replaced so it can be put back.
      const back = await ok<AgentStampNumbersBatch>(token, "PATCH", "/stamps", { updates: ["stamp=Mi 102; issue_format=none"] });
      const undone = back.updates[0];
      assert.ok(undone.status === "written");
      assert.equal(undone.replacedIssueFormat, "Stamp from a souvenir sheet");
      assert.equal(await issueFormatOf(s102), null);
      await ok(token, "PATCH", "/stamps", { updates: ["stamp=Mi 102; issue_format=exBl"] });
    });
  });

  describe("the stamp, copy and catalogue lists filter by it", () => {
    it("lists the stamps of an area with no issue format — `list_stamps` with `none`", async () => {
      const answer = await ok<ListAnswer<StampRow>>(token, "GET", "/stamps?area=Poland&issue_format=none");
      assert.deepEqual(answer.items.map((row) => row.stampId), [s200]);
      assert.equal(answer.total, 1);
      assert.equal(answer.items[0].issueFormat, undefined);
      assert.equal(answer.items[0].copies, 1);

      const sheets = await ok<ListAnswer<StampRow>>(token, "GET", "/stamps?area=Poland&issue_format=Bl,exBl");
      assert.equal(sheets.total, 3);
      assert.deepEqual(
        Object.fromEntries(sheets.items.map((row) => [row.stampId, row.issueFormat])),
        { [bl1]: "Souvenir sheet", [s101]: "Stamp from a souvenir sheet", [s102]: "Stamp from a souvenir sheet" }
      );
      const both = await ok<ListAnswer<StampRow>>(token, "GET", "/stamps?issue_format=Bl&issue_format=none");
      assert.equal(both.total, 3, "the souvenir sheet and the two ordinary stamps, Poland's and Germany's");
      const unknown = await refused(token, "GET", "/stamps?issue_format=Coil");
      assert.match(unknown.error.message, /issue format/);
    });

    it("narrows the holdings to copies of a format, each row naming its stamp's", async () => {
      const answer = await ok<ListAnswer<{ copyId: string; issueFormat?: string; format?: string }>>(
        token,
        "GET",
        "/holdings?issue_format=Stamp from a souvenir sheet"
      );
      assert.deepEqual(answer.items.map((row) => [row.copyId, row.issueFormat, row.format]), [
        [copyOfS101, "Stamp from a souvenir sheet", undefined],
      ]);
      const ordinary = await ok<ListAnswer<{ copyId: string; issueFormat?: string }>>(token, "GET", "/holdings?issue_format=none");
      assert.equal(ordinary.total, 1);
      assert.equal(ordinary.items[0].issueFormat, undefined);
      const copy = await ok<{ issueFormat?: string }>(token, "GET", `/copies/${copyOfS101}`);
      assert.equal(copy.issueFormat, "Stamp from a souvenir sheet");
    });

    it("narrows the issues to those with a stamp of the format, their stamps naming theirs", async () => {
      const answer = await ok<ListAnswer<{ name?: string; stamps?: { stampId: string; issueFormat?: string }[] }>>(
        token,
        "GET",
        "/issues?area=Poland&issue_format=Bl&include_numbers=true"
      );
      assert.deepEqual(answer.items.map((row) => row.name), ["Philatelic exhibition"]);
      const formats = Object.fromEntries((answer.items[0].stamps ?? []).map((row) => [row.stampId, row.issueFormat]));
      assert.deepEqual(formats, {
        [bl1]: "Souvenir sheet",
        [s101]: "Stamp from a souvenir sheet",
        [s102]: "Stamp from a souvenir sheet",
        [s200]: undefined,
      });
      const none = await ok<ListAnswer<unknown>>(token, "GET", "/issues?area=Germany&issue_format=Bl");
      assert.equal(none.total, 0);
    });

    it("names it on what a search finds", async () => {
      const answer = await ok<{ stamps: { stampId: string; issueFormat?: string }[]; copies: { copyId: string; issueFormat?: string }[] }>(
        token,
        "GET",
        "/search?query=Exhibition 101"
      );
      assert.equal(answer.stamps.find((row) => row.stampId === s101)?.issueFormat, "Stamp from a souvenir sheet");
      assert.equal(answer.copies.find((row) => row.copyId === copyOfS101)?.issueFormat, "Stamp from a souvenir sheet");
    });

    it("counts the stamps carrying an issue format on the dictionary's answer", async () => {
      const answer = await ok<IssueFormatAnswer>(token, "PATCH", "/issue-formats/exBl", { color: "violet" });
      assert.equal(answer.stampCount, 2);
    });
  });
});
