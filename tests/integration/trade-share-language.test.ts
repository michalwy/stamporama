import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines, addTradeReceiveLines } from "../../src/lib/trade-lines";
import {
  createTradeShareToken,
  readTradeShareLanguage,
  readTradeShareView,
  setTradeShareLanguage,
  verifyTradeShareToken,
  type TradeShareAccess,
} from "../../src/lib/trade-share";

// A trade's shared page in the partner's language (#2606): it opens in the partner's contact language,
// else the collection's; a choice in the collector's dialog is saved on the contact, and the page the
// partner already holds follows at the same address. Names are translated where the collection has a
// translation, and in its own wording where it has none.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  stampId: string;
  otherStampId: string;
  conditionId: string;
  areaId: string;
}

let f: Fixtures;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-share-lang-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User share-lang-${ts}`,
      email: `test-share-lang-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  // A Polish collection that lists in German somewhere — so German is one of its languages.
  const collection = await prisma.collection.create({
    data: { slug: `col-share-lang-${ts}`, name: "Anna", baseCurrency: "EUR", ownerId: userId, defaultLanguage: "pl" },
  });
  const collectionId = collection.id;
  await prisma.platform.create({ data: { collectionId, name: `Briefmarken ${ts}`, titleLanguage: "de" } });
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true, language: "en" },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Kasowany", abbreviation: "K", sortOrder: 0 },
  });
  await prisma.stampConditionTranslation.create({
    data: { stampConditionId: condition.id, language: "de", name: "Gestempelt", abbreviation: "G" },
  });
  const area = await prisma.collectionArea.create({ data: { collectionId, name: "Polska" } });
  await prisma.collectionAreaTranslation.create({
    data: { collectionAreaId: area.id, language: "de", titleName: "Polen" },
  });
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Kopernik" } });
  await prisma.stampTranslation.create({ data: { stampId: stamp.id, language: "de", name: "Kopernikus" } });
  // No translation of its own: it keeps the collection's wording on a German page.
  const other = await prisma.stamp.create({ data: { collectionId, name: "Chopin" } });
  for (const id of [stamp.id, other.id]) {
    await prisma.stampCollectionArea.create({ data: { stampId: id, collectionAreaId: area.id, isPrimary: true } });
  }
  return {
    userId,
    collectionId,
    partnerId: partner.id,
    stampId: stamp.id,
    otherStampId: other.id,
    conditionId: condition.id,
    areaId: area.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function sharedTrade(): Promise<{ tradeId: string; token: string }> {
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: null,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = created.sections[0].id;
  const item = await createItem(f.userId, f.collectionId, {
    stampId: f.stampId,
    conditionId: f.conditionId,
    forTrade: true,
  });
  const { refused } = await addTradeGiveLines(f.userId, sectionId, [item.id]);
  assert.deepEqual(refused, []);
  await addTradeReceiveLines(f.userId, sectionId, {
    stampId: f.otherStampId,
    conditionId: f.conditionId,
    certificateStatusId: null,
    formatId: null,
    quantity: 1,
  });
  const { token } = await createTradeShareToken(f.userId, created.id, { showValues: false, expiresAt: null });
  return { tradeId: created.id, token };
}

async function accessFor(token: string): Promise<TradeShareAccess> {
  const verified = await verifyTradeShareToken(token);
  assert.equal(verified.ok, true, "the link should still verify");
  return (verified as { ok: true; access: TradeShareAccess }).access;
}

describe("a trade's shared page in the partner's language (#2606)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("is shared in the partner's language — Language: English on the contact", async () => {
    const { tradeId, token } = await sharedTrade();
    const read = await readTradeShareLanguage(f.userId, tradeId);
    assert.equal(read.language, "en");
    assert.ok(read.languages.includes("pl") && read.languages.includes("de") && read.languages.includes("en"));

    const view = (await readTradeShareView(await accessFor(token), []))!;
    assert.equal(view.language, "en");
    assert.equal(view.statusLabel, "Preparing");
    assert.equal(view.sections[0].sides[0].heading, "From Anna");
    // English has no translation in this collection: the names stay its own.
    assert.equal(view.sections[0].sides[0].lines[0].name, "Kopernik");
  });

  it("switches to German: the partner's page follows at the same address, and German is saved on the contact", async () => {
    const { tradeId, token } = await sharedTrade();
    assert.equal(await setTradeShareLanguage(f.userId, tradeId, "de"), "de");
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: f.partnerId } })).language, "de");

    const view = (await readTradeShareView(await accessFor(token), ["area", "condition"]))!;
    assert.equal(view.language, "de");
    assert.equal(view.statusLabel, "In Vorbereitung");
    const [give, receive] = view.sections[0].sides;
    assert.equal(give.heading, "Von Anna");
    assert.equal(receive.heading, "Von Karel");
    // Translated where the collection has it in German…
    assert.equal(give.lines[0].name, "Kopernikus");
    assert.equal(give.lines[0].condition, "G");
    assert.equal(give.lines[0].areaPath, "Polen");
    // …and in its own wording where it has not.
    assert.equal(receive.lines[0].name, "Chopin");
    // The arrangement's headings are named in it too.
    const labels = Object.values(give.headings).map((h) => h.label).sort();
    assert.deepEqual(labels, ["G", "Polen"]);

    const read = await readTradeShareLanguage(f.userId, tradeId);
    assert.equal(read.language, "de");
    await prisma.contact.update({ where: { id: f.partnerId }, data: { language: "en" } });
  });

  it("opens in the collection's language for a partner whose language is not known", async () => {
    const { tradeId, token } = await sharedTrade();
    await prisma.contact.update({ where: { id: f.partnerId }, data: { language: null } });
    assert.equal((await readTradeShareLanguage(f.userId, tradeId)).language, "pl");
    const view = (await readTradeShareView(await accessFor(token), []))!;
    assert.equal(view.statusLabel, "W przygotowaniu");
    assert.equal(view.sections[0].sides[0].lines[0].name, "Kopernik");
    await prisma.contact.update({ where: { id: f.partnerId }, data: { language: "en" } });
  });

  it("refuses a language the collection does not use, and leaves the contact as it was", async () => {
    const { tradeId } = await sharedTrade();
    await assert.rejects(() => setTradeShareLanguage(f.userId, tradeId, "ja"), /not one this collection uses/);
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: f.partnerId } })).language, "en");
  });
});
