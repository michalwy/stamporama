import {
  bidStanding,
  ceilingOf,
  isOutpriced,
  lotHasSignal,
  maxBidWithin,
  type Amount,
  type AuctionFees,
} from "./auction-lot";

/**
 * The pure half of the morning auction reminder (#1373): what "today" and "the hour" mean in the
 * collector's own time zone, whether a collection's reminder is due, which lots it lists, and the
 * message itself. The reads, the once-a-day claim and the queueing are in `auction-reminder.ts`.
 *
 * Zone arithmetic is done with `Intl` alone. A day is named by its calendar date in the zone
 * (`YYYY-MM-DD`), and the instants that bound it are found by asking `Intl` what offset the zone
 * had — so a day with a clock change is 23 or 25 hours long, as the collector lives it.
 */

/** The hour a new reminder goes at: 08:00 in the collector's day. */
export const DEFAULT_REMINDER_HOUR = 8;

/** A calendar day in the collector's zone, `YYYY-MM-DD`. */
export type LocalDay = string;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Whether `Intl` knows the zone. The screen offers only zones it knows, so this is the server
 * refusing a value that did not come from that list. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Whether `hour` is one the reminder can go at: a whole hour of the day. */
export function isValidReminderHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** How far ahead of UTC the zone's clock was at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day and the hour `now` falls on in the zone. */
export function localDayAndHour(now: Date, timeZone: string): { day: LocalDay; hour: number } {
  const p = zonedParts(now, timeZone);
  return { day: `${p.year}-${pad(p.month)}-${pad(p.day)}`, hour: p.hour };
}

/** The day after `day`. Calendar arithmetic only, so it is zone-free. */
export function nextLocalDay(day: LocalDay): LocalDay {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The instant `day` begins in the zone — its local midnight. Found by correcting a UTC guess by the
 * zone's offset, then correcting again with the offset at the corrected instant, which is what
 * lands it on the right side of a clock change.
 */
export function startOfLocalDay(day: LocalDay, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`).getTime();
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** A `DATE` column's value as the day it names. Such a column round-trips as UTC midnight. */
export function localDayOfDateColumn(value: Date): LocalDay {
  return value.toISOString().slice(0, 10);
}

/** The day as a `DATE` column takes it. */
export function dateColumnOfLocalDay(day: LocalDay): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** A collection's reminder, as the sweep reads it. */
export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  timeZone: string | null;
  /** The collector's day the reminder was last done for, sent or empty. */
  lastDay: LocalDay | null;
}

/**
 * The day whose reminder is due at `now`, or null when none is.
 *
 * Due means: switched on, with a zone, the collector's clock has reached the chosen hour, and this
 * day has not been done yet. **Reached, not equal to**: a process that was down at eight and comes
 * up at ten still owes that morning's reminder, and sends it then. Nothing past the day is owed —
 * yesterday's lots have all ended.
 */
export function reminderDueDay(settings: ReminderSettings, now: Date): LocalDay | null {
  if (!settings.enabled || !settings.timeZone || !isValidTimeZone(settings.timeZone)) return null;
  const { day, hour } = localDayAndHour(now, settings.timeZone);
  if (hour < settings.hour) return null;
  if (settings.lastDay === day) return null;
  return day;
}

/**
 * The instants the day's lots are looked for in: from `now` — a lot whose moment has already gone by
 * is not one to be reminded of — to the start of the next day in the zone.
 */
export function reminderWindow(
  day: LocalDay,
  timeZone: string,
  now: Date
): { from: Date; until: Date } {
  return { from: now, until: startOfLocalDay(nextLocalDay(day), timeZone) };
}

/** One open lot ending in the window, as the reminder reads it. Amounts are the sale's currency. */
export interface ReminderLot {
  id: string;
  auctionSaleId: string;
  auctionLotNo: number;
  lotNo: string | null;
  title: string | null;
  endsAt: Date;
  currentBid: Amount;
  myBid: Amount;
  maxBid: Amount;
  currency: string;
  fees: AuctionFees;
  saleName: string;
  platformName: string;
}

/**
 * Which lots the email lists, soonest first, and how many were left out as past reach.
 *
 * A lot whose price has passed both the ceiling (all-in) and the bid placed is left out — the
 * collector decided on 2026-09-29 that it counts as already lost: nothing can happen to it without a
 * new decision, and a reminder is for what still needs one. It is the exposure totals' own rule
 * (`isOutpriced`, #600), so the email and the screen cannot disagree about it; the email says how
 * many it left out.
 */
export function selectReminderLots(lots: ReminderLot[]): {
  listed: ReminderLot[];
  outpricedCount: number;
} {
  const listed: ReminderLot[] = [];
  let outpricedCount = 0;
  for (const lot of lots) {
    if (isOutpriced(lot, lot.fees)) outpricedCount++;
    else listed.push(lot);
  }
  listed.sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || a.auctionLotNo - b.auctionLotNo);
  return { listed, outpricedCount };
}

/** An amount as the auction screens print it: two places and the sale's currency. */
function money(amount: Amount, currency: string): string | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === "string" && !amount.trim()) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? `${n.toFixed(2)} ${currency}` : null;
}

/**
 * Where the collector stands on a lot, in the lots screen's own words — *Leading*, *Outbid*,
 * *Can still bid* — with the ceiling when one is set.
 */
export function describeReminderStanding(lot: ReminderLot, now: Date): string {
  const c = lot.currency;
  const current = money(lot.currentBid, c);
  const mine = money(lot.myBid, c);
  const parts: string[] = [];

  const standing = bidStanding(lot.myBid, lot.currentBid);
  if (standing === "leading") parts.push(`Leading at ${current} (your bid ${mine})`);
  else if (standing === "outbid") parts.push(`Outbid at ${current} (your bid ${mine})`);
  else if (mine) parts.push(`Your bid ${mine}`);
  else if (current) parts.push(`No bid placed; at ${current}`);
  else parts.push("No bid placed");

  const signalInput = {
    status: "open" as const,
    endsAt: lot.endsAt,
    currentBid: lot.currentBid,
    myBid: lot.myBid,
    maxBid: lot.maxBid,
    fees: lot.fees,
  };
  // The ceiling as it is held (#1515): set apart, else the bid's own all-in.
  const held = ceilingOf(lot, lot.fees);
  if (lotHasSignal("bid-possible", signalInput, now)) {
    parts.push(`can still bid up to ${money(maxBidWithin(held, lot.fees), c)}`);
  }
  const ceiling = money(held, c);
  if (ceiling) parts.push(`ceiling ${ceiling} all-in`);
  return parts.join(" · ");
}

/** The lot's name as the email heads it: its title, else the house's lot number. */
function lotName(lot: ReminderLot): string {
  const title = lot.title?.trim();
  if (title) return title;
  const house = lot.lotNo?.trim();
  return house ? `Lot ${house}` : "Untitled lot";
}

function timeOfDay(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function dayHeading(day: LocalDay): string {
  // The day is a calendar date already, so it is formatted at UTC noon to stay that date.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T12:00:00Z`));
}

export interface ReminderMessageInput {
  day: LocalDay;
  timeZone: string;
  now: Date;
  listed: ReminderLot[];
  outpricedCount: number;
  /** The lot's address in the app, or null when the instance has no configured address. */
  lotUrl: (lot: ReminderLot) => string | null;
}

/**
 * The email, or null when there is nothing to list — **no lots, no email**: an empty reminder every
 * morning would teach the collector to skip the real ones. Lots left out as past reach do not make a
 * message on their own.
 */
export function composeReminderMessage(
  input: ReminderMessageInput
): { subject: string; text: string } | null {
  const { listed, outpricedCount, timeZone, now } = input;
  if (listed.length === 0) return null;

  const count = listed.length;
  const noun = count === 1 ? "lot" : "lots";
  const heading = dayHeading(input.day);
  const subject = `${count} watched auction ${noun} end${count === 1 ? "s" : ""} today, ${heading}`;

  const lines: string[] = [
    `${count} watched auction ${noun} end${count === 1 ? "s" : ""} today, ${heading} (times in ${timeZone}).`,
    "",
  ];
  for (const lot of listed) {
    const indent = "       ";
    lines.push(`${timeOfDay(lot.endsAt, timeZone)}  ${lotName(lot)}`);
    lines.push(`${indent}${lot.saleName} · ${lot.platformName}`);
    lines.push(`${indent}${describeReminderStanding(lot, now)}`);
    const url = input.lotUrl(lot);
    if (url) lines.push(`${indent}${url}`);
    lines.push("");
  }
  if (outpricedCount > 0) {
    lines.push(
      outpricedCount === 1
        ? "1 more lot ends today already past your ceiling; it is not listed."
        : `${outpricedCount} more lots end today already past your ceiling; they are not listed.`
    );
    lines.push("");
  }
  lines.push("You receive this because the auction reminder is on in Settings → Auction reminder.");
  return { subject, text: lines.join("\n") + "\n" };
}
