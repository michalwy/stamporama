import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost } from "../../src/lib/facebook-posts";
import { getDirectPlatform, getProposalScreen } from "../../src/lib/proposals";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentProposal, AgentProposalSaleOptions } from "../../src/lib/agent-api/proposal-reads";
import type { AgentFacebookPost } from "../../src/lib/agent-api/facebook-post-reads";
import type { AgentProposalConversion } from "../../src/lib/agent-api/operations/proposals";

// **A Facebook post made into a proposal through the agent API (#2608)**, driven through the real
// route with real tokens: `get_facebook_post` and `create_proposal_from_post`, and the proposal
// operations on a proposal made that way. The domain (#2602) is held by `proposal-from-post.test.ts`;
// this file holds that the API reaches it — the issue's *Done when* — and that its refusals are the
// app's.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string };
}

async function call(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; message: string }> {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, message: (answer.body as ApiErrorBody).error.message };
}

describe("a Facebook post made into a proposal through the agent API (#2608)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let facebookId: string;
  let directId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    userId = `test-user-postpropapi-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User postpropapi-${ts}`,
        email: `test-postpropapi-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-postpropapi-${ts}`, name: "Post proposals", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    directId = (await getDirectPlatform(collectionId)).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/123456",
      })
    ).id;
    await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski" } });
    await prisma.contact.create({ data: { collectionId, name: "Ewa Nowak" } });
    token = (await createAssistantToken(userId, collectionId, { label: "post agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "post agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.proposal.deleteMany({ where: { collectionId } });
    await prisma.facebookPost.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A Ready Facebook lot of one fresh copy, an auction opening at `price` — the group's default. */
  async function lotOffer(price: string): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: price,
        currency: "PLN",
        listingDate: null,
        facebookGroupId: groupId,
      },
      { seedItemIds: [item.id] }
    );
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  /** A post of `count` Ready lots, priced 10.00, 11.00, … in lot order. */
  async function post(count: number): Promise<{ postId: string; postNo: number; lots: string[] }> {
    const lots: string[] = [];
    for (let i = 0; i < count; i++) lots.push(await lotOffer(`${10 + i}.00`));
    const { postId, postNo } = await createFacebookPost(userId, collectionId, lots, "Poland 1950s");
    return { postId, postNo, lots };
  }

  it("makes a post of 12 lots into a proposal of the same 12 lots under the post's numbers, and sells lots 3 and 8 in the post", async () => {
    const { postId, postNo, lots } = await post(12);

    // The post read first: 12 lots by number, none in a proposal, nothing in the way of one.
    const before = await ok<AgentFacebookPost>(token, "GET", `/facebook-posts/${postNo}`);
    assert.equal(before.id, postId);
    assert.equal(before.group, "Znaczki — aukcje");
    assert.equal(before.stage, "ready");
    assert.equal(before.proposalRefusal, null);
    assert.equal(before.proposal, null);
    assert.deepEqual(
      before.lots.map((lot) => [lot.lotNo, lot.offerId, lot.price, lot.proposal]),
      lots.map((id, i) => [i + 1, id, `${10 + i}.00`, null])
    );

    // A read-only token reads the post but makes nothing of it.
    await ok<AgentFacebookPost>(readOnlyToken, "GET", `/facebook-posts/${postNo}`);
    const readOnly = await call(readOnlyToken, "POST", `/facebook-posts/${postNo}/proposal`, { contact: "Jan Kowalski" });
    assert.equal(readOnly.status, 403);

    const proposal = await ok<AgentProposal>(token, "POST", `/facebook-posts/${postNo}/proposal`, { contact: "Jan Kowalski" });
    assert.equal(proposal.status, "preparing");
    assert.equal(proposal.contact.name, "Jan Kowalski");
    assert.deepEqual(proposal.post, { id: postId, postNo, title: "Poland 1950s", group: "Znaczki — aukcje" });
    assert.deepEqual(
      proposal.lots.map((lot) => [lot.lotNo, lot.offerId]),
      lots.map((id, i) => [i + 1, id])
    );

    // Reading it again names the post and lists the same 12 lots with the post's numbers.
    const read = await ok<AgentProposal>(token, "GET", `/proposals/${proposal.proposalNo}`);
    assert.equal(read.post?.postNo, postNo);
    assert.deepEqual(read.lots.map((lot) => lot.lotNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Reading the post's lots says which proposal they are in.
    const after = await ok<AgentFacebookPost>(token, "GET", `/facebook-posts/${postId}`);
    assert.ok(after.lots.every((lot) => lot.proposal?.proposalNo === proposal.proposalNo && lot.proposal.status === "preparing"));
    assert.deepEqual(after.proposal, {
      id: proposal.id,
      proposalNo: proposal.proposalNo,
      contact: "Jan Kowalski",
      status: "preparing",
    });
    assert.match(after.proposalRefusal ?? "", new RegExp(`Proposal #${proposal.proposalNo} for Jan Kowalski is still open`));

    // A second proposal from the post is refused while this one is open, with the app's sentence.
    const second = await refused(token, "POST", `/facebook-posts/${postNo}/proposal`, { contact: "Ewa Nowak" });
    assert.equal(second.status, 400);
    assert.match(second.message, /is still open on this post — a post has one open proposal at a time/);

    // Its lots are the post's: added, made or taken out on the post, never on the proposal.
    const direct = await createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price: "5.00", currency: "PLN", listingDate: null },
      { seedItemIds: [(await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id] }
    );
    const add = await refused(token, "POST", `/proposals/${proposal.proposalNo}/lots`, { offers: [direct] });
    assert.match(add.message, new RegExp(`made from post #${postNo} — its lots are the post's`));
    const make = await refused(token, "POST", `/proposals/${proposal.proposalNo}/lots/new`, {
      copy_ids: [(await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id],
      packing: "each",
    });
    assert.match(make.message, /its lots are the post's/);
    const take = await refused(token, "DELETE", `/proposals/${proposal.proposalNo}/lots/4`);
    assert.match(take.message, /its lots are the post's/);
    assert.equal((await prisma.offer.count({ where: { proposalId: proposal.id } })), 12);

    // Converting: the options say where the sale goes and that the rest stay in the post.
    const options = await ok<AgentProposalSaleOptions>(token, "GET", `/proposals/${proposal.proposalNo}/sale-options`);
    assert.equal(options.newSalePlatform, "Facebook");
    assert.deepEqual(options.post, { postNo, group: "Znaczki — aukcje" });

    const conversion = await ok<AgentProposalConversion>(token, "POST", `/proposals/${proposal.proposalNo}/sale`, {
      lots: ["3", "8"],
      sale: "new",
    });
    assert.equal(conversion.proposal.status, "sold");
    assert.equal(conversion.sale.platform, "Facebook");
    const states = await prisma.offer.findMany({
      where: { id: { in: lots } },
      select: { id: true, state: true, facebookPostId: true, facebookLotNo: true },
    });
    const byLot = lots.map((id) => states.find((row) => row.id === id)!);
    // Lots 3 and 8 sold in the post; the other 10 still in it, open, numbered as before.
    assert.deepEqual(
      byLot.map((row) => row.state),
      lots.map((_, i) => (i === 2 || i === 7 ? "sold" : "ready"))
    );
    assert.ok(byLot.every((row, i) => row.facebookPostId === postId && row.facebookLotNo === i + 1));

    const screen = await getProposalScreen(userId, proposal.id);
    assert.equal(screen?.status, "sold");
    const postAfter = await ok<AgentFacebookPost>(token, "GET", `/facebook-posts/${postNo}`);
    assert.equal(postAfter.lots.filter((lot) => lot.state === "ready").length, 10);
    assert.equal(postAfter.proposalRefusal, null, "a sold proposal leaves the post free for the next one");
  });

  it("refuses a post that is up, with the app's sentence", async () => {
    const { postNo, lots } = await post(2);
    await prisma.offer.updateMany({
      where: { id: { in: lots } },
      data: { state: "active", facebookPostSnapshot: { text: "Up in the group" } },
    });
    const read = await ok<AgentFacebookPost>(token, "GET", `/facebook-posts/${postNo}`);
    assert.equal(read.stage, "up");
    assert.match(read.proposalRefusal ?? "", new RegExp(`Post #${postNo} is up`));
    const answer = await refused(token, "POST", `/facebook-posts/${postNo}/proposal`, { contact: "Jan Kowalski" });
    assert.equal(answer.status, 400);
    assert.match(answer.message, new RegExp(`Post #${postNo} is up — a proposal is made from a post before it goes up`));
    assert.equal(await prisma.proposal.count({ where: { collectionId, facebookPost: { postNo } } }), 0);
  });

  it("names an unknown post and an unknown contact rather than guessing", async () => {
    const missing = await refused(token, "GET", "/facebook-posts/99999");
    assert.equal(missing.status, 404);
    assert.match(missing.message, /No Facebook post #99999/);
    const { postNo } = await post(2);
    const nobody = await refused(token, "POST", `/facebook-posts/${postNo}/proposal`, { contact: "Nobody Here" });
    assert.ok(nobody.status >= 400);
    assert.equal(await prisma.proposal.count({ where: { collectionId, facebookPost: { postNo } } }), 0);
  });
});
