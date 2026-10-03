import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createStamp, createVariant, deleteStamp } from "../../src/lib/stamps";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { resolveQuickJump } from "../../src/lib/quick-jump-server";
import { parseQuickJump } from "../../src/lib/quick-jump";
import { GET, PATCH } from "../../src/app/api/v1/[...path]/route";
import type { AgentStampDetail } from "../../src/lib/agent-api/collection-reads";
import type { AgentStampSize } from "../../src/lib/agent-api/size-reads";

// A stamp's short number (#1574): every stamp and variant gets one, allocated from the collection's
// counter by a database trigger (ADR-0062), never reused and never changed. It is shown on stamp
// rows, taken by `st` in the quick-jump box, and returned and accepted by the agent API.
//
// The trigger is the thing under test as much as the rules: it is why a stamp written by *any* path —
// the app's own creates, a nested variant, a bare `prisma.stamp.create` with no number in it —
// comes out numbered, so the creates here are deliberately of more than one kind.

const ts = Date.now();

async function call(token: string, method: "GET" | "PATCH", path: string, body?: unknown) {
  const [pathname, search] = path.split("?");
  const request = new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const handler = method === "GET" ? GET : PATCH;
  const response = await handler(request, {
    params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("stamp short numbers (#1574)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let collectionSlug: string;
  let otherCollectionId: string;
  let token: string;

  const noOf = async (stampId: string) =>
    (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { stampNo: true } })).stampNo;

  before(async () => {
    userId = `test-user-stampno-${ts}`;
    strangerId = `test-user-stampno-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionSlug = `col-stampno-${ts}`;
    collectionId = (
      await prisma.collection.create({
        data: { slug: collectionSlug, name: "Stamp numbers", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-stampno-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    token = (await createAssistantToken(userId, collectionId, { label: "stamp numbers", scope: "read_write", kind: "agent" }))
      .token;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  // ── allocation ────────────────────────────────────────────────────────────

  it("numbers stamps and variants in order of creation, from every path, per collection", async () => {
    const base = await createStamp(userId, collectionId, { name: "Base" });
    const variant = await createVariant(userId, base.id, { name: "Variant" });
    // No number in the data at all — the trigger supplies it, which is the point of having one.
    const bare = await prisma.stamp.create({ data: { collectionId, name: "Bare" }, select: { id: true, stampNo: true } });
    const elsewhere = await createStamp(userId, otherCollectionId, { name: "Elsewhere" });

    const [a, b] = [await noOf(base.id), await noOf(variant.id)];
    assert.equal(b, a + 1);
    assert.equal(bare.stampNo, a + 2);
    // Counted per collection: the other one starts at 1 of its own.
    assert.equal(await noOf(elsewhere.id), 1);
  });

  it("ignores a number a caller supplies, so no path can hand out a taken one", async () => {
    const first = await prisma.stamp.create({ data: { collectionId }, select: { stampNo: true } });
    const forced = await prisma.stamp.create({ data: { collectionId, stampNo: 1 }, select: { stampNo: true } });
    assert.equal(forced.stampNo, first.stampNo + 1);
  });

  it("never reuses a deleted stamp's number", async () => {
    const doomed = await createStamp(userId, collectionId, { name: "Doomed" });
    const doomedNo = await noOf(doomed.id);
    await deleteStamp(userId, doomed.id);
    const next = await createStamp(userId, collectionId, { name: "Next" });
    assert.equal(await noOf(next.id), doomedNo + 1);
  });

  it("burns no number on a create that rolls back", async () => {
    const before = await createStamp(userId, collectionId, {});
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.stamp.create({ data: { collectionId } });
        throw new Error("rolled back");
      })
    );
    const after = await createStamp(userId, collectionId, {});
    assert.equal(await noOf(after.id), (await noOf(before.id)) + 1);
  });

  it("refuses to change a number once given", async () => {
    const stamp = await createStamp(userId, collectionId, { name: "Fixed" });
    const no = await noOf(stamp.id);
    await assert.rejects(prisma.stamp.update({ where: { id: stamp.id }, data: { stampNo: no + 1000 } }), /never changes/);
    // Any other edit is untouched by the guard.
    await prisma.stamp.update({ where: { id: stamp.id }, data: { name: "Still fixed" } });
    assert.equal(await noOf(stamp.id), no);
  });

  // ── quick jump ────────────────────────────────────────────────────────────

  it("opens the stamp's own page for `st <no>`, and finds nothing for a stranger or a free number", async () => {
    const stamp = await createStamp(userId, collectionId, { name: "Jump target" });
    const no = await noOf(stamp.id);
    const target = parseQuickJump(`st ${no}`);
    assert.deepEqual(target, { entity: "stamp", no });

    const result = await resolveQuickJump(userId, collectionId, target!);
    assert.equal(result?.href, `/c/${collectionSlug}/stamps/${stamp.id}`);

    assert.equal(await resolveQuickJump(strangerId, collectionId, target!), null);
    assert.equal(await resolveQuickJump(userId, collectionId, { entity: "stamp", no: no + 100_000 }), null);
  });

  // ── agent API ─────────────────────────────────────────────────────────────

  it("returns the number with a stamp, and takes `st <no>` wherever a stamp is named", async () => {
    const stamp = await createStamp(userId, collectionId, { name: "Agent's stamp" });
    const no = await noOf(stamp.id);

    // By id: the answer carries the number beside it.
    const byId = await call(token, "GET", `/stamps/${stamp.id}`);
    assert.equal(byId.status, 200, JSON.stringify(byId.body));
    assert.equal((byId.body as unknown as AgentStampDetail).stampNo, no);

    // By number, in a path parameter that used to take an id only.
    const byNo = await call(token, "GET", `/stamps/${encodeURIComponent(`st ${no}`)}`);
    assert.equal(byNo.status, 200, JSON.stringify(byNo.body));
    assert.equal((byNo.body as unknown as AgentStampDetail).stampId, stamp.id);

    // By number, in a parameter that also takes catalogue numbers.
    const size = await call(token, "GET", `/stamp-size?stamp=${encodeURIComponent(`st${no}`)}`);
    assert.equal(size.status, 200, JSON.stringify(size.body));
    assert.equal((size.body as unknown as AgentStampSize).stampId, stamp.id);
    assert.equal((size.body as unknown as AgentStampSize).stampNo, no);

    // A write, named by number.
    const renamed = await call(token, "PATCH", `/stamps/${encodeURIComponent(`st ${no}`)}`, { name: "Renamed by number" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal((await prisma.stamp.findUniqueOrThrow({ where: { id: stamp.id } })).name, "Renamed by number");
  });

  it("refuses a number that names no stamp here, naming it, and never reaches another collection", async () => {
    const elsewhere = await createStamp(userId, otherCollectionId, { name: "Not this token's" });
    const elsewhereNo = await noOf(elsewhere.id);
    const free = elsewhereNo + 100_000;

    const missing = await call(token, "GET", `/stamps/${encodeURIComponent(`st ${free}`)}`);
    assert.equal(missing.status, 404);
    // Refused *as a number* — not passed through and refused as an id that happens to read `st …`.
    assert.match(JSON.stringify(missing.body), new RegExp(`No stamp st ${free} is in`));

    const listed = await call(token, "GET", `/stamp-size?stamp=${encodeURIComponent(`st ${free}`)}`);
    assert.equal(listed.status, 400);
    assert.match(JSON.stringify(listed.body), new RegExp(`names st ${free}, which is not in this collection`));

    // The other collection's number may well exist in this one too; whatever it names here, it is
    // never the other collection's stamp.
    const crossed = await call(token, "GET", `/stamps/${encodeURIComponent(`st ${elsewhereNo}`)}`);
    if (crossed.status === 200) assert.notEqual((crossed.body as unknown as AgentStampDetail).stampId, elsewhere.id);
  });
});
