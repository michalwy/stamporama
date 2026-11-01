import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/db";

// `20261101120000_proposals` (#2287; ADR-0075) gives every collection the Direct module platform.
// `prisma migrate deploy` runs it against a fresh database, where there is no collection to give one
// to, so the ordinary suite never meets the rows it is for — the platform-entity migration test's
// reasoning and shape: a database of its own, every earlier migration off disk, today's rows, this
// migration's bytes, then the answer. The database is dropped afterwards.

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma/migrations");
const THIS_MIGRATION = "20261101120000_proposals";

function migrationSql(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

describe(`${THIS_MIGRATION} (#2287)`, () => {
  const dbName = `stamporama_mig2287_${process.pid}_${Date.now()}`;
  let db: PrismaClient;

  before(async () => {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${dbName}`;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

    const earlier = readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d{14}_/.test(name) && name < THIS_MIGRATION)
      .sort();
    for (const name of earlier) await db.$executeRawUnsafe(migrationSql(name));

    await db.$executeRawUnsafe(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES ('u', 'U', 'u@example.com', true, now(), now());
      INSERT INTO collection (id, slug, name, "baseCurrency", "ownerId") VALUES
        ('plain', 'plain', 'Plain', 'PLN', 'u'),
        ('named', 'named', 'Named', 'EUR', 'u'),
        ('lower', 'lower', 'Lower', 'USD', 'u');
      INSERT INTO platform (id, "collectionId", name, enabled, "platformCurrency") VALUES
        -- A generic platform the collector already called Direct: it becomes the module platform.
        ('mine', 'named', 'Direct', false, 'GBP'),
        -- Spelled otherwise: taken too, and named as the module is.
        ('low', 'lower', 'direct ', true, 'USD');
    `);
    await db.$executeRawUnsafe(migrationSql(THIS_MIGRATION));
  });

  after(async () => {
    await db.$disconnect();
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  async function direct(collectionId: string) {
    return db.platform.findMany({
      where: { collectionId, platformModule: "direct" },
      select: { id: true, name: true, enabled: true, platformCurrency: true, defaultListingType: true },
    });
  }

  it("gives a collection with none a Direct platform, switched on, in its currency, at a fixed price", async () => {
    const [row, ...rest] = await direct("plain");
    assert.equal(rest.length, 0);
    assert.deepEqual(
      { ...row, id: undefined },
      { id: undefined, name: "Direct", enabled: true, platformCurrency: "PLN", defaultListingType: "fixed" }
    );
  });

  it("makes a generic platform already called Direct the module platform, keeping its settings", async () => {
    assert.deepEqual(await direct("named"), [
      { id: "mine", name: "Direct", enabled: false, platformCurrency: "GBP", defaultListingType: null },
    ]);
    assert.deepEqual(await direct("lower"), [
      { id: "low", name: "Direct", enabled: true, platformCurrency: "USD", defaultListingType: null },
    ]);
  });

  it("starts every collection's proposal numbers at one", async () => {
    const rows = await db.collection.findMany({ select: { nextProposalNo: true } });
    assert.ok(rows.length === 3 && rows.every((r) => r.nextProposalNo === 1));
  });
});
