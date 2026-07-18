import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getCertificateStatuses,
  createCertificateStatus,
  updateCertificateStatus,
  deleteCertificateStatus,
  reorderCertificateStatuses,
} from "../../src/lib/certificate-statuses";
import { createCollection } from "../../src/lib/collections";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-cert-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-cert-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-cert-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("createCertificateStatus", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cc-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("appends statuses with increasing sortOrder", async () => {
    await createCertificateStatus(userId, collectionId, { name: "None", abbreviation: "—" });
    await createCertificateStatus(userId, collectionId, { name: "Certificate", abbreviation: "Cert" });
    const statuses = await getCertificateStatuses(userId, collectionId);
    assert.equal(statuses.length, 2);
    assert.equal(statuses[0].abbreviation, "—");
    assert.equal(statuses[0].sortOrder, 0);
    assert.equal(statuses[1].abbreviation, "Cert");
    assert.equal(statuses[1].sortOrder, 1);
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createCertificateStatus("wrong-user", collectionId, { name: "X", abbreviation: "X" }),
      /access denied/i
    );
  });
});

describe("updateCertificateStatus", () => {
  let userId: string;
  let collectionId: string;
  let statusId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`uc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `uc-${ts}`)).id;
    const s = await prisma.certificateStatus.create({
      data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 0 },
    });
    statusId = s.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("updates name and abbreviation without touching sortOrder", async () => {
    await updateCertificateStatus(userId, statusId, { name: "Guarantee", abbreviation: "Gu" });
    const s = await prisma.certificateStatus.findUniqueOrThrow({ where: { id: statusId } });
    assert.equal(s.name, "Guarantee");
    assert.equal(s.abbreviation, "Gu");
    assert.equal(s.sortOrder, 0);
  });

  it("throws when status does not belong to user", async () => {
    await assert.rejects(
      () => updateCertificateStatus("wrong-user", statusId, { name: "X", abbreviation: "X" }),
      /access denied/i
    );
  });
});

describe("deleteCertificateStatus", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`dc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `dc-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes a status", async () => {
    const s = await prisma.certificateStatus.create({
      data: { collectionId, name: "Guarantee", abbreviation: "Gu", sortOrder: 0 },
    });
    await deleteCertificateStatus(userId, s.id);
    const found = await prisma.certificateStatus.findUnique({ where: { id: s.id } });
    assert.equal(found, null);
  });

  it("throws when status does not belong to user", async () => {
    const s = await prisma.certificateStatus.create({
      data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 1 },
    });
    await assert.rejects(
      () => deleteCertificateStatus("wrong-user", s.id),
      /access denied/i
    );
  });
});

describe("reorderCertificateStatuses", () => {
  let userId: string;
  let collectionId: string;
  let ids: string[];

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`rc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `rc-${ts}`)).id;
    const created = await Promise.all(
      ["A", "B", "C"].map((n, i) =>
        prisma.certificateStatus.create({
          data: { collectionId, name: n, abbreviation: n, sortOrder: i },
        })
      )
    );
    ids = created.map((s) => s.id);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("rewrites sortOrder to match the given order", async () => {
    const reversed = [...ids].reverse();
    await reorderCertificateStatuses(userId, collectionId, reversed);
    const statuses = await getCertificateStatuses(userId, collectionId);
    assert.deepEqual(statuses.map((s) => s.id), reversed);
    assert.deepEqual(statuses.map((s) => s.sortOrder), [0, 1, 2]);
  });

  it("throws when the id list does not match the collection", async () => {
    await assert.rejects(
      () => reorderCertificateStatuses(userId, collectionId, [ids[0], ids[1]]),
      /does not match/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => reorderCertificateStatuses("wrong-user", collectionId, ids),
      /access denied/i
    );
  });
});

describe("certificate statuses on new collections", () => {
  let userId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`seed-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("starts with an empty status list (no seeded 'None')", async () => {
    // Certificate status is optional; absence of a selection means "none", so
    // new collections carry no seeded statuses. See #94.
    const collection = await createCollection(userId, "Fresh Collection", "EUR");
    const statuses = await getCertificateStatuses(userId, collection.id);
    assert.deepEqual(statuses, []);
  });
});
