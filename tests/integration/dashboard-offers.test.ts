import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getActionItems } from "../../src/lib/action-items";
import { getDashboardSection } from "../../src/lib/dashboard";
import type { DashboardGroup } from "../../src/lib/dashboard-rules";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  countOffers,
  createOffer,
  listOffersPaginated,
  setOfferState,
  type OfferListFilters,
} from "../../src/lib/offers";
import { addSaleLines, createSale, deleteSale } from "../../src/lib/sales";

// The Dashboard's *Offers to handle* section (#1811). What earns a real database is the shared-source
// rule: every group must hold exactly the offers its *see all* link opens on the offers list, and a
// group the bell also reports must hold exactly the bell's offers. And `stateChangedAt`, the instant
// Ready and Pending are aged by, is stamped by the writes that change the state.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

describe("dashboard: offers to handle (#1811)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let stampId: string;
  let conditionId: string;

  const ids: Record<string, string> = {};

  before(async () => {
    const ts = Date.now();
    userId = `test-user-dash-offers-${ts}`;
    otherUserId = `test-user-dash-offers-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-dash-offers-${ts}`, name: `Dash ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp D" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    delcampeId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, refreshQuickBuysAfterDays: 3 },
      })
    ).id;
    allegroId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;

    const copy = async () =>
      (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

    /** An offer holding `items`, stepped through the lifecycle to `to`. */
    async function offer(
      name: string,
      to: "preparing" | "ready" | "pending" | "active",
      opts: { platformId?: string; items?: string[]; auction?: { price: string; endsAt: Date } } = {}
    ): Promise<string> {
      const offerId = await createOffer(userId, collectionId, {
        platformId: opts.platformId ?? delcampeId,
        url: null,
        price: opts.auction?.price ?? "5.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
        ...(opts.auction
          ? { listingType: "auction" as const, startingPrice: "1.00", endsAt: opts.auction.endsAt }
          : {}),
      });
      await prisma.offer.update({ where: { id: offerId }, data: { name } });
      await addOfferSet(userId, offerId, opts.items ?? [await copy()]);
      if (to === "preparing") return offerId;
      await setOfferState(userId, offerId, "ready");
      if (to !== "ready") await setOfferState(userId, offerId, to);
      return offerId;
    }

    ids.preparing = await offer("Still preparing", "preparing");
    ids.readyNew = await offer("Ready today", "ready");
    ids.readyOld = await offer("Ready a week", "ready");
    await prisma.offer.update({ where: { id: ids.readyOld }, data: { stateChangedAt: daysAgo(7) } });
    ids.pending = await offer("Waiting for the admin", "pending");

    // A copy on two platforms, sold through one: the other is left listing it (the bell's red).
    const shared = await copy();
    ids.seller = await offer("Sold it", "active", { items: [shared] });
    ids.orphan = await offer("Holds the sold copy", "active", { platformId: allegroId, items: [shared] });
    // A live listing changed since it went up (#542) — and the same, on the orphan, which must still
    // be listed once, under its collision.
    ids.drifted = await offer("Changed since listed", "active", { platformId: allegroId });
    await prisma.offer.updateMany({
      where: { id: { in: [ids.drifted, ids.orphan] } },
      data: { listingContentChangedAt: daysAgo(2) },
    });

    // A quick buy up five days on a platform that wants a refresh after three.
    ids.due = await offer("Up too long", "active");
    await prisma.offer.update({ where: { id: ids.due }, data: { listingDate: daysAgo(5) } });

    // An auction ended with a bid, nothing recorded.
    ids.ended = await offer("Ended with a bid", "active", {
      platformId: allegroId,
      auction: { price: "42.00", endsAt: daysAgo(1) },
    });

    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const sellerSet = await prisma.offerSet.findFirstOrThrow({ where: { offerId: ids.seller } });
    await addSaleLines(userId, saleId, [
      { offerId: ids.seller, offerSetId: sellerSet.id, price: "5.00", itemIds: [shared] },
    ]);
    ids.sale = saleId;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function section(): Promise<Record<string, DashboardGroup>> {
    const result = await getDashboardSection(userId, collectionId, "offers");
    return Object.fromEntries(result.groups.map((g) => [g.id, g]));
  }

  /** The offers a group's *see all* opens: every page of the list under its filter. */
  async function listed(filters: OfferListFilters): Promise<string[]> {
    const page = await listOffersPaginated(userId, collectionId, { ...filters, pageSize: 500 });
    return page.items.map((o) => o.id).sort();
  }

  const keys = (group: DashboardGroup) => group.items.map((i) => i.key);

  it("lists the five groups in order, each with its count", async () => {
    const result = await getDashboardSection(userId, collectionId, "offers");
    assert.deepEqual(
      result.groups.map((g) => [g.title, g.count]),
      [
        ["Ready to publish", 2],
        ["Pending approval", 1],
        ["Needs action", 2],
        ["Quick buys to refresh", 1],
        ["Auctions ended, no result", 1],
      ]
    );
  });

  it("holds exactly the offers each group's link opens on the offers list", async () => {
    const byId = await section();
    const links: Record<string, OfferListFilters> = {
      "offers-ready": { states: ["ready"] },
      "offers-pending": { states: ["pending"] },
      "offers-needs-action": { needsAction: true },
      "offers-refresh": { needsRefresh: true },
      "offers-ended-auction": { endedAuction: true },
    };
    const hrefs: Record<string, string> = {
      "offers-ready": "offers?state=ready",
      "offers-pending": "offers?state=pending",
      "offers-needs-action": "offers?needsAction=1",
      "offers-refresh": "offers?needsRefresh=1",
      "offers-ended-auction": "offers?endedAuction=1",
    };
    for (const [id, filters] of Object.entries(links)) {
      const group = byId[id];
      assert.equal(group.href, hrefs[id]);
      assert.deepEqual([...keys(group)].sort(), await listed(filters), `${id}: the list's own rows`);
      assert.equal(group.count, await countOffers(userId, collectionId, filters), `${id}: the list's count`);
    }
  });

  it("holds exactly the bell's offers where the bell reports the same thing", async () => {
    const bell = await getActionItems(userId, collectionId, 100);
    const bellKeys = (...groupIds: string[]) =>
      [...new Set(bell.groups.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.items.map((i) => i.key)))].sort();
    const byId = await section();

    assert.deepEqual(
      [...keys(byId["offers-needs-action"])].sort(),
      bellKeys(
        "offer-sold-elsewhere",
        "offer-bidding-conflict",
        "offer-platform-sale-conflict",
        "offer-listing-changed"
      )
    );
    assert.deepEqual(keys(byId["offers-ended-auction"]), bellKeys("offer-auction-ended"));
  });

  it("shows the red collision first, once, and the changed listing after it", async () => {
    const group = (await section())["offers-needs-action"];
    assert.deepEqual(keys(group), [ids.orphan, ids.drifted]);
    const [collision, drift] = group.items;
    assert.equal(collision.detail, "Allegro · copy sold elsewhere");
    assert.equal(collision.at, null, "nothing records when the copy went elsewhere");
    assert.equal(drift.detail, "Allegro · changed since listed");
    assert.ok(drift.at, "a changed listing is aged from when it started diverging");
  });

  it("reads each row as number and title, platform, and age, opening the offer", async () => {
    const ready = (await section())["offers-ready"];
    assert.deepEqual(keys(ready), [ids.readyOld, ids.readyNew], "the longest waiting first");
    const offerNo = (await prisma.offer.findUniqueOrThrow({ where: { id: ids.readyOld } })).offerNo;
    const [row] = ready.items;
    assert.equal(row.label, `#${offerNo} Ready a week`);
    assert.equal(row.detail, "Delcampe");
    assert.equal(row.href, `offers/${ids.readyOld}`);
    assert.ok(Math.abs(Date.parse(row.at!) - daysAgo(7).getTime()) < 60_000, "aged from entering Ready");

    const refresh = (await section())["offers-refresh"];
    assert.equal(
      new Date(refresh.items[0].at!).toISOString().slice(0, 10),
      daysAgo(5).toISOString().slice(0, 10),
      "a quick buy is aged from its last posting"
    );
  });

  it("stamps stateChangedAt on every change of state, and only then", async () => {
    const at = async (id: string) =>
      (await prisma.offer.findUniqueOrThrow({ where: { id }, select: { stateChangedAt: true } }))
        .stateChangedAt;

    // By hand: Ready → Pending.
    await prisma.offer.update({ where: { id: ids.readyNew }, data: { stateChangedAt: daysAgo(3) } });
    await setOfferState(userId, ids.readyNew, "pending");
    assert.ok((await at(ids.readyNew)).getTime() > daysAgo(1).getTime(), "setOfferState stamps it");

    // An edit that is not a change of state leaves it alone.
    await prisma.offer.update({ where: { id: ids.preparing }, data: { stateChangedAt: daysAgo(3) } });
    await prisma.offer.update({ where: { id: ids.preparing }, data: { name: "Renamed" } });
    assert.ok((await at(ids.preparing)).getTime() < daysAgo(2).getTime());

    // The sale flow: sold when the sale is recorded, active again when it is deleted.
    await prisma.offer.update({ where: { id: ids.seller }, data: { stateChangedAt: daysAgo(3) } });
    await deleteSale(userId, ids.sale);
    const reverted = await prisma.offer.findUniqueOrThrow({ where: { id: ids.seller } });
    assert.equal(reverted.state, "active");
    assert.ok(reverted.stateChangedAt.getTime() > daysAgo(1).getTime(), "deleting the sale stamps it");
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(getDashboardSection(otherUserId, collectionId, "offers"));
  });
});
