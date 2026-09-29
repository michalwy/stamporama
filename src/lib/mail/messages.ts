import "server-only";
import { prisma, type DbTransaction } from "../db";
import { readMailConfig, summarizeMailConfig, type MailConfigSummary } from "./config";
import { mailErrorMessage, type MailProvider } from "./provider";
import { nextMailAttemptAt } from "./retry-rules";
import { mailProviderFor } from "./select";

/**
 * Mail to the collector: the queue the worker drains, the test message, and what Settings → Email
 * and the notification centre read (#1372; ADR-0060).
 *
 * The recipient is never an argument. Mail only goes to the collection owner's own account address,
 * read at the moment of sending — there is no second address to keep in step, and changing where
 * mail arrives is changing the account's address.
 */

async function assertOwner(ownerId: string, collectionId: string): Promise<void> {
  const found = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!found) throw new Error("Collection not found");
}

/** The provider this instance was deployed with, or null when it sends no mail. */
export function activeMailProvider(): MailProvider | null {
  return mailProviderFor(readMailConfig());
}

/** Whether this instance can send mail at all — what a feature that sends mail asks before it can
 * be switched on. */
export function isMailConfigured(): boolean {
  return readMailConfig().state === "ready";
}

/**
 * Put a message in the queue, or return null without writing anything when the instance has no
 * mail provider — nothing tries to send on an instance that cannot. Callers kick the worker
 * (`kickMailWorker`) or use `queueMail`, which does both.
 *
 * `db` lets a feature queue inside its own transaction, so the message and whatever records that it
 * was sent are written together or not at all (#1373's once-a-day claim).
 */
export async function enqueueMail(
  collectionId: string,
  message: { subject: string; text: string },
  db: DbTransaction = prisma
): Promise<string | null> {
  if (!isMailConfigured()) return null;
  const row = await db.mailMessage.create({
    data: { collectionId, subject: message.subject, text: message.text },
    select: { id: true },
  });
  return row.id;
}

/**
 * Claim the oldest due message for one attempt, or null when nothing is due. The conditional
 * `updateMany` is the lock: two passes cannot both move the same row out of `queued`.
 */
export async function claimNextDueMail(
  now: Date = new Date(),
  only?: { collectionId: string }
): Promise<string | null> {
  for (;;) {
    const next = await prisma.mailMessage.findFirst({
      where: { status: "queued", nextAttemptAt: { lte: now }, ...only },
      orderBy: { nextAttemptAt: "asc" },
      select: { id: true },
    });
    if (!next) return null;
    const claimed = await prisma.mailMessage.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (claimed.count === 1) return next.id;
  }
}

/**
 * One attempt at a claimed message. A failure puts it back in the queue for later, or — once the
 * schedule has run out — marks it `failed`, which is what the notification centre reports. Never
 * throws for a refused or unreachable provider; that is an ordinary outcome recorded on the row.
 */
export async function attemptMail(
  id: string,
  provider: MailProvider,
  now: () => Date = () => new Date()
): Promise<"sent" | "retry" | "failed"> {
  const row = await prisma.mailMessage.findUniqueOrThrow({
    where: { id },
    select: {
      subject: true,
      text: true,
      attempts: true,
      collection: { select: { owner: { select: { email: true } } } },
    },
  });
  const to = row.collection.owner.email;

  try {
    const { id: providerMessageId } = await provider.send({
      to,
      subject: row.subject,
      text: row.text,
      // Per attempt, not per message: a provider may remember a refused request under its key, and
      // a retry after the operator fixed the sender must be a new request. A restart mid-attempt
      // hands the attempt number back (`requeueStalledMail`), so it is repeated under the same name.
      idempotencyKey: `mail-${id}-${row.attempts}`,
    });
    await prisma.mailMessage.update({
      where: { id },
      data: { status: "sent", sentAt: now(), sentTo: to, providerMessageId },
    });
    return "sent";
  } catch (err) {
    const lastError = mailErrorMessage(err);
    const at = now();
    const next = nextMailAttemptAt(row.attempts, at);
    await prisma.mailMessage.update({
      where: { id },
      data: next
        ? { status: "queued", nextAttemptAt: next, lastError }
        : { status: "failed", failedAt: at, lastError },
    });
    return next ? "retry" : "failed";
  }
}

/** Put back what a previous process left mid-send, giving the attempt back so it is repeated under
 * the same idempotency key. Run once at boot. */
export async function requeueStalledMail(only?: { collectionId: string }): Promise<number> {
  const result = await prisma.mailMessage.updateMany({
    where: { status: "sending", ...only },
    data: { status: "queued", attempts: { decrement: 1 } },
  });
  return result.count;
}

/**
 * Send the test message now, not through the queue, so its result — delivered, or the provider's
 * own error — is the answer to the button that asked for it.
 */
export async function sendTestMail(
  ownerId: string,
  collectionId: string
): Promise<{ status: "sent"; to: string } | { status: "error"; message: string }> {
  await assertOwner(ownerId, collectionId);
  const provider = activeMailProvider();
  if (!provider) return { status: "error", message: "Mail is not set up on this instance." };

  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true } });
  try {
    await provider.send({
      to: owner.email,
      subject: "Stamporama test message",
      text:
        "This is a test message from your Stamporama instance.\n\n" +
        `It was sent through ${provider.label} from ${provider.from}. If it reached you, mail from ` +
        "this instance arrives here.\n",
    });
    return { status: "sent", to: owner.email };
  } catch (err) {
    return { status: "error", message: mailErrorMessage(err) };
  }
}

/** A message on Settings → Email that has not arrived: still being retried, or given up on. */
export interface UndeliveredMail {
  id: string;
  subject: string;
  status: "queued" | "sending" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  failedAt: string | null;
  nextAttemptAt: string | null;
}

export interface MailSettings {
  config: MailConfigSummary;
  /** Where mail goes: the owner's account address. */
  recipient: string;
  /** Most recent first. Retrying ones, and failed ones from the last {@link UNDELIVERED_DAYS} days. */
  undelivered: UndeliveredMail[];
  /** Failed messages the notification centre is still reporting; opening the page clears them. */
  unseenFailures: number;
}

/** How far back Settings → Email lists messages that were given up on. */
export const UNDELIVERED_DAYS = 30;

export async function getMailSettings(
  ownerId: string,
  collectionId: string,
  now: Date = new Date()
): Promise<MailSettings> {
  await assertOwner(ownerId, collectionId);
  const since = new Date(now.getTime() - UNDELIVERED_DAYS * 86_400_000);
  const [owner, rows, unseenFailures] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true } }),
    prisma.mailMessage.findMany({
      where: {
        collectionId,
        OR: [
          // Queued for its first attempt is not undelivered yet — only one that has already failed.
          { status: { in: ["queued", "sending"] }, attempts: { gt: 0 }, lastError: { not: null } },
          { status: "failed", failedAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.mailMessage.count({ where: { collectionId, status: "failed", seenAt: null } }),
  ]);

  return {
    config: summarizeMailConfig(readMailConfig()),
    recipient: owner.email,
    undelivered: rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      status: row.status as UndeliveredMail["status"],
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      failedAt: row.failedAt?.toISOString() ?? null,
      nextAttemptAt: row.status === "failed" ? null : row.nextAttemptAt.toISOString(),
    })),
    unseenFailures,
  };
}

/** Opening Settings → Email is reading the notification: every failed message of this collection
 * leaves the notification centre. The rows stay on the page. A no-op when there is nothing unseen. */
export async function markFailedMailSeen(ownerId: string, collectionId: string): Promise<number> {
  await assertOwner(ownerId, collectionId);
  const result = await prisma.mailMessage.updateMany({
    where: { collectionId, status: "failed", seenAt: null },
    data: { seenAt: new Date() },
  });
  return result.count;
}

/** Failed messages the collector has not seen yet, for the notification centre. */
export async function unseenFailedMail(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<{
  total: number;
  messages: { id: string; subject: string; lastError: string | null; failedAt: Date | null }[];
}> {
  await assertOwner(ownerId, collectionId);
  const where = { collectionId, status: "failed", seenAt: null };
  const [total, messages] = await Promise.all([
    prisma.mailMessage.count({ where }),
    prisma.mailMessage.findMany({
      where,
      orderBy: { failedAt: "desc" },
      take: limit,
      select: { id: true, subject: true, lastError: true, failedAt: true },
    }),
  ]);
  return { total, messages };
}
