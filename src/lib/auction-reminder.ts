import "server-only";
import { prisma } from "./db";
import { auctionLotScreenUrl } from "./app-url";
import {
  composeReminderMessage,
  dateColumnOfLocalDay,
  isValidReminderHour,
  isValidTimeZone,
  localDayOfDateColumn,
  reminderDueDay,
  reminderWindow,
  selectReminderLots,
  type LocalDay,
  type ReminderLot,
} from "./auction-reminder-rules";
import { readMailConfig, summarizeMailConfig, type MailConfigSummary } from "./mail/config";
import { enqueueMail, isMailConfigured } from "./mail/messages";

/**
 * The morning email of the watched auction lots ending that day (#1373): its settings, and the pass
 * that sends it. The rules — what "today" is in the collector's zone, which lots are listed, the
 * wording — are `auction-reminder-rules.ts`.
 *
 * **Once a day** is a claim, not a check. The pass moves `auctionReminderLastDay` to the day with a
 * conditional update, and queues the message in the same transaction: two passes cannot both claim
 * a day, and a day is never marked done without its message, or the other way round. The day is
 * claimed whether or not anything is listed, so a lot added at noon does not start a second,
 * afternoon reminder.
 */

export interface AuctionReminderSettings {
  enabled: boolean;
  hour: number;
  /** Null until the reminder is first switched on — the page offers the browser's zone then. */
  timeZone: string | null;
  /** The instance's mail as Settings may show it — never the key. The reminder cannot be switched on
   * unless it is `ready`. */
  mail: MailConfigSummary;
}

async function assertOwner(ownerId: string, collectionId: string): Promise<void> {
  const found = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!found) throw new Error("Collection not found or access denied.");
}

export async function getAuctionReminderSettings(
  ownerId: string,
  collectionId: string
): Promise<AuctionReminderSettings> {
  const col = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: {
      auctionReminderEnabled: true,
      auctionReminderHour: true,
      auctionReminderTimeZone: true,
    },
  });
  if (!col) throw new Error("Collection not found or access denied.");
  return {
    enabled: col.auctionReminderEnabled,
    hour: col.auctionReminderHour,
    timeZone: col.auctionReminderTimeZone,
    mail: summarizeMailConfig(readMailConfig()),
  };
}

/** What Settings → Auction reminder saves; every part optional, so a field saves on its own. */
export interface AuctionReminderPatch {
  enabled?: boolean;
  hour?: number;
  timeZone?: string;
}

/**
 * Save the reminder's settings. It **cannot be switched on while the instance cannot send mail**
 * (#1372) — a reminder that is on and never arrives looks exactly like one that works on a quiet
 * day — and it cannot be on without a zone, since "today" means nothing without one.
 */
export async function setAuctionReminder(
  ownerId: string,
  collectionId: string,
  patch: AuctionReminderPatch
): Promise<void> {
  if (patch.hour !== undefined && !isValidReminderHour(patch.hour)) {
    throw new Error("The hour must be a whole hour from 0 to 23.");
  }
  if (patch.timeZone !== undefined && !isValidTimeZone(patch.timeZone)) {
    throw new Error(`"${patch.timeZone}" is not a time zone this instance knows.`);
  }
  await assertOwner(ownerId, collectionId);

  const current = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { auctionReminderEnabled: true, auctionReminderTimeZone: true },
  });
  const enabling = patch.enabled === true && !current.auctionReminderEnabled;
  if (enabling && !isMailConfigured()) {
    throw new Error(
      "Mail is not set up on this instance, so the reminder cannot be switched on. See Settings → Email."
    );
  }
  const zone = patch.timeZone ?? current.auctionReminderTimeZone;
  if ((patch.enabled ?? current.auctionReminderEnabled) && !zone) {
    throw new Error("Choose your time zone before switching the reminder on.");
  }

  await prisma.collection.update({
    where: { id: collectionId },
    data: {
      auctionReminderEnabled: patch.enabled,
      auctionReminderHour: patch.hour,
      auctionReminderTimeZone: patch.timeZone,
    },
  });
}

/** The open lots of one collection ending in the window, as the reminder reads them. */
async function readReminderLots(
  collectionId: string,
  window: { from: Date; until: Date }
): Promise<ReminderLot[]> {
  const rows = await prisma.auctionLot.findMany({
    where: {
      status: "open",
      endsAt: { gt: window.from, lt: window.until },
      auctionSale: { collectionId },
    },
    select: {
      id: true,
      auctionSaleId: true,
      auctionLotNo: true,
      lotNo: true,
      title: true,
      endsAt: true,
      currentBid: true,
      myBid: true,
      maxBid: true,
      auctionSale: {
        select: {
          name: true,
          currency: true,
          premiumPercent: true,
          premiumFixed: true,
          platform: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    auctionSaleId: row.auctionSaleId,
    auctionLotNo: row.auctionLotNo,
    lotNo: row.lotNo,
    title: row.title,
    endsAt: row.endsAt,
    currentBid: row.currentBid?.toString() ?? null,
    myBid: row.myBid?.toString() ?? null,
    maxBid: row.maxBid?.toString() ?? null,
    currency: row.auctionSale.currency,
    // A single lot is costed without the parcel's shipping, as everywhere a lot is judged alone.
    fees: {
      premiumPercent: row.auctionSale.premiumPercent?.toString() ?? null,
      premiumFixed: row.auctionSale.premiumFixed?.toString() ?? null,
    },
    saleName: row.auctionSale.name,
    platformName: row.auctionSale.platform.name,
  }));
}

export type ReminderOutcome =
  | { status: "sent"; day: LocalDay; lots: number; mailId: string }
  | { status: "empty"; day: LocalDay }
  | { status: "not-due" }
  | { status: "claimed-elsewhere" };

/**
 * Do one collection's reminder for `now`, if it is due: claim the day, and queue the email when
 * there is anything to list. Returns what happened, for the pass's log and the tests.
 */
export async function runAuctionReminderFor(
  collectionId: string,
  now: Date = new Date()
): Promise<ReminderOutcome> {
  if (!isMailConfigured()) return { status: "not-due" };
  const col = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: {
      slug: true,
      auctionReminderEnabled: true,
      auctionReminderHour: true,
      auctionReminderTimeZone: true,
      auctionReminderLastDay: true,
    },
  });
  const timeZone = col.auctionReminderTimeZone;
  const day = reminderDueDay(
    {
      enabled: col.auctionReminderEnabled,
      hour: col.auctionReminderHour,
      timeZone,
      lastDay: col.auctionReminderLastDay ? localDayOfDateColumn(col.auctionReminderLastDay) : null,
    },
    now
  );
  if (!day || !timeZone) return { status: "not-due" };

  return prisma.$transaction(async (tx) => {
    const lastDay = dateColumnOfLocalDay(day);
    const claimed = await tx.collection.updateMany({
      where: {
        id: collectionId,
        auctionReminderEnabled: true,
        OR: [{ auctionReminderLastDay: null }, { auctionReminderLastDay: { not: lastDay } }],
      },
      data: { auctionReminderLastDay: lastDay },
    });
    if (claimed.count !== 1) return { status: "claimed-elsewhere" } as const;

    const { listed, outpricedCount } = selectReminderLots(
      await readReminderLots(collectionId, reminderWindow(day, timeZone, now))
    );
    const message = composeReminderMessage({
      day,
      timeZone,
      now,
      listed,
      outpricedCount,
      lotUrl: (lot) => auctionLotScreenUrl(col.slug, lot.auctionSaleId, lot.id),
    });
    if (!message) return { status: "empty", day } as const;

    const mailId = await enqueueMail(collectionId, message, tx);
    // `isMailConfigured` was true above; a null here means it changed mid-pass. Throwing rolls the
    // claim back, so the day is tried again on the next pass rather than lost.
    if (!mailId) throw new Error("Mail stopped being configured while the reminder was queued.");
    return { status: "sent", day, lots: listed.length, mailId } as const;
  });
}

/**
 * One pass over every collection with the reminder on. A collection that fails is logged and
 * counted, and the others still go; its claim was rolled back, so the next pass tries it again.
 */
export async function runAuctionReminders(
  now: Date = new Date()
): Promise<{ sent: number; empty: number; failed: number }> {
  const result = { sent: 0, empty: 0, failed: 0 };
  if (!isMailConfigured()) return result;
  const collections = await prisma.collection.findMany({
    where: { auctionReminderEnabled: true },
    select: { id: true },
  });
  for (const { id } of collections) {
    try {
      const outcome = await runAuctionReminderFor(id, now);
      if (outcome.status === "sent") result.sent++;
      else if (outcome.status === "empty") result.empty++;
    } catch (err) {
      result.failed++;
      console.error(`[auction-reminder] collection ${id} failed`, err);
    }
  }
  return result;
}
