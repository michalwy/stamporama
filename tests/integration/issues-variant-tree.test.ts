import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { addStampToIssue, addVariantTreeToStamp, getVariantTree } from "../../src/lib/issues";
import { DEFAULT_CHECKLIST } from "../../src/lib/checklist-vocabulary";
import { variantPathKey, variantTreeToText } from "../../src/lib/variant-tree";

// A stamp's whole variant tree entered as indented text (#1447). What matters here is the write:
// every new line becomes a variant exactly as the single add dialog would have left it, numbered
// parent + suffix, with the kind the preview chose, in the lines' order — and a stored variant is
// never duplicated, renamed or deleted, and a failure writes nothing.

/** The collector's irregular example: one watermark with three perforations, colours under two of
 *  them, and a second watermark with none. */
const IRREGULAR = ["X", "  A", "    a", "    b", "  B", "  C", "    a", "Y"].join("\n");

let nextTestIssueNo = 1;

describe("entering a variant tree as indented text (#1447)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let wmkSubtypeId: string;
  let perfSubtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-vartree-${ts}`,
          name: `Test User vartree-${ts}`,
          email: `test-vartree-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-vartree-${ts}`, name: `Collection ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Area" } })).id;
    vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const subtype = async (name: string, sortOrder: number, isDefault = false) =>
      (
        await prisma.stampSubtype.create({
          data: { collectionId, name, actsAsVariant: true, isDefault, sortOrder },
        })
      ).id;
    await subtype("Colour", 0, true);
    wmkSubtypeId = await subtype("Watermark", 1);
    perfSubtypeId = await subtype("Perforation", 2);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newIssue(name: string) {
    return prisma.issue.create({
      data: { collectionId, issueNo: nextTestIssueNo++, collectionAreaId: areaId, name, year: 1958 },
    });
  }

  async function addBase(issueId: string, number: string, issuedYear: number | null = 1961) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name: "base",
      issuedYear,
      catalogNumbers: [{ catalogVendorId: vendorId, number }],
      checklistIds: [DEFAULT_CHECKLIST],
    });
    return stampId;
  }

  /** The tree under `stampId` in the issue's order, as `number subtype` lines indented by depth. */
  async function drawTree(issueId: string, stampId: string): Promise<string[]> {
    const names = new Map(
      (await prisma.stampSubtype.findMany({ where: { collectionId } })).map((s) => [s.id, s.name])
    );
    const walk = async (parentId: string, depth: number): Promise<string[]> => {
      const children = await prisma.stamp.findMany({
        where: { parentId },
        select: {
          id: true,
          subtypeId: true,
          catalogNumbers: { select: { number: true } },
          issueMemberships: { where: { issueId }, select: { sortOrder: true } },
        },
      });
      children.sort(
        (a, b) => (a.issueMemberships[0]?.sortOrder ?? 0) - (b.issueMemberships[0]?.sortOrder ?? 0)
      );
      const out: string[] = [];
      for (const c of children) {
        out.push(`${"  ".repeat(depth)}${c.catalogNumbers[0]?.number} ${names.get(c.subtypeId ?? "")}`);
        out.push(...(await walk(c.id, depth + 1)));
      }
      return out;
    };
    return walk(stampId, 0);
  }

  it("creates the irregular tree, numbered parent + suffix, with the kinds chosen, in order", async () => {
    const issue = await newIssue("Irregular");
    const base = await addBase(issue.id, "123");

    const ids = await addVariantTreeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      text: IRREGULAR,
      kinds: {
        [variantPathKey(["X"])]: wmkSubtypeId,
        [variantPathKey(["Y"])]: wmkSubtypeId,
        [variantPathKey(["X", "A"])]: perfSubtypeId,
        [variantPathKey(["X", "B"])]: perfSubtypeId,
        [variantPathKey(["X", "C"])]: perfSubtypeId,
        // The colours are left without one: the collection's default.
      },
    });
    assert.equal(ids.length, 8);

    assert.deepEqual(await drawTree(issue.id, base), [
      "123X Watermark",
      "  123XA Perforation",
      "    123XAa Colour",
      "    123XAb Colour",
      "  123XB Perforation",
      "  123XC Perforation",
      "    123XCa Colour",
      "123Y Watermark",
    ]);

    // Everything else is what the single add dialog leaves on a variant.
    const rows = await prisma.stamp.findMany({
      where: { id: { in: ids } },
      select: {
        name: true,
        issuedYear: true,
        checklistEntries: { select: { checklistId: true } },
        issueMemberships: { select: { issueId: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      },
    });
    for (const r of rows) {
      assert.equal(r.name, null);
      assert.equal(r.issuedYear, 1961, "dated from the base stamp, not the issue");
      assert.deepEqual(r.checklistEntries, []);
      assert.deepEqual(r.issueMemberships, [{ issueId: issue.id }]);
      assert.deepEqual(r.stampAreaLinks, [{ collectionAreaId: areaId, isPrimary: true }]);
    }
  });

  it("opens on the stored tree, and a second pass adds only the new lines, in their place", async () => {
    const issue = await newIssue("Extend");
    const base = await addBase(issue.id, "200");
    await addVariantTreeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      text: "A\n  a\nC",
      kinds: { [variantPathKey(["A"])]: wmkSubtypeId, [variantPathKey(["C"])]: wmkSubtypeId },
    });

    const opened = await getVariantTree(userId, collectionId, issue.id, base, vendorId);
    assert.equal(opened.baseNumber, "200");
    const text = variantTreeToText(opened.variants, opened.baseNumber);
    assert.equal(text, "A\n  a\nC");

    const before = await prisma.stamp.findMany({ where: { collectionId }, select: { id: true } });
    const ids = await addVariantTreeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      // B between A and C, and a colour under C. A new line on the watermarks' level takes their
      // kind, which the dialog sends explicitly.
      text: "A\n  a\nB\nC\n  c",
      kinds: { [variantPathKey(["B"])]: wmkSubtypeId },
    });
    assert.equal(ids.length, 2);
    const after = await prisma.stamp.findMany({ where: { collectionId }, select: { id: true } });
    assert.equal(after.length, before.length + 2, "nothing stored was duplicated");

    assert.deepEqual(await drawTree(issue.id, base), [
      "200A Watermark",
      "  200Aa Colour",
      "200B Watermark",
      "200C Watermark",
      "  200Cc Colour",
    ]);
  });

  it("neither renames nor deletes a variant whose line is removed", async () => {
    const issue = await newIssue("Removed line");
    const base = await addBase(issue.id, "300");
    await addVariantTreeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      text: "a\nb",
    });
    await addVariantTreeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      text: "a\nc",
    });
    assert.deepEqual(await drawTree(issue.id, base), ["300a Colour", "300b Colour", "300c Colour"]);
  });

  it("writes nothing when the text carries a mistake", async () => {
    const issue = await newIssue("Mistakes");
    const base = await addBase(issue.id, "400");
    const count = () => prisma.stamp.count({ where: { collectionId } });
    const before = await count();

    await assert.rejects(
      addVariantTreeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        text: "a\n  b\n      c",
      }),
      /Line 3: It is indented more than one level/
    );
    await assert.rejects(
      addVariantTreeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        text: "a\nb\na",
      }),
      /Line 3: The suffix a is already used/
    );
    assert.equal(await count(), before);
  });

  it("writes nothing when a kind is refused", async () => {
    const issue = await newIssue("Foreign kind");
    const base = await addBase(issue.id, "500");
    const before = await prisma.stamp.count({ where: { collectionId } });

    await assert.rejects(
      addVariantTreeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        text: "A\n  a",
        kinds: { [variantPathKey(["A", "a"])]: "no-such-subtype" },
      }),
      /Subtype not found/
    );
    assert.equal(await prisma.stamp.count({ where: { collectionId } }), before);
  });

  it("writes nothing when the write fails halfway", async () => {
    const issue = await newIssue("Halfway");
    const base = await addBase(issue.id, "600");
    const before = await prisma.stamp.count({ where: { collectionId } });

    // The catalog numbers are written after every stamp is created, and Postgres refuses a NUL in
    // text — so this fails inside the transaction, with stamps already written, and they must go.
    await assert.rejects(
      addVariantTreeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        text: "a\nb\u0000",
      })
    );
    assert.equal(await prisma.stamp.count({ where: { collectionId } }), before);
  });

  it("refuses a stamp that is not a member of the issue", async () => {
    const home = await newIssue("Home");
    const elsewhere = await newIssue("Elsewhere");
    const base = await addBase(home.id, "700");
    await assert.rejects(
      addVariantTreeToStamp(userId, collectionId, elsewhere.id, base, {
        catalogVendorId: vendorId,
        text: "a",
      }),
      /not a member of this issue/
    );
  });
});
