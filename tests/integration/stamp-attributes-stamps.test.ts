import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { addStampToIssue, createIssue, listIssueMembers } from "../../src/lib/issues";
import { listStampsPaginated, updateStampWithCatalog } from "../../src/lib/stamps";
import {
  createStampAttribute,
  getStampAttributeValues,
} from "../../src/lib/stamp-attributes";
import { DEFAULT_CHECKLIST } from "../../src/lib/checklist-vocabulary";
import type { StampAttributeInput } from "../../src/lib/stamp-attribute-kinds";

// Entry, display and filtering of the six catalogue attributes (#736, #737). The dictionaries and
// the columns themselves are covered by `stamp-attributes-domain.test.ts`; what is tested here is
// the path a stamp actually takes through them: written on add, changed and cleared on edit, left
// alone by a caller that does not manage them, resolved to names on the read models, and narrowing
// the stamp list server-side.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-attrstamps-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-attrstamps-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("stamp attributes on stamps (#736, #737)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let areaId: string;
  let issueId: string;
  let carmine: string;
  let green: string;
  let lozenges: string;
  let thinPaper: string;
  let photogravure: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`a-${ts}`)).id;
    otherUserId = (await createTestUser(`b-${ts}`)).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-attrstamps-${ts}`, name: "C", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    issueId = (await createIssue(userId, collectionId, areaId, { name: "Definitives" })).id;
    carmine = await createStampAttribute(userId, collectionId, "color", { name: "Carmine" });
    green = await createStampAttribute(userId, collectionId, "color", { name: "Green" });
    lozenges = await createStampAttribute(userId, collectionId, "watermark", { name: "Lozenges" });
    thinPaper = await createStampAttribute(userId, collectionId, "paper", { name: "Thin paper" });
    photogravure = await createStampAttribute(userId, collectionId, "printing", {
      name: "Photogravure",
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function addStamp(
    name: string,
    attributes: StampAttributeInput = {}
  ): Promise<string> {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name,
      checklistIds: [DEFAULT_CHECKLIST],
      catalogNumbers: [],
      ...attributes,
    });
    return stampId;
  }

  it("writes all six on add, and reads them back by stamp id", async () => {
    const stampId = await addStamp("240a", {
      denomination: "10 gr",
      perforation: "11½:12",
      colorId: carmine,
      watermarkId: lozenges,
      paperId: thinPaper,
      printingId: photogravure,
    });
    assert.deepEqual(await getStampAttributeValues(userId, stampId), {
      denomination: "10 gr",
      perforation: "11½:12",
      colorId: carmine,
      watermarkId: lozenges,
      paperId: thinPaper,
      printingId: photogravure,
      widthMm: null,
      heightMm: null,
    });
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  it("adds a stamp that states none — the normal case", async () => {
    const stampId = await addStamp("plain", {});
    assert.deepEqual(await getStampAttributeValues(userId, stampId), {
      denomination: null,
      perforation: null,
      colorId: null,
      watermarkId: null,
      paperId: null,
      printingId: null,
      widthMm: null,
      heightMm: null,
    });
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  it("changes, clears, and leaves untouched what the caller did not send", async () => {
    const stampId = await addStamp("editable", {
      denomination: "10 gr",
      perforation: "11½",
      colorId: carmine,
      paperId: thinPaper,
    });

    // A blank clears; a new id sets; a field the form did not render is absent and stays put.
    await updateStampWithCatalog(userId, stampId, {
      name: "editable",
      catalogNumbers: [],
      denomination: "1 zł",
      perforation: "",
      colorId: green,
    });
    assert.deepEqual(await getStampAttributeValues(userId, stampId), {
      denomination: "1 zł",
      perforation: null,
      colorId: green,
      watermarkId: null,
      paperId: thinPaper,
      printingId: null,
      widthMm: null,
      heightMm: null,
    });

    // No attribute keys at all — a caller whose form does not manage them.
    await updateStampWithCatalog(userId, stampId, { name: "editable", catalogNumbers: [] });
    const after = await getStampAttributeValues(userId, stampId);
    assert.equal(after.denomination, "1 zł");
    assert.equal(after.colorId, green);
    assert.equal(after.paperId, thinPaper);
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  // The size (#763) rides the same write path as the six and comes back as the field shows it —
  // `21.5`, not `21.5000`, since the form's own state is text and a figure that round-tripped as a
  // different string would read as an edit the collector did not make.
  it("writes a size, reads it back as typed, and clears it", async () => {
    const stampId = await addStamp("sized", { widthMm: 21.5, heightMm: 25 });
    const stored = await getStampAttributeValues(userId, stampId);
    assert.equal(stored.widthMm, "21.5");
    assert.equal(stored.heightMm, "25");

    // A caller that does not manage the size leaves it alone; null clears it.
    await updateStampWithCatalog(userId, stampId, { name: "sized", catalogNumbers: [] });
    assert.equal((await getStampAttributeValues(userId, stampId)).widthMm, "21.5");
    await updateStampWithCatalog(userId, stampId, {
      name: "sized",
      catalogNumbers: [],
      widthMm: null,
      heightMm: null,
    });
    const cleared = await getStampAttributeValues(userId, stampId);
    assert.equal(cleared.widthMm, null);
    assert.equal(cleared.heightMm, null);
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  // What a list and a detail page read: the stamp's own figures, as plain numbers.
  it("carries the size onto the stamp list row", async () => {
    const stampId = await addStamp("listed size", { widthMm: 21.5, heightMm: 25.5 });
    const { items } = await listStampsPaginated(userId, collectionId, { issueId });
    const row = items.find((i) => i.id === stampId);
    assert.ok(row);
    assert.deepEqual(row.size, { widthMm: 21.5, heightMm: 25.5 });
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  it("is owner-scoped when reading one stamp's values", async () => {
    const stampId = await addStamp("scoped", {});
    await assert.rejects(() => getStampAttributeValues(otherUserId, stampId));
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  it("resolves the dictionary references to names on the list and the issue tree", async () => {
    const stampId = await addStamp("labelled", {
      denomination: "10 gr",
      colorId: carmine,
      paperId: thinPaper,
    });

    const { items } = await listStampsPaginated(userId, collectionId, { issueId });
    const row = items.find((i) => i.id === stampId);
    assert.ok(row);
    assert.deepEqual(row.attributes, {
      denomination: "10 gr",
      perforation: null,
      color: "Carmine",
      watermark: null,
      paper: "Thin paper",
      printing: null,
    });

    const nodes = await listIssueMembers(userId, collectionId, issueId);
    const node = nodes.find((n) => n.stampId === stampId);
    assert.ok(node);
    assert.equal(node.attributes.color, "Carmine");
    assert.equal(node.attributes.denomination, "10 gr");
    await prisma.stamp.delete({ where: { id: stampId } });
  });

  it("narrows the stamp list by a dictionary attribute, and combines two with AND", async () => {
    const a = await addStamp("carmine thin", {
      colorId: carmine,
      paperId: thinPaper,
    });
    const b = await addStamp("carmine plain", {
      colorId: carmine,
    });
    const c = await addStamp("green thin", {
      colorId: green,
      paperId: thinPaper,
    });

    const ids = async (opts: Parameters<typeof listStampsPaginated>[2]) =>
      (await listStampsPaginated(userId, collectionId, { issueId, ...opts })).items
        .map((i) => i.id)
        .sort();

    // An empty set is the absence of a filter, never "stamps that state none".
    assert.deepEqual(await ids({ colorIds: [] }), [a, b, c].sort());
    assert.deepEqual(await ids({ colorIds: [carmine] }), [a, b].sort());
    assert.deepEqual(await ids({ colorIds: [carmine, green] }), [a, b, c].sort());
    assert.deepEqual(await ids({ colorIds: [carmine], paperIds: [thinPaper] }), [a]);
    assert.deepEqual(await ids({ watermarkIds: [lozenges] }), []);

    await prisma.stamp.deleteMany({ where: { id: { in: [a, b, c] } } });
  });

  it("matches denomination and perforation through the list's search box", async () => {
    const stampId = await addStamp("searchable", {
      denomination: "50 h",
      perforation: "imperf",
    });
    const found = async (search: string) =>
      (await listStampsPaginated(userId, collectionId, { issueId, search })).items.map((i) => i.id);
    assert.deepEqual(await found("50 h"), [stampId]);
    assert.deepEqual(await found("IMPERF"), [stampId]);
    assert.deepEqual(await found("nothing here"), []);
    await prisma.stamp.delete({ where: { id: stampId } });
  });
});
