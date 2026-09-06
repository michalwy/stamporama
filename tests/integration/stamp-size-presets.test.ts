import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  applyStampSizePreset,
  createStampSizePreset,
  deleteStampSizePreset,
  getStampSizePresets,
  renameStampSizePreset,
  reorderStampSizePresets,
  StampSizePresetFigureError,
  StampSizePresetPairTakenError,
} from "../../src/lib/stamp-size-presets";

// Stamp size presets (#803; ADR-0048) — the dictionary, and the write that copies a pair onto stamps.
//
// What is actually at risk here is not arithmetic. It is **which stamps the write reaches**, and the
// two ways of getting that wrong look identical from a passing assertion on the root: a walk that
// stops at depth one, and a walk that writes the whole collection. So the tree below is built so
// that each of those fails a control of its own — `309APa` sits three levels down and must be
// written, while `450` sits in the same collection on no issue and must not be.

const ts = Date.now();

describe("stamp size presets (#803)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let issueId: string;
  let checklistId: string;
  let vendorId: string;
  let areaId: string;
  /** `309` and its tree: `309A` (variant) → `309AP` (variant) → `309APa` (variant, three deep). */
  let base: string, a: string, ap: string, apa: string;
  /** `309 I`, a **distinct entry** under `309` — a plate flaw, not another way of holding it. */
  let flaw: string;
  /** `310`, a second issue member with a child of its own: every root expands, not just the first. */
  let second: string, secondChild: string;
  /** `450`, in the collection but on no issue and no checklist. The blast-radius control. */
  let outsider: string;

  const sizeOf = async (stampId: string) => {
    const row = await prisma.stamp.findUniqueOrThrow({
      where: { id: stampId },
      select: { widthMm: true, heightMm: true },
    });
    return {
      widthMm: row.widthMm === null ? null : row.widthMm.toNumber(),
      heightMm: row.heightMm === null ? null : row.heightMm.toNumber(),
    };
  };

  const clearSizes = () =>
    prisma.stamp.updateMany({ where: { collectionId }, data: { widthMm: null, heightMm: null } });

  const clearPresets = () => prisma.stampSizePreset.deleteMany({ where: { collectionId } });

  before(async () => {
    userId = `test-user-sizepreset-${ts}`;
    otherUserId = `test-user-sizepreset-other-${ts}`;
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        name: `Test User ${id}`,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sizepreset-${ts}`, name: "Presets", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    vendorId = vendor.id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Infla" } })
    ).id;
    const variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Overprint variety",
          actsAsVariant: true,
          isDefault: true,
          sortOrder: 0,
        },
      })
    ).id;
    const distinctSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Plate flaw",
          actsAsVariant: false,
          isDefault: false,
          sortOrder: 1,
        },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9803, collectionAreaId: areaId, name: "Germania", year: 1922 },
      })
    ).id;

    const stamp = async (
      number: string,
      opts: { parentId?: string; subtypeId?: string } = {}
    ): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: number,
            parentId: opts.parentId,
            subtypeId: opts.subtypeId,
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;

    base = await stamp("309");
    a = await stamp("309A", { parentId: base, subtypeId: variantSubtypeId });
    ap = await stamp("309AP", { parentId: a, subtypeId: variantSubtypeId });
    apa = await stamp("309APa", { parentId: ap, subtypeId: variantSubtypeId });
    flaw = await stamp("309 I", { parentId: base, subtypeId: distinctSubtypeId });
    second = await stamp("310");
    secondChild = await stamp("310A", { parentId: second, subtypeId: variantSubtypeId });
    outsider = await stamp("450");

    await prisma.issueMember.createMany({
      data: [base, second].map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });
    checklistId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId,
          name: "Basic",
          sortOrder: 0,
          stamps: { create: [{ stampId: base }] },
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await clearSizes();
    await clearPresets();
  });

  after(async () => {
    await prisma.stampSizePreset.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogNumber.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stampCollectionArea.deleteMany({ where: { stamp: { collectionId } } });
    // Children first: `Stamp.parent` is `Restrict`-free but the rows still reference one another.
    for (const id of [apa, ap, a, flaw, secondChild, base, second, outsider]) {
      await prisma.stamp.deleteMany({ where: { id } });
    }
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  // --- the dictionary ---------------------------------------------------------------------------

  it("saves a pair with no name, appended at the end of the order", async () => {
    const first = await createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30 });
    const next = await createStampSizePreset(userId, collectionId, {
      widthMm: 21.5,
      heightMm: 25,
      name: "  Germania  ",
    });
    assert.equal(first.name, null);
    assert.equal(next.name, "Germania");
    assert.equal(first.sortOrder, 0);
    assert.equal(next.sortOrder, 1);

    const list = await getStampSizePresets(userId, collectionId);
    assert.deepEqual(
      list.map((p) => [p.widthMm, p.heightMm, p.name]),
      [
        [25, 30, null],
        [21.5, 25, "Germania"],
      ]
    );
  });

  it("refuses a pair already saved, with its own error", async () => {
    await createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30, name: "One" });
    // A different name is not a different preset: the *numbers* are the identity (ADR-0048 §3).
    await assert.rejects(
      () => createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30, name: "Two" }),
      (err: unknown) => {
        assert.ok(err instanceof StampSizePresetPairTakenError, `got ${String(err)}`);
        assert.match(err.message, /25 × 30 mm/);
        return true;
      }
    );
    assert.equal((await getStampSizePresets(userId, collectionId)).length, 1);
  });

  it("compares the pair at the precision it is stored at, not as typed", async () => {
    await createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30 });
    // `Decimal(5, 1)` holds one place, so 30.04 *is* 30.0 once stored — and a create that let it
    // through would leave two rows the picker draws identically.
    await assert.rejects(
      () => createStampSizePreset(userId, collectionId, { widthMm: 25.04, heightMm: 29.98 }),
      StampSizePresetPairTakenError
    );
    // The rounding is what the row holds, not merely what the clash was judged on.
    const [saved] = await getStampSizePresets(userId, collectionId);
    assert.deepEqual([saved.widthMm, saved.heightMm], [25, 30]);
  });

  it("refuses a figure it cannot accept as a dimension", async () => {
    for (const bad of [
      { widthMm: 0, heightMm: 30 },
      { widthMm: 25, heightMm: 99999 },
      { widthMm: Number.NaN, heightMm: 30 },
    ]) {
      await assert.rejects(
        () => createStampSizePreset(userId, collectionId, bad),
        StampSizePresetFigureError,
        JSON.stringify(bad)
      );
    }
    assert.equal((await getStampSizePresets(userId, collectionId)).length, 0);
  });

  it("renames, reorders and deletes", async () => {
    const one = await createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30 });
    const two = await createStampSizePreset(userId, collectionId, { widthMm: 21.5, heightMm: 25 });

    await renameStampSizePreset(userId, one.id, " Germania ");
    await reorderStampSizePresets(userId, collectionId, [two.id, one.id]);
    assert.deepEqual(
      (await getStampSizePresets(userId, collectionId)).map((p) => [p.id, p.name]),
      [
        [two.id, null],
        [one.id, "Germania"],
      ]
    );

    // A blank name is *no name*, not an empty label.
    await renameStampSizePreset(userId, one.id, "   ");
    assert.equal((await getStampSizePresets(userId, collectionId))[1].name, null);

    await deleteStampSizePreset(userId, two.id);
    assert.deepEqual(
      (await getStampSizePresets(userId, collectionId)).map((p) => p.id),
      [one.id]
    );
  });

  it("refuses a reorder that is not exactly the collection's presets", async () => {
    const one = await createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30 });
    await createStampSizePreset(userId, collectionId, { widthMm: 21.5, heightMm: 25 });
    await assert.rejects(() => reorderStampSizePresets(userId, collectionId, [one.id]), /Reorder/);
  });

  it("does not answer to somebody else's user id", async () => {
    const one = await createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30 });
    await assert.rejects(() => getStampSizePresets(otherUserId, collectionId), /access denied/);
    await assert.rejects(() => renameStampSizePreset(otherUserId, one.id, "x"), /access denied/);
    await assert.rejects(() => deleteStampSizePreset(otherUserId, one.id), /access denied/);
    await assert.rejects(
      () =>
        applyStampSizePreset(otherUserId, {
          presetId: one.id,
          subject: { kind: "issue", issueId },
        }),
      /access denied/
    );
    assert.equal((await getStampSizePresets(userId, collectionId)).length, 1);
  });

  // --- the write ---------------------------------------------------------------------------------

  const preset = () => createStampSizePreset(userId, collectionId, { widthMm: 25, heightMm: 30 });

  it("writes the pair down the whole variant subtree, at any depth", async () => {
    const { id: presetId } = await preset();
    const result = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "issue", issueId },
    });

    // `309` + `309A` + `309AP` + `309APa` + `309 I` + `310` + `310A`. Seven, and `450` is not here.
    assert.equal(result.total, 7);
    assert.equal(result.withoutSize, 7);
    assert.equal(result.written, 7);

    // The control that matters: `309APa` hangs three levels below the member. A walk that stopped
    // at the member itself, or at depth one, or at depth two, leaves this null and fails here —
    // which is the only reason the depths are separate assertions rather than one loop.
    assert.deepEqual(await sizeOf(base), { widthMm: 25, heightMm: 30 }, "the member itself");
    assert.deepEqual(await sizeOf(a), { widthMm: 25, heightMm: 30 }, "one level down");
    assert.deepEqual(await sizeOf(ap), { widthMm: 25, heightMm: 30 }, "two levels down");
    assert.deepEqual(await sizeOf(apa), { widthMm: 25, heightMm: 30 }, "three levels down");

    // Every root expands, not only the first one the walk happened to reach.
    assert.deepEqual(await sizeOf(second), { widthMm: 25, heightMm: 30 });
    assert.deepEqual(await sizeOf(secondChild), { widthMm: 25, heightMm: 30 });

    // A distinct entry is on the same paper as its parent, so it takes the figure too — ADR-0048
    // §7 is a *write*, where `checklist-variant-rollup.ts`'s `actsAsVariant` filter answers a
    // question about collecting rather than about printing.
    assert.deepEqual(await sizeOf(flaw), { widthMm: 25, heightMm: 30 });

    // And the counterweight, without which every assertion above would also pass for a write that
    // simply updated the collection: `450` is in this collection, on no issue, and untouched.
    assert.deepEqual(await sizeOf(outsider), { widthMm: null, heightMm: null });
  });

  it("reaches the same subtree from a checklist naming only the root", async () => {
    const { id: presetId } = await preset();
    const result = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "checklist", checklistId },
    });
    // The checklist names `309` alone; the subtree is what makes it five.
    assert.equal(result.total, 5);
    assert.equal(result.written, 5);
    assert.deepEqual(await sizeOf(apa), { widthMm: 25, heightMm: 30 });
    // `310` is an issue member but not on this checklist, so the subject really did narrow.
    assert.deepEqual(await sizeOf(second), { widthMm: null, heightMm: null });
  });

  it("expands an explicit stamp list the same way", async () => {
    const { id: presetId } = await preset();
    const result = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "stamps", stampIds: [a, outsider] },
    });
    // `309A` carries `309AP` and `309APa` with it; `450` is a leaf. Four, and `309` — the *parent*
    // of the named stamp — is not among them: the walk goes down, never up.
    assert.equal(result.total, 4);
    assert.deepEqual(await sizeOf(apa), { widthMm: 25, heightMm: 30 });
    assert.deepEqual(await sizeOf(outsider), { widthMm: 25, heightMm: 30 });
    assert.deepEqual(await sizeOf(base), { widthMm: null, heightMm: null });
  });

  it("counts without writing when asked to preview", async () => {
    const { id: presetId } = await preset();
    await prisma.stamp.update({ where: { id: a }, data: { widthMm: 22, heightMm: 26 } });

    const preview = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "issue", issueId },
      preview: true,
    });
    assert.deepEqual(
      { ...preview },
      {
        widthMm: 25,
        heightMm: 30,
        total: 7,
        withoutSize: 6,
        withStatedSize: 1,
        written: 0,
      }
    );
    // Nothing moved — including the stamp that would have been written.
    assert.deepEqual(await sizeOf(base), { widthMm: null, heightMm: null });
    assert.deepEqual(await sizeOf(a), { widthMm: 22, heightMm: 26 });
  });

  it("skips a stated size by default and writes it only when told to", async () => {
    const { id: presetId } = await preset();
    await prisma.stamp.update({ where: { id: a }, data: { widthMm: 22, heightMm: 26 } });

    const skipped = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "issue", issueId },
    });
    assert.equal(skipped.withStatedSize, 1);
    assert.equal(skipped.written, 6);
    // The measurement survives the write that filled in everything around it.
    assert.deepEqual(await sizeOf(a), { widthMm: 22, heightMm: 26 });
    assert.deepEqual(await sizeOf(ap), { widthMm: 25, heightMm: 30 });

    const overwritten = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "issue", issueId },
      overwriteStated: true,
    });
    assert.equal(overwritten.written, 7);
    assert.deepEqual(await sizeOf(a), { widthMm: 25, heightMm: 30 });
  });

  it("treats a stamp stating half a size as stating one", async () => {
    const { id: presetId } = await preset();
    // #763's "half a size is no size" governs **resolution** — half a box cannot be drawn. It is
    // not the rule here: a lone width is a figure the collector typed on purpose, and reading it as
    // *no size* would let the unchecked checkbox erase it.
    await prisma.stamp.update({ where: { id: a }, data: { widthMm: 22, heightMm: null } });

    const skipped = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "issue", issueId },
    });
    assert.equal(skipped.withStatedSize, 1);
    assert.deepEqual(await sizeOf(a), { widthMm: 22, heightMm: null });

    await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "issue", issueId },
      overwriteStated: true,
    });
    // Overwriting writes *both* columns, so the half-stated stamp ends up with a whole size.
    assert.deepEqual(await sizeOf(a), { widthMm: 25, heightMm: 30 });
  });

  it("leaves no reference behind: deleting the preset does not touch the stamps", async () => {
    const { id: presetId } = await preset();
    await applyStampSizePreset(userId, { presetId, subject: { kind: "issue", issueId } });
    await deleteStampSizePreset(userId, presetId);
    // ADR-0048 §1 as a fact about the schema rather than a claim in a comment: the pair was copied.
    assert.deepEqual(await sizeOf(apa), { widthMm: 25, heightMm: 30 });
  });

  it("refuses a subject from another collection rather than reporting nothing to do", async () => {
    const { id: presetId } = await preset();
    const strangerId = (
      await prisma.collection.create({
        data: {
          slug: `col-sizepreset-alt-${ts}`,
          name: "Elsewhere",
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    const strangerAreaId = (
      await prisma.collectionArea.create({ data: { collectionId: strangerId, name: "Elsewhere" } })
    ).id;
    const strangerIssueId = (
      await prisma.issue.create({
        data: {
          collectionId: strangerId,
          issueNo: 1,
          collectionAreaId: strangerAreaId,
          name: "Other",
        },
      })
    ).id;
    const strangerStampId = (
      await prisma.stamp.create({ data: { collectionId: strangerId, name: "1" } })
    ).id;

    await assert.rejects(
      () =>
        applyStampSizePreset(userId, {
          presetId,
          subject: { kind: "issue", issueId: strangerIssueId },
        }),
      /Issue not found/
    );
    await assert.rejects(
      () =>
        applyStampSizePreset(userId, {
          presetId,
          subject: { kind: "stamps", stampIds: [base, strangerStampId] },
        }),
      /Stamp not found/
    );
    assert.deepEqual(await sizeOf(base), { widthMm: null, heightMm: null });

    await prisma.stamp.delete({ where: { id: strangerStampId } });
    await prisma.issue.delete({ where: { id: strangerIssueId } });
    await prisma.collectionArea.delete({ where: { id: strangerAreaId } });
    await prisma.collection.delete({ where: { id: strangerId } });
  });

  it("reports an empty subject as nothing to do", async () => {
    const { id: presetId } = await preset();
    const emptyChecklistId = (
      await prisma.checklist.create({
        data: { collectionId, issueId, name: "Empty", sortOrder: 1 },
      })
    ).id;
    const result = await applyStampSizePreset(userId, {
      presetId,
      subject: { kind: "checklist", checklistId: emptyChecklistId },
    });
    assert.deepEqual({ ...result }, {
      widthMm: 25,
      heightMm: 30,
      total: 0,
      withoutSize: 0,
      withStatedSize: 0,
      written: 0,
    });
    await prisma.checklist.delete({ where: { id: emptyChecklistId } });
  });

  it("seeds nothing: a fresh collection's list is empty", async () => {
    const freshId = (
      await prisma.collection.create({
        data: {
          slug: `col-sizepreset-fresh-${ts}`,
          name: "Fresh",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    assert.deepEqual(await getStampSizePresets(userId, freshId), []);
    await prisma.collection.delete({ where: { id: freshId } });
  });
});
