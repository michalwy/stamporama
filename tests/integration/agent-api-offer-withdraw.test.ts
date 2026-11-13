import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, publishOfferOrPost } from "../../src/lib/facebook-posts";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { buildToolList } from "../../src/lib/agent-api/mcp";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import type {
  AgentOfferWithdrawResponse,
  AgentOfferWithdrawn,
  AgentUnlistedCopiesResponse,
} from "../../src/lib/agent-api/operations/offers";

// `withdraw_offer` (#2511), driven through the real route with a real token: the app's *Withdraw…*
// on the wire, one offer or several, each answered on its own, and Facebook's rules (#1779) — a lot
// of a post waiting for approval takes every pending lot of it along, a lot of a post that is up goes
// alone, a lot already withdrawn with its post is done.

const ts = Date.now();

function v1(token: string, method: string, path: string, body?: unknown) {
  const [pathname, search] = path.split("?");
  return {
    request: new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
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

async function get<T>(token: string, path: string): Promise<T> {
  const { request, context } = v1(token, "GET", path);
  const response = await GET(request, context);
  const body = await response.json();
  assert.equal(response.status, 200, `GET ${path} → ${JSON.stringify(body)}`);
  return body as T;
}

async function withdraw(token: string, offerIds: string[]): Promise<AgentOfferWithdrawResponse> {
  const { request, context } = v1(token, "POST", "/offers/withdraw", { offer_ids: offerIds });
  const response = await POST(request, context);
  const body = await response.json();
  assert.equal(response.status, 200, `POST /offers/withdraw → ${JSON.stringify(body)}`);
  return body as AgentOfferWithdrawResponse;
}

describe("withdraw_offer (#2511)", () => {
  let userId: string;
  let collectionId: string;
  let colnectId: string;
  let facebookId: string;
  let conditionId: string;
  let groupId: string;
  let token: string;
  let readOnlyToken: string;
  let n = 0;

  before(async () => {
    userId = `test-user-offerwd-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-offerwd-${ts}`, name: `offerwd-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    colnectId = (
      await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "PLN" } })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — wycofane",
        url: "https://www.facebook.com/groups/251101",
        postTemplate: "{title} od {startingPrice}",
        quickBuyTemplate: "{title} za {price}",
      })
    ).id;
    token = (
      await createAssistantToken(userId, collectionId, { label: "withdraw agent", scope: "read_write", kind: "agent" })
    ).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "withdraw agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function copy(): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: `Stamp ${Math.random()}` } });
    return (await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true })).id;
  }

  /** An active Colnect quick buy over one fresh copy, and that copy. */
  async function colnectOffer(): Promise<{ offerId: string; copyId: string }> {
    const copyId = await copy();
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId: colnectId, url: null, price: "10.00", currency: "PLN", listingDate: null },
      { seedItemIds: [copyId] }
    );
    await prisma.offer.update({ where: { id: offerId }, data: { state: "active" } });
    return { offerId, copyId };
  }

  /** A Ready Facebook auction over one fresh copy. */
  async function facebookOffer(): Promise<string> {
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: "5.00",
        currency: "PLN",
        listingDate: null,
        facebookGroupId: groupId,
        listingType: "auction",
        endsAt: new Date("2026-12-01T19:00:00Z"),
      },
      { seedItemIds: [await copy()] }
    );
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  async function facebookPost(status: "pending" | "active"): Promise<string[]> {
    const lots = [await facebookOffer(), await facebookOffer(), await facebookOffer()];
    await createFacebookPost(userId, collectionId, lots, `Post ${++n}`);
    const link =
      status === "pending"
        ? `https://www.facebook.com/groups/251101/pending_posts/${n}`
        : `https://www.facebook.com/groups/251101/posts/${n}`;
    await publishOfferOrPost(userId, lots[0], link, status);
    return lots;
  }

  const stateOf = async (id: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id }, select: { state: true } })).state;
  const numberOf = async (id: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id }, select: { offerNo: true } })).offerNo;
  const unlisted = async () =>
    (await get<AgentUnlistedCopiesResponse>(token, "/copies/unlisted?platform=Colnect&limit=100")).items.map(
      (row) => row.copyId
    );

  it("withdraws an active Colnect offer, and its copy can be listed again", async () => {
    const { offerId, copyId } = await colnectOffer();
    assert.ok(!(await unlisted()).includes(copyId), "a copy on an active listing is not unlisted");

    const answer = await withdraw(token, [offerId]);
    assert.deepEqual(
      { withdrawn: answer.withdrawn, unchanged: answer.unchanged, refused: answer.refused },
      { withdrawn: 1, unchanged: 0, refused: 0 }
    );
    const [item] = answer.offers as AgentOfferWithdrawn[];
    assert.equal(item.status, "withdrawn");
    assert.equal(item.state, "withdrawn");
    assert.equal(item.offerNo, await numberOf(offerId));
    assert.equal(item.withdrawnWith, undefined, "it went alone");
    assert.equal(await stateOf(offerId), "withdrawn");
    assert.ok((await unlisted()).includes(copyId), "the withdrawn listing's copy is free to list again");
  });

  it("on a lot of a post waiting for approval, withdraws every pending lot of the post and names them", async () => {
    const [a, b, c] = await facebookPost("pending");
    for (const id of [a, b, c]) assert.equal(await stateOf(id), "pending");

    const answer = await withdraw(token, [b]);
    const [item] = answer.offers as AgentOfferWithdrawn[];
    assert.equal(item.status, "withdrawn");
    assert.deepEqual(
      item.withdrawnWith,
      [
        { offerId: a, offerNo: await numberOf(a) },
        { offerId: c, offerNo: await numberOf(c) },
      ],
      "the other lots of the post went with it, in offer-number order"
    );
    for (const id of [a, b, c]) assert.equal(await stateOf(id), "withdrawn");

    // A lot already withdrawn with its post counts as done, not as an error.
    const again = await withdraw(token, [a]);
    assert.equal(again.unchanged, 1);
    assert.equal(again.refused, 0);
    const [done] = again.offers as AgentOfferWithdrawn[];
    assert.equal(done.status, "unchanged");
    assert.equal(done.state, "withdrawn");
  });

  it("on a lot of a post that is up, withdraws that lot alone and the post stays", async () => {
    const [a, b, c] = await facebookPost("active");
    const answer = await withdraw(token, [b]);
    const [item] = answer.offers as AgentOfferWithdrawn[];
    assert.equal(item.status, "withdrawn");
    assert.equal(item.withdrawnWith, undefined);
    assert.equal(await stateOf(b), "withdrawn");
    assert.equal(await stateOf(a), "active");
    assert.equal(await stateOf(c), "active");
  });

  it("changes nothing on a sold offer and says why", async () => {
    const { offerId } = await colnectOffer();
    await prisma.offer.update({ where: { id: offerId }, data: { state: "sold" } });
    const answer = await withdraw(token, [offerId]);
    assert.equal(answer.refused, 1);
    const [item] = answer.offers;
    assert.equal(item.status, "refused");
    assert.ok("reason" in item && /sold/.test(item.reason), JSON.stringify(item));
    assert.equal(await stateOf(offerId), "sold");
  });

  it("reports each of several offers on its own, a refusal stopping none of the others", async () => {
    const first = await colnectOffer();
    const sold = await colnectOffer();
    await prisma.offer.update({ where: { id: sold.offerId }, data: { state: "sold" } });
    const last = await colnectOffer();

    const answer = await withdraw(token, [first.offerId, "no-such-offer", sold.offerId, last.offerId]);
    assert.deepEqual(
      { withdrawn: answer.withdrawn, unchanged: answer.unchanged, refused: answer.refused },
      { withdrawn: 2, unchanged: 0, refused: 2 }
    );
    assert.deepEqual(
      answer.offers.map((item) => [item.index, item.offerId, item.status]),
      [
        [0, first.offerId, "withdrawn"],
        [1, "no-such-offer", "refused"],
        [2, sold.offerId, "refused"],
        [3, last.offerId, "withdrawn"],
      ]
    );
    assert.match((answer.offers[1] as { reason: string }).reason, /list_offers/);
    assert.equal(await stateOf(last.offerId), "withdrawn");
  });

  it("refuses an empty list, and a read-only token", async () => {
    const empty = v1(token, "POST", "/offers/withdraw", { offer_ids: [] });
    assert.equal((await POST(empty.request, empty.context)).status, 400);

    const { offerId } = await colnectOffer();
    const read = v1(readOnlyToken, "POST", "/offers/withdraw", { offer_ids: [offerId] });
    assert.equal((await POST(read.request, read.context)).status, 403);
    assert.equal(await stateOf(offerId), "active", "nothing moved");
  });

  it("is published from the one array, as a writing operation", () => {
    const operation = OPERATIONS.find((o) => o.name === "withdraw_offer");
    assert.ok(operation);
    assert.equal(operation.writes, true);
    const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    assert.equal(document.paths["/api/v1/offers/withdraw"]?.post?.operationId, "withdraw_offer");
    assert.ok(buildToolList(OPERATIONS).some((tool) => tool.name === "withdraw_offer"));
  });
});
