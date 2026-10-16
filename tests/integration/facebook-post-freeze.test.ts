import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, repostOffer, setOfferState, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup, updateFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS, type FacebookGroupValues } from "../../src/lib/facebook-group-rules";
import { freezeUnfrozenFacebookPosts, getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import { createFacebookPost, publishOfferOrPost, rejectOfferOrPost } from "../../src/lib/facebook-posts";
import { facebookPostSource, renderFacebookPostText } from "../../src/lib/facebook-post-rules";

// A published Facebook offer's post text is frozen (#1800): it follows the template until the offer
// first goes up — Pending or Active — and from then on reads as it was posted, whatever the template,
// the offer's own template or its figures do. A repost is a new publication, an offer back in Ready
// follows the template again, and an approval's closing time is the one figure that still moves. The
// pure half — drawing a frozen lot — is `tests/unit/facebook-post-rules.test.ts`.

const AUCTION = "{lot} {title} from {startingPrice}, ends {closesAt}\n{terms}";
const QUICK_BUY = "{lot} {title} for {price}";

function groupValues(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — aukcje",
    url: "https://www.facebook.com/groups/180000",
    postTemplate: AUCTION,
    quickBuyTemplate: QUICK_BUY,
    standingNote: "Shipping 5 PLN.",
    custom: ["postTemplate", "quickBuyTemplate", "standingNote"],
    ...overrides,
  };
}

describe("A published Facebook offer's post text is frozen (#1800)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbfreeze-${ts}`;
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
        data: { slug: `col-fbfreeze-${ts}`, name: `fbfreeze-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({
        data: { collectionId, name: "Facebook", platformCurrency: "PLN" },
      })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    groupId = (await createFacebookGroup(userId, collectionId, groupValues())).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  function input(overrides: Partial<OfferInput> = {}): OfferInput {
    return {
      platformId: facebookId,
      url: null,
      price: "0.00",
      startingPrice: "3.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
      facebookGroupId: groupId,
      ...overrides,
    };
  }

  async function offer(state: "preparing" | "ready" = "ready", overrides: Partial<OfferInput> = {}) {
    const id = await createOffer(userId, collectionId, input(overrides), { seedItemIds: [await newItem()] });
    if (state === "ready") await setOfferState(userId, id, "ready");
    return id;
  }

  /** The post text the offer's card draws, its closing time written as the instant. */
  async function postText(offerId: string): Promise<string> {
    const kit = (await getFacebookOfferKit(offerId))!;
    const source = facebookPostSource({ ...kit.group, layout: kit.layout }, kit.lots, (iso) => iso ?? "");
    return renderFacebookPostText(source.templates, source.standingNote, source.lots);
  }

  const snapshot = async (offerId: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { facebookPostSnapshot: true } }))
      .facebookPostSnapshot;

  async function editTemplates(overrides: Partial<FacebookGroupValues>) {
    await updateFacebookGroup(userId, groupId, groupValues(overrides));
  }

  it("follows the template until published, then keeps the text it went up with", async () => {
    await editTemplates({});
    const posted = await offer();
    const waiting = await offer();
    assert.equal(await snapshot(posted), null, "nothing is frozen before the offer goes up");
    await publishOfferOrPost(userId, posted, "https://www.facebook.com/groups/180000/posts/1");
    const asPosted = await postText(posted);
    assert.match(asPosted, /from 3 PLN/);
    assert.match(asPosted, /Shipping 5 PLN\./);

    await editTemplates({ postTemplate: "NEW {title}\n{terms}", standingNote: "Shipping 9 PLN." });
    await patchOffer(userId, posted, { facebookPostTemplate: "OWN {title}" });
    await prisma.offer.update({ where: { id: posted }, data: { startingPrice: "8.00", name: "Renamed" } });

    assert.equal(await postText(posted), asPosted, "a published offer's text is exactly as it was");
    assert.match(await postText(waiting), /^NEW .*\nShipping 9 PLN\.$/, "an offer not yet posted follows the template");
    assert.notEqual((await getFacebookOfferKit(posted))!.lots[0].frozen, null);
  });

  it("freezes on submission for approval, and follows the template again once rejected (#1778)", async () => {
    await editTemplates({});
    const id = await offer();
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/180000/pending_posts/2", "pending");
    const submitted = await postText(id);
    await editTemplates({ postTemplate: "SECOND {title}" });
    assert.equal(await postText(id), submitted, "Pending is publication");

    await rejectOfferOrPost(userId, id);
    assert.equal(await snapshot(id), null);
    assert.match(await postText(id), /^SECOND /, "back in Ready it follows the template");

    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/180000/pending_posts/3", "pending");
    await editTemplates({ postTemplate: "THIRD {title}" });
    assert.match(await postText(id), /^SECOND /, "published anew, frozen anew");
  });

  it("takes an approval's closing time into the frozen text, and nothing else (#1779)", async () => {
    await editTemplates({});
    const written = new Date("2026-10-12T18:00:00.000Z");
    const chosen = new Date("2026-10-15T18:00:00.000Z");
    const id = await offer("ready", { endsAt: written });
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/180000/pending_posts/4", "pending");
    await editTemplates({ postTemplate: "LATER {title}" });
    const submitted = await postText(id);
    assert.ok(submitted.includes(written.toISOString()));

    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/180000/posts/4", "active", chosen);
    assert.equal(await postText(id), submitted.replace(written.toISOString(), chosen.toISOString()));
  });

  it("freezes a post holding several lots as one, each lot's text as posted", async () => {
    await editTemplates({});
    const a = await offer();
    const b = await offer();
    await createFacebookPost(userId, collectionId, [a, b], "Test post");
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/180000/posts/5");
    const asPosted = await postText(b);
    assert.match(asPosted, /^1 .*\n\n2 .*\nShipping 5 PLN\.$/s);
    for (const id of [a, b]) assert.notEqual(await snapshot(id), null);

    await editTemplates({ postTemplate: "{lot} CHANGED", standingNote: "Other note" });
    assert.equal(await postText(a), asPosted);
  });

  it("refreezes on a repost, with the template and figures as they are now (#1718)", async () => {
    await editTemplates({});
    const id = await offer("ready", { listingType: "fixed", price: "9.00", startingPrice: null });
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/180000/posts/6");
    assert.match(await postText(id), /for 9 PLN$/);

    await editTemplates({ quickBuyTemplate: "{title} now only {price}" });
    await prisma.offer.update({ where: { id }, data: { price: "7.50" } });
    assert.match(await postText(id), /for 9 PLN$/, "up, it reads as posted");

    await repostOffer(userId, id, "https://www.facebook.com/groups/180000/posts/7");
    assert.match(await postText(id), /now only 7\.50 PLN$/, "reposted, it reads as posted again");
  });

  it("freezes an offer created already up", async () => {
    await editTemplates({});
    const id = await createOffer(userId, collectionId, input({ state: "active" }), {
      seedItemIds: [await newItem()],
    });
    assert.notEqual(await snapshot(id), null);
  });

  it("freezes, at start-up, every offer already up with none, and nothing else", async () => {
    await editTemplates({});
    const up = await offer();
    await publishOfferOrPost(userId, up, "https://www.facebook.com/groups/180000/posts/8");
    const notPosted = await offer();
    // An offer that went up before #1800: up, with no snapshot.
    await prisma.$executeRaw`UPDATE "offer" SET "facebookPostSnapshot" = NULL WHERE "id" = ${up}`;
    assert.equal(await snapshot(up), null);
    const shown = await postText(up);

    assert.ok((await freezeUnfrozenFacebookPosts()) >= 1);
    assert.notEqual(await snapshot(up), null);
    assert.equal(await snapshot(notPosted), null);
    await editTemplates({ postTemplate: "AFTER {title}" });
    assert.equal(await postText(up), shown, "frozen with the text it showed");
  });
});
