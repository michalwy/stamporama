import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/db";
import { MODULE_PLATFORMS } from "../../src/lib/platform-modules";

// `20261016130000_platform_entity` (#1955; ADR-0071) turns every platform contact into a platform
// and points every reference at it. `prisma migrate deploy` runs it against a fresh database, where
// there is no contact to move, so the ordinary suite never meets the rows it is for.
//
// So the test builds a database of its own: every migration before this one, run off disk in order;
// a collection as today's data has it, written raw against the old columns; then this migration's
// own bytes; then what the *Done when* asks — every record names the platform its contact became,
// the module platforms are the contacts their pages had chosen, the rest are generic, and a contact
// with another role, a counterparty record or a filled address-book field is still there. The
// database is dropped afterwards; the suite's own is never touched.

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma/migrations");
const THIS_MIGRATION = "20261016130000_platform_entity";

function migrationSql(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

describe(`${THIS_MIGRATION} (#1955)`, () => {
  const dbName = `stamporama_mig1955_${process.pid}_${Date.now()}`;
  let db: PrismaClient;

  const C = "col-main";
  const EMPTY = "col-empty";

  before(async () => {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${dbName}`;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

    const earlier = readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d{14}_/.test(name) && name < THIS_MIGRATION)
      .sort();
    for (const name of earlier) await db.$executeRawUnsafe(migrationSql(name));

    // ── Today's data, against the old columns ─────────────────────────────────────────────────
    await db.$executeRawUnsafe(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES ('u', 'U', 'u@example.com', true, now(), now());
      INSERT INTO collection (id, slug, name, "baseCurrency", "ownerId") VALUES
        ('${C}', 'main', 'Main', 'PLN', 'u'),
        ('${EMPTY}', 'empty', 'Empty', 'PLN', 'u');

      INSERT INTO contact (id, "collectionId", name, notes, platform, "platformModule", "platformCurrency",
                           "titleTemplate", market, seller, buyer, email, "coverSymbols") VALUES
        -- Chosen on the Allegro page: becomes the Allegro module platform, under the module's name.
        ('allegro-pl', '${C}', 'Allegro.pl', 'Our main account', true, 'allegro', 'PLN',
         '{catalog} {name}', 'PL', false, false, NULL, false),
        -- A plain marketplace: a generic platform of its own name, and the contact goes.
        ('ebay', '${C}', 'eBay', NULL, true, NULL, 'USD', NULL, NULL, false, false, NULL, false),
        -- A house selling directly — a platform and a seller: the contact stays, as a seller.
        ('house', '${C}', 'Heritage', NULL, true, NULL, 'EUR', NULL, 'DE', true, false, NULL, false),
        -- A marketplace with an address-book field filled: kept as an ordinary contact.
        ('forum', '${C}', 'Stamp forum', NULL, true, NULL, NULL, NULL, NULL, false, false,
         'admin@forum.example', false),
        -- Its role unticked long ago, but offers still name it: a platform, switched off.
        ('old', '${C}', 'Old auction site', NULL, false, NULL, 'PLN', NULL, NULL, false, false, NULL, false),
        -- Named like a module, but no page chose it: generic, under a suffixed name.
        ('fb-contact', '${C}', 'Facebook', NULL, true, NULL, 'PLN', NULL, NULL, false, false, NULL, true),
        -- A platform contact that supplied a purchase: the counterparty record keeps it.
        ('supplier-platform', '${C}', 'Philasearch shop', NULL, true, NULL, 'EUR', NULL, NULL, false, false,
         NULL, false),
        -- People, untouched.
        ('jan', '${C}', 'Jan', NULL, false, NULL, NULL, NULL, NULL, false, true, NULL, false);

      UPDATE contact SET "defaultAuctionPlatformId" = 'ebay' WHERE id = 'jan';

      INSERT INTO offer (id, "collectionId", "offerNo", "platformId", price, currency) VALUES
        ('o-ebay', '${C}', 1, 'ebay', 1, 'USD'),
        ('o-old', '${C}', 2, 'old', 1, 'PLN'),
        ('o-allegro', '${C}', 3, 'allegro-pl', 1, 'PLN');
      INSERT INTO sale (id, "collectionId", "saleNo", "platformId", "buyerId", "soldAt", currency) VALUES
        ('s-allegro', '${C}', 1, 'allegro-pl', 'jan', now(), 'PLN');
      INSERT INTO purchase (id, "collectionId", "purchaseNo", "platformId", "contactId", "purchasedAt", currency)
        VALUES ('p-ebay', '${C}', 1, 'ebay', 'supplier-platform', now(), 'USD');
      INSERT INTO auction_sale (id, "collectionId", "sellerId", "platformId", name, currency) VALUES
        ('a-house', '${C}', 'house', 'house', 'Heritage 42', 'EUR');
      INSERT INTO shipping_option (id, "collectionId", "platformId", name, price, currency) VALUES
        ('ship', '${C}', 'allegro-pl', 'Letter', 5, 'PLN');
    `);

    await db.$executeRawUnsafe(migrationSql(THIS_MIGRATION));
  });

  after(async () => {
    await db?.$disconnect();
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  const platforms = (collectionId: string) =>
    db.platform.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        platformModule: true,
        enabled: true,
        platformCurrency: true,
        notes: true,
        market: true,
        titleTemplate: true,
      },
      orderBy: { name: "asc" },
    });

  it("makes the chosen contact the module platform, named after its module, settings and notes kept", async () => {
    const allegro = (await platforms(C)).find((p) => p.platformModule === "allegro")!;
    assert.deepEqual(allegro, {
      id: "allegro-pl",
      name: "Allegro",
      platformModule: "allegro",
      enabled: true,
      platformCurrency: "PLN",
      notes: "Our main account",
      market: "PL",
      titleTemplate: "{catalog} {name}",
    });
  });

  it("makes every other platform contact a generic platform of its name", async () => {
    const generic = (await platforms(C))
      .filter((p) => p.platformModule === null)
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      generic.map((p) => [p.id, p.name, p.enabled, p.platformCurrency]),
      [
        ["ebay", "eBay", true, "USD"],
        ["fb-contact", "Facebook (2)", true, "PLN"],
        ["forum", "Stamp forum", true, null],
        ["house", "Heritage", true, "EUR"],
        // Its role had been unticked: it was offered nowhere, so it starts switched off.
        ["old", "Old auction site", false, "PLN"],
        ["supplier-platform", "Philasearch shop", true, "EUR"],
      ]
    );
  });

  it("gives every collection its five module platforms, those no contact stood for switched off", async () => {
    for (const collectionId of [C, EMPTY]) {
      const modules = (await platforms(collectionId)).filter((p) => p.platformModule !== null);
      assert.deepEqual(
        modules.map((p) => p.platformModule).sort(),
        MODULE_PLATFORMS.map((m) => m.module).sort()
      );
      for (const p of modules) {
        assert.equal(p.name, MODULE_PLATFORMS.find((m) => m.module === p.platformModule)!.name);
        assert.equal(p.enabled, collectionId === C && p.platformModule === "allegro");
      }
    }
  });

  it("points every record that named a platform contact at the platform it became", async () => {
    const offers = await db.offer.findMany({
      where: { collectionId: C },
      select: { id: true, platform: { select: { name: true } } },
      orderBy: { offerNo: "asc" },
    });
    assert.deepEqual(
      offers.map((o) => [o.id, o.platform.name]),
      [
        ["o-ebay", "eBay"],
        ["o-old", "Old auction site"],
        ["o-allegro", "Allegro"],
      ]
    );
    const sale = await db.sale.findUniqueOrThrow({
      where: { id: "s-allegro" },
      select: { platform: { select: { name: true } }, buyer: { select: { name: true } } },
    });
    assert.deepEqual([sale.platform.name, sale.buyer?.name], ["Allegro", "Jan"]);
    const purchase = await db.purchase.findUniqueOrThrow({
      where: { id: "p-ebay" },
      select: { platform: { select: { name: true } }, contact: { select: { name: true } } },
    });
    assert.deepEqual([purchase.platform?.name, purchase.contact?.name], ["eBay", "Philasearch shop"]);
    const auction = await db.auctionSale.findUniqueOrThrow({
      where: { id: "a-house" },
      select: { platform: { select: { name: true } }, seller: { select: { name: true, seller: true } } },
    });
    // The house is two records now: the seller a contact, the venue a platform.
    assert.deepEqual([auction.platform.name, auction.seller.name, auction.seller.seller], [
      "Heritage",
      "Heritage",
      true,
    ]);
    const option = await db.shippingOption.findUniqueOrThrow({
      where: { id: "ship" },
      select: { platform: { select: { name: true } } },
    });
    assert.equal(option.platform.name, "Allegro");
    const jan = await db.contact.findUniqueOrThrow({
      where: { id: "jan" },
      select: { defaultAuctionPlatform: { select: { name: true } } },
    });
    assert.equal(jan.defaultAuctionPlatform?.name, "eBay");
  });

  it("keeps a former platform contact with another role, a counterparty record or an address-book field", async () => {
    const contacts = await db.contact.findMany({ where: { collectionId: C }, select: { id: true } });
    assert.deepEqual(
      contacts.map((c) => c.id).sort(),
      // The forum (an email), Heritage (a seller), Jan (a person), the shop (a purchase's supplier).
      ["forum", "house", "jan", "supplier-platform"]
    );
  });

  it("leaves no Platform role, nor any platform setting, on the contact", async () => {
    const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'contact'`
    );
    const names = columns.map((c) => c.column_name);
    for (const gone of ["platform", "platformModule", "platformCurrency", "titleTemplate", "maxPhotos"]) {
      assert.ok(!names.includes(gone), `contact.${gone} must be gone`);
    }
    // What a contact still says about selling stays: a house's market and its auction terms.
    for (const kept of ["market", "defaultCurrency", "buyerPremiumPercent", "defaultAuctionPlatformId"]) {
      assert.ok(names.includes(kept), `contact.${kept} must stay`);
    }
  });
});
