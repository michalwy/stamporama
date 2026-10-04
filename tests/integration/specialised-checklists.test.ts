import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createChecklist,
  ensureDefaultChecklist,
  getChecklist,
  getChecklistsForIssue,
  listChecklistIdsByStamp,
  listSpanningChecklists,
  renameChecklist,
  reorderChecklists,
  setChecklistKind,
  setChecklistStamps,
  setStampChecklistsForIssue,
} from "../../src/lib/checklists";
import { getIssueListItem, listIssueMembers } from "../../src/lib/issues";
import { getIssueCompleteness } from "../../src/lib/checklist-completeness";
import { getSpanningChecklistOverview } from "../../src/lib/spanning-checklists";
import { previewIssueMissingWants } from "../../src/lib/wants";
import { createAlbum, gatherAlbumEntries, getAlbumEntries } from "../../src/lib/albums";
import { loadPoolChecklists } from "../../src/lib/lot-builder";
import { getStampListItem } from "../../src/lib/stamps";

// Standard and specialised checklists (#1617, ADR-0031 §11) — the domain half.
//
// What is pinned: a checklist is standard unless made otherwise; every read that lists, offers or
// counts checklists leaves the specialised ones out unless asked to include them — an issue's list,
// the issue row's badge and count, the stamp tree (a stamp on none but a specialised one is *not on a
// checklist*), the completeness grid, the want-list gap, the stamp's own memberships, the
// spanning-checklist screen and its run picker, an album's gathering and the bulk-offer pool — while a
// checklist named by id answers whatever its kind; a save that could not see the specialised ones
// leaves a stamp's places on them alone; a reorder of the visible ones keeps the hidden ones where
// they stood; and the default a stamp joins is the issue's first **standard** checklist.

const ts = Date.now();

describe("specialised checklists (#1617)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let issueId: string;
  /** Three stamps of one issue: `a` and `b` on the basic set, `c` only on the shades. */
  let a: string, b: string, c: string;
  let basicId: string;
  let shadesId: string;

  before(async () => {
    userId = `test-user-spec-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User spec-${ts}`,
        email: `test-spec-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-spec-${ts}`, name: "Spec", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 91617, collectionAreaId: areaId, name: "Grosik", year: 1928 },
      })
    ).id;
    const stamp = async (name: string, sortOrder: number) => {
      const id = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.issueMember.create({ data: { issueId, stampId: id, sortOrder } });
      return id;
    };
    a = await stamp("a", 0);
    b = await stamp("b", 1);
    c = await stamp("c", 2);

    basicId = await createChecklist(userId, collectionId, { issueId, name: "Basic" });
    shadesId = await createChecklist(userId, collectionId, {
      issueId,
      name: "Shades",
      kind: "specialised",
    });
    await setChecklistStamps(userId, basicId, [a, b]);
    await setChecklistStamps(userId, shadesId, [a, c]);
  });

  after(async () => {
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("makes a checklist standard unless it is made otherwise", async () => {
    assert.equal((await getChecklist(userId, collectionId, basicId))?.kind, "standard");
    // Straight through Prisma, the column's own default — what every existing row became.
    const raw = await prisma.checklist.create({
      data: { collectionId, issueId, name: "Raw", sortOrder: 9 },
      select: { id: true, kind: true },
    });
    assert.equal(raw.kind, "standard");
    await prisma.checklist.delete({ where: { id: raw.id } });
  });

  it("lists an issue's specialised checklists only when they are included", async () => {
    const ids = async (include: boolean) =>
      (await getChecklistsForIssue(userId, collectionId, issueId, include)).map((c) => c.id);
    assert.deepEqual(await ids(false), [basicId]);
    assert.deepEqual(await ids(true), [basicId, shadesId]);
  });

  it("answers a specialised checklist named by id whatever the switch", async () => {
    const shades = await getChecklist(userId, collectionId, shadesId);
    assert.equal(shades?.kind, "specialised");
    assert.deepEqual(shades?.stampIds, [a, c]);
  });

  it("counts the issue row's checklists and stamps by the switch", async () => {
    const off = await getIssueListItem(userId, collectionId, issueId);
    assert.deepEqual(
      off?.checklists.map((c) => [c.id, c.kind]),
      [[basicId, "standard"]]
    );
    assert.equal(off?.requiredCount, 2);
    const on = await getIssueListItem(userId, collectionId, issueId, { includeSpecialised: true });
    assert.deepEqual(
      on?.checklists.map((c) => [c.id, c.kind]),
      [
        [basicId, "standard"],
        [shadesId, "specialised"],
      ]
    );
    assert.equal(on?.requiredCount, 3);
  });

  it("files a stamp on none but a specialised checklist as on no checklist while they are off", async () => {
    const onOf = async (include: boolean) =>
      new Map(
        (await listIssueMembers(userId, collectionId, issueId, undefined, null, include)).map(
          (node) => [node.stampId, node.checklistIds]
        )
      );
    const off = await onOf(false);
    assert.deepEqual(off.get(a), [basicId]);
    assert.deepEqual(off.get(c), []);
    const on = await onOf(true);
    assert.deepEqual([...(on.get(a) ?? [])].sort(), [basicId, shadesId].sort());
    assert.deepEqual(on.get(c), [shadesId]);
  });

  it("names a stamp's checklists by the switch", async () => {
    const off = await getStampListItem(userId, a);
    assert.deepEqual(
      off.issues[0].checklists.map((c) => c.id),
      [basicId]
    );
    const on = await getStampListItem(userId, a, { includeSpecialised: true });
    assert.deepEqual(
      on.issues[0].checklists.map((c) => [c.id, c.kind, c.on]),
      [
        [basicId, "standard", true],
        [shadesId, "specialised", true],
      ]
    );
    const chips = await listChecklistIdsByStamp(collectionId, [c], false);
    assert.equal(chips.get(c), undefined);
  });

  it("draws a completeness grid only for the checklists the switch shows", async () => {
    const off = await getIssueCompleteness(userId, collectionId, issueId, false);
    assert.deepEqual(
      off.checklists.map((g) => g.checklistId),
      [basicId]
    );
    const on = await getIssueCompleteness(userId, collectionId, issueId, true);
    assert.deepEqual(
      on.checklists.map((g) => [g.checklistId, g.kind]),
      [
        [basicId, "standard"],
        [shadesId, "specialised"],
      ]
    );
  });

  it("offers the want-list gap of the specialised checklists only when they are included", async () => {
    const off = await previewIssueMissingWants(userId, collectionId, issueId, undefined, null, false);
    assert.deepEqual(
      off.map((g) => g.checklistId),
      [basicId]
    );
    const on = await previewIssueMissingWants(userId, collectionId, issueId, undefined, null, true);
    assert.deepEqual(
      on.map((g) => [g.checklistId, g.kind]),
      [
        [basicId, "standard"],
        [shadesId, "specialised"],
      ]
    );
  });

  it("leaves a stamp's place on a specialised checklist alone when the form could not see it", async () => {
    // The stamp form with the switch off shows only *Basic*; taking `a` off it must not take `a`
    // off *Shades*, which the form never offered.
    await setStampChecklistsForIssue(userId, collectionId, issueId, a, [], false);
    assert.deepEqual((await getChecklist(userId, collectionId, basicId))?.stampIds, [b]);
    assert.deepEqual((await getChecklist(userId, collectionId, shadesId))?.stampIds, [a, c]);
    // With the switch on the form offered both, so an untick of either is meant — and a stamp that
    // stays keeps its place in the set (#764).
    await setStampChecklistsForIssue(userId, collectionId, issueId, a, [basicId, shadesId], true);
    assert.deepEqual((await getChecklist(userId, collectionId, basicId))?.stampIds, [b, a]);
    assert.deepEqual((await getChecklist(userId, collectionId, shadesId))?.stampIds, [a, c]);
    await setStampChecklistsForIssue(userId, collectionId, issueId, a, [basicId], true);
    assert.deepEqual((await getChecklist(userId, collectionId, shadesId))?.stampIds, [c]);
    // Back as the rest of the file expects it — emptied first, since a set keeps its stamps' order.
    for (const [id, stamps] of [
      [basicId, [a, b]],
      [shadesId, [a, c]],
    ] as const) {
      await setChecklistStamps(userId, id, []);
      await setChecklistStamps(userId, id, [...stamps]);
    }
  });

  it("keeps a hidden checklist where it stood when the visible ones are reordered", async () => {
    const second = await createChecklist(userId, collectionId, { issueId, name: "Imperforate" });
    // Basic, Shades (hidden), Imperforate — the editor with the switch off sees Basic, Imperforate.
    await reorderChecklists(userId, collectionId, issueId, [second, basicId]);
    const all = await getChecklistsForIssue(userId, collectionId, issueId, true);
    assert.deepEqual(
      all.map((c) => c.id),
      [second, shadesId, basicId]
    );
    await reorderChecklists(userId, collectionId, issueId, [basicId, shadesId, second]);
    await prisma.checklist.delete({ where: { id: second } });
  });

  it("makes the issue's first standard checklist the default a stamp joins", async () => {
    assert.equal(await ensureDefaultChecklist(userId, collectionId, issueId), basicId);
    // An issue whose only checklist is specialised gets a standard one, ahead of it.
    const other = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 91618, collectionAreaId: areaId, name: "Other", year: 1930 },
      })
    ).id;
    const onlyShades = await createChecklist(userId, collectionId, {
      issueId: other,
      name: "Other shades",
      kind: "specialised",
    });
    const made = await ensureDefaultChecklist(userId, collectionId, other);
    assert.notEqual(made, onlyShades);
    const listed = await getChecklistsForIssue(userId, collectionId, other, true);
    assert.deepEqual(
      listed.map((c) => [c.id, c.kind]),
      [
        [made, "standard"],
        [onlyShades, "specialised"],
      ]
    );
    await prisma.checklist.deleteMany({ where: { issueId: other } });
    await prisma.issue.delete({ where: { id: other } });
  });

  it("lists the specialised checklists spanning issues only when they are included", async () => {
    const thematic = await createChecklist(userId, collectionId, {
      issueId: null,
      name: "Every shade",
      kind: "specialised",
    });
    await setChecklistStamps(userId, thematic, [c]);
    assert.deepEqual(await listSpanningChecklists(userId, collectionId, false), []);
    assert.deepEqual(
      (await listSpanningChecklists(userId, collectionId, true)).map((s) => [s.id, s.kind]),
      [[thematic, "specialised"]]
    );
    assert.deepEqual(await getSpanningChecklistOverview(userId, collectionId, false), []);
    assert.deepEqual(
      (await getSpanningChecklistOverview(userId, collectionId, true)).map((s) => s.id),
      [thematic]
    );
    await prisma.checklist.delete({ where: { id: thematic } });
  });

  it("changes a checklist's kind, and nothing else about it", async () => {
    await setChecklistKind(userId, shadesId, "standard");
    let shades = await getChecklist(userId, collectionId, shadesId);
    assert.equal(shades?.kind, "standard");
    assert.deepEqual(shades?.stampIds, [a, c]);
    // The name form carries the type too; leaving it out leaves it as it is.
    await renameChecklist(userId, shadesId, "Shades", undefined, "specialised");
    await renameChecklist(userId, shadesId, "Shades");
    shades = await getChecklist(userId, collectionId, shadesId);
    assert.equal(shades?.kind, "specialised");
  });

  it("offers the bulk-offer pool only standard sets unless the specialised are included", async () => {
    const pool = [{ variantChain: [c] }];
    assert.deepEqual(await loadPoolChecklists(collectionId, pool, false), []);
    assert.deepEqual(
      (await loadPoolChecklists(collectionId, pool, true)).map((s) => s.checklistId),
      [shadesId]
    );
  });

  it("gathers only the standard checklists into an album unless the specialised are included", async () => {
    // A new album gathers its area's checklists as it is made — by the switch too.
    const albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Binder", collectionAreaId: areaId, language: "en" },
      null,
      false
    );
    assert.deepEqual(
      (await getAlbumEntries(userId, albumId)).map((e) => [e.checklistId, e.checklistKind]),
      [[basicId, "standard"]]
    );
    assert.equal(await gatherAlbumEntries(userId, albumId, false), 0);
    assert.equal(await gatherAlbumEntries(userId, albumId, true), 1);
    // An entry on a specialised checklist is the album's, listed whatever the switch says.
    assert.deepEqual(
      (await getAlbumEntries(userId, albumId)).map((e) => [e.checklistId, e.checklistKind]),
      [
        [basicId, "standard"],
        [shadesId, "specialised"],
      ]
    );
  });
});
