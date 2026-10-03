import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { colnectStampUrl } from "../../src/lib/colnect-link";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentColnectIdWrite } from "../../src/lib/agent-api/colnect-ids";
import type { AgentStampDetail } from "../../src/lib/agent-api/collection-reads";

// **A stamp's Colnect ID through the agent API (#1445), driven through the real route with real
// tokens.** `tests/unit/agent-api-colnect-ids.test.ts` holds how the value is read and the refusal's
// wording. This file holds the *Done when* as calls: set, change and clear with the replaced ID
// reported, an ID another stamp holds refused with the holder named, a forgery written like any stamp,
// an ambiguous number refused with its candidates, and a read-only token refused.

const ts = Date.now();

type Method = "GET" | "POST";
const HANDLERS = { GET, POST };

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

async function set(token: string, body: unknown): Promise<AgentColnectIdWrite> {
  const answer = await call(token, "POST", "/stamp-colnect-id", body);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body as AgentColnectIdWrite;
}

async function refused(token: string, body: unknown) {
  const answer = await call(token, "POST", "/stamp-colnect-id", body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

describe("set_stamp_colnect_id (#1445)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let s301: string, s302: string;
  /** A variant of `301` under a `Forgery` subtype that does not act as a variant (ADR-0049). */
  let forgery: string;
  /** Two stamps both catalogued `Mi 400`, so the number names neither. */
  let dupA: string, dupB: string;

  // Read back rather than stated: the database hands out a stamp's number (#1574, ADR-0062).
  const stampNoOf = async (stampId: string) =>
    (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { stampNo: true } })).stampNo;
  const colnectIdOf = async (stampId: string) =>
    (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { colnectId: true } })).colnectId;

  before(async () => {
    userId = `test-user-colnectids-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User colnectids-${ts}`,
        email: `test-colnectids-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-colnectids-${ts}`, name: "Colnect ids", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    const forgerySubtypeId = (
      await prisma.stampSubtype.create({ data: { collectionId, name: "Forgery", actsAsVariant: false, sortOrder: 0 } })
    ).id;

    const stamp = async (number: string, extra: { parentId?: string; subtypeId?: string } = {}) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Germania ${number}`,
            ...extra,
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    s301 = await stamp("301");
    s302 = await stamp("302");
    forgery = await stamp("301F", { parentId: s301, subtypeId: forgerySubtypeId });
    dupA = await stamp("400");
    dupB = await stamp("400");

    token = (await createAssistantToken(userId, collectionId, { label: "colnect agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "colnect agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  beforeEach(async () => {
    await prisma.stamp.updateMany({ where: { collectionId }, data: { colnectId: null } });
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.stamp.updateMany({ where: { collectionId }, data: { parentId: null } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("sets an ID by catalogue number, and everything that reads the stamp's ID sees it at once", async () => {
    const answer = await set(token, { stamp: "Mi 301", colnect_id: "1133075" });
    assert.deepEqual(answer, { status: "written", stampId: s301, stampNo: await stampNoOf(s301), catalogNumbers: ["Mi 301"], colnectId: "1133075" });
    assert.equal(await colnectIdOf(s301), "1133075");

    // The listing kit, the Colnect links and the list sync all read `Stamp.colnectId`, and so does
    // `get_stamp` — there is no second place for the ID to lag behind in.
    const read = await call(token, "GET", `/stamps/${s301}`);
    assert.equal((read.body as AgentStampDetail).colnectId, "1133075");
    assert.equal(colnectStampUrl(await colnectIdOf(s301)), "https://colnect.com/en/stamps/stamp/1133075");
  });

  it("reads the ID out of a Colnect stamp address, and answers unchanged for the ID already there", async () => {
    await set(token, { stamp: s302, colnect_id: "https://colnect.com/en/stamps/stamp/555-Germania" });
    assert.equal(await colnectIdOf(s302), "555");
    const again = await set(token, { stamp: s302, colnect_id: "555" });
    assert.deepEqual(again, { status: "unchanged", stampId: s302, stampNo: await stampNoOf(s302), catalogNumbers: ["Mi 302"], colnectId: "555" });
  });

  it("changes and clears an ID, naming the one it replaced each time", async () => {
    await set(token, { stamp: s301, colnect_id: "100" });
    const changed = await set(token, { stamp: s301, colnect_id: "200" });
    assert.equal(changed.status, "written");
    assert.equal(changed.colnectId, "200");
    assert.equal(changed.replaced, "100");

    const cleared = await set(token, { stamp: s301, clear: true });
    assert.deepEqual(cleared, { status: "cleared", stampId: s301, stampNo: await stampNoOf(s301), catalogNumbers: ["Mi 301"], replaced: "200" });
    assert.equal(await colnectIdOf(s301), null);

    const nothing = await set(token, { stamp: s301, clear: true });
    assert.deepEqual(nothing, { status: "unchanged", stampId: s301, stampNo: await stampNoOf(s301), catalogNumbers: ["Mi 301"] });
  });

  it("refuses an ID another stamp holds, naming that stamp, and writes nothing", async () => {
    await set(token, { stamp: s301, colnect_id: "777" });
    await set(token, { stamp: s302, colnect_id: "888" });
    const { status, error } = await refused(token, { stamp: s302, colnect_id: "777" });
    assert.equal(status, 400);
    assert.match(error.message, /777 already belongs to "Germania 301" \(Mi 301, id /);
    assert.deepEqual(error.accepted, [s301]);
    assert.equal(await colnectIdOf(s302), "888");
    assert.equal(await colnectIdOf(s301), "777");
  });

  it("writes a forgery's ID like any other stamp's (#1007 closed: a forgery is an ordinary variant)", async () => {
    const answer = await set(token, { stamp: forgery, colnect_id: "4242" });
    assert.equal(answer.status, "written");
    assert.equal(await colnectIdOf(forgery), "4242");
    // And the umbrella above it is not touched: an ID is a claim about the stamp it is set on (#616).
    assert.equal(await colnectIdOf(s301), null);
  });

  it("refuses an ambiguous catalogue number with its candidates, and a malformed call", async () => {
    const ambiguous = await refused(token, { stamp: "Mi 400", colnect_id: "1" });
    assert.equal(ambiguous.status, 400);
    assert.deepEqual([...(ambiguous.error.accepted ?? [])].sort(), [dupA, dupB].sort());
    assert.equal(await colnectIdOf(dupA), null);
    assert.equal(await colnectIdOf(dupB), null);

    for (const body of [
      { stamp: s301 },
      { stamp: s301, colnect_id: "1", clear: true },
      { stamp: s301, colnect_id: "https://colnect.com/en/stamps/list/country/173" },
    ]) {
      const { status } = await refused(token, body);
      assert.equal(status, 400, JSON.stringify(body));
    }
    assert.equal(await colnectIdOf(s301), null);
  });

  it("refuses a read-only token, naming the scope needed, and writes nothing", async () => {
    const operation = OPERATIONS.find((op) => op.name === "set_stamp_colnect_id");
    assert.equal(operation?.writes, true);
    const { status, error } = await refused(readOnlyToken, { stamp: s301, colnect_id: "1" });
    assert.equal(status, 403);
    assert.equal(error.code, "forbidden");
    assert.ok(error.accepted?.includes("read_write"));
    assert.equal(await colnectIdOf(s301), null);
  });
});
