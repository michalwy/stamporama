import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getStampConditions,
  createStampCondition,
  updateStampCondition,
} from "../../src/lib/conditions";
import {
  getCertificateStatuses,
  createCertificateStatus,
  updateCertificateStatus,
} from "../../src/lib/certificate-statuses";
import { createIssue, updateIssue, addStampToIssue, deleteIssue } from "../../src/lib/issues";
import { getStampTranslations, updateStampWithCatalog } from "../../src/lib/stamps";
import { toTitleCopy, type TitleCopyRow } from "../../src/lib/title-copy";
import type { AreaVendorMaps } from "../../src/lib/area-vendor";

// Per-language entity text for the remaining title tokens (#294 condition / certificate status,
// #295 issue name, #296 stamp name). The area equivalent (#293) is covered in
// `areas-domain.test.ts`; the shared parse / sync / resolve rules are unit-tested in
// `tests/unit/translations.test.ts`. What is exercised here is each entity's own write path and the
// database constraints behind it — per-field fallback, clearing, and FK cascade.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-etr-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-etr-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-etr-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("condition translations (#294)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cond-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cond-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function conditionNamed(name: string) {
    return (await getStampConditions(userId, collectionId)).find((c) => c.name === name);
  }

  it("stores name and abbreviation per language on create", async () => {
    await createStampCondition(userId, collectionId, {
      name: "Mint Never Hinged",
      abbreviation: "MNH",
      translations: {
        pl: { name: "Czyste bez podlepki", abbreviation: "**" },
        de: { name: "Postfrisch", abbreviation: null },
      },
    });
    const c = await conditionNamed("Mint Never Hinged");
    assert.ok(c);
    assert.deepEqual(c.nameByLanguage, { pl: "Czyste bez podlepki", de: "Postfrisch" });
    // German translated only the name — the abbreviation keeps falling back to MNH.
    assert.deepEqual(c.abbreviationByLanguage, { pl: "**" });
  });

  it("keeps the row when one field is cleared and the other still has text", async () => {
    await createStampCondition(userId, collectionId, {
      name: "Used",
      abbreviation: "U",
      translations: { pl: { name: "Kasowane", abbreviation: "K" } },
    });
    const created = await conditionNamed("Used");
    assert.ok(created);

    await updateStampCondition(userId, created.id, {
      name: "Used",
      abbreviation: "U",
      translations: { pl: { name: "Kasowane", abbreviation: "  " } },
    });
    const updated = await conditionNamed("Used");
    assert.deepEqual(updated?.nameByLanguage, { pl: "Kasowane" });
    assert.deepEqual(updated?.abbreviationByLanguage, {});
  });

  it("drops the row once every field is blank", async () => {
    await createStampCondition(userId, collectionId, {
      name: "Mint Hinged",
      abbreviation: "MH",
      translations: { pl: { name: "Z podlepką", abbreviation: "*" } },
    });
    const created = await conditionNamed("Mint Hinged");
    assert.ok(created);

    await updateStampCondition(userId, created.id, {
      name: "Mint Hinged",
      abbreviation: "MH",
      translations: { pl: { name: "", abbreviation: "" } },
    });
    const rows = await prisma.stampConditionTranslation.findMany({
      where: { stampConditionId: created.id },
    });
    assert.deepEqual(rows, []);
  });

  it("leaves languages absent from the update untouched", async () => {
    await createStampCondition(userId, collectionId, {
      name: "Cancelled to Order",
      abbreviation: "CTO",
      translations: { pl: { name: "Kasowane na zamówienie" }, de: { name: "Gefälligkeitsstempel" } },
    });
    const created = await conditionNamed("Cancelled to Order");
    assert.ok(created);

    await updateStampCondition(userId, created.id, {
      name: "Cancelled to Order",
      abbreviation: "CTO",
      translations: { pl: { name: "CTO po polsku" } },
    });
    const updated = await conditionNamed("Cancelled to Order");
    assert.deepEqual(updated?.nameByLanguage, {
      pl: "CTO po polsku",
      de: "Gefälligkeitsstempel",
    });
  });

  it("cascade-deletes translations with the condition", async () => {
    await createStampCondition(userId, collectionId, {
      name: "First Day Cover",
      abbreviation: "FDC",
      translations: { pl: { name: "Koperta FDC" } },
    });
    const created = await conditionNamed("First Day Cover");
    assert.ok(created);
    await prisma.stampCondition.delete({ where: { id: created.id } });
    const rows = await prisma.stampConditionTranslation.findMany({
      where: { stampConditionId: created.id },
    });
    assert.deepEqual(rows, []);
  });
});

describe("certificate status translations (#294)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cert-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cert-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("round-trips per-language name and abbreviation", async () => {
    await createCertificateStatus(userId, collectionId, {
      name: "Certificate",
      abbreviation: "Cert",
      translations: { pl: { name: "Atest", abbreviation: "At." } },
    });
    let status = (await getCertificateStatuses(userId, collectionId))[0];
    assert.deepEqual(status.nameByLanguage, { pl: "Atest" });
    assert.deepEqual(status.abbreviationByLanguage, { pl: "At." });

    await updateCertificateStatus(userId, status.id, {
      name: "Certificate",
      abbreviation: "Cert",
      translations: { pl: { name: "Atest eksperta", abbreviation: "At." } },
    });
    status = (await getCertificateStatuses(userId, collectionId))[0];
    assert.deepEqual(status.nameByLanguage, { pl: "Atest eksperta" });
  });

  it("cascade-deletes translations with the status", async () => {
    await createCertificateStatus(userId, collectionId, {
      name: "Guarantee",
      abbreviation: "Gtee",
      translations: { pl: { name: "Gwarancja" } },
    });
    const status = (await getCertificateStatuses(userId, collectionId)).find(
      (s) => s.name === "Guarantee"
    );
    assert.ok(status);
    await prisma.certificateStatus.delete({ where: { id: status.id } });
    const rows = await prisma.certificateStatusTranslation.findMany({
      where: { certificateStatusId: status.id },
    });
    assert.deepEqual(rows, []);
  });
});

describe("issue and stamp name translations (#295, #296)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`isn-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `isn-${ts}`)).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function issueNames(issueId: string) {
    const rows = await prisma.issueTranslation.findMany({
      where: { issueId },
      orderBy: { language: "asc" },
    });
    return Object.fromEntries(rows.map((r) => [r.language, r.name]));
  }

  it("stores an issue name per language on create and update", async () => {
    const { id } = await createIssue(userId, collectionId, areaId, {
      name: "First Issue",
      translations: { pl: { name: "Pierwsze wydanie" } },
    });
    assert.deepEqual(await issueNames(id), { pl: "Pierwsze wydanie" });

    await updateIssue(userId, collectionId, id, {
      name: "First Issue",
      translations: { pl: { name: "Wydanie pierwsze" }, de: { name: "Erste Ausgabe" } },
    });
    assert.deepEqual(await issueNames(id), {
      de: "Erste Ausgabe",
      pl: "Wydanie pierwsze",
    });

    await updateIssue(userId, collectionId, id, {
      name: "First Issue",
      translations: { pl: { name: "" } },
    });
    assert.deepEqual(await issueNames(id), { de: "Erste Ausgabe" });
  });

  it("cascade-deletes issue translations with the issue", async () => {
    const { id } = await createIssue(userId, collectionId, areaId, {
      name: "Doomed",
      translations: { pl: { name: "Skazane" } },
    });
    await deleteIssue(userId, collectionId, id);
    assert.deepEqual(await prisma.issueTranslation.findMany({ where: { issueId: id } }), []);
  });

  it("stores a stamp name per language on add and update", async () => {
    const issue = await createIssue(userId, collectionId, areaId, { name: "Stamps here" });
    const { stampId } = await addStampToIssue(userId, collectionId, issue.id, {
      name: "5 kr blue",
      requiredForCompleteness: true,
      catalogNumbers: [],
      translations: { pl: { name: "5 kr niebieski" } },
    });
    assert.deepEqual(await getStampTranslations(userId, stampId), { pl: "5 kr niebieski" });

    await updateStampWithCatalog(userId, stampId, {
      name: "5 kr blue",
      catalogNumbers: [],
      translations: { pl: { name: "5 koron niebieski" } },
    });
    assert.deepEqual(await getStampTranslations(userId, stampId), { pl: "5 koron niebieski" });
  });

  it("leaves stamp translations untouched when the caller does not manage them", async () => {
    const issue = await createIssue(userId, collectionId, areaId, { name: "Untouched" });
    const { stampId } = await addStampToIssue(userId, collectionId, issue.id, {
      name: "10 kr green",
      requiredForCompleteness: true,
      catalogNumbers: [],
      translations: { pl: { name: "10 kr zielony" } },
    });
    // No `translations` key at all — e.g. a form that doesn't render the field.
    await updateStampWithCatalog(userId, stampId, { name: "10 kr green", catalogNumbers: [] });
    assert.deepEqual(await getStampTranslations(userId, stampId), { pl: "10 kr zielony" });
  });

  it("cascade-deletes stamp translations with the stamp", async () => {
    const issue = await createIssue(userId, collectionId, areaId, { name: "Cascade" });
    const { stampId } = await addStampToIssue(userId, collectionId, issue.id, {
      name: "1 kr red",
      requiredForCompleteness: true,
      catalogNumbers: [],
      translations: { pl: { name: "1 kr czerwony" } },
    });
    await prisma.stamp.delete({ where: { id: stampId } });
    assert.deepEqual(await prisma.stampTranslation.findMany({ where: { stampId } }), []);
  });
});

describe("toTitleCopy language resolution (#294–#296)", () => {
  const EMPTY_MAPS: AreaVendorMaps = {
    vendorMapByArea: new Map(),
    primaryVendorByArea: new Map(),
  };

  function row(): TitleCopyRow {
    return {
      id: "item-1",
      stamp: {
        name: "5 kr blue",
        issuedYear: 1918,
        translations: [{ language: "pl", name: "5 kr niebieski" }],
        catalogNumbers: [],
        stampAreaLinks: [],
        issueMemberships: [
          {
            issue: {
              name: "First Issue",
              year: 1918,
              translations: [{ language: "pl", name: "Pierwsze wydanie" }],
            },
          },
        ],
      },
      condition: {
        name: "Mint Never Hinged",
        abbreviation: "MNH",
        // Polish translates the name but deliberately keeps the abbreviation.
        translations: [{ language: "pl", name: "Czyste bez podlepki", abbreviation: null }],
      },
      certificateStatus: {
        name: "Certificate",
        abbreviation: "Cert",
        translations: [{ language: "pl", name: "Atest", abbreviation: "At." }],
      },
      location: null,
      locationRef: null,
    };
  }

  it("uses the default-language columns when no language is given", () => {
    const copy = toTitleCopy(row(), EMPTY_MAPS, new Map(), null);
    assert.equal(copy.name, "5 kr blue");
    assert.equal(copy.issueName, "First Issue");
    assert.equal(copy.condition, "Mint Never Hinged");
    assert.equal(copy.conditionAbbr, "MNH");
    assert.equal(copy.certificate, "Certificate");
    assert.equal(copy.certificateAbbr, "Cert");
  });

  it("resolves each token in the requested language", () => {
    const copy = toTitleCopy(row(), EMPTY_MAPS, new Map(), "pl");
    assert.equal(copy.name, "5 kr niebieski");
    assert.equal(copy.issueName, "Pierwsze wydanie");
    assert.equal(copy.condition, "Czyste bez podlepki");
    assert.equal(copy.certificate, "Atest");
    assert.equal(copy.certificateAbbr, "At.");
  });

  it("falls back per field, so a translated name does not imply a translated abbreviation", () => {
    const copy = toTitleCopy(row(), EMPTY_MAPS, new Map(), "pl");
    assert.equal(copy.conditionAbbr, "MNH");
  });

  it("falls back for a language nothing is translated into", () => {
    const copy = toTitleCopy(row(), EMPTY_MAPS, new Map(), "fr");
    assert.equal(copy.name, "5 kr blue");
    assert.equal(copy.condition, "Mint Never Hinged");
    assert.equal(copy.certificate, "Certificate");
  });

  it("keeps an absent certificate status absent rather than translating a null", () => {
    const withoutCert = { ...row(), certificateStatus: null };
    const copy = toTitleCopy(withoutCert, EMPTY_MAPS, new Map(), "pl");
    assert.equal(copy.certificate, null);
    assert.equal(copy.certificateAbbr, null);
  });
});
