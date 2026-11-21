import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createOffer, setOfferState, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost } from "../../src/lib/facebook-posts";
import { addProposalLots, createProposal, createProposalFromPost, getDirectPlatform, moveProposal } from "../../src/lib/proposals";
import { createProposalShareToken } from "../../src/lib/proposal-handout";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET } from "../../src/app/api/v1/[...path]/route";
import type { AgentProposalDeletion } from "../../src/lib/agent-api/proposal-reads";
import type { AgentProposalDeleted } from "../../src/lib/agent-api/operations/proposals";

// **Deleting a proposal through the agent API (#2642)**, driven through the real route with real
// tokens: `preview_proposal_delete` is *Delete proposal…*'s read and changes nothing, and
// `delete_proposal` is its write (#2641) — the lots go with the proposal, a sold one is refused with
// the app's sentence, and a post's lots stay in the post. `tests/integration/proposal-delete.test.ts`
// holds the domain's rules; `tests/unit/agent-api-proposal-reads.test.ts` the projection.

const ts = Date.now();

type Method = "GET" | "DELETE";
const HANDLERS = { GET, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string };
}

async function call(token: string, method: Method, path: string): Promise<{ status: number; body: unknown }> {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  const response = await HANDLERS[method](request, { params: Promise.resolve({ path: path.split("/").filter(Boolean) }) });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, method: Method, path: string): Promise<T> {
  const answer = await call(token, method, path);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string): Promise<{ status: number; code: string; message: string }> {
  const answer = await call(token, method, path);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  const { code, message } = (answer.body as ApiErrorBody).error;
  return { status: answer.status, code, message };
}

describe("deleting a proposal through the agent API (#2642)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let conditionId: string;
  let directId: string;
  let facebookId: string;
  let groupId: string;
  let nextStamp = 0;
  let nextContact = 0;

  async function copy(): Promise<string> {
    nextStamp += 1;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${nextStamp}` } })).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  async function contact(): Promise<string> {
    nextContact += 1;
    return (await prisma.contact.create({ data: { collectionId, name: `Buyer ${nextContact}`, buyer: true } })).id;
  }

  /** A proposal of `count` fresh Direct lots, each one copy. */
  async function proposalOf(count: number) {
    const lots: { offerId: string; itemId: string }[] = [];
    for (let i = 0; i < count; i++) {
      const itemId = await copy();
      const offerId = await createOffer(
        userId,
        collectionId,
        { platformId: directId, url: null, price: "5.00", startingPrice: null, currency: "PLN", listingDate: null },
        { seedItemIds: [itemId] }
      );
      lots.push({ offerId, itemId });
    }
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, await contact());
    await addProposalLots(userId, proposalId, lots.map((l) => l.offerId));
    return { proposalId, proposalNo, lots };
  }

  /** A Ready Facebook offer of one fresh copy. */
  async function facebookLot(): Promise<string> {
    const input: OfferInput & NewOfferInput = {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "PLN",
      listingDate: null,
      facebookGroupId: groupId,
      startingPrice: "3.00",
    };
    const offerId = await createOffer(userId, collectionId, input, { seedItemIds: [await copy()] });
    await prisma.offer.update({ where: { id: offerId }, data: { price: "3.00" } });
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  before(async () => {
    userId = `test-user-api-proposal-delete-${ts}`;
    await prisma.user.create({
      data: { id: userId, name: `Test User ${userId}`, email: `${userId}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-api-proposal-delete-${ts}`, name: "API proposal delete", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    facebookId = (await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    directId = (await getDirectPlatform(collectionId)).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/2642",
      })
    ).id;
    token = (await createAssistantToken(userId, collectionId, { label: "proposal agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "proposal agent, read", scope: "read", kind: "agent" })
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

  it("carries the preview as a read and the delete as a write", () => {
    const preview = OPERATIONS.find((op) => op.name === "preview_proposal_delete");
    const remove = OPERATIONS.find((op) => op.name === "delete_proposal");
    assert.deepEqual([preview?.method, preview?.path, preview?.writes], ["GET", "/proposals/{proposal}/deletion", false]);
    assert.deepEqual([remove?.method, remove?.path, remove?.writes], ["DELETE", "/proposals/{proposal}", true]);
  });

  it("deletes a Preparing proposal of 5 lots with its 5 offers, as the app does, after a preview that changes nothing", async () => {
    const { proposalId, proposalNo, lots } = await proposalOf(5);

    const preview = await ok<AgentProposalDeletion>(readOnlyToken, "GET", `/proposals/${proposalNo}/deletion`);
    assert.equal(preview.id, proposalId);
    assert.equal(preview.status, "preparing");
    assert.equal(preview.deletable, true);
    assert.equal(preview.lotsDeleted, 5);
    assert.equal(preview.soldLotsKept, 0);
    assert.equal(preview.post, null);
    assert.equal(preview.linkStopsWorking, false);
    assert.match(preview.confirmation[0], new RegExp(`Proposal #${proposalNo} for ${preview.contactName} and all 5 of its lots`));
    assert.equal(await prisma.offer.count({ where: { proposalId } }), 5, "the preview deleted nothing");

    const answer = await ok<AgentProposalDeleted>(token, "DELETE", `/proposals/p${proposalNo}`);
    assert.deepEqual(answer.deleted, {
      id: proposalId,
      proposalNo,
      contactName: preview.contactName,
      lotsDeleted: 5,
      soldLotsKept: 0,
      post: null,
    });
    assert.equal(answer.message, `Proposal #${proposalNo} deleted with its 5 lots`);
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 0);
    assert.equal(await prisma.offer.count({ where: { id: { in: lots.map((l) => l.offerId) } } }), 0);
    assert.equal(await prisma.item.count({ where: { id: { in: lots.map((l) => l.itemId) } } }), 5, "the copies stay");

    const gone = await refused(token, "GET", `/proposals/${proposalNo}/deletion`);
    assert.equal(gone.status, 404);
  });

  it("says a sent proposal's live link stops working", async () => {
    const { proposalId } = await proposalOf(1);
    await moveProposal(userId, proposalId, "send");
    await createProposalShareToken(userId, proposalId);
    const preview = await ok<AgentProposalDeletion>(token, "GET", `/proposals/${proposalId}/deletion`);
    assert.equal(preview.linkStopsWorking, true);
    assert.ok(preview.confirmation.some((line) => /live link stops working/.test(line)));
    await ok<AgentProposalDeleted>(token, "DELETE", `/proposals/${proposalId}`);
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 0);
  });

  it("refuses a Sold proposal with the app's sentence, and deletes nothing", async () => {
    const { proposalId, proposalNo } = await proposalOf(2);
    await prisma.proposal.update({ where: { id: proposalId }, data: { status: "sold", closedAt: new Date() } });
    const sentence = "A sold proposal cannot be deleted — it is the record of how its sale came about.";

    const preview = await ok<AgentProposalDeletion>(token, "GET", `/proposals/${proposalNo}/deletion`);
    assert.equal(preview.deletable, false);
    assert.equal(preview.refusal, sentence);
    assert.deepEqual(preview.confirmation, []);

    const refusal = await refused(token, "DELETE", `/proposals/${proposalNo}`);
    assert.equal(refusal.code, "invalid_request");
    assert.equal(refusal.message, sentence);
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 1);
    assert.equal(await prisma.offer.count({ where: { proposalId } }), 2);
  });

  it("leaves a post's lots in place when deleting a proposal made from the post", async () => {
    const lots = [await facebookLot(), await facebookLot(), await facebookLot()];
    const { postId, postNo } = await createFacebookPost(userId, collectionId, lots, "Test post");
    const { proposalNo } = await createProposalFromPost(userId, postId, await contact());
    const before = await prisma.offer.findMany({
      where: { id: { in: lots } },
      orderBy: { facebookLotNo: "asc" },
      select: { id: true, state: true, facebookPostId: true, facebookLotNo: true, price: true },
    });

    const preview = await ok<AgentProposalDeletion>(token, "GET", `/proposals/${proposalNo}/deletion`);
    assert.equal(preview.lotsDeleted, 0);
    assert.deepEqual(preview.post, { postNo, lotsKept: 3 });

    const answer = await ok<AgentProposalDeleted>(token, "DELETE", `/proposals/${proposalNo}`);
    assert.equal(answer.deleted.lotsDeleted, 0);
    assert.deepEqual(answer.deleted.post, { postNo, lotsKept: 3 });
    assert.equal(answer.message, `Proposal #${proposalNo} deleted`);

    const after = await prisma.offer.findMany({
      where: { id: { in: lots } },
      orderBy: { facebookLotNo: "asc" },
      select: { id: true, state: true, facebookPostId: true, facebookLotNo: true, price: true, proposalId: true },
    });
    assert.deepEqual(
      after.map((l) => ({ id: l.id, state: l.state, facebookPostId: l.facebookPostId, facebookLotNo: l.facebookLotNo, price: l.price })),
      before
    );
    assert.ok(after.every((l) => l.proposalId === null));
  });

  it("refuses a read only token on the delete, and reads with one", async () => {
    const { proposalId, proposalNo } = await proposalOf(1);
    await ok<AgentProposalDeletion>(readOnlyToken, "GET", `/proposals/${proposalNo}/deletion`);
    const refusal = await refused(readOnlyToken, "DELETE", `/proposals/${proposalNo}`);
    assert.equal(refusal.status, 403);
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 1);
  });

  it("finds no proposal by a number this collection does not hold", async () => {
    const refusal = await refused(token, "DELETE", "/proposals/99999");
    assert.equal(refusal.status, 404);
  });
});
