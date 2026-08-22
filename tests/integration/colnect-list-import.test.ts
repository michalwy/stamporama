import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createTrade, updateTradeSection } from "../../src/lib/trades";
import {
  importColnectListRows,
  previewColnectListImport,
  resolveColnectImportRows,
  type ColnectImportRow,
} from "../../src/lib/colnect-list-import";
import {
  addTradeColnectList,
  listTradeColnectLists,
  updateTradeColnectList,
} from "../../src/lib/trade-colnect-lists";

// **A Colnect list becomes lines on a trade** (#645).
//
// What only a database can answer, and so what is checked here: that a row finds its stamp by the
// Colnect id it carries and, failing that, by the catalog numbers it prints; that a grade travels
// through the collection's *own* Colnect mapping rather than through a second opinion; that a row
// stating no grade takes the section's default and, where the section states none, comes back as a
// gap; that the give side reports what it cannot serve instead of quietly writing less; and that
// nothing at all is written by a preview.
//
// The file under test is a real Colnect export, trimmed to eight rows — the same fixture the unit
// tests read, so the two halves cannot drift apart about what the file says.

const FIXTURE = readFileSync(
  join(process.cwd(), "tests/fixtures/colnect/own-wish-list.csv"),
  "utf8"
);

/** A real export whose stamps sit on **two** of the collector's lists — the ordinary case, since
 *  what is offered for exchange is also on a swap list and what is wanted is also on a wish list. */
const TWO_LISTS = readFileSync(
  join(process.cwd(), "tests/fixtures/colnect/own-list-two-lists.csv"),
  "utf8"
);
/** Line 19 of that file: `Wish` wants it MNH, `Test Swap FROM` states U. */
const TWO_GRADES = { colnectId: "932289", line: 19 };

/** The first row of that fixture: Andorra, `Mi:AD-ES 207`, Colnect 25270, quantity 1, MNH. */
const ANDORRA = { colnectId: "25270", michel: "AD-ES 207", line: 8 };
/** The second: Albania, `Mi:AL 1155`, Colnect 331501, no quantity and no grade. */
const ALBANIA = { colnectId: "331501", michel: "AL 1155", line: 9 };

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  michelVendorId: string;
  mnhId: string;
  usedId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-colnect-import-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User colnect-import-${ts}`,
      email: `test-colnect-import-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-colnect-import-${ts}`,
      name: `Collection colnect-import-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  // The vendor's abbreviation is `Mi`, which is also Colnect's — the matcher's second route, taken
  // without a mapping row (`resolveColnectAbbreviation`'s `exact` fallback).
  const michel = await prisma.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  const mnh = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
  });
  const used = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
  });
  // The collection's own reading of Colnect's grades (#404). The import reads these **backwards**.
  await prisma.colnectConditionMapping.create({
    data: { collectionId, stampConditionId: mnh.id, colnectValue: "1" },
  });
  await prisma.colnectConditionMapping.create({
    data: { collectionId, stampConditionId: used.id, colnectValue: "4" },
  });

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    michelVendorId: michel.id,
    mnhId: mnh.id,
    usedId: used.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

/** A stamp in the collection, optionally carrying a Colnect id and a Michel number. */
async function stamp(over: { colnectId?: string; michel?: string; name?: string }) {
  seq += 1;
  const created = await prisma.stamp.create({
    data: {
      collectionId: f.collectionId,
      name: over.name ?? `Stamp ${seq}`,
      colnectId: over.colnectId ?? null,
      ...(over.michel
        ? {
            catalogNumbers: {
              create: [{ catalogVendorId: f.michelVendorId, number: over.michel }],
            },
          }
        : {}),
    },
  });
  return created;
}

async function trade(): Promise<{ tradeId: string; sectionId: string }> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: `colnect-import ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  return { tradeId: created.id, sectionId: created.sections[0].id };
}

function rowAt(rows: ColnectImportRow[], line: number): ColnectImportRow {
  const row = rows.find((r) => r.line === line);
  assert.ok(row, `no row on line ${line}`);
  return row;
}

/** The rows a screen would let through for one list — a stamp, a grade, and nothing left to answer. */
function settled(rows: ColnectImportRow[], listName = "Test Swap FROM") {
  const out: { line: number; stampId: string; conditionId: string; quantity: number }[] = [];
  for (const row of rows) {
    const entry = row.entries.find((candidate) => candidate.listName === listName);
    if (!entry || !row.stampId || !entry.conditionId) continue;
    out.push({
      line: row.line,
      stampId: row.stampId,
      conditionId: entry.conditionId,
      quantity: entry.quantity,
    });
  }
  return out;
}

/** One row's reading on one list — what the screen draws in its Condition cell. */
function entryOn(row: ColnectImportRow, listName = "Test Swap FROM") {
  const entry = row.entries.find((candidate) => candidate.listName === listName);
  assert.ok(entry, `row ${row.line} is not on ${listName}`);
  return entry;
}

before(async () => {
  f = await seed();
});

beforeEach(async () => {
  await prisma.trade.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.item.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.stamp.deleteMany({ where: { collectionId: f.collectionId } });
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("finding the stamp a row is about (#645)", () => {
  it("takes a stamp already carrying the row's Colnect id, and says so", async () => {
    await stamp({ colnectId: ANDORRA.colnectId, name: "Coat of arms" });
    const { sectionId } = await trade();

    const preview = await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE);
    const row = rowAt(preview.rows, ANDORRA.line);
    assert.equal(row.matchedBy, "colnect-id");
    assert.equal(row.stampLabel, "Coat of arms");
    assert.equal(row.stampGap, null);
    assert.equal(entryOn(row).conditionGap, null);
  });

  it("falls back to the catalog numbers the row prints", async () => {
    const found = await stamp({ michel: ANDORRA.michel, name: "By number" });
    const { sectionId } = await trade();

    const preview = await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE);
    const row = rowAt(preview.rows, ANDORRA.line);
    assert.equal(row.matchedBy, "catalog-number");
    assert.equal(row.stampId, found.id);

    // **Which** number matched is marked, on both sides — the collector checks a match against the
    // numbers that did not match, so all of them are carried and one of them is picked out.
    assert.deepEqual(
      row.catalogRefs.map((ref) => [ref.number, ref.status]).slice(0, 2),
      [
        ["AD-ES 207", "matched"],
        ["AD-ES 196", "unmapped"],
      ]
    );
    assert.deepEqual(row.stampNumbers, [{ label: "Mi AD-ES 207", status: "matched" }]);
    assert.equal(row.colnectIdMatched, false);
  });

  it("marks the Colnect id as the evidence where the id is what matched", async () => {
    await stamp({ colnectId: ANDORRA.colnectId, michel: ANDORRA.michel });
    const { sectionId } = await trade();

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE)).rows,
      ANDORRA.line
    );
    assert.equal(row.colnectIdMatched, true);
    // And the numbers are still shown, still marked — the id decided it, the numbers corroborate it.
    assert.deepEqual(row.stampNumbers, [{ label: "Mi AD-ES 207", status: "matched" }]);
  });

  it("never writes a Colnect id onto a stamp while reading somebody else's list", async () => {
    const found = await stamp({ michel: ANDORRA.michel });
    const { sectionId } = await trade();

    await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE);

    const after = await prisma.stamp.findUnique({
      where: { id: found.id },
      select: { colnectId: true },
    });
    assert.equal(after?.colnectId, null);
  });

  it("reports a row it cannot place rather than dropping it", async () => {
    const { sectionId } = await trade();
    const preview = await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE);

    assert.equal(preview.rows.length, 8, "every row of the file survives to the report");
    const row = rowAt(preview.rows, ANDORRA.line);
    assert.equal(row.stampId, null);
    // `not-held` rather than `unresolved`: the collection keeps Michel, so the reference resolved
    // fine — there is simply no stamp here carrying that number.
    assert.equal(row.stampGap, "not-held");
    // And it still carries what a person needs to recognise it.
    assert.equal(row.country, "Andorra, Spanish Administration");
    // `unknown` rather than `matched`: the catalog resolves, but with no stamp to compare against,
    // claiming the number missing or conflicting would be a guess (#284's vocabulary).
    assert.deepEqual(row.catalogRefs[0], {
      catalog: "Mi",
      number: "AD-ES 207",
      status: "unknown",
    });
    // And the way out to Colnect, which on an unmatched row is the search that says what it is.
    assert.equal(row.colnectUrl, "https://colnect.com/en/stamps/stamp/25270");
  });

  it("offers the candidates it could not choose between", async () => {
    await stamp({ michel: ANDORRA.michel, name: "One" });
    await stamp({ michel: ANDORRA.michel, name: "Two" });
    const { sectionId } = await trade();

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE)).rows,
      ANDORRA.line
    );
    assert.equal(row.stampId, null);
    assert.equal(row.stampGap, "ambiguous");
    assert.deepEqual(row.candidates.map((c) => c.label).sort(), ["One", "Two"]);
    // Each carries its own numbers, marked — which is what makes *which of these two* answerable.
    assert.deepEqual(row.candidates[0].numbers, [
      { label: "Mi AD-ES 207", status: "matched" },
    ]);
  });
});

describe("the grade a row is in (#645)", () => {
  it("reads the collection's own Colnect mapping backwards", async () => {
    await stamp({ colnectId: ANDORRA.colnectId });
    const { sectionId } = await trade();

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE)).rows,
      ANDORRA.line
    );
    const entry = entryOn(row);
    assert.equal(entry.statedGrade, "MNH");
    assert.equal(entry.conditionId, f.mnhId);
    assert.equal(entry.conditionFromSection, false);
  });

  it("calls a grade the collection has never mapped a gap, not a guess", async () => {
    await prisma.colnectConditionMapping.deleteMany({
      where: { collectionId: f.collectionId, colnectValue: "1" },
    });
    await stamp({ colnectId: ANDORRA.colnectId });
    const { sectionId } = await trade();

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE)).rows,
      ANDORRA.line
    );
    assert.equal(entryOn(row).conditionId, null);
    assert.equal(entryOn(row).conditionGap, "unmapped-grade");

    await prisma.colnectConditionMapping.create({
      data: { collectionId: f.collectionId, stampConditionId: f.mnhId, colnectValue: "1" },
    });
  });

  it("fills a silent row from the section's default, and marks where it came from", async () => {
    await stamp({ colnectId: ALBANIA.colnectId });
    const { sectionId } = await trade();
    await updateTradeSection(f.userId, sectionId, {
      name: "Swap",
      defaultConditionId: f.usedId,
    });

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE)).rows,
      ALBANIA.line
    );
    const entry = entryOn(row);
    assert.equal(entry.statedGrade, null);
    assert.equal(entry.conditionId, f.usedId);
    assert.equal(entry.conditionFromSection, true);
  });

  it("leaves a silent row as a gap where the section states no default", async () => {
    await stamp({ colnectId: ALBANIA.colnectId });
    const { sectionId } = await trade();

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE)).rows,
      ALBANIA.line
    );
    assert.equal(entryOn(row).conditionId, null);
    assert.equal(entryOn(row).conditionGap, "not-stated");
  });
});

describe("which of the collector's lists is being imported (#645)", () => {
  it("counts the lists and suggests the one every row carries", async () => {
    const { sectionId } = await trade();
    const preview = await previewColnectListImport(f.userId, sectionId, "receive", TWO_LISTS);

    assert.deepEqual(preview.lists, [
      { name: "Test Swap FROM", rows: 12 },
      { name: "Wish", rows: 4 },
    ]);
    assert.equal(preview.suggestedList, "Test Swap FROM");
  });

  it("keeps a grade per list, so the same stamp is mint on one and used on the other", async () => {
    await stamp({ colnectId: TWO_GRADES.colnectId });
    const { sectionId } = await trade();

    const preview = await previewColnectListImport(f.userId, sectionId, "receive", TWO_LISTS);
    const row = rowAt(preview.rows, TWO_GRADES.line);

    // The whole point: neither grade is chosen here, and neither is dropped.
    assert.deepEqual(
      row.entries.map((entry) => [entry.listName, entry.statedGrade, entry.conditionId]),
      [
        ["Wish", "MNH", f.mnhId],
        ["Test Swap FROM", "U", f.usedId],
      ]
    );
  });

  it("keeps a blank group on its own list rather than shifting the next grade onto it", async () => {
    // Line 16 states `[2],[]` and `[MNH],[]`: two mint wanted on Wish, and the swap list says
    // nothing at all. With no section default, that second entry is a gap — not an MNH.
    await stamp({ colnectId: "528372" });
    const { sectionId } = await trade();

    const row = rowAt(
      (await previewColnectListImport(f.userId, sectionId, "receive", TWO_LISTS)).rows,
      16
    );
    assert.deepEqual(
      row.entries.map((entry) => [entry.listName, entry.conditionId, entry.quantity]),
      [
        ["Wish", f.mnhId, 2],
        ["Test Swap FROM", null, 1],
      ]
    );
    assert.equal(entryOn(row, "Test Swap FROM").conditionGap, "not-stated");
  });

  it("imports the list that was chosen, and only the rows on it", async () => {
    const onBoth = await stamp({ colnectId: TWO_GRADES.colnectId });
    const onSwapOnly = await stamp({ colnectId: ANDORRA.colnectId });
    const { tradeId, sectionId } = await trade();

    const preview = await previewColnectListImport(f.userId, sectionId, "receive", TWO_LISTS);

    // Chosen: Wish. Four rows carry it; only the one whose stamp is here can be written, and the
    // Andorra row — which is on the swap list and not on Wish — is simply not part of it.
    await importColnectListRows(f.userId, sectionId, "receive", settled(preview.rows, "Wish"));
    let lines = await prisma.tradeLine.findMany({
      where: { tradeId, side: "receive" },
      select: { stampId: true, conditionId: true, quantity: true },
    });
    assert.deepEqual(lines, [{ stampId: onBoth.id, conditionId: f.mnhId, quantity: 1 }]);

    // Chosen: the swap list. The same stamp comes in **used**, and Andorra joins it.
    const second = await trade();
    const secondPreview = await previewColnectListImport(
      f.userId,
      second.sectionId,
      "receive",
      TWO_LISTS
    );
    await importColnectListRows(
      f.userId,
      second.sectionId,
      "receive",
      settled(secondPreview.rows, "Test Swap FROM")
    );
    lines = await prisma.tradeLine.findMany({
      where: { tradeId: second.tradeId, side: "receive" },
      orderBy: { position: "asc" },
      select: { stampId: true, conditionId: true, quantity: true },
    });
    assert.deepEqual(lines, [
      { stampId: onSwapOnly.id, conditionId: f.mnhId, quantity: 1 },
      { stampId: onBoth.id, conditionId: f.usedId, quantity: 1 },
    ]);
  });
});

describe("writing the list into a side (#645)", () => {
  it("writes the receive side with the file's own quantities", async () => {
    const andorra = await stamp({ colnectId: ANDORRA.colnectId });
    const { tradeId, sectionId } = await trade();
    await updateTradeSection(f.userId, sectionId, { name: "Swap", defaultConditionId: f.usedId });

    const preview = await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE);
    const result = await importColnectListRows(
      f.userId,
      sectionId,
      "receive",
      settled(preview.rows)
    );

    assert.equal(result.added, 1, "only the row whose stamp was found is written");
    const lines = await prisma.tradeLine.findMany({
      where: { tradeId, side: "receive" },
      select: { stampId: true, conditionId: true, quantity: true },
    });
    assert.deepEqual(lines, [
      { stampId: andorra.id, conditionId: f.mnhId, quantity: 1 },
    ]);
  });

  it("promises a copy on the give side, through #659's resolver", async () => {
    const andorra = await stamp({ colnectId: ANDORRA.colnectId });
    const copy = await createItem(f.userId, f.collectionId, {
      stampId: andorra.id,
      conditionId: f.mnhId,
    });
    const { tradeId, sectionId } = await trade();

    const preview = await previewColnectListImport(f.userId, sectionId, "give", FIXTURE);
    assert.deepEqual(preview.shortfalls, [
      { line: ANDORRA.line, requested: 1, served: 1, missing: 0 },
    ]);

    const result = await importColnectListRows(f.userId, sectionId, "give", settled(preview.rows));
    assert.equal(result.added, 1);
    const lines = await prisma.tradeLine.findMany({
      where: { tradeId, side: "give" },
      select: { itemId: true },
    });
    assert.deepEqual(lines, [{ itemId: copy.id }]);
  });

  it("states what it cannot serve — the gap the partner is sent back", async () => {
    const andorra = await stamp({ colnectId: ANDORRA.colnectId });
    const { sectionId } = await trade();

    const preview = await previewColnectListImport(f.userId, sectionId, "give", FIXTURE);
    assert.deepEqual(preview.shortfalls, [
      { line: ANDORRA.line, requested: 1, served: 0, missing: 1 },
    ]);

    // Holding one of two asked for is a shortfall, not a refusal: the line that can be promised is.
    await createItem(f.userId, f.collectionId, { stampId: andorra.id, conditionId: f.mnhId });
    const shortfalls = await resolveColnectImportRows(f.userId, (await trade()).tradeId, [
      { line: ANDORRA.line, stampId: andorra.id, conditionId: f.mnhId, quantity: 2 },
    ]);
    assert.deepEqual(shortfalls, [
      { line: ANDORRA.line, requested: 2, served: 1, missing: 1 },
    ]);
  });

  it("writes nothing at all while previewing", async () => {
    await stamp({ colnectId: ANDORRA.colnectId });
    const { tradeId, sectionId } = await trade();
    await previewColnectListImport(f.userId, sectionId, "give", FIXTURE);
    await previewColnectListImport(f.userId, sectionId, "receive", FIXTURE);
    assert.equal(await prisma.tradeLine.count({ where: { tradeId } }), 0);
  });

  it("refuses a file that is not a Colnect list, by name", async () => {
    const { sectionId } = await trade();
    await assert.rejects(
      previewColnectListImport(f.userId, sectionId, "give", "a,b\n1,2\n"),
      /Colnect list export/
    );
  });
});

describe("the Colnect lists a trade is about (#645)", () => {
  it("keeps a list per side and does not duplicate the same address", async () => {
    const { tradeId } = await trade();
    await addTradeColnectList(f.userId, tradeId, {
      url: "https://colnect.com/en/stamps/list/custom_list__18/partner",
      label: "Their wants",
      side: "give",
    });
    await addTradeColnectList(f.userId, tradeId, {
      url: "https://colnect.com/en/stamps/list/custom_list__15/collector",
      label: "My wants",
      side: "receive",
    });
    // The import offers the file's own list every time it reads one; the second offer is the same
    // list, not a second one.
    await addTradeColnectList(f.userId, tradeId, {
      url: "https://colnect.com/en/stamps/list/custom_list__18/partner",
      side: "give",
    });

    const lists = await listTradeColnectLists(f.userId, tradeId);
    assert.equal(lists.length, 2);
    assert.deepEqual(
      lists.map((list) => [list.side, list.label]),
      [
        ["give", "Their wants"],
        ["receive", "My wants"],
      ],
      "a re-offer with no name keeps the name the collector typed"
    );
  });

  it("refuses an address a browser should not follow", async () => {
    const { tradeId } = await trade();
    await assert.rejects(
      addTradeColnectList(f.userId, tradeId, { url: "javascript:alert(1)", side: "give" }),
      /http or https/
    );
    await assert.rejects(
      addTradeColnectList(f.userId, tradeId, { url: "not a link", side: "give" }),
      /not a link/
    );
  });

  it("refuses to move one list onto another's address", async () => {
    const { tradeId } = await trade();
    const first = await addTradeColnectList(f.userId, tradeId, {
      url: "https://colnect.com/en/stamps/list/a/partner",
      side: "give",
    });
    await addTradeColnectList(f.userId, tradeId, {
      url: "https://colnect.com/en/stamps/list/b/partner",
      side: "receive",
    });
    await assert.rejects(
      updateTradeColnectList(f.userId, first.id, {
        url: "https://colnect.com/en/stamps/list/b/partner",
        side: "give",
      }),
      /already on this trade/
    );
  });
});
