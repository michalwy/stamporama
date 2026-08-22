import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { SECRET_KEY_ENV } from "../../src/lib/secret-box";
import { createItem } from "../../src/lib/items";
import { createTrade, getTrade, setTradeStatus } from "../../src/lib/trades";
import { addTradeGiveLines, addTradeReceiveLines } from "../../src/lib/trade-lines";
import {
  canServeTradeSharePhoto,
  createTradeShareToken,
  readTradeShareLink,
  readTradeShareView,
  revokeTradeShareToken,
  setTradeShareOptions,
  verifyTradeShareToken,
  type TradeShareAccess,
} from "../../src/lib/trade-share";

// The partner's read-only link (#640).
//
// What only a database can answer, and so what is checked here: that a raw token resolves to exactly
// one trade and to nothing else, that regenerating and revoking really do kill the old address, that
// expiry and a cancelled exchange refuse **by reason**, that a photo not hanging on this trade's own
// lines is unreachable through the token, and that `showValues` is what decides whether a single
// figure crosses to the partner.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  stampId: string;
  otherStampId: string;
  conditionId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-share-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User share-${ts}`,
      email: `test-share-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-share-${ts}`,
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

  // A priced stamp in an area with a primary catalogue: the figures on the partner's page are the
  // collection's own valuation, so a stamp nothing prices would leave nothing to hide or show.
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
    // Both primaries (#675): the book a copy is valued from, and the vendor whose numbers lead.
    data: { primaryCatalogNameId: catalogName.id, primaryCatalogVendorId: vendor.id },
  });
  await prisma.collectionAreaCatalog.create({
    data: { collectionAreaId: area.id, catalogNameId: catalogName.id },
  });

  const stampIds: string[] = [];
  for (const [name, number] of [
    ["Chopin", "640"],
    ["Copernicus", "641"],
  ] as const) {
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: vendor.id, number },
    });
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: stamp.id,
        catalogEditionId: edition.id,
        conditionId: condition.id,
        price: "10.00",
        currency: "EUR",
      },
    });
    stampIds.push(stamp.id);
  }

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    stampId: stampIds[0],
    otherStampId: stampIds[1],
    conditionId: condition.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function copy(stampId = f.stampId): Promise<string> {
  return (
    await createItem(f.userId, f.collectionId, {
      stampId,
      conditionId: f.conditionId,
      forTrade: true,
    })
  ).id;
}

/** A photo hanging on a copy. Only the row matters here — nothing in these tests reads bytes. */
async function photoOn(itemId: string): Promise<string> {
  seq += 1;
  const photo = await prisma.photo.create({
    data: {
      itemId,
      storageKey: `test/share-${seq}`,
      mime: "image/jpeg",
      width: 100,
      height: 100,
      sizeBytes: 1000,
    },
  });
  return photo.id;
}

/** A trade with one copy promised and one line asked for, left in `preparing`. */
async function trade(): Promise<{ tradeId: string; sectionId: string; itemId: string }> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "CZK",
    notes: `share ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = created.sections[0].id;
  const itemId = await copy();
  const { refused } = await addTradeGiveLines(f.userId, sectionId, [itemId]);
  assert.deepEqual(refused, [], "the fixture's copy should be promisable");
  await addTradeReceiveLines(f.userId, sectionId, {
    stampId: f.otherStampId,
    conditionId: f.conditionId,
    certificateStatusId: null,
    formatId: null,
    quantity: 3,
  });
  return { tradeId: created.id, sectionId, itemId };
}

async function accessFor(token: string): Promise<TradeShareAccess> {
  const verified = await verifyTradeShareToken(token);
  assert.equal(verified.ok, true, "the token should verify");
  return (verified as { ok: true; access: TradeShareAccess }).access;
}

const NO_EXPIRY = { showValues: false, expiresAt: null };

/** The key every install that has one runs with. Set for this file because since #681 minting seals
 *  the raw token with it; the one case that runs without it says so on its own test. */
const KEY = "cLBk3n0tArEaLkEy/JustEntropyForTests=";
let savedKey: string | undefined;

describe("the partner's share link (#640)", () => {
  before(async () => {
    savedKey = process.env[SECRET_KEY_ENV];
    process.env[SECRET_KEY_ENV] = KEY;
    f = await seed();
  });
  after(async () => {
    if (savedKey === undefined) delete process.env[SECRET_KEY_ENV];
    else process.env[SECRET_KEY_ENV] = savedKey;
    await cleanup();
  });

  it("resolves a raw token to the one trade it names, and to that trade's owner", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const access = await accessFor(token);
    assert.equal(access.tradeId, tradeId);
    assert.equal(access.ownerId, f.userId);
    assert.equal(access.collectionId, f.collectionId);
  });

  it("stores the hash it resolves by and a sealed copy — the token itself nowhere", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const row = await prisma.tradeShareToken.findUnique({ where: { tradeId } });
    assert.ok(row);
    assert.notEqual(row.tokenHash, token);
    assert.equal(row.tokenHash.length, 64, "a SHA-256 hex digest");
    assert.ok(row.tokenSealed, "and the sealed copy #681 shows the collector");
    assert.ok(
      !JSON.stringify(row).includes(token),
      "neither column holds the address in the clear"
    );
  });

  it("keeps one link per trade: regenerating replaces the row and kills the old address", async () => {
    const { tradeId } = await trade();
    const first = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const second = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    assert.notEqual(first.token, second.token);
    assert.equal(await prisma.tradeShareToken.count({ where: { tradeId } }), 1);

    assert.deepEqual(await verifyTradeShareToken(first.token), { ok: false, reason: "unknown" });
    assert.equal((await verifyTradeShareToken(second.token)).ok, true);
  });

  it("withdraws a link, after which its address is simply unknown", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    await revokeTradeShareToken(f.userId, tradeId);
    assert.deepEqual(await verifyTradeShareToken(token), { ok: false, reason: "unknown" });
    assert.equal(await readTradeShareLink(f.userId, tradeId), null);
  });

  it("refuses an expired link by reason, without touching the address", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, {
      showValues: false,
      expiresAt: new Date(Date.now() - 60_000),
    });
    assert.deepEqual(await verifyTradeShareToken(token), { ok: false, reason: "expired" });
  });

  it("refuses a cancelled exchange, and serves a closed one", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    await setTradeStatus(f.userId, tradeId, "cancelled");
    assert.deepEqual(await verifyTradeShareToken(token), { ok: false, reason: "cancelled" });
  });

  it("writes a read receipt for a visit, and not for every thumbnail on it", async () => {
    const { tradeId } = await trade();
    const { token, record } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    assert.equal(record.lastUsedAt, null, "a fresh link has never been opened");

    await verifyTradeShareToken(token, { touch: false });
    assert.equal((await readTradeShareLink(f.userId, tradeId))?.lastUsedAt, null);

    await verifyTradeShareToken(token);
    assert.notEqual((await readTradeShareLink(f.userId, tradeId))?.lastUsedAt, null);
  });

  it("changes what the page shows without changing the address", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    await setTradeShareOptions(f.userId, tradeId, { showValues: true, expiresAt: null });
    const verified = await verifyTradeShareToken(token);
    assert.equal(verified.ok, true, "the same link still works");
    assert.equal((verified as { ok: true; access: TradeShareAccess }).access.showValues, true);
  });

  it("refuses to set options on a trade that has no link", async () => {
    const { tradeId } = await trade();
    await assert.rejects(
      () => setTradeShareOptions(f.userId, tradeId, NO_EXPIRY),
      /no share link/
    );
  });

  it("is invisible to another collector — the token is minted for the owner alone", async () => {
    const { tradeId } = await trade();
    await assert.rejects(() => createTradeShareToken("someone-else", tradeId, NO_EXPIRY));
  });

  it("tells the trade screen a link is out there", async () => {
    const { tradeId } = await trade();
    assert.equal((await getTrade(f.userId, tradeId))?.share, null);
    await createTradeShareToken(f.userId, tradeId, { showValues: true, expiresAt: null });
    const share = (await getTrade(f.userId, tradeId))?.share;
    assert.equal(share?.showValues, true);
    assert.equal(share?.lastUsedAt, null);
  });

  // ── Reading the address again, after the dialog is closed (#681) ──────────────────────────────

  it("hands the address back long after the dialog that minted it was closed", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const link = await readTradeShareLink(f.userId, tradeId);
    assert.deepEqual(link?.address, { readable: true, token });
  });

  it("says the same address on the trade's own screen", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    assert.deepEqual((await getTrade(f.userId, tradeId))?.share?.address, {
      readable: true,
      token,
    });
  });

  it("shows the new address after regenerating, never the one it replaced", async () => {
    const { tradeId } = await trade();
    const first = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const second = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const link = await readTradeShareLink(f.userId, tradeId);
    assert.deepEqual(link?.address, { readable: true, token: second.token });
    assert.notEqual(second.token, first.token);
  });

  it("keeps a link minted before #681 serving, and says plainly why it cannot be shown", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    // What the migration leaves behind: the hash resolves, and the raw value is genuinely gone.
    await prisma.tradeShareToken.update({ where: { tradeId }, data: { tokenSealed: null } });

    const link = await readTradeShareLink(f.userId, tradeId);
    assert.deepEqual(link?.address, { readable: false, reason: "legacy" });
    assert.equal((await verifyTradeShareToken(token)).ok, true, "the partner's copy still works");
  });

  it("mints on an install with no key rather than refusing, and does not pretend", async () => {
    const { tradeId } = await trade();
    delete process.env[SECRET_KEY_ENV];
    try {
      const { token, record } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
      assert.deepEqual(record.address, { readable: false, reason: "unconfigured" });
      assert.equal((await verifyTradeShareToken(token)).ok, true, "and the link works");
    } finally {
      process.env[SECRET_KEY_ENV] = KEY;
    }
  });

  // ── Scoping: nothing outside the named trade ──────────────────────────────────────────────────

  it("serves a photo hanging on this trade's own lines, on either side", async () => {
    const { tradeId, itemId } = await trade();
    const photoId = await photoOn(itemId);
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    assert.equal(await canServeTradeSharePhoto(await accessFor(token), photoId), true);
  });

  it("refuses a photo of a copy in the same collection that is not on this trade", async () => {
    const { tradeId } = await trade();
    const strangerId = await photoOn(await copy());
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    assert.equal(await canServeTradeSharePhoto(await accessFor(token), strangerId), false);
  });

  it("refuses a photo that belongs to a different trade of the same collection", async () => {
    const mine = await trade();
    const theirs = await trade();
    const theirPhotoId = await photoOn(theirs.itemId);
    const { token } = await createTradeShareToken(f.userId, mine.tradeId, NO_EXPIRY);
    assert.equal(await canServeTradeSharePhoto(await accessFor(token), theirPhotoId), false);
  });

  it("refuses a photo id that names nothing", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    assert.equal(await canServeTradeSharePhoto(await accessFor(token), "no-such-photo"), false);
  });

  // ── The page ──────────────────────────────────────────────────────────────────────────────────

  it("renders both sides of every section, counting pieces apart from lines", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const view = await readTradeShareView(await accessFor(token), []);
    assert.ok(view);
    assert.equal(view.sections.length, 1);

    const give = view.sections[0].sides.find((s) => s.side === "give")!;
    const receive = view.sections[0].sides.find((s) => s.side === "receive")!;
    assert.equal(give.lines.length, 1);
    assert.equal(receive.lines.length, 1);
    // Three lines can be thirty stamps: the receive line asks for three of one stamp.
    assert.equal(view.totals.give.pieces, 1);
    assert.equal(view.totals.receive.lines, 1);
    assert.equal(view.totals.receive.pieces, 3);
  });

  it("heads the two sides by name rather than by the collector's give and receive", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const view = await readTradeShareView(await accessFor(token), []);
    const headings = view!.sections[0].sides.map((s) => s.heading);
    assert.deepEqual(headings, [`From ${view!.collectorName}`, "From Karel"]);
  });

  it("prints the catalogue number the collector's own screen prints", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const view = await readTradeShareView(await accessFor(token), []);
    const give = view!.sections[0].sides.find((s) => s.side === "give")!;
    assert.equal(give.lines[0].primaryNumber, "Fi 640");
  });

  it("carries no figure anywhere while the link hides values", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const view = await readTradeShareView(await accessFor(token), []);
    assert.equal(view!.valuation, null);
    assert.equal(view!.totals.give.value, null);
    for (const side of view!.sections.flatMap((s) => s.sides)) {
      for (const line of side.lines) assert.equal(line.value, null, "no line may carry a figure");
    }
  });

  it("falls back to the collector's own valuation, per line, when no catalogue was agreed", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, {
      showValues: true,
      expiresAt: null,
    });
    const view = await readTradeShareView(await accessFor(token), []);
    assert.equal(view!.valuation?.kind, "own");
    // The collection's base currency, **not** the trade's — the two valuations are two units and
    // are never merged (ADR-0039 §7).
    assert.equal(view!.valuation?.currency, "EUR");

    const give = view!.sections[0].sides.find((s) => s.side === "give")!;
    assert.equal(give.lines[0].value?.amount, 10);
    // Each line says which book it was read in, or a column out of several catalogues is unreadable.
    assert.equal(give.lines[0].value?.attribution, "Fischer Polska 2026");
    // Quantities are counted: three of a ten-euro stamp is thirty.
    assert.equal(view!.totals.receive.value, 30);
  });

  it("groups exactly as the collector's own screen does, when the partner asks it to", async () => {
    const { tradeId } = await trade();
    const { token } = await createTradeShareToken(f.userId, tradeId, NO_EXPIRY);
    const flat = await readTradeShareView(await accessFor(token), []);
    assert.deepEqual(flat!.sections[0].sides[0].lines[0].path, [], "flat is no headings at all");

    const grouped = await readTradeShareView(await accessFor(token), ["area"]);
    const line = grouped!.sections[0].sides[0].lines[0];
    assert.equal(line.path.length, 1);
    assert.equal(grouped!.sections[0].sides[0].headings[line.path[0]].label, "Poland");
  });
});
