import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createTrade, setTradeStatus } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import {
  readTradeLineCandidates,
  setTradeCopyBlock,
  setTradeGiveLineItem,
} from "../../src/lib/trade-candidates";
import {
  canServeTradeShareCandidatePhoto,
  dismissTradeCopyProposal,
  readTradeProposals,
  readTradeShareChoices,
  saveTradeCopyProposal,
} from "../../src/lib/trade-proposals";
import {
  createTradeShareToken,
  verifyTradeShareToken,
  type TradeShareAccess,
} from "../../src/lib/trade-share";

// **The partner picks which copy they receive** (#658).
//
// What only a database can answer, and so what is checked here: that the set offered through the
// token is exactly #657's pool and not one copy more, that a pick moves **nothing** on the line it is
// about, that accepting swaps the effective copy and dismissing does not, that a candidate which
// lapsed between the pick and the answer is refused **by name** with the request left standing, that
// two lines cannot both be answered with one piece, and that the widened photo scope reaches the
// copies offered against this trade's lines and no further.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  stampId: string;
  otherStampId: string;
  conditionId: string;
  otherConditionId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-proposal-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User proposal-${ts}`,
      email: `test-proposal-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-proposal-${ts}`,
      name: `Anna's collection ${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const otherCondition = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint", abbreviation: "MNH", sortOrder: 1 },
  });
  // A priced area, because moving a trade to `shared` is gated on every line carrying a valuation
  // (#638) and this whole feature only exists on a list that has been handed over.
  const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
  const vendor = await prisma.catalogVendor.create({
    data: { collectionId, name: "Fischer", abbreviation: "Fi" },
  });
  const catalogName = await prisma.catalogName.create({
    data: { vendorId: vendor.id, name: "Fischer Polska", currency: "EUR" },
  });
  const edition = await prisma.catalogEdition.create({
    data: { catalogNameId: catalogName.id, year: 2026 },
  });
  await prisma.collectionArea.update({
    where: { id: area.id },
    data: { primaryCatalogNameId: catalogName.id, primaryCatalogVendorId: vendor.id },
  });
  await prisma.collectionAreaCatalog.create({
    data: { collectionAreaId: area.id, catalogNameId: catalogName.id },
  });

  const stampIds: string[] = [];
  for (const name of ["Chopin", "Copernicus"]) {
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    for (const conditionId of [condition.id, otherCondition.id]) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stamp.id,
          catalogEditionId: edition.id,
          conditionId,
          price: "10.00",
          currency: "EUR",
        },
      });
    }
    stampIds.push(stamp.id);
  }

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    stampId: stampIds[0],
    otherStampId: stampIds[1],
    conditionId: condition.id,
    otherConditionId: otherCondition.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function copy(over: { stampId?: string; conditionId?: string } = {}): Promise<string> {
  return (
    await createItem(f.userId, f.collectionId, {
      stampId: over.stampId ?? f.stampId,
      conditionId: over.conditionId ?? f.conditionId,
      forTrade: true,
    })
  ).id;
}

async function photoOn(itemId: string): Promise<string> {
  seq += 1;
  const photo = await prisma.photo.create({
    data: {
      itemId,
      storageKey: `test/proposal-${seq}`,
      mime: "image/jpeg",
      width: 100,
      height: 100,
      sizeBytes: 1000,
    },
  });
  return photo.id;
}

/** A trade with one give line, a live share link, and the trade moved to `shared` — which is the one
 *  status a pick may be made in. Two more interchangeable copies sit in the collection beside the
 *  one promised, so the line has a pool to choose from. */
async function shared(): Promise<{
  tradeId: string;
  sectionId: string;
  lineId: string;
  promised: string;
  alternatives: string[];
  access: TradeShareAccess;
}> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: `proposal ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = created.sections[0].id;
  const promised = await copy();
  const { refused } = await addTradeGiveLines(f.userId, sectionId, [promised]);
  assert.deepEqual(refused, [], "the fixture's copy should be promisable");
  const alternatives = [await copy(), await copy()];
  const line = await prisma.tradeLine.findFirstOrThrow({
    where: { tradeId: created.id, side: "give" },
    select: { id: true },
  });
  await setTradeStatus(f.userId, created.id, "shared");
  const access = await accessFor(created.id);
  return { tradeId: created.id, sectionId, lineId: line.id, promised, alternatives, access };
}

async function accessFor(tradeId: string): Promise<TradeShareAccess> {
  const { token } = await createTradeShareToken(f.userId, tradeId, {
    showValues: false,
    expiresAt: null,
  });
  const verified = await verifyTradeShareToken(token);
  assert.equal(verified.ok, true, "the token should verify");
  return (verified as { ok: true; access: TradeShareAccess }).access;
}

/** The access again, after the trade's status has moved — the token carries the status it resolved
 *  at, and every gate here reads it. */
async function reAccess(tradeId: string): Promise<TradeShareAccess> {
  return accessFor(tradeId);
}

describe("the partner's pick of which copy they receive (#658)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  // ── What the partner is offered ───────────────────────────────────────────────────────────────

  it("offers the promised copy first and then #657's pool, in copy-number order", async () => {
    const { lineId, promised, alternatives, access } = await shared();
    const choices = await readTradeShareChoices(access);
    const choice = choices[lineId];
    assert.ok(choice, "a line with alternatives should offer a choice");
    assert.equal(choice.options[0].itemId, promised);
    assert.equal(choice.options[0].current, true);
    // Every eligible duplicate in the collection is a candidate, including ones other fixtures left
    // lying about — so this checks the two this trade made are both offered, and in copy-number
    // order, rather than that they are the only two.
    const ids = choice.options.map((o) => o.itemId);
    assert.ok(ids.includes(alternatives[0]));
    assert.ok(ids.indexOf(alternatives[0]) < ids.indexOf(alternatives[1]));
    assert.equal(choice.open, true);
  });

  it("offers nothing on a line whose stamp the collector holds once", async () => {
    const { tradeId, sectionId } = await shared();
    // A copy of a different stamp: one line, no alternatives.
    const lone = await copy({ stampId: f.otherStampId });
    await setTradeStatus(f.userId, tradeId, "preparing");
    await addTradeGiveLines(f.userId, sectionId, [lone]);
    await setTradeStatus(f.userId, tradeId, "shared");
    const line = await prisma.tradeLine.findFirstOrThrow({
      where: { sectionId, itemId: lone },
      select: { id: true },
    });
    const choices = await readTradeShareChoices(await reAccess(tradeId));
    assert.equal(choices[line.id], undefined, "one option is no choice at all");
  });

  it("never offers a copy the collector has held back", async () => {
    const { tradeId, lineId, alternatives } = await shared();
    // Blocking is `preparing`-or-`shared` work, and this trade is shared.
    await setTradeCopyBlock(f.userId, tradeId, alternatives[0], true);
    const choices = await readTradeShareChoices(await reAccess(tradeId));
    const ids = choices[lineId].options.map((o) => o.itemId);
    assert.equal(ids.includes(alternatives[0]), false, "a held-back copy is never shown");
    assert.equal(ids.includes(alternatives[1]), true);
  });

  it("does not offer a copy differing in condition — that is a different line, not an alternative", async () => {
    const { lineId, tradeId } = await shared();
    const mint = await copy({ conditionId: f.otherConditionId });
    const choices = await readTradeShareChoices(await reAccess(tradeId));
    const ids = choices[lineId].options.map((o) => o.itemId);
    assert.equal(ids.includes(mint), false, "a copy in another grade is a different line");
  });

  it("carries the copies' scans and no handle the collection knows them by", async () => {
    const { lineId, alternatives, tradeId } = await shared();
    const photoId = await photoOn(alternatives[0]);
    const choices = await readTradeShareChoices(await reAccess(tradeId));
    const option = choices[lineId].options.find((o) => o.itemId === alternatives[0]);
    assert.deepEqual(option?.photoIds, [photoId]);
    assert.deepEqual(Object.keys(option ?? {}).sort(), [
      "current",
      "itemId",
      "label",
      "photoIds",
      "proposed",
    ]);
  });

  // ── The pick itself ───────────────────────────────────────────────────────────────────────────

  it("records a pick against the line and moves nothing else", async () => {
    const { lineId, promised, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { itemId: true, proposedItemId: true, proposedAt: true },
    });
    assert.equal(line.itemId, promised, "the effective copy is untouched");
    assert.equal(line.proposedItemId, alternatives[0]);
    assert.ok(line.proposedAt, "the moment it arrived is written with it");
  });

  it("marks the standing pick beside the current choice rather than in place of it", async () => {
    const { lineId, tradeId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[1]);
    const choices = await readTradeShareChoices(await reAccess(tradeId));
    const options = choices[lineId].options;
    assert.equal(options.find((o) => o.current)?.proposed, false);
    assert.equal(options.find((o) => o.proposed)?.itemId, alternatives[1]);
  });

  it("takes the pick back when the copy already chosen is picked again", async () => {
    const { lineId, promised, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    const cleared = await saveTradeCopyProposal(access, lineId, promised);
    assert.equal(cleared.proposedItemId, null);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { proposedItemId: true, proposedAt: true },
    });
    assert.equal(line.proposedItemId, null);
    assert.equal(line.proposedAt, null, "both halves of one fact are cleared together");
  });

  it("refuses a copy that is not one of this line's alternatives", async () => {
    const { lineId, access } = await shared();
    const stranger = await copy({ conditionId: f.otherConditionId });
    await assert.rejects(
      () => saveTradeCopyProposal(access, lineId, stranger),
      /not one of the alternatives/
    );
  });

  it("refuses a line that is not on this exchange", async () => {
    const { access } = await shared();
    const other = await shared();
    await assert.rejects(
      () => saveTradeCopyProposal(access, other.lineId, other.alternatives[0]),
      /not on this exchange/
    );
  });

  it("refuses the same copy on two lines of one trade, by name", async () => {
    const { tradeId, sectionId, alternatives } = await shared();
    // A second line for the same stamp and condition — "two of these" — sharing the pool.
    await setTradeStatus(f.userId, tradeId, "preparing");
    const second = await copy();
    await addTradeGiveLines(f.userId, sectionId, [second]);
    await setTradeStatus(f.userId, tradeId, "shared");
    const lines = await prisma.tradeLine.findMany({
      where: { tradeId, side: "give" },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const live = await reAccess(tradeId);
    await saveTradeCopyProposal(live, lines[0].id, alternatives[0]);
    await assert.rejects(
      () => saveTradeCopyProposal(live, lines[1].id, alternatives[0]),
      /already asked for that copy/
    );
  });

  it("takes a pick only while the exchange is shared", async () => {
    const { tradeId, lineId, alternatives } = await shared();
    await setTradeStatus(f.userId, tradeId, "preparing");
    await assert.rejects(
      async () => saveTradeCopyProposal(await reAccess(tradeId), lineId, alternatives[0]),
      /still being put together/
    );
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    await assert.rejects(
      async () => saveTradeCopyProposal(await reAccess(tradeId), lineId, alternatives[0]),
      /agreed/
    );
  });

  // ── The collector answering ───────────────────────────────────────────────────────────────────

  it("reports the standing pick to the collector, named by copy number", async () => {
    const { tradeId, lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    const read = await readTradeProposals(tradeId);
    assert.equal(read.open, 1);
    assert.equal(read.lines[lineId].itemId, alternatives[0]);
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: alternatives[0] },
      select: { itemNo: true },
    });
    assert.equal(read.lines[lineId].copyLabel, `Copy #${item.itemNo}`);
  });

  it("grants a pick by swapping the effective copy, and clears the request with it", async () => {
    const { tradeId, lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await setTradeGiveLineItem(f.userId, lineId, alternatives[0]);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { itemId: true, proposedItemId: true, proposedAt: true },
    });
    assert.equal(line.itemId, alternatives[0]);
    assert.equal(line.proposedItemId, null);
    assert.equal(line.proposedAt, null);
    assert.equal((await readTradeProposals(tradeId)).open, 0);
  });

  it("dismisses a pick without touching the copy the line promises", async () => {
    const { lineId, promised, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await dismissTradeCopyProposal(f.userId, lineId);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { itemId: true, proposedItemId: true },
    });
    assert.equal(line.itemId, promised);
    assert.equal(line.proposedItemId, null);
  });

  it("refuses to accept onto a locked list, with the step that would unfreeze it", async () => {
    const { tradeId, lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await setTradeStatus(f.userId, tradeId, "agreed");
    await assert.rejects(
      () => setTradeGiveLineItem(f.userId, lineId, alternatives[0]),
      /Step the trade back to shared/
    );
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { proposedItemId: true },
    });
    assert.equal(line.proposedItemId, alternatives[0], "the request stays standing");
  });

  it("dismisses a pick even on a locked list — it clears advisory data and nothing else", async () => {
    const { tradeId, lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await setTradeStatus(f.userId, tradeId, "agreed");
    await dismissTradeCopyProposal(f.userId, lineId);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { proposedItemId: true },
    });
    assert.equal(line.proposedItemId, null);
  });

  it("refuses a lapsed candidate by name and leaves the request standing", async () => {
    const { lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    // The copy leaves the collection while the collector is reading the request.
    await prisma.item.update({
      where: { id: alternatives[0] },
      data: { disposedAt: new Date() },
    });
    await assert.rejects(
      () => setTradeGiveLineItem(f.userId, lineId, alternatives[0]),
      /no longer held/
    );
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { proposedItemId: true },
    });
    assert.equal(line.proposedItemId, alternatives[0]);
  });

  it("refuses a copy the collector has since held back, by name", async () => {
    const { tradeId, lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await setTradeCopyBlock(f.userId, tradeId, alternatives[0], true);
    await assert.rejects(
      () => setTradeGiveLineItem(f.userId, lineId, alternatives[0]),
      /held back/
    );
  });

  it("says plainly when there is nothing to dismiss", async () => {
    const { lineId } = await shared();
    await assert.rejects(
      () => dismissTradeCopyProposal(f.userId, lineId),
      /no request on this line/
    );
  });

  it("is invisible to another collector — the line is asserted against its owner", async () => {
    const { lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await assert.rejects(() => dismissTradeCopyProposal("someone-else", lineId));
    await assert.rejects(() => setTradeGiveLineItem("someone-else", lineId, alternatives[0]));
  });

  // ── The one screen it is all answered on ──────────────────────────────────────────────────────

  it("puts the request on the list of copies, so the collector sees the one they are agreeing to", async () => {
    const { lineId, promised, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    const read = await readTradeLineCandidates(f.userId, lineId);
    assert.equal(read.promised?.id, promised);
    assert.equal(read.proposedItemId, alternatives[0]);
    assert.ok(
      read.candidates.some((c) => c.copy.id === alternatives[0]),
      "the copy asked for is drawn among the alternatives, with its scans"
    );
  });

  it("swaps to a copy nobody asked for, leaving a standing request to be answered", async () => {
    const { lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await setTradeGiveLineItem(f.userId, lineId, alternatives[1]);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { itemId: true, proposedItemId: true },
    });
    assert.equal(line.itemId, alternatives[1]);
    assert.equal(line.proposedItemId, alternatives[0], "a swap to a third copy answers nothing");
  });

  it("treats sending the copy already being sent as a no-op rather than a refusal", async () => {
    const { lineId, promised } = await shared();
    await setTradeGiveLineItem(f.userId, lineId, promised);
    const line = await prisma.tradeLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { itemId: true },
    });
    assert.equal(line.itemId, promised);
  });

  it("releases the copy it swapped away — it is an alternative again", async () => {
    const { lineId, promised, alternatives } = await shared();
    await setTradeGiveLineItem(f.userId, lineId, alternatives[0]);
    const read = await readTradeLineCandidates(f.userId, lineId);
    assert.equal(read.promised?.id, alternatives[0]);
    assert.ok(read.candidates.some((c) => c.copy.id === promised));
  });

  // ── What the token may reach ──────────────────────────────────────────────────────────────────

  it("serves the scan of a copy offered against one of this trade's lines", async () => {
    const { alternatives, tradeId } = await shared();
    const photoId = await photoOn(alternatives[0]);
    assert.equal(
      await canServeTradeShareCandidatePhoto(await reAccess(tradeId), photoId),
      true
    );
  });

  it("refuses the scan of a copy that is neither on a line nor a candidate", async () => {
    const { tradeId } = await shared();
    const stranger = await copy({ conditionId: f.otherConditionId });
    const photoId = await photoOn(stranger);
    assert.equal(
      await canServeTradeShareCandidatePhoto(await reAccess(tradeId), photoId),
      false
    );
  });

  it("refuses the scan of a candidate the collector has held back", async () => {
    const { tradeId, alternatives } = await shared();
    const photoId = await photoOn(alternatives[0]);
    await setTradeCopyBlock(f.userId, tradeId, alternatives[0], true);
    assert.equal(
      await canServeTradeShareCandidatePhoto(await reAccess(tradeId), photoId),
      false
    );
  });

  // ── After the handshake ───────────────────────────────────────────────────────────────────────

  it("closes the choice out with the trade, saying so where a request went unanswered", async () => {
    const { tradeId, lineId, alternatives, access } = await shared();
    await saveTradeCopyProposal(access, lineId, alternatives[0]);
    await setTradeStatus(f.userId, tradeId, "agreed");
    const choices = await readTradeShareChoices(await reAccess(tradeId));
    assert.deepEqual(choices[lineId].options, []);
    assert.match(choices[lineId].unansweredNote ?? "", /asked for a different copy/);
    assert.match(choices[lineId].unansweredNote ?? "", /agreed/);
  });
});
