import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentSizeApply, AgentSizePreset, AgentStampSize } from "../../src/lib/agent-api/size-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Stamp sizes and size presets through the agent API (#1415), driven through the real route with
// real tokens.** `tests/unit/agent-api-size-reads.test.ts` holds the figure grammar, the source rule
// and the refusal wording; `tests/unit/agent-api-operation-boundary.test.ts` holds *no preset is
// deleted* as a fact about imports; `tests/integration/stamp-size-presets.test.ts` holds which stamps
// an apply reaches. This file holds the *Done when* as calls: what each read says, that a preview
// writes nothing and an apply writes what it previewed, that a stated size survives every write that
// was not told to overwrite, and that a read-only token is refused on every write.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, method: Method, path: string, body?: unknown) {
  const [pathname, search] = path.split("?");
  const request = new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }),
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

const SIZE_PATHS = /^\/(size-presets|stamp-size)/;

describe("the size operations (#1415)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let issueId: string;
  let checklistId: string;
  /** `301`–`304` on the issue and its checklist; `303a` a variant under `303`, on neither. */
  let s301: string, s302: string, s303: string, s303a: string, s304: string;
  /** Two stamps both catalogued `Mi 400`, so the number names neither. */
  let dupA: string, dupB: string;
  /** In the collection, on no checklist. */
  let loner: string;

  const sizeOf = async (stampId: string) => {
    const row = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { widthMm: true, heightMm: true } });
    return { widthMm: row.widthMm?.toNumber() ?? null, heightMm: row.heightMm?.toNumber() ?? null };
  };
  const setSize = (stampId: string, widthMm: number | null, heightMm: number | null) =>
    prisma.stamp.update({ where: { id: stampId }, data: { widthMm, heightMm } });

  before(async () => {
    userId = `test-user-sizeops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User sizeops-${ts}`,
        email: `test-sizeops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sizeops-${ts}`, name: "Size ops", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    issueId = (
      await prisma.issue.create({ data: { collectionId, issueNo: 9415, collectionAreaId: areaId, name: "Germania", year: 1902 } })
    ).id;

    const stamp = async (number: string, parentId?: string) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Germania ${number}`,
            parentId,
            // The catalog order the inheritance is reckoned along, stated rather than left to ids.
            primaryCatalogSortKey: number.replace(/^(\d+)(.*)$/, (_, n: string, s: string) => `${n.padStart(10, "0")}${s}`),
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    s301 = await stamp("301");
    s302 = await stamp("302");
    s303 = await stamp("303");
    s303a = await stamp("303a", s303);
    s304 = await stamp("304");
    dupA = await stamp("400");
    dupB = await stamp("400");
    loner = await stamp("500");

    const members = [s301, s302, s303, s304];
    await prisma.issueMember.createMany({ data: members.map((stampId, i) => ({ issueId, stampId, sortOrder: i })) });
    checklistId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId,
          name: "Basic",
          sortOrder: 0,
          stamps: { create: members.map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      })
    ).id;

    token = (await createAssistantToken(userId, collectionId, { label: "size agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "size agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  beforeEach(async () => {
    await prisma.stamp.updateMany({ where: { collectionId }, data: { widthMm: null, heightMm: null } });
    await prisma.stampSizePreset.deleteMany({ where: { collectionId } });
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.stampSizePreset.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issueId } });
    await prisma.stamp.updateMany({ where: { collectionId }, data: { parentId: null } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("presets", () => {
    it("are listed, created and corrected, and a pair already saved is refused with its preset", async () => {
      const empty = await ok<ListResponse<AgentSizePreset>>(token, "GET", "/size-presets");
      assert.equal(empty.total, 0);

      const germania = await ok<AgentSizePreset>(token, "POST", "/size-presets", {
        width_mm: "25",
        height_mm: "30",
        name: "Germania",
      });
      assert.equal(germania.label, "25 × 30 mm · Germania");
      const bare = await ok<AgentSizePreset>(token, "POST", "/size-presets", { width_mm: "21,5", height_mm: "25" });
      assert.equal(bare.label, "21.5 × 25 mm");

      const listed = await ok<ListResponse<AgentSizePreset>>(token, "GET", "/size-presets");
      assert.equal(listed.total, 2);
      assert.deepEqual(listed.items.map((p) => p.presetId), [germania.presetId, bare.presetId]);

      const taken = await refused(token, "POST", "/size-presets", { width_mm: "25.0", height_mm: "30", name: "Again" });
      assert.equal(taken.status, 400);
      assert.deepEqual(taken.error.accepted, [germania.presetId]);
      assert.equal(await prisma.stampSizePreset.count({ where: { collectionId } }), 2);

      // Only what is sent changes.
      const renamed = await ok<AgentSizePreset>(token, "PATCH", `/size-presets/${bare.presetId}`, { name: "Small" });
      assert.deepEqual([renamed.widthMm, renamed.heightMm, renamed.name], [21.5, 25, "Small"]);
      const corrected = await ok<AgentSizePreset>(token, "PATCH", `/size-presets/${bare.presetId}`, { height_mm: "25.5" });
      assert.deepEqual([corrected.widthMm, corrected.heightMm, corrected.name], [21.5, 25.5, "Small"]);
      const cleared = await ok<AgentSizePreset>(token, "PATCH", `/size-presets/${bare.presetId}`, { clear: ["name"] });
      assert.equal(cleared.name, undefined);

      const onto = await refused(token, "PATCH", `/size-presets/${bare.presetId}`, { width_mm: "25", height_mm: "30" });
      assert.deepEqual(onto.error.accepted, [germania.presetId]);
      const nothing = await refused(token, "PATCH", `/size-presets/${bare.presetId}`, {});
      assert.match(nothing.error.message, /Nothing to change/);
      const tooFine = await refused(token, "POST", "/size-presets", { width_mm: "25.05", height_mm: "30" });
      assert.match(tooFine.error.message, /to a tenth at most/);
    });

    it("cannot be deleted: no operation deletes or reorders one", () => {
      const sizeOps = OPERATIONS.filter((op) => SIZE_PATHS.test(op.path));
      assert.deepEqual(
        sizeOps.map((op) => `${op.method} ${op.path} ${op.name}`).sort(),
        [
          "GET /size-presets list_size_presets",
          "GET /stamp-size get_stamp_size",
          "GET /stamp-sizes/apply preview_stamp_size_apply",
          "PATCH /size-presets/{preset_id} update_size_preset",
          "POST /size-presets create_size_preset",
          "POST /stamp-size set_stamp_size",
          "POST /stamp-sizes/apply apply_stamp_size",
        ]
      );
      const deleting = OPERATIONS.filter(
        (op) => /preset/.test(op.name) && (op.method === "DELETE" || /^(delete|remove|reorder|move)_/.test(op.name))
      );
      assert.deepEqual(deleting, []);
    });
  });

  describe("one stamp", () => {
    it("reads stated, inherited through its checklist, and none, named by id or catalogue number", async () => {
      await setSize(s302, 21, 25);
      await setSize(s304, 22, null);

      const stated = await ok<AgentStampSize>(token, "GET", `/stamp-size?stamp=${s302}`);
      assert.equal(stated.source, "stated");
      assert.deepEqual([stated.widthMm, stated.heightMm], [21, 25]);
      assert.deepEqual(stated.catalogNumbers, ["Mi 302"]);

      const inherited = await ok<AgentStampSize>(token, "GET", `/stamp-size?stamp=${encodeURIComponent("Mi 301")}`);
      assert.equal(inherited.stampId, s301);
      assert.equal(inherited.source, "inherited");
      assert.equal(inherited.widthMm, undefined);
      assert.deepEqual(inherited.inherited, [
        { checklistId, checklist: "Basic", widthMm: 21, heightMm: 25, fromStampId: s302, fromCatalogNumber: "Mi 302" },
      ]);

      // Half a size is not a size: `304` borrows its neighbour's and keeps its own width beside it.
      const half = await ok<AgentStampSize>(token, "GET", `/stamp-size?stamp=${s304}`);
      assert.equal(half.source, "inherited");
      assert.equal(half.widthMm, 22);
      assert.equal(half.inherited?.[0].fromStampId, s302);

      const none = await ok<AgentStampSize>(token, "GET", `/stamp-size?stamp=${encodeURIComponent("Mi 500")}`);
      assert.equal(none.source, "none");
      assert.equal(none.inherited, undefined);
    });

    it("refuses an ambiguous number with its candidates, and an unknown one, before anything is written", async () => {
      const ambiguous = await refused(token, "POST", "/stamp-size", { stamp: "Mi 400", width_mm: "20", height_mm: "24" });
      assert.equal(ambiguous.status, 400);
      assert.deepEqual([...(ambiguous.error.accepted ?? [])].sort(), [dupA, dupB].sort());
      assert.match(ambiguous.error.message, /"Mi 400" matches 2 stamps/);
      assert.deepEqual(await sizeOf(dupA), { widthMm: null, heightMm: null });
      assert.deepEqual(await sizeOf(dupB), { widthMm: null, heightMm: null });

      const unknown = await refused(token, "GET", `/stamp-size?stamp=${encodeURIComponent("Mi 999")}`);
      assert.match(unknown.error.message, /"Mi 999" is no stamp id/);
    });

    it("writes a stamp with no size, and replaces a stated one only when told to", async () => {
      const written = await ok<{ status: string; widthMm: number; heightMm: number; replaced?: unknown }>(
        token, "POST", "/stamp-size", { stamp: "Mi 301", width_mm: "21.5", height_mm: "25" }
      );
      assert.equal(written.status, "written");
      assert.equal(written.replaced, undefined);
      assert.deepEqual(await sizeOf(s301), { widthMm: 21.5, heightMm: 25 });
      // Only this stamp: `303a` is not reached by a one-stamp write.
      await ok(token, "POST", "/stamp-size", { stamp: s303, width_mm: "20", height_mm: "24" });
      assert.deepEqual(await sizeOf(s303a), { widthMm: null, heightMm: null });

      // Half a size counts as stated.
      await setSize(s302, 22, null);
      const guarded = await refused(token, "POST", "/stamp-size", { stamp: s302, width_mm: "21", height_mm: "25" });
      assert.equal(guarded.status, 400);
      assert.match(guarded.error.message, /already states 22 mm wide.*"overwrite": true/);
      assert.deepEqual(await sizeOf(s302), { widthMm: 22, heightMm: null });

      const replaced = await ok<{ status: string; replaced?: unknown }>(token, "POST", "/stamp-size", {
        stamp: s302,
        width_mm: "21",
        height_mm: "25",
        overwrite: true,
      });
      assert.equal(replaced.status, "written");
      assert.deepEqual(replaced.replaced, { widthMm: 22 });
      assert.deepEqual(await sizeOf(s302), { widthMm: 21, heightMm: 25 });

      const same = await ok<{ status: string }>(token, "POST", "/stamp-size", { stamp: s302, width_mm: "21", height_mm: "25" });
      assert.equal(same.status, "unchanged");
    });
  });

  describe("applying", () => {
    it("previews without writing, then writes what it previewed and never a stated size", async () => {
      const preset = await ok<AgentSizePreset>(token, "POST", "/size-presets", { width_mm: "25", height_mm: "30", name: "Germania" });
      await setSize(s302, 21, 25);
      await setSize(s304, 22, null);

      const preview = await ok<AgentSizeApply>(token, "GET", `/stamp-sizes/apply?issue_id=${issueId}&preset=Germania`);
      // The four members and `303a` under `303`.
      assert.deepEqual(
        [preview.total, preview.withoutSize, preview.withStatedSize, preview.withPartialSize, preview.willWrite],
        [5, 3, 2, 1, 3]
      );
      assert.equal(preview.preset, "25 × 30 mm · Germania");
      assert.match(preview.summary.join(" "), /3 stamps have no size and will get 25 × 30 mm/);
      for (const id of [s301, s303, s303a]) assert.deepEqual(await sizeOf(id), { widthMm: null, heightMm: null });

      // A read-only token may ask for the preview.
      const readPreview = await ok<AgentSizeApply>(readOnlyToken, "GET", `/stamp-sizes/apply?issue_id=${issueId}&preset=${preset.presetId}`);
      assert.equal(readPreview.willWrite, 3);

      const applied = await ok<AgentSizeApply>(token, "POST", "/stamp-sizes/apply", { issue_id: issueId, preset: "Germania" });
      assert.equal(applied.written, preview.willWrite);
      for (const id of [s301, s303, s303a]) assert.deepEqual(await sizeOf(id), { widthMm: 25, heightMm: 30 });
      assert.deepEqual(await sizeOf(s302), { widthMm: 21, heightMm: 25 });
      assert.deepEqual(await sizeOf(s304), { widthMm: 22, heightMm: null });
      assert.deepEqual(await sizeOf(loner), { widthMm: null, heightMm: null });

      // Overwrite is a second, explicit decision.
      const over = await ok<AgentSizeApply>(token, "POST", "/stamp-sizes/apply", {
        checklist_id: checklistId,
        width_mm: "24",
        height_mm: "28.5",
        overwrite: true,
      });
      assert.equal(over.written, 5);
      assert.deepEqual(await sizeOf(s302), { widthMm: 24, heightMm: 28.5 });
    });

    it("takes a list of stamps named by number, and refuses the list whole if one entry is ambiguous", async () => {
      const ambiguous = await refused(token, "POST", "/stamp-sizes/apply", {
        stamps: ["Mi 301", "Mi 400"],
        width_mm: "20",
        height_mm: "24",
      });
      assert.deepEqual([...(ambiguous.error.accepted ?? [])].sort(), [dupA, dupB].sort());
      assert.deepEqual(await sizeOf(s301), { widthMm: null, heightMm: null });

      const applied = await ok<AgentSizeApply>(token, "POST", "/stamp-sizes/apply", {
        stamps: ["Mi 301", dupA, "Mi 303"],
        width_mm: "20",
        height_mm: "24",
      });
      assert.deepEqual([applied.total, applied.written], [4, 4]);
      for (const id of [s301, dupA, s303, s303a]) assert.deepEqual(await sizeOf(id), { widthMm: 20, heightMm: 24 });
      assert.deepEqual(await sizeOf(dupB), { widthMm: null, heightMm: null });
    });

    it("refuses a call that names the subject or the size in more than one way, or not at all", async () => {
      for (const body of [
        { issue_id: issueId, checklist_id: checklistId, width_mm: "20", height_mm: "24" },
        { width_mm: "20", height_mm: "24" },
        { issue_id: issueId, preset: "x", width_mm: "20", height_mm: "24" },
        { issue_id: issueId, width_mm: "20" },
      ]) {
        const { status } = await refused(token, "POST", "/stamp-sizes/apply", body);
        assert.equal(status, 400, JSON.stringify(body));
      }
      const missing = await refused(token, "POST", "/stamp-sizes/apply", { issue_id: "nope", width_mm: "20", height_mm: "24" });
      assert.equal(missing.status, 404);
      const unknownPreset = await refused(token, "GET", `/stamp-sizes/apply?issue_id=${issueId}&preset=Hindenburg`);
      assert.match(unknownPreset.error.message, /size preset/);
    });
  });

  describe("scope", () => {
    it("refuses a read-only token on every write, naming the scope needed, and writes nothing", async () => {
      const preset = await ok<AgentSizePreset>(token, "POST", "/size-presets", { width_mm: "25", height_mm: "30" });
      const writes: [Method, string, unknown][] = [
        ["POST", "/size-presets", { width_mm: "20", height_mm: "24" }],
        ["PATCH", `/size-presets/${preset.presetId}`, { name: "Read" }],
        ["POST", "/stamp-size", { stamp: s301, width_mm: "20", height_mm: "24" }],
        ["POST", "/stamp-sizes/apply", { issue_id: issueId, preset: preset.presetId }],
      ];
      const writing = OPERATIONS.filter((op) => op.writes && SIZE_PATHS.test(op.path));
      assert.equal(writing.length, writes.length);
      for (const [method, path, body] of writes) {
        const { status, error } = await refused(readOnlyToken, method, path, body);
        assert.equal(status, 403, `${method} ${path}`);
        assert.equal(error.code, "forbidden");
        assert.ok(error.accepted?.includes("read_write"), `${method} ${path} names the scope`);
      }
      assert.equal(await prisma.stampSizePreset.count({ where: { collectionId } }), 1);
      assert.deepEqual(await sizeOf(s301), { widthMm: null, heightMm: null });

      // And every read answers it.
      await ok(readOnlyToken, "GET", "/size-presets");
      await ok(readOnlyToken, "GET", `/stamp-size?stamp=${s301}`);
    });
  });
});
