import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  matchColnectItems,
  confirmColnectMatch,
  ColnectMatchConflictError,
  type ColnectMatchItemInput,
} from "../../src/lib/colnect";

// End-to-end coverage of the strict full-key Colnect matcher (#250): the abbreviation mapping
// (Colnect `Pol` → local Fischer), the effective area prefix (Michel Poland "PL"), the decision
// matrix, dry-run, and confirm/overwrite protection — against a real database.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-colnect-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-colnect-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

interface Seed {
  userId: string;
  collectionId: string;
  areaId: string;
  miVendorId: string;
  fiVendorId: string;
  scVendorId: string;
  stamps: Record<string, string>;
}

/** Seed a collection with Michel/Fischer/Scott vendors, a Poland area (Michel prefix "PL", a
 *  Colnect `Pol`→Fischer mapping), and one stamp per matrix scenario. */
async function seed(suffix: string): Promise<Seed> {
  const userId = (await createTestUser(suffix)).id;
  const collectionId = (
    await prisma.collection.create({
      data: { slug: `col-colnect-${suffix}`, name: "Colnect", baseCurrency: "EUR", ownerId: userId },
    })
  ).id;

  const mi = await prisma.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  const fi = await prisma.catalogVendor.create({
    data: { collectionId, name: "Fischer", abbreviation: "Fi" },
  });
  const sc = await prisma.catalogVendor.create({
    data: { collectionId, name: "Scott", abbreviation: "Sc" },
  });

  // Colnect prints Fischer numbers under its own abbreviation "Pol"; map it to our Fischer vendor.
  await prisma.colnectCatalogMapping.create({
    data: { collectionId, colnectAbbrev: "Pol", catalogVendorId: fi.id },
  });

  const area = await prisma.collectionArea.create({
    data: { collectionId, name: `Poland-${suffix}` },
  });
  // Michel numbers in Poland carry the "PL" prefix; Fischer/Scott carry none.
  await prisma.collectionAreaVendor.create({
    data: { collectionAreaId: area.id, catalogVendorId: mi.id, areaPrefix: "PL" },
  });

  // A second area whose Michel numbering is digit-free (local issues numbered with Roman numerals),
  // so the matcher's recall net is exercised on a number carrying no digits at all.
  const localArea = await prisma.collectionArea.create({
    data: { collectionId, name: `Russia BW-${suffix}` },
  });
  await prisma.collectionAreaVendor.create({
    data: { collectionAreaId: localArea.id, catalogVendorId: mi.id, areaPrefix: "RU-BW" },
  });

  // Each scenario stamp: create, link to its area as primary, attach its catalog numbers.
  async function makeStamp(
    name: string,
    numbers: { vendorId: string; number: string }[],
    colnectId?: string,
    areaId: string = area.id
  ): Promise<string> {
    const stamp = await prisma.stamp.create({
      data: { collectionId, name, issuedYear: 1960, colnectId: colnectId ?? null },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.stampCatalogNumber.createMany({
      data: numbers.map((n) => ({ stampId: stamp.id, catalogVendorId: n.vendorId, number: n.number })),
    });
    return stamp.id;
  }

  // One issue, so candidate results can be checked to carry the issue name (#249 preview detail).
  const issue = await prisma.issue.create({
    // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
    data: { collectionId, issueNo: 9001, collectionAreaId: area.id, name: `Birds-${suffix}`, year: 1960 },
  });

  const stamps: Record<string, string> = {
    auto: await makeStamp("Mi PL 200", [{ vendorId: mi.id, number: "200" }]),
    mapping: await makeStamp("Fi 300", [{ vendorId: fi.id, number: "300" }]),
    dupA: await makeStamp("Dup A", [{ vendorId: mi.id, number: "400" }]),
    dupB: await makeStamp("Dup B", [{ vendorId: mi.id, number: "400" }]),
    partial: await makeStamp("Partial", [
      { vendorId: mi.id, number: "500" },
      { vendorId: sc.id, number: "55" },
    ]),
    existing: await makeStamp("Existing", [{ vendorId: mi.id, number: "600" }], "old-600"),
    // Filed as "IIIa" while Colnect prints "IIIA": recall on a digit-free number must ignore case.
    roman: await makeStamp("Local Roman", [{ vendorId: mi.id, number: "IIIa" }], undefined, localArea.id),
  };

  await prisma.issueMember.create({ data: { issueId: issue.id, stampId: stamps.auto } });

  return { userId, collectionId, areaId: area.id, miVendorId: mi.id, fiVendorId: fi.id, scVendorId: sc.id, stamps };
}

/** The full batch covering every matrix branch, keyed by Colnect ID. */
function batch(): ColnectMatchItemInput[] {
  return [
    { colnectId: "111", catalogRefs: [{ catalog: "Mi", number: "PL 200" }] }, // auto
    { colnectId: "222", catalogRefs: [{ catalog: "Pol", number: "300" }] }, // auto via mapping
    { colnectId: "333", catalogRefs: [{ catalog: "Mi", number: "PL 400" }] }, // multiple-candidates
    {
      colnectId: "444",
      catalogRefs: [
        { catalog: "Mi", number: "PL 500" },
        { catalog: "Sc", number: "99" },
      ],
    }, // partial-conflict
    { colnectId: "555", catalogRefs: [{ catalog: "Mi", number: "PL 600" }] }, // existing-different
    { colnectId: "666", catalogRefs: [{ catalog: "Mi", number: "PL 999" }] }, // no-candidates
    { colnectId: "777", catalogRefs: [{ catalog: "XX", number: "1" }] }, // unresolved-refs
  ];
}

function byColnect(results: Awaited<ReturnType<typeof matchColnectItems>>) {
  return new Map(results.map((r) => [r.colnectId, r]));
}

describe("matchColnectItems", () => {
  let s: Seed;

  before(async () => {
    s = await seed(`match-${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  });

  it("dry-run computes the full matrix without persisting", async () => {
    const results = byColnect(await matchColnectItems(s.userId, s.collectionId, batch(), { dryRun: true }));

    const auto = results.get("111");
    assert.equal(auto?.status, "auto");
    if (auto?.status === "auto") {
      assert.equal(auto.stampId, s.stamps.auto);
      assert.equal(auto.written, false); // dry run — nothing written
    }

    assert.equal(results.get("222")?.status, "auto");
    assert.equal(results.get("333")?.status, "needs-confirm");
    assert.equal(results.get("444")?.status, "needs-confirm");
    assert.equal(results.get("555")?.status, "needs-confirm");
    assert.equal(results.get("666")?.status, "skipped");
    assert.equal(results.get("777")?.status, "skipped");

    // Nothing persisted.
    const autoStamp = await prisma.stamp.findUnique({ where: { id: s.stamps.auto }, select: { colnectId: true } });
    assert.equal(autoStamp?.colnectId, null);
  });

  it("writes unambiguous matches and classifies the rest", async () => {
    const results = byColnect(await matchColnectItems(s.userId, s.collectionId, batch()));

    // 111 — clean single candidate (Michel PL prefix) → written.
    const auto = results.get("111");
    assert.equal(auto?.status, "auto");
    if (auto?.status === "auto") {
      assert.equal(auto.stampId, s.stamps.auto);
      assert.equal(auto.written, true);
      // The matched stamp travels with the result so callers can show what the ID landed on (#249).
      assert.equal(auto.stamp?.stampId, s.stamps.auto);
      // Our own number is marked too: Colnect prints the same one, so it reads as matched.
      assert.deepEqual(auto.stamp?.catalogNumbers, [{ label: "Mi·PL 200", status: "matched" }]);
      assert.ok(auto.stamp?.issueName?.startsWith("Birds-"), "issue name travels with the candidate");
    }

    // 222 — resolved through the Colnect `Pol` → Fischer mapping → written.
    const mapping = results.get("222");
    assert.equal(mapping?.status, "auto");
    if (mapping?.status === "auto") assert.equal(mapping.stampId, s.stamps.mapping);

    // 333 — two identical Michel PL 400 stamps → confirm, both offered.
    const multi = results.get("333");
    assert.equal(multi?.status, "needs-confirm");
    if (multi?.status === "needs-confirm") {
      assert.equal(multi.reason, "multiple-candidates");
      assert.deepEqual(
        multi.candidates.map((c) => c.stampId).sort(),
        [s.stamps.dupA, s.stamps.dupB].sort()
      );
      // Labels reflect the effective area prefix.
      assert.ok(multi.candidates[0].catalogNumbers.some((n) => n.label === "Mi·PL 400"));
    }

    // 444 — agrees on Michel, conflicts on Scott → partial confirm.
    const partial = results.get("444");
    assert.equal(partial?.status, "needs-confirm");
    if (partial?.status === "needs-confirm") {
      assert.equal(partial.reason, "partial-conflict");
      assert.deepEqual(partial.candidates.map((c) => c.stampId), [s.stamps.partial]);
    }

    // 555 — single candidate already carrying a different Colnect ID → never overwritten silently.
    const existing = results.get("555");
    assert.equal(existing?.status, "needs-confirm");
    if (existing?.status === "needs-confirm") {
      assert.equal(existing.reason, "existing-different");
      assert.equal(existing.candidates[0].existingColnectId, "old-600");
    }

    // 666 / 777 — nothing owned / abbreviation unmapped.
    assert.equal(results.get("666")?.status, "skipped");
    if (results.get("666")?.status === "skipped") {
      assert.equal((results.get("666") as { reason: string }).reason, "no-candidates");
    }
    if (results.get("777")?.status === "skipped") {
      assert.equal((results.get("777") as { reason: string }).reason, "unresolved-refs");
    }

    // Persistence: auto writes landed; the existing-different stamp is untouched.
    const autoStamp = await prisma.stamp.findUnique({ where: { id: s.stamps.auto }, select: { colnectId: true } });
    assert.equal(autoStamp?.colnectId, "111");
    const mappingStamp = await prisma.stamp.findUnique({ where: { id: s.stamps.mapping }, select: { colnectId: true } });
    assert.equal(mappingStamp?.colnectId, "222");
    const existingStamp = await prisma.stamp.findUnique({ where: { id: s.stamps.existing }, select: { colnectId: true } });
    assert.equal(existingStamp?.colnectId, "old-600");
  });

  it("classifies each printed ref against the matched stamp", async () => {
    // The stamp holds Michel 500 and Scott 55. Colnect prints the matching Michel, a Scott that
    // differs, a Fischer (mapped via "Pol") the stamp has no number for, and an unmapped catalog.
    const results = byColnect(
      await matchColnectItems(
        s.userId,
        s.collectionId,
        [
          {
            colnectId: "700",
            catalogRefs: [
              { catalog: "Mi", number: "PL 500" },
              { catalog: "Sc", number: "99" },
              { catalog: "Pol", number: "1234" },
              { catalog: "Zz", number: "7" },
            ],
          },
        ],
        { dryRun: true }
      )
    );

    const r = results.get("700");
    assert.ok(r);
    const status = new Map(r.refs.map((x) => [x.catalog, x.status]));
    assert.equal(status.get("Mi"), "matched", "the Michel number is the matching evidence");
    assert.equal(status.get("Sc"), "conflict", "Scott differs from ours");
    assert.equal(status.get("Pol"), "missing", "we keep Fischer but this stamp has no number");
    assert.equal(status.get("Zz"), "unmapped", "no catalog of ours corresponds");
    // Values travel verbatim for display.
    assert.equal(r.refs.find((x) => x.catalog === "Mi")?.number, "PL 500");
  });

  it("is idempotent: re-running a written match reports alreadySet with no write", async () => {
    const results = byColnect(
      await matchColnectItems(s.userId, s.collectionId, [
        { colnectId: "111", catalogRefs: [{ catalog: "Mi", number: "PL 200" }] },
      ])
    );
    const auto = results.get("111");
    assert.equal(auto?.status, "auto");
    if (auto?.status === "auto") {
      assert.equal(auto.alreadySet, true);
      assert.equal(auto.written, false);
    }
  });

  it("matches a digit-free catalog number (Michel Roman local issues)", async () => {
    const results = byColnect(
      await matchColnectItems(
        s.userId,
        s.collectionId,
        [{ colnectId: "800", catalogRefs: [{ catalog: "Mi", number: "RU-BW IIIA" }] }],
        { dryRun: true }
      )
    );
    const roman = results.get("800");
    assert.equal(roman?.status, "auto", "a number with no digits must still recall its stamp");
    if (roman?.status === "auto") {
      assert.equal(roman.stampId, s.stamps.roman);
      assert.deepEqual(roman.stamp?.catalogNumbers, [{ label: "Mi·RU-BW IIIa", status: "matched" }]);
    }
  });

  it("requires ownership", async () => {
    await assert.rejects(
      () => matchColnectItems("wrong-user", s.collectionId, batch()),
      /access denied/i
    );
  });
});

describe("confirmColnectMatch", () => {
  let s: Seed;

  before(async () => {
    s = await seed(`confirm-${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  });

  it("commits a chosen match to a fresh stamp", async () => {
    await confirmColnectMatch(s.userId, s.collectionId, { colnectId: "333", stampId: s.stamps.dupA });
    const stamp = await prisma.stamp.findUnique({ where: { id: s.stamps.dupA }, select: { colnectId: true } });
    assert.equal(stamp?.colnectId, "333");
  });

  it("refuses to overwrite a different existing id without allowOverwrite", async () => {
    await assert.rejects(
      () => confirmColnectMatch(s.userId, s.collectionId, { colnectId: "new", stampId: s.stamps.existing }),
      (err: unknown) => err instanceof ColnectMatchConflictError && err.existingColnectId === "old-600"
    );
    const stamp = await prisma.stamp.findUnique({ where: { id: s.stamps.existing }, select: { colnectId: true } });
    assert.equal(stamp?.colnectId, "old-600"); // untouched
  });

  it("overwrites when allowOverwrite is set", async () => {
    await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "new-600",
      stampId: s.stamps.existing,
      allowOverwrite: true,
    });
    const stamp = await prisma.stamp.findUnique({ where: { id: s.stamps.existing }, select: { colnectId: true } });
    assert.equal(stamp?.colnectId, "new-600");
  });

  it("rejects a stamp from another collection", async () => {
    await assert.rejects(
      () => confirmColnectMatch(s.userId, s.collectionId, { colnectId: "x", stampId: "nonexistent-stamp" }),
      /not found/i
    );
  });
});
