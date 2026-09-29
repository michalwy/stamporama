import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getActionItems } from "../../src/lib/action-items";
import {
  attemptMail,
  claimNextDueMail,
  enqueueMail,
  getMailSettings,
  markFailedMailSeen,
  requeueStalledMail,
  sendTestMail,
} from "../../src/lib/mail/messages";
import { MailSendError, type MailProvider, type OutgoingMail } from "../../src/lib/mail/provider";
import { MAIL_MAX_ATTEMPTS } from "../../src/lib/mail/retry-rules";

// Mail to the collector (#1372): the queue, its retries and the notification the last failure
// raises. The provider is a stand-in that records what it was handed — the Resend transport has its
// own unit tests, and nothing here should reach the network.

const ENV = {
  STAMPORAMA_MAIL_PROVIDER: "resend",
  STAMPORAMA_RESEND_API_KEY: "re_test",
  STAMPORAMA_RESEND_FROM: "stamps@example.com",
};

function fakeProvider(outcomes: ("ok" | "fail")[]): MailProvider & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  let i = 0;
  return {
    label: "Fake",
    from: "stamps@example.com",
    sent,
    async send(mail) {
      sent.push(mail);
      const outcome = outcomes[Math.min(i++, outcomes.length - 1)];
      if (outcome === "fail") throw new MailSendError("Resend refused the message: The domain is not verified.", 403);
      return { id: `provider-${sent.length}` };
    },
  };
}

describe("mail to the collector (#1372)", () => {
  let userId: string;
  let email: string;
  let collectionId: string;
  let otherUserId: string;
  const saved: Record<string, string | undefined> = {};

  before(async () => {
    const ts = Date.now();
    userId = `test-user-mail-${ts}`;
    email = `test-mail-${ts}@example.com`;
    otherUserId = `test-user-mail-other-${ts}`;
    for (const [id, address] of [
      [userId, email],
      [otherUserId, `test-mail-other-${ts}@example.com`],
    ]) {
      await prisma.user.create({
        data: { id, name: id, email: address, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    const col = await prisma.collection.create({
      data: { slug: `col-mail-${ts}`, name: `Collection mail-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    for (const key of Object.keys(ENV)) saved[key] = process.env[key];
  });

  beforeEach(async () => {
    Object.assign(process.env, ENV);
    await prisma.mailMessage.deleteMany({ where: { collectionId } });
  });

  after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const only = () => ({ collectionId });

  /** Claim and attempt everything due at `now` for this collection. */
  async function pass(provider: MailProvider, now: Date) {
    const outcomes: string[] = [];
    for (;;) {
      const id = await claimNextDueMail(now, only());
      if (!id) return outcomes;
      outcomes.push(await attemptMail(id, provider, () => now));
    }
  }

  async function undeliveredGroup() {
    const items = await getActionItems(userId, collectionId);
    return items.groups.find((g) => g.id === "mail-undelivered");
  }

  it("queues nothing on an instance without a provider", async () => {
    delete process.env.STAMPORAMA_MAIL_PROVIDER;
    const id = await enqueueMail(collectionId, { subject: "Closing today", text: "…" });
    assert.equal(id, null);
    assert.equal(await prisma.mailMessage.count({ where: { collectionId } }), 0);
    const settings = await getMailSettings(userId, collectionId);
    assert.deepEqual(settings.config, { state: "off" });
  });

  it("sends to the owner's own address and raises nothing", async () => {
    const id = await enqueueMail(collectionId, { subject: "Closing today", text: "Three lots." });
    assert.ok(id);
    const provider = fakeProvider(["ok"]);
    assert.deepEqual(await pass(provider, new Date()), ["sent"]);
    assert.equal(provider.sent[0].to, email);
    const row = await prisma.mailMessage.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, "sent");
    assert.equal(row.sentTo, email);
    assert.equal(row.providerMessageId, "provider-1");
    assert.equal(await undeliveredGroup(), undefined);
  });

  it("retries a failure later, and a success on a retry raises no notification", async () => {
    const id = await enqueueMail(collectionId, { subject: "Closing today", text: "…" });
    const provider = fakeProvider(["fail", "ok"]);
    const t0 = new Date();
    assert.deepEqual(await pass(provider, t0), ["retry"]);

    const waiting = await prisma.mailMessage.findUniqueOrThrow({ where: { id: id! } });
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.attempts, 1);
    assert.equal(waiting.nextAttemptAt.getTime(), t0.getTime() + 60_000);
    assert.match(waiting.lastError ?? "", /not verified/);

    // Not due yet: a pass a moment later leaves it alone.
    assert.deepEqual(await pass(provider, new Date(t0.getTime() + 30_000)), []);
    // Listed on the tab as still being tried, but not in the notification centre.
    const settings = await getMailSettings(userId, collectionId);
    assert.equal(settings.undelivered.length, 1);
    assert.equal(settings.undelivered[0].status, "queued");
    assert.equal(await undeliveredGroup(), undefined);

    assert.deepEqual(await pass(provider, new Date(t0.getTime() + 61_000)), ["sent"]);
    assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: id! } })).status, "sent");
    // Each attempt is named separately to the provider.
    assert.deepEqual(
      provider.sent.map((m) => m.idempotencyKey),
      [`mail-${id}-1`, `mail-${id}-2`]
    );
    assert.equal(await undeliveredGroup(), undefined);
    assert.equal((await getMailSettings(userId, collectionId)).undelivered.length, 0);
  });

  it("gives up after the last attempt and reports it until Settings → Email is opened", async () => {
    const id = await enqueueMail(collectionId, { subject: "Closing today", text: "…" });
    const provider = fakeProvider(["fail"]);
    let now = new Date();
    const outcomes: string[] = [];
    for (let i = 0; i < MAIL_MAX_ATTEMPTS; i++) {
      outcomes.push(...(await pass(provider, now)));
      const row = await prisma.mailMessage.findUniqueOrThrow({ where: { id: id! } });
      now = new Date(row.nextAttemptAt.getTime() + 1);
    }
    assert.deepEqual(outcomes, [...Array(MAIL_MAX_ATTEMPTS - 1).fill("retry"), "failed"]);
    const row = await prisma.mailMessage.findUniqueOrThrow({ where: { id: id! } });
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, MAIL_MAX_ATTEMPTS);
    assert.ok(row.failedAt);

    const group = await undeliveredGroup();
    assert.ok(group, "the final failure is in the notification centre");
    assert.equal(group.severity, "warning");
    assert.equal(group.count, 1);
    assert.equal(group.href, "settings?tab=email");
    assert.equal(group.items[0].label, "Closing today");
    assert.match(group.items[0].detail ?? "", /not verified/);

    const settings = await getMailSettings(userId, collectionId);
    assert.equal(settings.unseenFailures, 1);
    assert.equal(settings.undelivered[0].status, "failed");

    assert.equal(await markFailedMailSeen(userId, collectionId), 1);
    assert.equal(await undeliveredGroup(), undefined, "opening the tab reads it");
    const after = await getMailSettings(userId, collectionId);
    assert.equal(after.unseenFailures, 0);
    assert.equal(after.undelivered.length, 1, "the tab still lists it");
    assert.equal(await markFailedMailSeen(userId, collectionId), 0);
  });

  it("repeats an attempt a restart interrupted under the same name", async () => {
    const id = await enqueueMail(collectionId, { subject: "s", text: "t" });
    assert.equal(await claimNextDueMail(new Date(), only()), id);
    assert.equal(await requeueStalledMail(only()), 1);
    const row = await prisma.mailMessage.findUniqueOrThrow({ where: { id: id! } });
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
    const provider = fakeProvider(["ok"]);
    await pass(provider, new Date());
    assert.equal(provider.sent[0].idempotencyKey, `mail-${id}-1`);
  });

  it("follows a changed account address", async () => {
    const id = await enqueueMail(collectionId, { subject: "s", text: "t" });
    const changed = `changed-${email}`;
    await prisma.user.update({ where: { id: userId }, data: { email: changed } });
    try {
      const provider = fakeProvider(["ok"]);
      await pass(provider, new Date());
      assert.equal(provider.sent[0].to, changed);
      assert.equal((await prisma.mailMessage.findUniqueOrThrow({ where: { id: id! } })).sentTo, changed);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { email } });
    }
  });

  it("says the test cannot be sent without a provider, and refuses another owner", async () => {
    delete process.env.STAMPORAMA_MAIL_PROVIDER;
    assert.deepEqual(await sendTestMail(userId, collectionId), {
      status: "error",
      message: "Mail is not set up on this instance.",
    });
    await assert.rejects(sendTestMail(otherUserId, collectionId), /Collection not found/);
    await assert.rejects(getMailSettings(otherUserId, collectionId), /Collection not found/);
    await assert.rejects(markFailedMailSeen(otherUserId, collectionId), /Collection not found/);
  });

  it("never shows the key", async () => {
    const settings = await getMailSettings(userId, collectionId);
    assert.deepEqual(settings.config, { state: "ready", providerLabel: "Resend", from: "stamps@example.com" });
    assert.ok(!JSON.stringify(settings).includes("re_test"));
    assert.equal(settings.recipient, email);
  });
});
