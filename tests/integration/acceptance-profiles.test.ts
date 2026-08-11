import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listAcceptanceProfiles,
  createAcceptanceProfile,
  updateAcceptanceProfile,
  deleteAcceptanceProfile,
  reorderAcceptanceProfiles,
  AcceptanceProfileNameTakenError,
} from "../../src/lib/acceptance-profiles";
import { createWant, listWantsPaginated } from "../../src/lib/wants";

// Named acceptance profiles (#533; ADR-0032 §9). The dictionary itself, and the one property the
// seed decision rests on: a profile edited or deleted after a want was created from it leaves that
// want exactly as it was.

async function seedFixtures(suffix: string) {
  const user = await prisma.user.create({
    data: {
      id: `test-user-profile-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-profile-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-profile-${suffix}`,
      name: `Collection ${suffix}`,
      baseCurrency: "EUR",
      ownerId: user.id,
    },
  });
  const collectionId = collection.id;
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 401" } });
  const mnh = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
  });
  const mh = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 1 },
  });
  const used = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 2 },
  });
  const cert = await prisma.certificateStatus.create({
    data: { collectionId, name: "Photo certificate", abbreviation: "Fot", sortOrder: 0 },
  });
  const block4 = await prisma.stampFormat.create({
    data: { collectionId, name: "Block of 4", abbreviation: "B4", sortOrder: 0 },
  });
  return { userId: user.id, collectionId, stamp, mnh, mh, used, cert, block4 };
}

type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

async function cleanup(userId: string) {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("acceptance profiles — the dictionary", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures("dict");
  });
  after(async () => cleanup(f.userId));

  it("starts empty", async () => {
    assert.deepEqual(await listAcceptanceProfiles(f.userId, f.collectionId), []);
  });

  it("round-trips all three sets, null members included", async () => {
    await createAcceptanceProfile(f.userId, f.collectionId, {
      name: "Any mint",
      conditionIds: [f.mnh.id, f.mh.id],
      // Null is a member — "no certificate" — not an empty set.
      certificateStatusIds: [null, f.cert.id],
      formatIds: [null],
    });

    const [profile] = await listAcceptanceProfiles(f.userId, f.collectionId);
    assert.equal(profile.name, "Any mint");
    assert.deepEqual([...profile.conditionIds].sort(), [f.mh.id, f.mnh.id].sort());
    assert.deepEqual([...profile.certificateStatusIds].sort(), [null, f.cert.id].sort());
    assert.deepEqual(profile.formatIds, [null]);
  });

  it("keeps an empty axis empty — that is 'any', not a missing answer", async () => {
    await createAcceptanceProfile(f.userId, f.collectionId, {
      name: "Anything",
      conditionIds: [],
      certificateStatusIds: [],
      formatIds: [],
    });
    const profile = (await listAcceptanceProfiles(f.userId, f.collectionId)).find(
      (p) => p.name === "Anything"
    )!;
    assert.deepEqual(profile.conditionIds, []);
    assert.deepEqual(profile.certificateStatusIds, []);
    assert.deepEqual(profile.formatIds, []);
  });

  it("collapses a duplicate member rather than letting the unique index refuse it", async () => {
    await createAcceptanceProfile(f.userId, f.collectionId, {
      name: "Doubled",
      conditionIds: [f.mnh.id, f.mnh.id],
      certificateStatusIds: [null, null],
      formatIds: [],
    });
    const profile = (await listAcceptanceProfiles(f.userId, f.collectionId)).find(
      (p) => p.name === "Doubled"
    )!;
    assert.deepEqual(profile.conditionIds, [f.mnh.id]);
    assert.deepEqual(profile.certificateStatusIds, [null]);
  });

  it("refuses a second profile of the same name, saying so", async () => {
    await assert.rejects(
      createAcceptanceProfile(f.userId, f.collectionId, {
        name: "Any mint",
        conditionIds: [],
        certificateStatusIds: [],
        formatIds: [],
      }),
      (err: unknown) =>
        err instanceof AcceptanceProfileNameTakenError && /already exists/.test(err.message)
    );
  });

  it("refuses a blank name", async () => {
    await assert.rejects(
      createAcceptanceProfile(f.userId, f.collectionId, {
        name: "   ",
        conditionIds: [],
        certificateStatusIds: [],
        formatIds: [],
      }),
      /Name is required/
    );
  });

  it("replaces the sets on an edit rather than merging them", async () => {
    const profile = (await listAcceptanceProfiles(f.userId, f.collectionId)).find(
      (p) => p.name === "Any mint"
    )!;
    await updateAcceptanceProfile(f.userId, profile.id, {
      name: "MNH only",
      conditionIds: [f.mnh.id],
      certificateStatusIds: [],
      formatIds: [],
    });
    const updated = (await listAcceptanceProfiles(f.userId, f.collectionId)).find(
      (p) => p.id === profile.id
    )!;
    assert.equal(updated.name, "MNH only");
    assert.deepEqual(updated.conditionIds, [f.mnh.id]);
    assert.deepEqual(updated.certificateStatusIds, []);
    assert.deepEqual(updated.formatIds, []);
  });

  it("orders by sortOrder and reorders", async () => {
    const before = await listAcceptanceProfiles(f.userId, f.collectionId);
    const reversed = [...before].reverse().map((p) => p.id);
    await reorderAcceptanceProfiles(f.userId, f.collectionId, reversed);
    const after = await listAcceptanceProfiles(f.userId, f.collectionId);
    assert.deepEqual(after.map((p) => p.id), reversed);
  });

  it("refuses a reorder that does not name exactly this collection's profiles", async () => {
    const profiles = await listAcceptanceProfiles(f.userId, f.collectionId);
    await assert.rejects(
      reorderAcceptanceProfiles(f.userId, f.collectionId, [profiles[0].id]),
      /does not match/
    );
  });

  it("deletes", async () => {
    const profile = (await listAcceptanceProfiles(f.userId, f.collectionId)).find(
      (p) => p.name === "Doubled"
    )!;
    await deleteAcceptanceProfile(f.userId, profile.id);
    const names = (await listAcceptanceProfiles(f.userId, f.collectionId)).map((p) => p.name);
    assert.ok(!names.includes("Doubled"));
  });
});

describe("acceptance profiles — scoping", () => {
  let f: Fixtures;
  let other: Fixtures;
  before(async () => {
    f = await seedFixtures("scope-a");
    other = await seedFixtures("scope-b");
  });
  after(async () => {
    await cleanup(f.userId);
    await cleanup(other.userId);
  });

  it("refuses a condition from another collection", async () => {
    await assert.rejects(
      createAcceptanceProfile(f.userId, f.collectionId, {
        name: "Foreign",
        conditionIds: [other.mnh.id],
        certificateStatusIds: [],
        formatIds: [],
      }),
      /not in this collection/
    );
  });

  it("refuses a certificate status and a format from another collection", async () => {
    await assert.rejects(
      createAcceptanceProfile(f.userId, f.collectionId, {
        name: "Foreign cert",
        conditionIds: [],
        certificateStatusIds: [other.cert.id],
        formatIds: [],
      }),
      /not in this collection/
    );
    await assert.rejects(
      createAcceptanceProfile(f.userId, f.collectionId, {
        name: "Foreign format",
        conditionIds: [],
        certificateStatusIds: [],
        formatIds: [other.block4.id],
      }),
      /not in this collection/
    );
  });

  it("refuses another owner's collection, and another owner's profile", async () => {
    await assert.rejects(
      createAcceptanceProfile(other.userId, f.collectionId, {
        name: "Trespass",
        conditionIds: [],
        certificateStatusIds: [],
        formatIds: [],
      }),
      /not found or access denied/
    );

    await createAcceptanceProfile(f.userId, f.collectionId, {
      name: "Mine",
      conditionIds: [f.mnh.id],
      certificateStatusIds: [],
      formatIds: [],
    });
    const [mine] = await listAcceptanceProfiles(f.userId, f.collectionId);
    await assert.rejects(
      deleteAcceptanceProfile(other.userId, mine.id),
      /not found or access denied/
    );
    await assert.rejects(
      listAcceptanceProfiles(other.userId, f.collectionId),
      /not found or access denied/
    );
  });

  it("lets two collections use the same profile name", async () => {
    await createAcceptanceProfile(other.userId, other.collectionId, {
      name: "Mine",
      conditionIds: [],
      certificateStatusIds: [],
      formatIds: [],
    });
    const names = (await listAcceptanceProfiles(other.userId, other.collectionId)).map(
      (p) => p.name
    );
    assert.deepEqual(names, ["Mine"]);
  });
});

describe("acceptance profiles — a profile seeds, it is never referenced (ADR-0032 §9)", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures("seed");
  });
  after(async () => cleanup(f.userId));

  it("editing a profile leaves a want created from it untouched", async () => {
    await createAcceptanceProfile(f.userId, f.collectionId, {
      name: "Any mint",
      conditionIds: [f.mnh.id, f.mh.id],
      certificateStatusIds: [],
      formatIds: [],
    });
    const [profile] = await listAcceptanceProfiles(f.userId, f.collectionId);

    // What applying one does, on the server side of the form: the sets are copied onto the want.
    await createWant(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionIds: [...profile.conditionIds],
      certificateStatusIds: [...profile.certificateStatusIds],
      formatIds: [...profile.formatIds],
      priority: "normal",
      notes: null,
    });

    // The collector later narrows the *profile* to MNH only.
    await updateAcceptanceProfile(f.userId, profile.id, {
      name: "Any mint",
      conditionIds: [f.mnh.id],
      certificateStatusIds: [],
      formatIds: [],
    });

    const { items } = await listWantsPaginated(f.userId, f.collectionId, { pageSize: 10 });
    assert.equal(items.length, 1);
    assert.deepEqual([...items[0].conditionIds].sort(), [f.mh.id, f.mnh.id].sort());
  });

  it("deleting a profile leaves the want alone — there is nothing to restrict", async () => {
    const [profile] = await listAcceptanceProfiles(f.userId, f.collectionId);
    await deleteAcceptanceProfile(f.userId, profile.id);

    const { items } = await listWantsPaginated(f.userId, f.collectionId, { pageSize: 10 });
    assert.equal(items.length, 1);
    assert.deepEqual([...items[0].conditionIds].sort(), [f.mh.id, f.mnh.id].sort());
  });
});
