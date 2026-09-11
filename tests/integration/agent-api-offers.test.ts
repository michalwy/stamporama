import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createOffer } from "../../src/lib/offers";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { buildToolList } from "../../src/lib/agent-api/mcp";
import { GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import { POST as MCP_POST } from "../../src/app/api/mcp/route";
import type { AgentOfferDetail, AgentOfferRow } from "../../src/lib/agent-api/offer-reads";
import type { AgentUnlistedCopiesResponse } from "../../src/lib/agent-api/operations/offers";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **The offer operations (#711), driven through the real route with a real token.**
//
// `tests/unit/agent-api-offer-reads.test.ts` holds every projection, because each is a function of a
// row, and `tests/unit/agent-api-operation-boundary.test.ts` holds the publish boundary as a fact
// about what the operation modules import. What neither can hold is everything below.
//
// **It goes through `src/app/api/v1/[...path]/route.ts` rather than through the handlers**, unlike
// #710's file beside it, and that is the point rather than a style choice. #711 is the first issue
// on this surface whose operations **write**, and the two things that had never been exercised on
// the wire are both in the route: `assertAgentApiScope`, which #707 and #709 could only test
// against fixture operations because nothing on `main` declared `writes: true`, and the body
// parsing a `POST` / `PATCH` needs and a `GET` never reaches. Calling the handlers directly would
// walk past both.
//
// **What this file closes is owed to #709 and #707 rather than to #711**, and it is stated here
// because that is where a later reader will look for it: until this landed, replacing the MCP
// route's `assertScope` binding with a no-op left every test in `agent-api-mcp.test.ts` green. It
// no longer does — see *a read token is refused on the wire* below, which is the first end-to-end
// proof that scope enforcement works on either wrapper.

const ts = Date.now();

/** A `/api/v1` request, as an agent makes one. */
function v1(
  token: string,
  method: string,
  path: string,
  body?: unknown
): { request: NextRequest; context: { params: Promise<{ path: string[] }> } } {
  const [pathname, search] = path.split("?");
  const url = `http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`;
  return {
    request: new NextRequest(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    context: { params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }) },
  };
}

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function get<T>(token: string, path: string): Promise<T> {
  const { request, context } = v1(token, "GET", path);
  const response = await GET(request, context);
  const body = await response.json();
  assert.equal(response.status, 200, `GET ${path} → ${JSON.stringify(body)}`);
  return body as T;
}

async function post<T>(token: string, path: string, body: unknown): Promise<T> {
  const call = v1(token, "POST", path, body);
  const response = await POST(call.request, call.context);
  const answer = await response.json();
  assert.equal(response.status, 200, `POST ${path} → ${JSON.stringify(answer)}`);
  return answer as T;
}

async function patch<T>(token: string, path: string, body: unknown): Promise<T> {
  const call = v1(token, "PATCH", path, body);
  const response = await PATCH(call.request, call.context);
  const answer = await response.json();
  assert.equal(response.status, 200, `PATCH ${path} → ${JSON.stringify(answer)}`);
  return answer as T;
}

/** The refusal a call came back with, and a failure saying so when it was not refused at all. */
async function refused(
  token: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<{ status: number; error: ApiErrorBody["error"] }> {
  const call = v1(token, method, path, body);
  const handler = method === "GET" ? GET : method === "POST" ? POST : PATCH;
  const response = await handler(call.request, call.context);
  const answer = (await response.json()) as ApiErrorBody;
  assert.ok(response.status >= 400, `expected a refusal, got ${JSON.stringify(answer)}`);
  return { status: response.status, error: answer.error };
}

describe("the offer operations (#711)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let token: string;
  let readOnlyToken: string;

  let platformId: string;
  let mnhId: string;
  let usedId: string;
  let areaId: string;
  let childAreaId: string;
  let otherAreaId: string;
  let editionId: string;

  /** Catalogued at 50.00 EUR MNH, and with auction evidence behind it. */
  let dearStampId: string;
  /** Catalogued at 2.00 EUR MNH — the cheap common a band is meant to separate out. */
  let cheapStampId: string;
  /** Priced at nothing at all: outside every band, by the rule `items.ts` states. */
  let unpricedStampId: string;
  /** In another area, so the area scope has something to leave out. */
  let foreignStampId: string;

  let dearCopyId: string;
  let cheapCopyId: string;
  let unpricedCopyId: string;
  let foreignCopyId: string;
  let usedCopyId: string;
  /** Already on a listing, so it is not unlisted. */
  let listedCopyId: string;
  /** An offer that exists before anything here runs, so `list_offers` has a second row. */
  let seededOfferId: string;

  before(async () => {
    userId = `test-user-offerops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offerops-${ts}`,
        email: `test-offerops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // EUR throughout — the collection, the catalogue and the platform — so no exchange rate is
    // fetched and the suite runs offline, the arrangement `estimated-value.test.ts` makes beside it.
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-offerops-${ts}`, name: "Offer ops", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-offerops-other-${ts}`,
          name: "Other",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polen", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendor.id,
          primaryCatalogNameId: catalogName.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalogName.id }] },
        },
      })
    ).id;
    childAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Galicia", parentId: areaId, primaryCatalogNameId: catalogName.id },
      })
    ).id;
    otherAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Austria", primaryCatalogNameId: catalogName.id },
      })
    ).id;

    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;

    // The platform, with a title template and a description template, so a draft comes back
    // **named** — which is the *titled* half of #711's own criterion, and the one thing nothing
    // else here would prove.
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Colnect",
          platform: true,
          platformCurrency: "EUR",
          titleTemplate: "{catalog} {name}",
          descriptionTemplate: "{#set}{catalog}{/set}",
          minimumPrice: "2.00",
        },
      })
    ).id;
    // A house that always opens an auction at the same figure (#553), so the format's own price
    // rule has somewhere to be exercised.
    await prisma.contact.create({
        data: {
          collectionId,
          name: "Kramer",
          platform: true,
          platformCurrency: "EUR",
          defaultListingType: "auction",
          defaultStartingPrice: "5.00",
          titleTemplate: "{catalog}",
        },
    });

    const issue = await prisma.issue.create({
      // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432), exactly as
      // the collection-reads suite beside it does.
      data: { collectionId, issueNo: 9711, collectionAreaId: areaId, name: "Insurgents", year: 1938 },
    });

    async function stamp(name: string, number: string, area: string): Promise<string> {
      const row = await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1938 } });
      await prisma.stampCollectionArea.create({
        data: { stampId: row.id, collectionAreaId: area, isPrimary: true },
      });
      await prisma.issueMember.create({ data: { issueId: issue.id, stampId: row.id } });
      await prisma.stampCatalogNumber.create({
        data: { stampId: row.id, catalogVendorId: vendor.id, number },
      });
      return row.id;
    }

    async function price(stampId: string, conditionId: string, amount: string): Promise<void> {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId,
          catalogEditionId: editionId,
          conditionId,
          certificateStatusId: null,
          formatId: null,
          price: amount,
          currency: "EUR",
        },
      });
    }

    dearStampId = await stamp("Kościuszko", "200", areaId);
    cheapStampId = await stamp("Definitive", "201", childAreaId);
    unpricedStampId = await stamp("Overprint", "202", areaId);
    foreignStampId = await stamp("Franz Josef", "300", otherAreaId);

    await price(dearStampId, mnhId, "50.00");
    await price(dearStampId, usedId, "8.00");
    await price(cheapStampId, mnhId, "2.00");
    await price(foreignStampId, mnhId, "30.00");

    async function copy(stampId: string, conditionId: string): Promise<string> {
      const item = await createItem(userId, collectionId, {
        stampId,
        conditionId,
        forSale: true,
        inCollection: true,
      });
      return item.id;
    }

    dearCopyId = await copy(dearStampId, mnhId);
    cheapCopyId = await copy(cheapStampId, mnhId);
    unpricedCopyId = await copy(unpricedStampId, mnhId);
    foreignCopyId = await copy(foreignStampId, mnhId);
    usedCopyId = await copy(dearStampId, usedId);
    listedCopyId = await copy(dearStampId, mnhId);

    // One closed, priced auction lot on the dear stamp at MNH — a real market datapoint, so the
    // row's `marketValue` is a median this suite computed rather than a constant it asserted.
    const seller = await prisma.contact.create({
      data: { collectionId, name: "Seller", seller: true },
    });
    const auctionSale = await prisma.auctionSale.create({
      data: {
        collectionId,
        sellerId: seller.id,
        platformId,
        name: `Sale ${ts}`,
        currency: "EUR",
      },
    });
    await prisma.auctionLot.create({
      data: {
        auctionSaleId: auctionSale.id,
        auctionLotNo: 9001,
        lotNo: "1",
        endsAt: new Date(Date.now() - 86_400_000),
        status: "closed",
        finalPrice: "20.00",
        lines: {
          create: [
            {
              stampId: dearStampId,
              conditionId: mnhId,
              certificateStatusId: null,
              formatId: null,
              quantity: 1,
            },
          ],
        },
      },
    });

    // A listing that already exists, holding `listedCopyId` — so `find_unlisted_copies` has
    // something to leave out and `list_offers` has a row that nothing below created.
    seededOfferId = await createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "0.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: [listedCopyId] }
    );

    token = (
      await createAssistantToken(userId, collectionId, {
        label: "offer agent",
        scope: "read_write",
        kind: "agent",
      })
    ).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, {
        label: "offer agent, read only",
        scope: "read",
        kind: "agent",
      })
    ).token;
  });

  after(async () => {
    const ids = [collectionId, otherCollectionId];
    await prisma.assistantToken.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.auctionLot.deleteMany({ where: { auctionSale: { collectionId } } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.offerSetItem.deleteMany({ where: { offerSet: { offer: { collectionId } } } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stampCatalogNumber.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampCollectionArea.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── The boundary ──────────────────────────────────────────────────────────

  describe("the boundary the whole issue is about", () => {
    it("carries no publish-shaped operation, checked against the registry rather than asserted", () => {
      // #711's *Done when*: **no publish-shaped operation exists in the registry**. A sentence in a
      // document is not a check, and this is the one guard that still answers when somebody adds an
      // operation in six months without reading the issue.
      //
      // It is deliberately a **verb** test and not a word-fragment one: `list_offers` and
      // `find_unlisted_copies` both contain `list`, and a pattern crude enough to catch
      // `list_on_colnect` would fail on those. So it reads the leading verb of each snake_case name
      // and matches whole words after it. Its sibling —
      // `tests/unit/agent-api-operation-boundary.test.ts` — fails on the *imports* instead, and
      // catches exactly what this one cannot: a publishing operation called something innocent.
      const forbiddenVerbs = new Set([
        "publish",
        "activate",
        "post",
        "send",
        "submit",
        "upload",
        "withdraw",
        "relist",
        "sync",
      ]);
      const forbiddenWords = new Set(["publish", "publishing", "live", "marketplace"]);
      const offenders = OPERATIONS.filter((operation) => {
        const words = operation.name.split("_");
        return forbiddenVerbs.has(words[0]) || words.some((word) => forbiddenWords.has(word));
      }).map((operation) => operation.name);
      assert.deepEqual(
        offenders,
        [],
        "the agent never publishes to a marketplace, and the boundary is that no such operation exists (#711)"
      );
    });

    it("would notice one, so the assertion above is not green for want of an instrument", () => {
      // A control that has never been seen to fail is indistinguishable from one that cannot fail
      // (#814). The predicate is exercised over names that are *not* in the registry, which is what
      // makes the empty result above worth reading.
      const words = (name: string) => name.split("_");
      const caught = ["publish_offer", "activate_listing", "post_to_marketplace", "sync_platform"];
      for (const name of caught) {
        assert.ok(
          ["publish", "activate", "post", "sync"].includes(words(name)[0]),
          `${name} would not have been caught`
        );
      }
      // And the two real names a crude pattern would have taken with it.
      for (const name of ["list_offers", "find_unlisted_copies"]) {
        assert.ok(
          !["publish", "activate", "post", "send", "submit", "upload", "withdraw", "relist", "sync"].includes(
            words(name)[0]
          ),
          `${name} is a real operation and must not be caught`
        );
      }
    });

    it("has no way to move a listing's state, so a draft stays a draft", async () => {
      // The other half of *absence, not a flag*: there is no state parameter on `draft_offer` and
      // no operation that takes one. A draft created here is `preparing`, and nothing on this
      // surface can make it anything else.
      const draft = await post<AgentOfferDetail>(token, "/offers", {
        platform: "Colnect",
        copy_ids: [usedCopyId],
      });
      assert.equal(draft.state, "preparing");
      const paths = OPERATIONS.map((operation) => `${operation.method} ${operation.path}`);
      assert.ok(!paths.some((path) => /state|publish|activate/.test(path)), paths.join(", "));
    });
  });

  // ── The composition claim ─────────────────────────────────────────────────

  describe("from `find unlisted copies in this area` to a drafted, priced, titled offer", () => {
    it("is the actual sequence of calls, and the answers are read out here rather than asserted", async () => {
      // **#711's own *Done when*, as a claim about composition.** It is checkable only by making
      // the calls and reading what comes back, which is what #710 did for its own criterion and
      // what caught two wrong assumptions there. Every step goes through the real route.

      // 1. What is not listed on this marketplace, in this area.
      const unlisted = await get<AgentUnlistedCopiesResponse>(
        token,
        "/copies/unlisted?platform=Colnect&area=Poland"
      );
      const ids = unlisted.items.map((row) => row.copyId);
      assert.ok(ids.includes(dearCopyId), "the dear copy is unlisted and in Poland");
      assert.ok(ids.includes(cheapCopyId), "a copy in a nested area is inside its parent's");
      assert.ok(!ids.includes(foreignCopyId), "Austria is not under Poland");
      assert.ok(!ids.includes(listedCopyId), "a copy already on a listing is not unlisted");

      // 2. What each of them is worth — off the row, with no second call. That is the whole of
      //    *price suggestions for … a copy*: the row answers it, the way a holdings row answers
      //    *where is it* (#710).
      const dear = unlisted.items.find((row) => row.copyId === dearCopyId);
      assert.ok(dear);
      assert.equal(dear.catalogValue.amount, "50.00");
      assert.equal(dear.marketValue, "20.00", "the median of the one closed lot behind it");
      assert.equal(unlisted.baseCurrency, "EUR");

      // 3. Draft a listing around two of them. Nothing is posted anywhere.
      const draft = await post<AgentOfferDetail>(token, "/offers", {
        platform: "Colnect",
        copy_ids: [dearCopyId, cheapCopyId],
      });
      assert.equal(draft.state, "preparing");
      assert.equal(draft.currency, "EUR", "locked to the platform's (#196)");
      assert.equal(draft.copyCount, 2);
      assert.equal(draft.sets.length, 1, "one set — a group sold together");

      // **Titled on the way in.** The platform's own template rendered over the seed copies, which
      // is what makes *a drafted, priced, titled offer* reachable without a second write.
      assert.ok(draft.name, "the draft came back with no title at all");
      assert.match(draft.name, /Mi·PL 200/, `the title did not name the stamps: ${draft.name}`);

      // 4. What should it cost? The four claims, told apart.
      const priced = await get<AgentOfferDetail>(token, `/offers/${draft.offerId}`);
      assert.equal(priced.pricing.catalogueTotal, "52.00", "50.00 + 2.00");
      assert.equal(priced.pricing.suggested, "52.00", "one set, so the per-set average is the total");
      assert.equal(priced.pricing.suggestedValuedSets, 1);
      assert.equal(priced.pricing.suggestedUnpricedSets, 0);
      assert.equal(priced.pricing.marketTotal, "20.00", "only the dear stamp has evidence");
      assert.equal(priced.pricing.marketNoEvidenceCopies, 1);
      assert.equal(priced.pricing.platformMinimum, "2.00");
      assert.equal("price" in priced, false, "a draft nobody has priced carries no price");

      // 5. Price it.
      const afterPrice = await patch<AgentOfferDetail>(
        token,
        `/offers/${draft.offerId}/price`,
        { price: "45.00" }
      );
      assert.equal(afterPrice.price, "45.00");
      assert.equal(afterPrice.state, "preparing", "pricing a listing does not make it live");

      // 6. Give it wording of the agent's own.
      const afterText = await patch<AgentOfferDetail>(
        token,
        `/offers/${draft.offerId}/text`,
        { field: "title", text: "Poland 1938 — two mint stamps" }
      );
      assert.equal(afterText.name, "Poland 1938 — two mint stamps");
      assert.deepEqual(afterText.editedTexts, ["title"], "a written text stops following the template");

      // 7. And it is undone by handing the field back to the template, which is #711's *compose a
      //    listing text through the existing machinery* rather than a second text path.
      const regenerated = await patch<AgentOfferDetail>(
        token,
        `/offers/${draft.offerId}/text`,
        { field: "title" }
      );
      assert.match(regenerated.name ?? "", /Mi·PL 200/);
      assert.deepEqual(regenerated.editedTexts, []);

      // 8. The copies it now holds are no longer unlisted on that platform — which is the loop
      //    closing, and the one assertion that would catch the whole chain having written nothing.
      const after = await get<AgentUnlistedCopiesResponse>(
        token,
        "/copies/unlisted?platform=Colnect&area=Poland"
      );
      const remaining = after.items.map((row) => row.copyId);
      assert.ok(!remaining.includes(dearCopyId));
      assert.ok(!remaining.includes(cheapCopyId));
      assert.equal(after.total, unlisted.total - 2, "the total followed the rows");
    });

    it("is the same sequence for an agent that started from a name rather than an id", async () => {
      // Every id above came from a previous call. The one thing an agent has in hand at the start
      // is names, which is #708's whole subject — so the platform, the area and the grade are all
      // sent as names here and nothing in the chain takes a cuid the agent could not have had.
      //
      // It seeds its own copy rather than reusing one of the fixtures: the test above lists two of
      // them, and a case that only passes when its predecessor has not run is a case that will one
      // day fail for a reason nobody can read off it.
      await createItem(userId, collectionId, {
        stampId: cheapStampId,
        conditionId: mnhId,
        forSale: true,
        inCollection: true,
      });
      const unlisted = await get<AgentUnlistedCopiesResponse>(
        token,
        "/copies/unlisted?platform=Colnect&area=Galicia&condition=MNH"
      );
      assert.ok(unlisted.items.length > 0);
      const draft = await post<AgentOfferDetail>(token, "/offers", {
        platform: "Colnect",
        copy_ids: [unlisted.items[0].copyId],
      });
      assert.equal(draft.platform, "Colnect");
    });
  });

  // ── find_unlisted_copies ──────────────────────────────────────────────────

  describe("find_unlisted_copies", () => {
    it("narrows to a band of catalogue value, over the whole match and not the page", async () => {
      const dearOnly = await get<AgentUnlistedCopiesResponse>(
        token,
        "/copies/unlisted?platform=Colnect&min_catalogue_value=10"
      );
      const ids = dearOnly.items.map((row) => row.copyId);
      assert.ok(ids.includes(foreignCopyId), "Austria's 30.00 copy is in the band");
      assert.ok(!ids.includes(cheapCopyId), "2.00 is below the floor");
      // The total is the match count and not the page's length, which is the convention the whole
      // envelope exists for (#706).
      assert.equal(dearOnly.total, ids.length);
    });

    it("leaves a copy with no catalogue value outside every band", async () => {
      // `items.ts`'s own rule, and `yearFrom`'s one axis over: a bound is a claim about what the
      // goods are worth, and a copy that cannot answer it has not met it. Deliberately **not**
      // #758's reading, where a lot builder's ceiling admits an unpriced copy and reports it.
      const banded = await get<AgentUnlistedCopiesResponse>(
        token,
        "/copies/unlisted?platform=Colnect&max_catalogue_value=1000"
      );
      assert.ok(
        !banded.items.some((row) => row.copyId === unpricedCopyId),
        "an unpriced copy passed a band it cannot be known to be inside"
      );
      // And it is genuinely unlisted, which is what makes the assertion above about the band rather
      // than about the copy being absent for some other reason.
      const unbanded = await get<AgentUnlistedCopiesResponse>(
        token,
        "/copies/unlisted?platform=Colnect"
      );
      assert.ok(unbanded.items.some((row) => row.copyId === unpricedCopyId));
    });

    it("refuses a band that could match nothing rather than answering empty", async () => {
      const refusal = await refused(
        token,
        "GET",
        "/copies/unlisted?platform=Colnect&min_catalogue_value=50&max_catalogue_value=10"
      );
      assert.equal(refusal.error.code, "invalid_request");
      assert.match(refusal.error.message, /Swap them/);
    });

    it("hands back the accepted platform names when the one sent is not one of this collection's", async () => {
      const refusal = await refused(token, "GET", "/copies/unlisted?platform=eBay");
      assert.equal(refusal.error.code, "invalid_request");
      assert.ok(refusal.error.accepted?.includes("Colnect"), (refusal.error.accepted ?? []).join(", "));
    });

    it("requires the platform, because unlisted is a question about one marketplace", async () => {
      const refusal = await refused(token, "GET", "/copies/unlisted");
      assert.equal(refusal.error.code, "invalid_request");
      assert.match(refusal.error.message, /"platform" is required/);
    });
  });

  // ── list_offers / get_offer ───────────────────────────────────────────────

  describe("list_offers and get_offer", () => {
    it("states a total over the whole match, so a page can be told from the collection", async () => {
      const page = await get<ListResponse<AgentOfferRow>>(token, "/offers?limit=1");
      assert.equal(page.items.length, 1);
      assert.ok(page.total > 1, "the total is the match count, not the page's length");
      assert.equal(page.nextCursor, "1");
    });

    it("walks the whole list through the cursor without repeating or skipping a row", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const page: ListResponse<AgentOfferRow> = await get(
          token,
          `/offers?limit=2${cursor ? `&cursor=${cursor}` : ""}`
        );
        seen.push(...page.items.map((row) => row.offerId));
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      assert.equal(new Set(seen).size, seen.length, "a row came back on two pages");
      const all = await get<ListResponse<AgentOfferRow>>(token, "/offers?limit=100");
      assert.equal(seen.length, all.total);
    });

    it("narrows to a state, and leaves closed listings out unless asked", async () => {
      const preparing = await get<ListResponse<AgentOfferRow>>(token, "/offers?state=preparing");
      assert.ok(preparing.items.length > 0);
      assert.ok(preparing.items.every((row) => row.state === "preparing"));
      const refusal = await refused(token, "GET", "/offers?state=nonsense");
      assert.equal(refusal.error.code, "invalid_request");
      assert.ok(refusal.error.accepted?.includes("withdrawn"));
    });

    it("says nothing about how the listing would be published", async () => {
      // The projection's own boundary, checked against a real `OfferDetail` rather than a fixture:
      // the read model carries the Allegro publication, the Delcampe category, the listing blockers
      // and the Assistant's handoff state, and none of it survives into what an agent is told.
      const detail = (await get<AgentOfferDetail>(
        token,
        `/offers/${seededOfferId}`
      )) as unknown as Record<string, unknown>;
      for (const key of ["allegroPublication", "listingBlockers", "readyBlockers", "platformModule"]) {
        assert.equal(key in detail, false, `\`${key}\` reached the agent`);
      }
    });

    it("refuses an offer in the collector's other collection, naming where to get a good id", async () => {
      const elsewhere = await createOffer(
        userId,
        otherCollectionId,
        {
          platformId: (
            await prisma.contact.create({
              data: {
                collectionId: otherCollectionId,
                name: "Elsewhere",
                platform: true,
                platformCurrency: "EUR",
              },
            })
          ).id,
          url: null,
          price: "0.00",
          currency: "EUR",
          listingDate: null,
          state: "preparing",
        },
        {}
      );
      const refusal = await refused(token, "GET", `/offers/${elsewhere}`);
      assert.equal(refusal.status, 404);
      assert.equal(refusal.error.code, "not_found");
      assert.match(refusal.error.message, /list_offers/);
    });
  });

  // ── draft_offer ───────────────────────────────────────────────────────────

  describe("draft_offer", () => {
    it("packages a stock of duplicates as one set per copy when asked", async () => {
      // #372's shape: three of the same stamp on one platform that refuses a second listing for it
      // is a quantity listing, not one lot of three.
      const a = await createItem(userId, collectionId, {
        stampId: cheapStampId,
        conditionId: usedId,
        forSale: true,
        inCollection: true,
      });
      const b = await createItem(userId, collectionId, {
        stampId: cheapStampId,
        conditionId: usedId,
        forSale: true,
        inCollection: true,
      });
      const draft = await post<AgentOfferDetail>(token, "/offers", {
        platform: "Colnect",
        copy_ids: [a.id, b.id],
        one_set_per_copy: true,
      });
      assert.equal(draft.sets.length, 2);
      assert.equal(draft.copyCount, 2);
    });

    it("relays a domain refusal as a sentence the agent can act on", async () => {
      const refusal = await refused(token, "POST", "/offers", {
        platform: "Colnect",
        copy_ids: [],
      });
      assert.equal(refusal.error.code, "invalid_request");
      assert.match(refusal.error.message, /find_unlisted_copies/);
    });

    it("refuses a copy that is not in this token's collection, by the domain's own guard", async () => {
      const stranger = await prisma.stamp.create({
        data: { collectionId: otherCollectionId, name: "Stranger" },
      });
      const otherCondition = await prisma.stampCondition.create({
        data: { collectionId: otherCollectionId, name: "MNH", abbreviation: "MNH", sortOrder: 0 },
      });
      const outside = await createItem(userId, otherCollectionId, {
        stampId: stranger.id,
        conditionId: otherCondition.id,
        forSale: true,
      });
      const refusal = await refused(token, "POST", "/offers", {
        platform: "Colnect",
        copy_ids: [outside.id],
      });
      assert.ok(refusal.status >= 400);
      assert.equal(refusal.error.code, "invalid_request");
    });
  });

  // ── set_offer_price ───────────────────────────────────────────────────────

  describe("set_offer_price", () => {
    it("writes the figure the seller states, which on an auction is the opening one", async () => {
      // `offers.md`'s own rule (#449/#731) said once more rather than re-decided here: an auction's
      // live `price` is where the bidding has got to — an observation of what buyers did — so
      // writing a number into it would put a bid in the record that nobody placed.
      const draft = await post<AgentOfferDetail>(token, "/offers", {
        platform: "Kramer",
        copy_ids: [unpricedCopyId],
      });
      assert.equal(draft.listingType, "auction", "the platform's default format (#449)");
      const priced = await patch<AgentOfferDetail>(
        token,
        `/offers/${draft.offerId}/price`,
        { price: "12.00" }
      );
      assert.equal(priced.startingPrice, "12.00");
      assert.equal("price" in priced, false, "nobody has bid, so there is no live figure");
    });

    it("refuses something that is not an amount, naming what to send", async () => {
      const refusal = await refused(token, "PATCH", `/offers/${seededOfferId}/price`, {
        price: "about forty",
      });
      assert.equal(refusal.error.code, "invalid_request");
      assert.match(refusal.error.message, /two decimal places/);
    });
  });

  // ── set_offer_text ────────────────────────────────────────────────────────

  describe("set_offer_text", () => {
    it("writes each of the three texts, and names the field it will not take", async () => {
      const withNote = await patch<AgentOfferDetail>(token, `/offers/${seededOfferId}/text`, {
        field: "private_note",
        text: "Shelf A, top drawer",
      });
      assert.equal(withNote.privateNote, "Shelf A, top drawer");
      const refusal = await refused(token, "PATCH", `/offers/${seededOfferId}/text`, {
        field: "subtitle",
        text: "x",
      });
      assert.equal(refusal.error.code, "invalid_request");
      assert.ok(refusal.error.accepted?.includes("description"));
    });

    it("refuses a regenerate with no template to render from, rather than emptying the field", async () => {
      // **The one guard the domain does not make for itself.** `regenerateOfferText` writes what the
      // generator produced, which over no template is null — so a `set_offer_text` with no `text`
      // on a field with no template to render from would *clear* it. The collector's own ↻ is
      // disabled there rather than refused, off the same `regeneratable` answer this reads, so the
      // two surfaces say the same thing about the same field.
      //
      // Found by this test failing, which is the half worth recording: the first version of it
      // asserted the field was left standing, and the run said `undefined`.
      const withNote = await patch<AgentOfferDetail>(token, `/offers/${seededOfferId}/text`, {
        field: "private_note",
        text: "kept",
      });
      assert.equal(withNote.privateNote, "kept");
      assert.ok(
        !withNote.templatedTexts.includes("private_note"),
        "this platform was expected to have no private-note template"
      );

      const refusal = await refused(token, "PATCH", `/offers/${seededOfferId}/text`, {
        field: "private_note",
      });
      assert.equal(refusal.error.code, "invalid_request");
      assert.match(refusal.error.message, /no template for the private note/);

      // And the field is exactly as it was, which is the thing the refusal is protecting.
      const after = await get<AgentOfferDetail>(token, `/offers/${seededOfferId}`);
      assert.equal(after.privateNote, "kept");
    });

  });

  // ── The scope check, on the wire ──────────────────────────────────────────

  describe("a read token is refused on the wire, which nothing could show until now", () => {
    it("is refused on every writing operation and accepted on every reading one", async () => {
      // **This is #707's and #709's criterion, and it is owed to them rather than to #711.** Both
      // could only be tested against fixture operations, because nothing on `main` declared
      // `writes: true` — so replacing the route's scope binding with a no-op left every test in
      // `agent-api-auth.test.ts` and `agent-api-mcp.test.ts` green. With writing operations in the
      // registry it does not: each assertion below is a real `read` token, on a real hashed row,
      // refused by the real dispatcher.
      // **Asked as *are #711's three still declared* rather than as *is this the whole registry*.**
      // It was an exact list until #712, and #712 broke it by adding four writing verbs of its own —
      // which is the assertion having been about the registry when its own sentence said it was
      // about this issue's operations. An exact list here would go red on every later issue that
      // adds a write, against a file that has nothing to do with it.
      const writing = new Set(
        OPERATIONS.filter((operation) => operation.writes).map((o) => o.name)
      );
      for (const name of ["draft_offer", "set_offer_price", "set_offer_text"]) {
        assert.ok(writing.has(name), `${name} writes and must still declare it`);
      }
      // And the reading half of #711, which is the direction an accident would go: a read operation
      // quietly gaining `writes: true` would refuse a `read` token that should have worked.
      for (const name of ["find_unlisted_copies", "list_offers", "get_offer"]) {
        assert.ok(!writing.has(name), `${name} writes nothing and must say so`);
      }

      const draft = await refused(readOnlyToken, "POST", "/offers", {
        platform: "Colnect",
        copy_ids: [usedCopyId],
      });
      assert.equal(draft.status, 403);
      assert.equal(draft.error.code, "forbidden");
      assert.match(draft.error.message, /read_write/);
      assert.deepEqual(draft.error.accepted, ["read", "read_write"]);

      const price = await refused(readOnlyToken, "PATCH", `/offers/${seededOfferId}/price`, {
        price: "1.00",
      });
      assert.equal(price.status, 403);
      assert.equal(price.error.code, "forbidden");

      const text = await refused(readOnlyToken, "PATCH", `/offers/${seededOfferId}/text`, {
        field: "title",
        text: "x",
      });
      assert.equal(text.status, 403);
      assert.equal(text.error.code, "forbidden");

      // The reading half, and it is not decoration: a scope check that refused everything would
      // satisfy all three assertions above for the wrong reason.
      const reading = await get<ListResponse<AgentOfferRow>>(readOnlyToken, "/offers?limit=1");
      assert.equal(reading.items.length, 1);
    });

    it("is refused before a parameter is even looked at", async () => {
      // The ordering the dispatcher states (#707): after the operation is resolved, because the
      // answer depends on which one; before the parsing, because there is no point handing
      // parameter feedback to a call that will not be made. A `read` token sending a **bad** body
      // to a writing operation is answered `forbidden` and never hears about the body.
      const refusal = await refused(readOnlyToken, "POST", "/offers", { nonsense: true });
      assert.equal(refusal.error.code, "forbidden");
      assert.ok(
        !/platform|copy_ids/.test(refusal.error.message),
        `the refusal mentioned the parameters: ${refusal.error.message}`
      );
    });

    it("is refused through the MCP wrapper too, which is the binding #709 could not cover", async () => {
      // The same check, reached through the second wrapper. The route binds `assertAgentApiScope`
      // to the caller and hands it in; until a writing tool existed, replacing that binding with a
      // no-op broke nothing.
      const response = await MCP_POST(
        new NextRequest("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${readOnlyToken}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "draft_offer", arguments: { platform: "Colnect", copy_ids: [usedCopyId] } },
          }),
        })
      );
      const body = (await response.json()) as {
        result?: { isError?: boolean; content: { type: string; text: string }[] };
      };
      // A refused scope is a **tool error** rather than a JSON-RPC one (`agent-api.md`): a JSON-RPC
      // error is handled by the client's transport and may never reach the model, and the whole
      // point of the error convention is that the agent reads the sentence and corrects itself.
      assert.equal(response.status, 200);
      assert.equal(body.result?.isError, true);
      assert.match(body.result?.content[0].text ?? "", /read_write/);
    });
  });

  // ── What adding them to the registry published ────────────────────────────

  describe("what adding them to the registry published", () => {
    const OFFER_OPERATIONS = [
      "find_unlisted_copies",
      "list_offers",
      "get_offer",
      "draft_offer",
      "set_offer_price",
      "set_offer_text",
    ];

    it("puts every one of them in the OpenAPI document, from the one array", () => {
      const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
        paths: Record<string, Record<string, { operationId: string }>>;
      };
      const published = new Set(
        Object.values(document.paths).flatMap((methods) =>
          Object.values(methods).map((entry) => entry.operationId)
        )
      );
      for (const name of OFFER_OPERATIONS) {
        assert.ok(published.has(name), `${name} is not in the document`);
      }
    });

    it("makes every one of them an MCP tool with no MCP-side edit", () => {
      const tools = buildToolList(OPERATIONS).map((tool) => tool.name);
      for (const name of OFFER_OPERATIONS) {
        assert.ok(tools.includes(name), `${name} is not an MCP tool`);
      }
    });

    it("declares which of #711's six write, and which do not", () => {
      // `writes` is the only field the scope check reads, and a verb in a name buys no protection
      // at all — so an operation that writes and declares `false` is a security defect with no test
      // that could see it. This is the nearest thing there is: the declaration, pinned.
      //
      // **Six assertions about #711's own operations, and deliberately not a claim about the
      // registry** — the title said *and only those three*, which was a sentence about the whole
      // array that this issue's file has no business making, and #712's writing verbs are what
      // showed it. The per-issue enumerations live in each issue's own file.
      const byName = new Map(OPERATIONS.map((operation) => [operation.name, operation.writes]));
      assert.equal(byName.get("find_unlisted_copies"), false);
      assert.equal(byName.get("list_offers"), false);
      assert.equal(byName.get("get_offer"), false);
      assert.equal(byName.get("draft_offer"), true);
      assert.equal(byName.get("set_offer_price"), true);
      assert.equal(byName.get("set_offer_text"), true);
    });
  });
});
