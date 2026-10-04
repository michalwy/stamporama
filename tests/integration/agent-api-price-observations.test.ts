import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type {
  AgentObservationBatch,
  AgentPriceObservation,
} from "../../src/lib/agent-api/price-observations";
import type { AgentBidRecommendation } from "../../src/lib/agent-api/bid-reads";

// **Price observations through the agent API (#1635), driven through the real route with real
// tokens.** `tests/unit/agent-api-price-observations.test.ts` holds the `name=value` grammar and the
// projection; `tests/integration/price-observations.test.ts` the domain's own rules. This file holds
// the *Done when* as calls: a batch answered row by row with duplicates of a source lot refused, a
// number that does not name one stamp recorded on the umbrella as a hint or refused — never guessed —,
// an unknown house refused rather than created, the list and its filters, a correction, a deletion,
// the ids `recommend_bid` names its evidence by, and `create_seller` adding a house with its market.
//
// The collection's base is EUR and every price is in EUR, so no ECB rate is fetched: a network call
// would fail the suite offline (`price-observations.test.ts` says the same).

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

interface ListBody<T> {
  items: T[];
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
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown): Promise<ApiErrorBody["error"] & { status: number }> {
  const answer = await call(token, method, path, body);
  assert.notEqual(answer.status, 200, `${method} ${path} was not refused: ${JSON.stringify(answer.body)}`);
  return { status: answer.status, ...(answer.body as ApiErrorBody).error };
}

describe("price observations through the agent API (#1635)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  const stampIds: Record<string, string> = {};

  const record = (observations: string[]) =>
    ok<AgentObservationBatch>(token, "POST", "/price-observations", { observations });
  const list = async (query = "") =>
    ok<ListBody<AgentPriceObservation>>(token, "GET", `/price-observations${query ? `?${query}` : ""}`);
  const row = (fields: string) => `sold_on=2024-03-14; platform=Philasearch; ${fields}`;

  before(async () => {
    userId = `test-user-obsapi-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User obsapi-${ts}`,
        email: `test-obsapi-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-obsapi-${ts}`, name: "Observations", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const book = await prisma.catalogName.create({ data: { vendorId: michel.id, name: "Michel Deutschland", currency: "EUR" } });
    const editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: book.id, year: 2024 } })).id;

    // Danzig anchors on Germany; Poland says nothing, so it anchors on the home market, PL.
    const area = async (name: string, anchorMarkets: string[]) => {
      const created = await prisma.collectionArea.create({
        data: {
          collectionId,
          name,
          anchorMarkets,
          primaryCatalogNameId: book.id,
          primaryCatalogVendorId: michel.id,
          collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: null }] },
        },
      });
      await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: created.id, catalogNameId: book.id } });
      return created.id;
    };
    const danzigId = await area("Danzig", ["DE"]);
    const polandId = await area("Poland", []);

    const mnh = await prisma.stampCondition.create({ data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 } });
    await prisma.certificateStatus.create({ data: { collectionId, name: "Fotoattest", abbreviation: "FA", sortOrder: 0 } });
    const variant = await prisma.stampSubtype.create({
      data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });

    // Mi 5 in Danzig; Mi 6 an umbrella over Mi 6a; Mi 7 twice, once in each area; Mi 8 in Poland.
    const tree: [string, string, string | null][] = [
      ["5", danzigId, null],
      ["6", danzigId, null],
      ["6a", danzigId, "6"],
      ["7", danzigId, null],
      ["7 ", polandId, null],
      ["8", polandId, null],
    ];
    for (const [key, areaId, parent] of tree) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${key.trim()}`,
          parentId: parent ? stampIds[parent] : null,
          subtypeId: parent ? variant.id : null,
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number: key.trim() }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      stampIds[key] = stamp.id;
    }
    await prisma.stampCatalogPrice.create({
      data: { stampId: stampIds["5"], catalogEditionId: editionId, conditionId: mnh.id, price: "200.00", currency: "EUR" },
    });

    await prisma.contact.create({ data: { collectionId, name: "Philasearch", platform: true } });
    await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } });
    await prisma.contact.create({
      data: {
        collectionId,
        name: "Köhler",
        auctionHouse: true,
        market: "DE",
        buyerPremiumPercent: "23.00",
        buyerPremiumFixed: "1.50",
        defaultCurrency: "EUR",
      },
    });

    token = (await createAssistantToken(userId, collectionId, { label: "bidding assistant", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "bidding assistant, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.priceObservation.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  let köhlerLot: AgentPriceObservation;

  describe("record_price_observations", () => {
    it("answers row by row: recorded, a duplicate of a source lot, or refused — and a refusal stops nothing", async () => {
      const count = await prisma.priceObservation.count({ where: { collectionId } });
      const batch = await record([
        row("stamp=Mi 5; condition=MNH; price=100; currency=EUR; house=Köhler; auction=412; lot=1001"),
        row("stamp=Mi 6; condition=MNH; price=60; currency=EUR; house=Köhler; auction=412; lot=1002"),
        row("stamp=Mi 7; condition=MNH; price=10; currency=EUR; lot=1003"),
        row("stamp=Mi 999; condition=MNH; price=10; currency=EUR; lot=1004"),
        row("stamp=Mi 5; condition=MNH; price=10; currency=EUR; house=Gärtner; auction=66; lot=1"),
        row("stamp=Mi 5; condition=MNH; price=101; currency=EUR; house=köhler; auction=412; lot=1001"),
        "stamp=Mi 5; price=10",
        row("stamp=Mi 5; condition=?; price=95; currency=EUR; house=Köhler; auction=412; lot=1005"),
      ]);
      assert.deepEqual(
        batch.observations.map((o) => o.outcome),
        ["recorded", "recorded", "refused", "refused", "refused", "duplicate", "refused", "recorded"]
      );
      assert.deepEqual([batch.recorded, batch.duplicate, batch.refused, batch.counted], [3, 1, 4, 1]);
      assert.equal(await prisma.priceObservation.count({ where: { collectionId } }), count + 3);

      // A counted one says so, at once.
      köhlerLot = batch.observations[0].observation!;
      assert.equal(köhlerLot.counted, true);
      assert.equal(köhlerLot.countedAmount, "100.00");
      assert.equal(köhlerLot.market, "DE");
      assert.equal(köhlerLot.stamp, "Mi 5");
      assert.equal(köhlerLot.stampId, stampIds["5"]);

      // A number that names an umbrella is recorded on it, as a hint: the variant is not established.
      const umbrella = batch.observations[1].observation!;
      assert.equal(umbrella.stampId, stampIds["6"]);
      assert.equal(umbrella.counted, false);
      assert.equal(umbrella.notCounted, "uncertain");
      assert.deepEqual(umbrella.doubts, ["variant"]);

      // A number naming two stamps, or none, is refused — never guessed.
      assert.match(batch.observations[2].reason!, /matches 2 stamps/);
      assert.match(batch.observations[3].reason!, /no stamp id and no catalogue number/);
      // A house nobody knows is refused, never created.
      assert.match(batch.observations[4].reason!, /create_seller/);
      assert.equal(await prisma.contact.count({ where: { collectionId, name: "Gärtner" } }), 0);
      // The same lot number in the same auction at the same house, case aside, is the lot recorded first.
      assert.equal(batch.observations[5].duplicateOf, köhlerLot.id);
      assert.match(batch.observations[6].reason!, /no sold_on and no platform/);
      // `condition=?` is recorded, and not counted.
      assert.deepEqual(batch.observations[7].observation!.doubts, ["condition"]);
    });

    it("fills what a row leaves out from the house's terms, and reduces an all-in price to the hammer", async () => {
      const batch = await record([row("stamp=Mi 5; condition=MNH; basis=all_in; price=124,50; house=Köhler; auction=413; lot=7")]);
      const read = batch.observations[0].observation!;
      assert.equal(read.currency, "EUR");
      assert.equal(read.premium, "23.00");
      assert.equal(read.fee, "1.50");
      assert.equal(read.hammer, "100.00");
      assert.equal(read.countedAmount, "100.00");
    });

    it("refuses a row with no currency to take, a platform it does not know, and a duplicate address within the batch", async () => {
      const batch = await record([
        row("stamp=Mi 8; condition=MNH; price=10; lot=20"),
        "stamp=Mi 8; condition=MNH; price=10; currency=PLN; sold_on=2024-03-14; platform=eBay; lot=21",
        row("stamp=Mi 8; condition=MNH; price=10; currency=EUR; url=https://example.com/r/22;jsessionid=x"),
        row("stamp=Mi 8; condition=MNH; price=11; currency=EUR; url=https://example.com/r/22;jsessionid=x"),
      ]);
      assert.deepEqual(batch.observations.map((o) => o.outcome), ["refused", "refused", "recorded", "duplicate"]);
      assert.match(batch.observations[0].reason!, /no `currency`/);
      assert.match(batch.observations[1].reason!, /eBay/);
      assert.equal(batch.observations[2].observation!.url, "https://example.com/r/22;jsessionid=x");
    });

    it("refuses an empty batch, one over the cap, and a read-only token", async () => {
      assert.match((await refused(token, "POST", "/price-observations", { observations: [] })).message, /at least one/);
      const many = Array.from({ length: 101 }, (_, i) => row(`stamp=Mi 8; price=1; currency=EUR; lot=x${i}`));
      assert.match((await refused(token, "POST", "/price-observations", { observations: many })).message, /at most 100/);
      const readOnly = await refused(readOnlyToken, "POST", "/price-observations", { observations: [row("stamp=Mi 8; price=1; currency=EUR")] });
      assert.equal(readOnly.status, 403);
    });
  });

  describe("list_price_observations", () => {
    it("lists newest sale first, narrowed by stamp, area, market, platform, house and days", async () => {
      await record([
        "stamp=Mi 8; condition=MNH; price=30; currency=EUR; sold_on=2023-05-01; platform=Allegro; lot=555",
      ]);
      const all = await list();
      assert.equal(all.total, await prisma.priceObservation.count({ where: { collectionId } }));
      assert.equal(all.items[all.items.length - 1].soldOn, "2023-05-01");

      const mi5 = await list("stamp=Mi 5");
      assert.ok(mi5.items.length > 0 && mi5.items.every((o) => o.stampId === stampIds["5"]));

      const danzig = await list("area=Danzig");
      assert.ok(danzig.items.every((o) => [stampIds["5"], stampIds["6"]].includes(o.stampId)));

      // Köhler names DE; Philasearch and Allegro name none, so they count as the home market, PL.
      const de = await list("market=DE");
      assert.ok(de.total > 0 && de.items.every((o) => o.market === "DE"));
      const pl = await list("market=pl");
      assert.ok(pl.total > 0 && pl.items.every((o) => o.market === undefined));
      assert.equal(de.total + pl.total, all.total);

      const allegro = await list("platform=Allegro");
      assert.deepEqual(allegro.items.map((o) => o.lot), ["555"]);
      assert.equal(allegro.items[0].counted, true, "a Polish stamp sold on the home market counts");

      const köhler = await list("house=Köhler");
      assert.ok(köhler.items.every((o) => o.house === "Köhler"));
      const before = await list("sold_to=2023-12-31");
      assert.deepEqual(before.items.map((o) => o.lot), ["555"]);
      const after = await list("sold_from=2024-01-01");
      assert.equal(after.total + before.total, all.total);

      assert.match((await refused(token, "GET", "/price-observations?market=Germany")).message, /two-letter/);
    });
  });

  describe("update_price_observation and delete_price_observation", () => {
    it("corrects only what is sent, clears what `clear` names, and refuses becoming another lot", async () => {
      const corrected = await ok<AgentPriceObservation>(token, "PATCH", `/price-observations/${köhlerLot.id}`, {
        price: "110",
        clear: ["auction"],
      });
      assert.equal(corrected.price, "110.00");
      assert.equal(corrected.auction, undefined);
      assert.equal(corrected.lot, "1001");
      assert.equal(corrected.house, "Köhler");
      assert.equal(corrected.counted, true);

      const hint = await ok<AgentPriceObservation>(token, "PATCH", `/price-observations/${köhlerLot.id}`, {
        condition: "?",
        certificate: "?",
      });
      assert.equal(hint.counted, false);
      assert.deepEqual(hint.doubts, ["condition", "certificate"]);
      assert.equal(hint.certificate, "?");

      // Moved onto Mi 6a, the variant the umbrella row could not name.
      const moved = await ok<AgentPriceObservation>(token, "PATCH", `/price-observations/${köhlerLot.id}`, {
        stamp: "Mi 6a",
        condition: "MNH",
        certificate: "none",
      });
      assert.equal(moved.stampId, stampIds["6a"]);
      assert.equal(moved.doubts, undefined);

      const other = (await list("house=Köhler")).items.find((o) => o.id !== köhlerLot.id && o.lot)!;
      const clash = await refused(token, "PATCH", `/price-observations/${other.id}`, { lot: "1001", clear: ["auction"] });
      assert.match(clash.message, new RegExp(köhlerLot.id));

      assert.match((await refused(token, "PATCH", `/price-observations/${köhlerLot.id}`, {})).message, /Nothing to change/);
      assert.equal((await refused(token, "PATCH", "/price-observations/nope", { price: "1" })).status, 404);
    });

    it("deletes one, and a second delete is not found", async () => {
      const answer = await ok<{ deleted: string; stampId: string }>(token, "DELETE", `/price-observations/${köhlerLot.id}`);
      assert.equal(answer.deleted, köhlerLot.id);
      assert.equal(await prisma.priceObservation.count({ where: { id: köhlerLot.id } }), 0);
      assert.equal((await refused(token, "DELETE", `/price-observations/${köhlerLot.id}`)).status, 404);
    });
  });

  describe("recommend_bid's evidence", () => {
    it("names each observation it rests on by the id the corrections take", async () => {
      const answer = await ok<AgentBidRecommendation>(
        token,
        "GET",
        `/bid-recommendation?stamp_ids=${stampIds["8"]}&condition=MNH&currency=EUR`
      );
      const [line] = answer.lines;
      assert.equal(line.anchoredOn, "market");
      const counted = (await list("stamp=Mi 8")).items.filter((o) => o.counted);
      assert.ok(counted.length >= 2);
      assert.ok(line.marketResults!.every((result) => result.kind === "observation"));
      assert.deepEqual(
        line.marketResults!.map((result) => result.id).sort(),
        counted.map((o) => o.id).sort()
      );
    });
  });

  describe("create_seller for a house", () => {
    it("adds an auction house with the market it sells in, and refuses a market that is not a code", async () => {
      const created = await ok<{ id: string; name: string }>(token, "POST", "/sellers", {
        name: `Gärtner ${ts}`,
        auction_house: true,
        market: "de",
      });
      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(contact.market, "DE");
      assert.equal(contact.auctionHouse, true);
      assert.equal(contact.seller, true);

      const batch = await record([row(`stamp=Mi 5; condition=MNH; price=50; currency=EUR; house=Gärtner ${ts}; auction=66; lot=9`)]);
      assert.equal(batch.observations[0].observation?.market, "DE");

      assert.match(
        (await refused(token, "POST", "/sellers", { name: `Somebody ${ts}`, market: "Germany" })).message,
        /two-letter/
      );
    });
  });

  it("publishes the four operations, three of them writing", () => {
    const ops = OPERATIONS.filter((op) => op.path.startsWith("/price-observations"))
      .map((op) => `${op.method} ${op.path} ${op.name} ${op.writes}`)
      .sort();
    assert.deepEqual(ops, [
      "DELETE /price-observations/{observationId} delete_price_observation true",
      "GET /price-observations list_price_observations false",
      "PATCH /price-observations/{observationId} update_price_observation true",
      "POST /price-observations record_price_observations true",
    ]);
  });
});
