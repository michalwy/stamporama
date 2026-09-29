import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getAuctionReminderSettings,
  runAuctionReminderFor,
  runAuctionReminders,
  setAuctionReminder,
} from "../../src/lib/auction-reminder";

// The morning auction reminder (#1373) against a real database: switching it on only where mail can
// be sent, the lots it lists and leaves out, the day boundary in the collector's zone, and the
// once-a-day claim — a second pass, a restart after the hour, and two passes racing.

const ENV = {
  STAMPORAMA_MAIL_PROVIDER: "resend",
  STAMPORAMA_RESEND_API_KEY: "re_test",
  STAMPORAMA_RESEND_FROM: "stamps@example.com",
  BETTER_AUTH_URL: "https://stamps.example.com/",
};

const WARSAW = "Europe/Warsaw";

// Wednesday 30 September 2026 in Warsaw (CEST, UTC+2). 06:00 UTC is 08:00 there.
const AT_EIGHT = new Date("2026-09-30T06:00:00Z");
const utc = (iso: string) => new Date(`2026-${iso}Z`);

describe("the morning auction reminder (#1373)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let slug: string;
  let saleId: string;
  let lotNo = 0;
  const saved: Record<string, string | undefined> = {};

  before(async () => {
    const ts = Date.now();
    userId = `test-user-reminder-${ts}`;
    otherUserId = `test-user-reminder-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    slug = `col-reminder-${ts}`;
    const col = await prisma.collection.create({
      data: { slug, name: `Collection reminder-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const sellerId = (await prisma.contact.create({ data: { collectionId, name: "Köhler", seller: true } })).id;
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Philasearch", platform: true } })
    ).id;
    saleId = (
      await prisma.auctionSale.create({
        data: { collectionId, sellerId, platformId, name: "Köhler 385", currency: "EUR", premiumPercent: "20" },
      })
    ).id;
    for (const key of Object.keys(ENV)) saved[key] = process.env[key];
  });

  beforeEach(async () => {
    Object.assign(process.env, ENV);
    await prisma.mailMessage.deleteMany({ where: { collectionId } });
    await prisma.auctionLot.deleteMany({ where: { auctionSaleId: saleId } });
    await prisma.collection.update({
      where: { id: collectionId },
      data: {
        auctionReminderEnabled: false,
        auctionReminderHour: 8,
        auctionReminderTimeZone: null,
        auctionReminderLastDay: null,
      },
    });
  });

  after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function addLot(data: {
    title: string;
    endsAt: Date;
    status?: string;
    currentBid?: string;
    myBid?: string;
    maxBid?: string;
  }) {
    return prisma.auctionLot.create({
      data: { auctionSaleId: saleId, auctionLotNo: ++lotNo, ...data },
    });
  }

  async function switchOn(hour = 8) {
    await setAuctionReminder(userId, collectionId, { enabled: true, hour, timeZone: WARSAW });
  }

  const mails = () =>
    prisma.mailMessage.findMany({ where: { collectionId }, orderBy: { createdAt: "asc" } });

  it("cannot be switched on while the instance has no mail, and says why", async () => {
    delete process.env.STAMPORAMA_MAIL_PROVIDER;
    await assert.rejects(
      setAuctionReminder(userId, collectionId, { enabled: true, timeZone: WARSAW }),
      /Mail is not set up on this instance/
    );
    const settings = await getAuctionReminderSettings(userId, collectionId);
    assert.equal(settings.enabled, false);
    assert.deepEqual(settings.mail, { state: "off" });
    // The hour and zone can still be set while it is off.
    await setAuctionReminder(userId, collectionId, { hour: 7, timeZone: WARSAW });
    const after = await getAuctionReminderSettings(userId, collectionId);
    assert.equal(after.hour, 7);
    assert.equal(after.timeZone, WARSAW);
  });

  it("is off by default at 08:00, and refuses a missing zone, a bad zone, a bad hour and a stranger", async () => {
    const settings = await getAuctionReminderSettings(userId, collectionId);
    assert.equal(settings.enabled, false);
    assert.equal(settings.hour, 8);
    assert.equal(settings.timeZone, null);
    assert.equal(settings.mail.state, "ready");

    await assert.rejects(setAuctionReminder(userId, collectionId, { enabled: true }), /time zone/);
    await assert.rejects(
      setAuctionReminder(userId, collectionId, { enabled: true, timeZone: "Europe/Warsau" }),
      /not a time zone/
    );
    await assert.rejects(setAuctionReminder(userId, collectionId, { hour: 24 }), /whole hour/);
    await assert.rejects(
      setAuctionReminder(otherUserId, collectionId, { enabled: true, timeZone: WARSAW }),
      /not found/
    );
    await switchOn();
    assert.equal((await getAuctionReminderSettings(userId, collectionId)).enabled, true);
  });

  it("at the chosen hour, queues one email listing today's open lots by end time, with status and links", async () => {
    await switchOn();
    const late = await addLot({ title: "Inverted Jenny", endsAt: utc("09-30T19:00:00"), currentBid: "50", myBid: "60", maxBid: "120" });
    const early = await addLot({ title: "Penny Black", endsAt: utc("09-30T10:15:00"), currentBid: "40", myBid: "30", maxBid: "96" });
    // Left out: closed and cancelled lots, a lot already ended this morning, tomorrow's, and one
    // already past the ceiling and the bid placed (#600's rule, the collector's decision).
    await addLot({ title: "Closed one", endsAt: utc("09-30T12:00:00"), status: "closed", myBid: "10" });
    await addLot({ title: "Cancelled one", endsAt: utc("09-30T12:00:00"), status: "cancelled" });
    await addLot({ title: "Ended at dawn", endsAt: utc("09-30T04:00:00") });
    await addLot({ title: "Tomorrow", endsAt: utc("10-01T09:00:00") });
    await addLot({ title: "Past reach", endsAt: utc("09-30T15:00:00"), currentBid: "100", myBid: "60", maxBid: "80" });

    // 07:59 in Warsaw: not yet.
    assert.deepEqual(await runAuctionReminderFor(collectionId, new Date("2026-09-30T05:59:00Z")), {
      status: "not-due",
    });
    assert.equal((await mails()).length, 0);

    const outcome = await runAuctionReminderFor(collectionId, AT_EIGHT);
    assert.equal(outcome.status, "sent");
    const [mail] = await mails();
    assert.equal(mail.status, "queued");
    assert.equal(mail.subject, "2 watched auction lots end today, Wednesday 30 September");
    const text = mail.text;
    for (const left of ["Closed one", "Cancelled one", "Ended at dawn", "Tomorrow", "Past reach"]) {
      assert.doesNotMatch(text, new RegExp(left), left);
    }
    // Times are Warsaw's: 10:15 UTC is 12:15, 19:00 UTC is 21:00.
    assert.match(text, /^12:15 {2}Penny Black$/m);
    assert.match(text, /^21:00 {2}Inverted Jenny$/m);
    assert.ok(text.indexOf("Penny Black") < text.indexOf("Inverted Jenny"));
    assert.match(text, /Köhler 385 · Philasearch/);
    assert.match(text, /Outbid at 40\.00 EUR \(your bid 30\.00 EUR\) · can still bid up to 80\.00 EUR/);
    assert.match(text, /Leading at 50\.00 EUR \(your bid 60\.00 EUR\)/);
    assert.ok(
      text.includes(`https://stamps.example.com/c/${slug}/auctions/sales/${saleId}?lot=${early.id}`)
    );
    assert.ok(text.includes(`?lot=${late.id}`));
    assert.match(text, /1 more lot ends today already past your ceiling/);

    const col = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    assert.equal(col.auctionReminderLastDay?.toISOString().slice(0, 10), "2026-09-30");
  });

  it("never sends the same day twice — not on a later pass, and not for a lot added later that day", async () => {
    await switchOn();
    await addLot({ title: "Penny Black", endsAt: utc("09-30T15:00:00") });
    assert.equal((await runAuctionReminderFor(collectionId, AT_EIGHT)).status, "sent");
    await addLot({ title: "Added at noon", endsAt: utc("09-30T18:00:00") });
    assert.deepEqual(await runAuctionReminderFor(collectionId, utc("09-30T10:00:00")), { status: "not-due" });
    assert.deepEqual(await runAuctionReminderFor(collectionId, utc("09-30T21:55:00")), { status: "not-due" });
    assert.equal((await mails()).length, 1);
  });

  it("a restart after the hour still sends the day's missed reminder, once", async () => {
    await switchOn();
    await prisma.collection.update({
      where: { id: collectionId },
      data: { auctionReminderLastDay: new Date("2026-09-29T00:00:00Z") },
    });
    await addLot({ title: "Evening lot", endsAt: utc("09-30T20:00:00") });
    // The instance was down at eight and comes back at 16:00 Warsaw time.
    const back = utc("09-30T14:00:00");
    assert.equal((await runAuctionReminderFor(collectionId, back)).status, "sent");
    assert.deepEqual(await runAuctionReminderFor(collectionId, new Date(back.getTime() + 300_000)), {
      status: "not-due",
    });
    assert.equal((await mails()).length, 1);
  });

  it("two passes racing for the same day queue one email", async () => {
    await switchOn();
    await addLot({ title: "Penny Black", endsAt: utc("09-30T15:00:00") });
    const outcomes = await Promise.all([
      runAuctionReminderFor(collectionId, AT_EIGHT),
      runAuctionReminderFor(collectionId, AT_EIGHT),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "sent").length, 1);
    assert.equal((await mails()).length, 1);
  });

  it("sends nothing on a day with no lots — and a lot added later does not start one", async () => {
    await switchOn();
    await addLot({ title: "Tomorrow", endsAt: utc("10-01T09:00:00") });
    assert.deepEqual(await runAuctionReminderFor(collectionId, AT_EIGHT), { status: "empty", day: "2026-09-30" });
    await addLot({ title: "Added at noon", endsAt: utc("09-30T18:00:00") });
    assert.deepEqual(await runAuctionReminderFor(collectionId, utc("09-30T10:00:00")), { status: "not-due" });
    assert.equal((await mails()).length, 0);
  });

  it("sends nothing when every lot ending today is already past reach", async () => {
    await switchOn();
    await addLot({ title: "Past reach", endsAt: utc("09-30T15:00:00"), currentBid: "100", myBid: "60", maxBid: "80" });
    assert.equal((await runAuctionReminderFor(collectionId, AT_EIGHT)).status, "empty");
    assert.equal((await mails()).length, 0);
  });

  it("ends the day at the collector's midnight, not UTC's", async () => {
    await switchOn();
    // Both on 30 September by UTC; the second is already 1 October in Warsaw.
    await addLot({ title: "Before midnight", endsAt: utc("09-30T21:30:00") });
    await addLot({ title: "After midnight", endsAt: utc("09-30T22:30:00") });
    await runAuctionReminderFor(collectionId, AT_EIGHT);
    const [mail] = await mails();
    assert.match(mail.text, /^23:30 {2}Before midnight$/m);
    assert.doesNotMatch(mail.text, /After midnight/);
  });

  it("reads 'today' and the hour in the chosen zone", async () => {
    // In New York (EDT, UTC−4) 08:00 is 12:00 UTC, and a lot at 02:00 UTC on 1 October is still the
    // evening of the 30th there.
    await setAuctionReminder(userId, collectionId, { enabled: true, timeZone: "America/New_York" });
    await addLot({ title: "New York evening", endsAt: utc("10-01T02:00:00") });
    assert.deepEqual(await runAuctionReminderFor(collectionId, AT_EIGHT), { status: "not-due" });
    assert.equal((await runAuctionReminderFor(collectionId, utc("09-30T12:00:00"))).status, "sent");
    const [mail] = await mails();
    assert.match(mail.text, /^22:00 {2}New York evening$/m);
  });

  it("the pass over every collection skips one switched off, and does nothing without mail", async () => {
    await addLot({ title: "Penny Black", endsAt: utc("09-30T15:00:00") });
    await setAuctionReminder(userId, collectionId, { timeZone: WARSAW });
    await runAuctionReminders(AT_EIGHT);
    assert.equal((await mails()).length, 0);

    await switchOn();
    delete process.env.STAMPORAMA_MAIL_PROVIDER;
    assert.deepEqual(await runAuctionReminders(AT_EIGHT), { sent: 0, empty: 0, failed: 0 });
    // Nothing was claimed, so the day is still owed once mail is back.
    Object.assign(process.env, ENV);
    const pass = await runAuctionReminders(AT_EIGHT);
    assert.ok(pass.sent >= 1);
    assert.equal((await mails()).length, 1);
  });
});
