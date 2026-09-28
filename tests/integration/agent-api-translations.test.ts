import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createAlbum } from "../../src/lib/albums";
import { albumTranslationGaps } from "../../src/lib/album-editor";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { getAlbumPrintedReport, markAlbumPagesPrinted } from "../../src/lib/album-printing";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";
import { createItem } from "../../src/lib/items";
import { createOffer, previewOfferTitle } from "../../src/lib/offers";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { translationKey, translationTarget } from "../../src/lib/agent-api/translations";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentMissingTranslation, AgentTranslationWrite } from "../../src/lib/agent-api/translations";

// **Translating the collection's texts through the agent API (#1452), driven through the real route
// with real tokens.** `tests/unit/agent-api-translations.test.ts` holds the keys, the entries and the
// language check. This file holds the *Done when* as calls: the texts a language is missing, with
// their default text and what they belong to, narrowed by kind, area or album; writing them, which a
// listing title and an album page then print; an existing translation kept unless replacement is
// asked for, and named when it is replaced; a language the collection does not use refused; a
// read-only token refused on the write; and a printed card left as it was, reporting the change.

const ts = Date.now();

type Method = "GET" | "POST";
const HANDLERS = { GET, POST };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

interface MissingList {
  items: AgentMissingTranslation[];
  total: number;
  nextCursor: string | null;
}

async function call(token: string, method: Method, path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const pathOnly = path.split("?")[0];
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: pathOnly.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function missing(token: string, query: string): Promise<MissingList> {
  const answer = await call(token, "GET", `/translations/missing?${query}`);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body as MissingList;
}

async function write(token: string, body: unknown): Promise<AgentTranslationWrite> {
  const answer = await call(token, "POST", "/translations", body);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body as AgentTranslationWrite;
}

async function refused(token: string, method: Method, path: string, body?: unknown) {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

describe("find_missing_translations and set_translations (#1452)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let token: string;
  let readOnlyToken: string;
  let europe: string, poland: string, germany: string;
  let constitution: string, germania: string;
  let mercury: string, nameless: string, germaniaStamp: string;
  let imperforate: string, namedAfterIssue: string;
  let conditionId: string;
  let otherIssue: string;
  let platformId: string;
  let copyId: string;
  let albumId: string;

  const key = (kind: Parameters<typeof translationTarget>[0], field: string, id: string) =>
    translationKey(translationTarget(kind, field, id));

  /** Every page of a listing, walked by its cursor. */
  async function allMissing(query: string): Promise<AgentMissingTranslation[]> {
    const out: AgentMissingTranslation[] = [];
    let cursor: string | null = null;
    do {
      const page: MissingList = await missing(token, `${query}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      out.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return out;
  }

  before(async () => {
    userId = `test-user-api-translations-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User api-translations-${ts}`,
        email: `test-api-translations-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const collection = (slug: string) =>
      prisma.collection.create({
        data: { slug, name: slug, baseCurrency: "EUR", ownerId: userId, defaultLanguage: "en" },
      });
    collectionId = (await collection(`col-api-translations-${ts}`)).id;
    otherCollectionId = (await collection(`col-api-translations-other-${ts}`)).id;

    const vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const area = async (name: string, parentId: string | null, extra: object = {}) =>
      (
        await prisma.collectionArea.create({
          data: {
            collectionId,
            name,
            titleName: name,
            parentId,
            primaryCatalogVendorId: vendorId,
            collectionAreaVendors: { create: [{ catalogVendorId: vendorId }] },
            ...extra,
          },
        })
      ).id;
    europe = await area("Europe", null);
    poland = await area("Poland", europe, { catalogPrefix: "PL" });
    // Germany's public name is already German, so it is missing nothing in German.
    germany = await area("Germany", europe, { translations: { create: [{ language: "de", titleName: "Deutschland" }] } });

    const stamp = async (areaId: string, number: string, name: string | null, sortKey: string) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            widthMm: 26,
            heightMm: 30,
            primaryCatalogSortKey: sortKey,
            catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    mercury = await stamp(poland, "300", "Mercury", "0000000300");
    nameless = await stamp(poland, "301", null, "0000000301");
    germaniaStamp = await stamp(germany, "55", "Germania", "0000000055");

    const issue = async (issueNo: number, areaId: string, name: string, year: number, stamps: string[]) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo,
            collectionAreaId: areaId,
            name,
            year,
            members: { create: stamps.map((stampId) => ({ stampId })) },
          },
        })
      ).id;
    constitution = await issue(1938, poland, "Constitution", 1938, [mercury, nameless]);
    germania = await issue(1900, germany, "Germania", 1900, [germaniaStamp]);

    // Named after its issue, as `ensureIssueChecklist` names one: it prints the issue's translation.
    namedAfterIssue = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: constitution,
          name: "Constitution",
          stamps: { create: [mercury, nameless].map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      })
    ).id;
    // Named by hand: a text of its own.
    imperforate = (
      await prisma.checklist.create({
        data: { collectionId, issueId: constitution, name: "Imperforate", sortOrder: 1 },
      })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: {
          collectionId,
          name: "Mint never hinged",
          abbreviation: "MNH",
          sortOrder: 0,
          // Only the name is German — the abbreviation is a text of its own.
          translations: { create: [{ language: "de", name: "Postfrisch" }] },
        },
      })
    ).id;

    // A German marketplace makes German a translation language (#293); the Polish album below makes
    // Polish one (#777).
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Briefmarken.de", platform: true, titleLanguage: "de", titleTemplate: "{name} {issueName} {conditionAbbr}" },
      })
    ).id;
    copyId = (await createItem(userId, collectionId, { stampId: mercury, conditionId, forSale: true })).id;

    await prisma.hawidStrip.createMany({ data: [{ collectionId, heightMm: 40, stockLengthMm: 210, sortOrder: 0 }] });
    const templateId = (
      await prisma.albumTemplate.create({
        data: {
          collectionId,
          name: "Polish",
          ...DEFAULT_ALBUM_PRESET,
          checklistTemplate: "{year}. {checklistName}",
          boxLabelTemplate: "{name}",
          footerTemplate: "{pageRange} {area}",
        },
      })
    ).id;
    albumId = await createAlbum(userId, collectionId, { name: "Polska", collectionAreaId: poland, language: "pl" }, templateId);

    otherIssue = (
      await prisma.issue.create({
        data: {
          collectionId: otherCollectionId,
          issueNo: 1,
          collectionAreaId: (await prisma.collectionArea.create({ data: { collectionId: otherCollectionId, name: "Elsewhere" } })).id,
          name: "Not yours",
        },
      })
    ).id;

    token = (await createAssistantToken(userId, collectionId, { label: "translator", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "translator, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("finding what a language is missing", () => {
    it("lists every untranslated text once, with its own-language text and what it belongs to", async () => {
      const rows = await allMissing("language=de");
      assert.deepEqual(
        rows.map((row) => row.key),
        [
          key("area", "titleName", europe),
          key("area", "titleName", poland),
          key("issue", "name", germania),
          key("issue", "name", constitution),
          key("checklist", "name", imperforate),
          key("stamp", "name", germaniaStamp),
          key("stamp", "name", mercury),
          key("condition", "abbreviation", conditionId),
        ],
        "Germany's name and the condition's name are German already, a nameless stamp has nothing to translate, and a checklist named after its issue prints the issue's translation"
      );
      const byKey = new Map(rows.map((row) => [row.key, row]));
      assert.deepEqual(byKey.get(key("stamp", "name", mercury)), {
        key: key("stamp", "name", mercury),
        kind: "stamp",
        field: "name",
        text: "Mercury",
        belongsTo: "Mi·PL 300 in Constitution, 1938",
      });
      assert.equal(byKey.get(key("issue", "name", constitution))?.belongsTo, "Poland, 1938");
      assert.equal(byKey.get(key("area", "titleName", poland))?.field, "title_name");
      assert.equal(byKey.get(key("area", "titleName", poland))?.belongsTo, "under Europe");
      assert.equal(byKey.get(key("area", "titleName", europe))?.belongsTo, undefined);
      assert.equal(byKey.get(key("checklist", "name", imperforate))?.belongsTo, "of Constitution, 1938");
      assert.deepEqual(byKey.get(key("condition", "abbreviation", conditionId)), {
        key: key("condition", "abbreviation", conditionId),
        kind: "condition",
        field: "abbreviation",
        text: "MNH",
      });
      assert.equal(rows.some((row) => row.key.includes(namedAfterIssue)), false);
    });

    it("states the full total on every page", async () => {
      const first = await missing(token, "language=de&limit=3");
      assert.equal(first.items.length, 3);
      assert.equal(first.total, 8);
      assert.equal(first.nextCursor, "3");
    });

    it("narrows to a kind, and to an area with every area under it", async () => {
      assert.deepEqual(
        (await missing(token, "language=de&kind=stamp")).items.map((row) => row.key),
        [key("stamp", "name", germaniaStamp), key("stamp", "name", mercury)]
      );
      assert.deepEqual(
        (await allMissing("language=de&area=Poland")).map((row) => row.key),
        [
          key("area", "titleName", poland),
          key("issue", "name", constitution),
          key("checklist", "name", imperforate),
          key("stamp", "name", mercury),
        ]
      );
      assert.equal((await missing(token, "language=de&area=Europe")).total, 7, "everything but the condition");

      const conditionInArea = await refused(token, "GET", "/translations/missing?language=de&area=Poland&kind=condition");
      assert.match(conditionInArea.error.message, /condition belongs to no area/);
    });

    it("narrows to an album, listing exactly what its unprinted pages would print untranslated", async () => {
      const rows = await allMissing(`language=pl&album=Polska`);
      const editor = await albumTranslationGaps(userId, albumId);
      assert.ok(editor && editor.gaps.length > 0);
      assert.deepEqual(
        rows.map((row) => row.key),
        editor!.gaps.map((gap) => key(gap.entityType, gap.entityField, gap.entityId))
      );
      assert.ok(rows.some((row) => row.key === key("stamp", "name", mercury)), "the box label prints the stamp's name");
      assert.equal(rows.some((row) => row.key.includes(germaniaStamp)), false, "nothing outside the album");

      const wrongLanguage = await refused(token, "GET", "/translations/missing?language=de&album=Polska");
      assert.deepEqual(wrongLanguage.error.accepted, ["pl"]);
      const both = await refused(token, "GET", "/translations/missing?language=pl&album=Polska&area=Poland");
      assert.match(both.error.message, /not both/);
    });

    it("refuses a language the collection does not use, and its own, with the ones it does", async () => {
      for (const language of ["fr", "en"]) {
        const answer = await refused(token, "GET", `/translations/missing?language=${language}`);
        assert.equal(answer.error.code, "invalid_request");
        assert.deepEqual(answer.error.accepted, ["de", "pl"]);
      }
    });

    it("answers a read-only token", async () => {
      assert.ok((await missing(readOnlyToken, "language=de")).total > 0);
    });
  });

  describe("writing them", () => {
    it("fills gaps, and the listing title prints them at once", async () => {
      const offerId = await createOffer(userId, collectionId, {
        platformId,
        url: null,
        price: "5.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      });
      const answer = await write(token, {
        language: "de",
        translations: [
          `${key("stamp", "name", mercury)}: Merkur`,
          `${key("issue", "name", constitution)}: Verfassung`,
          `${key("condition", "abbreviation", conditionId)}: **`,
        ],
      });
      assert.deepEqual(answer, {
        language: "de",
        written: [
          { key: key("stamp", "name", mercury), text: "Merkur" },
          { key: key("issue", "name", constitution), text: "Verfassung" },
          { key: key("condition", "abbreviation", conditionId), text: "**" },
        ],
        kept: [],
      });

      const preview = await previewOfferTitle(userId, offerId, [copyId]);
      assert.equal(preview?.segments.map((s) => s.text).join(""), "Merkur Verfassung **");
      assert.equal(preview?.gaps.length, 0);

      const condition = await prisma.stampConditionTranslation.findUniqueOrThrow({
        where: { stampConditionId_language: { stampConditionId: conditionId, language: "de" } },
      });
      assert.deepEqual([condition.name, condition.abbreviation], ["Postfrisch", "**"], "the name is left as it was");
      assert.equal((await missing(token, "language=de")).total, 5);
    });

    it("keeps an existing translation unless replacement is asked for, and names what it replaced", async () => {
      const kept = await write(token, {
        language: "de",
        translations: [`${key("condition", "name", conditionId)}: Ungebraucht`, `${key("stamp", "name", germaniaStamp)}: Germania`],
      });
      assert.deepEqual(kept.kept, [{ key: key("condition", "name", conditionId), current: "Postfrisch" }]);
      assert.deepEqual(kept.written, [{ key: key("stamp", "name", germaniaStamp), text: "Germania" }]);

      const replaced = await write(token, {
        language: "de",
        translations: [`${key("condition", "name", conditionId)}: Ungebraucht`],
        replace: true,
      });
      assert.deepEqual(replaced.written, [
        { key: key("condition", "name", conditionId), text: "Ungebraucht", replaced: "Postfrisch" },
      ]);
      assert.deepEqual(replaced.kept, []);
    });

    it("refuses the whole call over a key naming nothing here, or a text with no words to translate", async () => {
      const before = await prisma.stampTranslation.count({ where: { stampId: germaniaStamp } });
      const unknown = await refused(token, "POST", "/translations", {
        language: "pl",
        translations: [`${key("stamp", "name", germaniaStamp)}: Germania`, `${key("issue", "name", otherIssue)}: Obce`],
      });
      assert.deepEqual(unknown.error.accepted, [key("issue", "name", otherIssue)]);
      assert.match(unknown.error.message, /Nothing was written/);

      const empty = await refused(token, "POST", "/translations", {
        language: "pl",
        translations: [`${key("stamp", "name", nameless)}: Bez nazwy`],
      });
      assert.match(empty.error.message, /empty in the collection's own language/);

      const malformed = await refused(token, "POST", "/translations", {
        language: "pl",
        translations: [`copy.name.${copyId}: x`],
      });
      assert.match(malformed.error.message, /not a text's key/);
      assert.equal(await prisma.stampTranslation.count({ where: { stampId: germaniaStamp } }), before);
    });

    it("refuses a language the collection does not use", async () => {
      const answer = await refused(token, "POST", "/translations", {
        language: "fr",
        translations: [`${key("stamp", "name", mercury)}: Mercure`],
      });
      assert.deepEqual(answer.error.accepted, ["de", "pl"]);
    });

    it("refuses a read-only token, before anything is read", async () => {
      const answer = await refused(readOnlyToken, "POST", "/translations", {
        language: "pl",
        translations: [`${key("stamp", "name", mercury)}: Merkury`],
      });
      assert.equal(answer.status, 403);
      assert.equal(answer.error.code, "forbidden");
    });
  });

  it("leaves a printed card as it was, and the card reports the new wording", async () => {
    const overview = albumPlanOverview((await planAlbum(userId, albumId))!);
    assert.ok(overview.pages.length > 0);
    await markAlbumPagesPrinted(userId, albumId, overview.pages.map((_, i) => i + 1), overview.fingerprint);
    assert.deepEqual(
      (await getAlbumPrintedReport(userId, albumId)).sheets.flatMap((sheet) => sheet.divergences),
      []
    );
    assert.equal(
      (await missing(token, "language=pl&album=Polska")).items.some((row) => row.key === key("stamp", "name", mercury)),
      false,
      "a text on a printed card is not listed: what is on the card is on it"
    );

    await write(token, { language: "pl", translations: [`${key("stamp", "name", mercury)}: Merkury`] });

    const divergences = (await getAlbumPrintedReport(userId, albumId)).sheets.flatMap((sheet) => sheet.divergences);
    assert.ok(
      // The card still carries `Mercury`: the report compares it with what would print now.
      divergences.some((d) => d.kind === "text" && /box label reads differently/.test(d.detail)),
      JSON.stringify(divergences)
    );
  });

  it("is two operations in the registry, and only the write writes", () => {
    const ours = OPERATIONS.filter((operation) => operation.path.startsWith("/translations"));
    assert.deepEqual(
      ours.map((operation) => [operation.name, operation.writes]),
      [
        ["find_missing_translations", false],
        ["set_translations", true],
      ]
    );
  });
});
