import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { GET } from "../../src/app/api/v1/[...path]/route";

// **`find_missing_catalogue_prices` (#2110), driven through the real route with real tokens.**
// `tests/unit/agent-api-missing-catalog-prices.test.ts` holds what counts as missing over fixture
// rows; this file holds the *Done when* as calls: an area, an issue, a checklist and a list of stamps
// each answered grouped by issue with the cells named and a total, `-` and `?` never reported, a
// derivable certificate cell reported as derivable, the edition defaulting to the area's primary
// catalogue's newest, paging by stamps, and a read-only token served.

const ts = Date.now();

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

interface Cell {
  condition: string;
  certificate?: string;
  format?: string;
  derivable?: string;
}

interface Group {
  issueId: string | null;
  issue?: string;
  year?: number;
  edition: string;
  currency: string;
  stamps: { stampId: string; stampNo: number; numbers: string[]; name?: string; umbrella?: true; missing: Cell[] }[];
}

interface Answer {
  items: Group[];
  total: number;
  nextCursor: string | null;
  missingCells: number;
  withoutCatalogue?: number;
}

async function call(token: string, path: string) {
  const request = new NextRequest(`http://localhost/api/v1${path.replaceAll(" ", "%20")}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  const response = await GET(request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("find_missing_catalogue_prices (#2110)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let definitives: string;
  let airmail: string;
  let checklistId: string;
  const stampIds: Record<string, string> = {};

  const find = async (query: string) => {
    const answer = await call(token, `/catalog-prices/missing?${query}`);
    assert.equal(answer.status, 200, `${query} → ${JSON.stringify(answer.body)}`);
    return answer.body as Answer;
  };
  /** Each stamp's first number and its missing cells, flattened in the order told. */
  const told = (answer: Answer) =>
    answer.items.flatMap((group) =>
      group.stamps.map((stamp) => [
        stamp.numbers[0],
        stamp.missing.map((c) => [c.condition, c.certificate, c.format, c.derivable].filter(Boolean).join("/")),
      ])
    );

  before(async () => {
    userId = `test-user-missprice-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User missprice-${ts}`,
        email: `test-missprice-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-missprice-${ts}`, name: "Missing prices", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const polen = await prisma.catalogName.create({ data: { vendorId: michel.id, name: "Michel Polen", currency: "EUR" } });
    const current = await prisma.catalogEdition.create({ data: { catalogNameId: polen.id, year: 2024 } });
    const older = await prisma.catalogEdition.create({ data: { catalogNameId: polen.id, year: 2020 } });

    const europe = await prisma.collectionArea.create({ data: { collectionId, name: "Europe", sortOrder: 0 } });
    const poland = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        parentId: europe.id,
        primaryCatalogNameId: polen.id,
        primaryCatalogVendorId: michel.id,
        collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: null }] },
      },
    });
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: poland.id, catalogNameId: polen.id } });
    // An area with no catalogue at all: its stamps cannot be checked without an edition.
    const elsewhere = await prisma.collectionArea.create({ data: { collectionId, name: "Elsewhere", sortOrder: 1 } });

    const mnh = await prisma.stampCondition.create({ data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 } });
    const used = await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } });
    await prisma.certificateStatus.create({
      data: { collectionId, name: "Expertised", abbreviation: "Exp", sortOrder: 0, pricePercent: 120 },
    });
    const pair = await prisma.stampFormat.create({ data: { collectionId, name: "Pair", abbreviation: "Pr", sortOrder: 0 } });
    await prisma.stampFormatFactor.create({ data: { collectionId, formatId: pair.id, factor: 2 } });
    const color = await prisma.stampSubtype.create({
      data: { collectionId, name: "Color", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });

    definitives = (
      await prisma.issue.create({ data: { collectionId, issueNo: 1, collectionAreaId: poland.id, name: "Definitives", year: 1960 } })
    ).id;
    airmail = (
      await prisma.issue.create({ data: { collectionId, issueNo: 2, collectionAreaId: poland.id, name: "Airmail", year: 1950 } })
    ).id;
    const faraway = (
      await prisma.issue.create({ data: { collectionId, issueNo: 3, collectionAreaId: elsewhere.id, name: "Faraway", year: 1970 } })
    ).id;
    // Mi 309 is an umbrella over 309A and 309B; Mi 310 stands beside it; Mi 50 is airmail, issued
    // earlier and numbered lower, so its issue is told first.
    const tree: [string, string | null, string, string][] = [
      ["309", null, definitives, poland.id],
      ["309A", "309", definitives, poland.id],
      ["309B", "309", definitives, poland.id],
      ["310", null, definitives, poland.id],
      ["50", null, airmail, poland.id],
      ["1", null, faraway, elsewhere.id],
    ];
    for (const [i, [number, parent, issueId, areaId]] of tree.entries()) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${number}`,
          parentId: parent ? stampIds[parent] : null,
          subtypeId: parent ? color.id : null,
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      stampIds[number] = stamp.id;
      await prisma.issueMember.create({ data: { issueId, stampId: stamp.id, sortOrder: i } });
    }
    await prisma.issue.update({ where: { id: airmail }, data: { primaryCatalogSortKey: "000050" } });
    await prisma.issue.update({ where: { id: definitives }, data: { primaryCatalogSortKey: "000309" } });

    const record = (number: string, conditionId: string, value: number | "-" | "?", editionId = current.id, extra = {}) =>
      prisma.stampCatalogPrice.create({
        data: {
          stampId: stampIds[number],
          catalogEditionId: editionId,
          conditionId,
          currency: "EUR",
          price: typeof value === "number" ? value : null,
          mark: value === "-" ? "nonexistent" : value === "?" ? "undeterminable" : null,
          ...extra,
        },
      });
    await record("309A", mnh.id, 4);
    await record("309B", mnh.id, 6);
    await record("309A", used.id, "-");
    await record("310", mnh.id, 10);
    await record("310", used.id, "?");
    await record("310", mnh.id, 99, current.id, { certificateStatusId: null, formatId: pair.id });
    // Priced only in the older edition: still missing in the current one.
    await record("50", mnh.id, 2, older.id);

    checklistId = (
      await prisma.checklist.create({
        data: { collectionId, issueId: definitives, name: "Varieties", stamps: { create: [{ stampId: stampIds["309B"] }] } },
      })
    ).id;

    token = (await createAssistantToken(userId, collectionId, { label: "price agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "price agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampFormatFactor.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.certificateStatus.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers an area with every area under it, grouped by issue in catalogue order, with a total", async () => {
    const answer = await find("area=Europe");
    assert.deepEqual(
      answer.items.map((g) => [g.issue, g.year, g.edition, g.currency]),
      [
        ["Airmail", 1950, "Michel Polen 2024", "EUR"],
        ["Definitives", 1960, "Michel Polen 2024", "EUR"],
      ]
    );
    // 309 is answered on MNH by both its variants, and not on Used, where 309B has nothing; `-` and `?`
    // are answers; 50's older-edition price does not count in the newest.
    assert.deepEqual(told(answer), [
      ["Mi 50", ["Mint Never Hinged", "Used"]],
      ["Mi 309", ["Used"]],
      ["Mi 309B", ["Used"]],
    ]);
    assert.equal(answer.total, 3);
    assert.equal(answer.missingCells, 4);
    assert.equal(answer.nextCursor, null);
    assert.equal(answer.withoutCatalogue, undefined);
    const umbrella = answer.items[1].stamps[0];
    assert.equal(umbrella.umbrella, true);
    assert.equal(umbrella.stampId, stampIds["309"]);
  });

  it("checks every stamp in an edition sent, and counts those it cannot check without one", async () => {
    const collectionWide = await find(`area=Elsewhere`);
    assert.equal(collectionWide.total, 0);
    assert.equal(collectionWide.withoutCatalogue, 1);
    const older = await find(`area=Elsewhere&edition=Michel Polen 2020`);
    assert.deepEqual(told(older), [["Mi 1", ["Mint Never Hinged", "Used"]]]);
    assert.equal(older.items[0].edition, "Michel Polen 2020");
    const inOlder = await find(`issue=${airmail}&edition=Michel Polen 2020`);
    assert.deepEqual(told(inOlder), [["Mi 50", ["Used"]]]);
  });

  it("answers one issue, one checklist and a list of stamps", async () => {
    assert.deepEqual(told(await find(`issue=${definitives}&conditions=MNH`)), []);
    assert.deepEqual(told(await find(`checklist=${checklistId}`)), [["Mi 309B", ["Used"]]]);
    assert.deepEqual(told(await find(`stamps=Mi 310,Mi 50&conditions=U`)), [["Mi 50", ["Used"]]]);
  });

  it("reports a certificate cell the plain price would fill as derivable, and a derived format as priced", async () => {
    const certified = await find(`issue=${definitives}&conditions=MNH&certificates=Exp`);
    assert.deepEqual(told(certified), [
      ["Mi 309", ["Mint Never Hinged/Expertised"]],
      ["Mi 309A", ["Mint Never Hinged/Expertised/4.80"]],
      ["Mi 309B", ["Mint Never Hinged/Expertised/7.20"]],
      ["Mi 310", ["Mint Never Hinged/Expertised/12.00"]],
    ]);
    // A marked plain cell carries its mark over as what to send.
    const marked = await find(`stamps=Mi 309A,Mi 310&conditions=U&certificates=Exp`);
    assert.deepEqual(told(marked), [
      ["Mi 309A", ["Used/Expertised/-"]],
      ["Mi 310", ["Used/Expertised/?"]],
    ]);
    // Pairs: 309A and 309B derive from their singles, so 309 is answered too; 310 has its own.
    assert.deepEqual(told(await find(`issue=${definitives}&conditions=MNH&formats=Pair`)), []);
    assert.deepEqual(told(await find(`issue=${definitives}&conditions=MNH&formats=single,Pair`)), []);
  });

  it("pages by stamps and tells an issue cut by the boundary on both pages", async () => {
    const first = await find("area=Poland&limit=2");
    assert.equal(first.total, 3);
    assert.deepEqual(first.items.map((g) => [g.issue, g.stamps.length]), [["Airmail", 1], ["Definitives", 1]]);
    assert.ok(first.nextCursor);
    const second = await find(`area=Poland&limit=2&cursor=${first.nextCursor}`);
    assert.deepEqual(second.items.map((g) => [g.issue, g.stamps.map((s) => s.numbers[0])]), [["Definitives", ["Mi 309B"]]]);
    assert.equal(second.nextCursor, null);
  });

  it("refuses no scope or two, and an unknown condition with the accepted names", async () => {
    for (const query of ["", `area=Europe&issue=${definitives}`]) {
      const answer = await call(token, `/catalog-prices/missing?${query}`);
      assert.equal(answer.status, 400, query);
      assert.deepEqual((answer.body as ApiErrorBody).error.accepted, ["area", "issue", "checklist", "stamps"]);
    }
    const unknown = await call(token, `/catalog-prices/missing?area=Europe&conditions=Postfrisch`);
    assert.equal(unknown.status, 400);
  });

  it("serves a read-only token, and is in the document as a read", async () => {
    const answer = await call(readOnlyToken, `/catalog-prices/missing?area=Europe`);
    assert.equal(answer.status, 200);
    const operation = OPERATIONS.find((op) => op.name === "find_missing_catalogue_prices");
    assert.equal(operation?.writes, false);
    const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    assert.equal(document.paths["/api/v1/catalog-prices/missing"]?.get?.operationId, "find_missing_catalogue_prices");
  });
});
