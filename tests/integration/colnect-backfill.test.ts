import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { matchColnectItems, confirmColnectMatch } from "../../src/lib/colnect";

// End-to-end coverage of the Colnect catalog-number backfill (#280) against a real database: the
// prefix stripping that makes a write the inverse of matching, the read-only conflict, the
// ambiguous-prefix skips, the duplicate policy (#85), and the sort-key recompute (#181).

interface Seed {
  userId: string;
  collectionId: string;
  areaId: string;
  mi: string;
  sn: string;
  yt: string;
  sc: string;
  stamps: Record<string, string>;
}

/**
 * A Poland area where Michel, Scott and Yvert numbers carry the "PL" prefix and AFA (`sc` here,
 * standing in for a prefixless catalog) carries none, plus the stamps each scenario needs.
 */
async function seed(suffix: string): Promise<Seed> {
  const user = await prisma.user.create({
    data: {
      id: `test-user-backfill-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-backfill-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-backfill-${suffix}`, name: "Backfill", baseCurrency: "EUR", ownerId: user.id },
  });
  const collectionId = collection.id;

  const mk = (name: string, abbreviation: string) =>
    prisma.catalogVendor.create({ data: { collectionId, name, abbreviation } });
  const mi = await mk("Michel", "Mi");
  const sn = await mk("Scott", "Sn");
  const yt = await mk("Yvert", "Yt");
  const sc = await mk("AFA", "AFA");

  const area = await prisma.collectionArea.create({
    data: { collectionId, name: `Poland-${suffix}` },
  });
  // Michel/Scott/Yvert numbers in Poland are printed with the country code; AFA has none set, which
  // is what makes a prefixed AFA value unsplittable.
  for (const vendorId of [mi.id, sn.id, yt.id]) {
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: area.id, catalogVendorId: vendorId, areaPrefix: "PL" },
    });
  }

  async function makeStamp(
    name: string,
    numbers: { vendorId: string; number: string }[]
  ): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1960 } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.createMany({
      data: numbers.map((n) => ({
        stampId: stamp.id,
        catalogVendorId: n.vendorId,
        number: n.number,
      })),
    });
    return stamp.id;
  }

  const stamps: Record<string, string> = {
    // Matched on Michel; missing Scott (fillable), Yvert (mismatched prefix) and AFA (no prefix set).
    target: await makeStamp("Target", [{ vendorId: mi.id, number: "3690" }]),
    // Matched on Michel, but already holds a *different* Scott number → conflict, never overwritten.
    conflicting: await makeStamp("Conflicting", [
      { vendorId: mi.id, number: "700" },
      { vendorId: sn.id, number: "55" },
    ]),
    // Already holds the Scott identity a fill onto `dupTarget` would create.
    dupHolder: await makeStamp("Dup holder", [{ vendorId: sn.id, number: "4000" }]),
    dupTarget: await makeStamp("Dup target", [{ vendorId: mi.id, number: "800" }]),
    // For the confirm path: two identical Michel 900s, so the item needs a decision.
    pickA: await makeStamp("Pick A", [{ vendorId: mi.id, number: "900" }]),
    pickB: await makeStamp("Pick B", [{ vendorId: mi.id, number: "900" }]),
  };

  return { userId: user.id, collectionId, areaId: area.id, mi: mi.id, sn: sn.id, yt: yt.id, sc: sc.id, stamps };
}

const numbersOf = async (stampId: string) =>
  prisma.stampCatalogNumber.findMany({
    where: { stampId },
    select: { catalogVendorId: true, number: true },
  });

describe("Colnect catalog-number backfill", () => {
  let s: Seed;

  before(async () => {
    s = await seed(`${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  });

  /** The item that matches `target` on Michel and offers one of every backfill outcome. */
  const targetItem = () => [
    {
      colnectId: "1001",
      catalogRefs: [
        { catalog: "Mi", number: "PL 3690" }, // the matching evidence — no proposal
        { catalog: "Sn", number: "PL 3382" }, // fillable, prefix stripped
        { catalog: "Yt", number: "DE 12" }, // area prefix is PL → mismatch
        { catalog: "AFA", number: "DK 7" }, // area sets no AFA prefix → unsplittable
        { catalog: "ZZ", number: "5" }, // unmapped abbreviation → ignored entirely
      ],
    },
  ];

  it("is off unless asked for", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, targetItem(), {
      dryRun: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.deepEqual(result.stamp?.backfill, []);
  });

  it("dry-run proposes exactly what would be added, and writes nothing", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, targetItem(), {
      dryRun: true,
      backfill: true,
    });
    assert.equal(result.status, "auto");
    if (result.status !== "auto") return;

    const byCatalog = new Map(result.stamp!.backfill.map((p) => [p.catalog, p]));
    assert.deepEqual([...byCatalog.keys()].sort(), ["AFA", "Sn", "Yt"]);
    assert.equal(byCatalog.get("Sn")?.status, "would-fill");
    assert.equal(byCatalog.get("Sn")?.number, "3382");
    assert.equal(byCatalog.get("Sn")?.label, "Sn·PL 3382");
    assert.equal(byCatalog.get("Yt")?.status, "prefix-mismatch");
    assert.equal(byCatalog.get("AFA")?.status, "skipped-no-area-prefix");

    assert.equal((await numbersOf(s.stamps.target)).length, 1);
  });

  it("fills the missing catalog with the prefix stripped and recomputes the sort key", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, targetItem(), {
      backfill: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      const sn = result.stamp!.backfill.find((p) => p.catalog === "Sn");
      assert.equal(sn?.status, "filled");
    }

    const rows = await numbersOf(s.stamps.target);
    assert.deepEqual(
      rows.filter((r) => r.catalogVendorId === s.sn).map((r) => r.number),
      ["3382"]
    );
    // No prefix was ever written into the number, and nothing else was touched.
    assert.equal(rows.length, 2);

    const after = await prisma.stamp.findUnique({
      where: { id: s.stamps.target },
      select: { primaryCatalogSortKey: true },
    });
    assert.equal(after?.primaryCatalogSortKey, 3382, "the new lowest number drives the sort key");
  });

  it("reports a disagreeing catalog as a conflict and never overwrites it", async () => {
    // Agreeing on Michel while disagreeing on Scott is a `partial-conflict` for the matcher (#250),
    // so the item asks rather than writes — but the candidate still carries the read-only conflict.
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [
        {
          colnectId: "1002",
          catalogRefs: [
            { catalog: "Mi", number: "PL 700" },
            { catalog: "Sn", number: "PL 99" },
          ],
        },
      ],
      { backfill: true }
    );
    assert.equal(result.status, "needs-confirm");
    if (result.status === "needs-confirm") {
      assert.equal(result.reason, "partial-conflict");
      const sn = result.candidates[0].backfill.find((p) => p.catalog === "Sn");
      assert.equal(sn?.status, "conflict");
      assert.equal(sn?.existingNumber, "55");
      assert.equal(sn?.number, null);
    }
    const rows = await numbersOf(s.stamps.conflicting);
    assert.equal(rows.find((r) => r.catalogVendorId === s.sn)?.number, "55");
  });

  it("blocks a duplicate fill under block mode, and warns-but-writes under warn mode", async () => {
    // Colnect prints a Scott number another of our stamps already holds, so both stamps qualify and
    // the decision lands on the user; the fill happens through the confirm path.
    const item = {
      colnectId: "1003",
      catalogRefs: [
        { catalog: "Mi", number: "PL 800" },
        { catalog: "Sn", number: "PL 4000" }, // already held by `dupHolder`
      ],
    };

    await prisma.collection.update({
      where: { id: s.collectionId },
      data: { duplicateCatalogMode: "block" },
    });

    // The preview says so before anything is picked.
    const [preview] = await matchColnectItems(s.userId, s.collectionId, [item], {
      dryRun: true,
      backfill: true,
    });
    assert.equal(preview.status, "needs-confirm");
    if (preview.status === "needs-confirm") {
      const candidate = preview.candidates.find((c) => c.stampId === s.stamps.dupTarget);
      const sn = candidate?.backfill.find((p) => p.catalog === "Sn");
      assert.equal(sn?.status, "duplicate");
      assert.deepEqual(sn?.duplicateStampNames, ["Dup holder"]);
    }

    const blocked = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: item.colnectId,
      stampId: s.stamps.dupTarget,
      catalogRefs: item.catalogRefs,
      backfill: true,
    });
    assert.equal(blocked.backfill.find((p) => p.catalog === "Sn")?.status, "duplicate");
    assert.equal((await numbersOf(s.stamps.dupTarget)).length, 1, "block mode wrote nothing");

    await prisma.collection.update({
      where: { id: s.collectionId },
      data: { duplicateCatalogMode: "warn" },
    });
    const warned = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: item.colnectId,
      stampId: s.stamps.dupTarget,
      catalogRefs: item.catalogRefs,
      backfill: true,
    });
    const sn = warned.backfill.find((p) => p.catalog === "Sn");
    assert.equal(sn?.status, "filled");
    assert.equal(sn?.duplicateWarning, true);
    assert.deepEqual(sn?.duplicateStampNames, ["Dup holder"]);

    const rows = await numbersOf(s.stamps.dupTarget);
    assert.equal(rows.find((r) => r.catalogVendorId === s.sn)?.number, "4000");
  });

  it("backfills the stamp the user picked when confirming an ambiguous match", async () => {
    const item = {
      colnectId: "1004",
      catalogRefs: [
        { catalog: "Mi", number: "PL 900" },
        { catalog: "Sn", number: "PL 901" },
      ],
    };

    // Ambiguous: two stamps carry Michel PL 900, so nothing is written and both are offered with
    // their own proposals.
    const [preview] = await matchColnectItems(s.userId, s.collectionId, [item], {
      dryRun: true,
      backfill: true,
    });
    assert.equal(preview.status, "needs-confirm");
    if (preview.status === "needs-confirm") {
      assert.equal(preview.candidates.length, 2);
      for (const c of preview.candidates) {
        assert.equal(c.backfill.find((p) => p.catalog === "Sn")?.status, "would-fill");
      }
    }
    assert.equal((await numbersOf(s.stamps.pickA)).length, 1);

    const applied = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: item.colnectId,
      stampId: s.stamps.pickA,
      catalogRefs: item.catalogRefs,
      backfill: true,
    });
    assert.equal(applied.backfill.find((p) => p.catalog === "Sn")?.status, "filled");

    const picked = await numbersOf(s.stamps.pickA);
    assert.equal(picked.find((r) => r.catalogVendorId === s.sn)?.number, "901");
    // The stamp the user did not pick is untouched.
    assert.equal((await numbersOf(s.stamps.pickB)).length, 1);
  });

  it("leaves the confirmed stamp alone when the backfill is not asked for", async () => {
    const applied = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "1005",
      stampId: s.stamps.pickB,
      catalogRefs: [
        { catalog: "Mi", number: "PL 900" },
        { catalog: "Sn", number: "PL 902" },
      ],
    });
    assert.deepEqual(applied, { backfill: [], date: null });
    assert.equal((await numbersOf(s.stamps.pickB)).length, 1);
  });
});
