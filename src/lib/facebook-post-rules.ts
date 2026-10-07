// The rules a Facebook auction and its post are prepared by (#1544; ADR-0061 §2, §3, §6) — pure, no
// Prisma and no `server-only`, because the offer form and the offer's Facebook card are client
// components and the closing time is a local time of day: it can only be turned into an instant in
// the browser, the one place the collector's zone is known (the `endsAt` field's rule, #490).
//
// What lives here is the arithmetic a group's defaults become on a new auction, and the text of the
// kit: the group's post template filled in per lot, with the standing note under it.

import { normalizeDecimalInput, roundAmount } from "./decimal-input";
import { FACEBOOK_POST_PLACEHOLDERS, type FacebookStartingPriceMode } from "./facebook-group-rules";

/**
 * When a new auction in a group closes, from the group's defaults: `days` after `now`, at the group's
 * closing time of day — or at the time it is now, where the group states no time of day.
 *
 * Null when the group states no length: a closing time of day alone names no day, and guessing one
 * would put an end on the auction nobody chose. Calendar days in the local zone, so an auction made
 * on the evening before a clock change still closes at the hour the group says.
 */
export function facebookDefaultEndsAt(
  now: Date,
  days: number | null,
  closingTime: string | null
): Date | null {
  if (days == null || !Number.isInteger(days) || days < 1) return null;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const match = closingTime ? /^(\d{2}):(\d{2})$/.exec(closingTime) : null;
  if (match) end.setHours(Number(match[1]), Number(match[2]), 0, 0);
  else end.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return end;
}

/**
 * The starting price a group's default gives a new auction, as a 2-dp string, or null.
 *
 * `amount` is the figure itself. `catalogPercent` needs the copies' catalogue value, already in the
 * offer's currency — the figure the form suggests a price from (#230) — and is null without one: a
 * percentage of nothing is no price, and the collector states one instead.
 */
export function facebookDefaultStartingPrice(
  mode: FacebookStartingPriceMode | null,
  value: number | null,
  catalogValue: string | null
): string | null {
  if (mode === null || value == null) return null;
  if (mode === "amount") return roundAmount(value);
  const catalog = catalogValue ? Number(catalogValue) : NaN;
  if (!Number.isFinite(catalog) || catalog <= 0) return null;
  const figure = roundAmount((catalog * value) / 100);
  return Number(figure) > 0 ? figure : null;
}

/**
 * What a creation with no offer form says about its Facebook half (#1663): the group picked beside the
 * create button, and when the auction closes — worked out from that group's defaults in the browser,
 * the one place the zone is known (#490), and carried as an ISO instant. Both null off Facebook. The
 * rest of the group's defaults — the increment, the currency, the starting price — are read by the
 * server as the offer is made, exactly as for an offer from the form.
 */
export interface FacebookCreateChoice {
  facebookGroupId: string | null;
  endsAt: string | null;
}

export const NO_FACEBOOK_CHOICE: FacebookCreateChoice = { facebookGroupId: null, endsAt: null };

/** The choice a shortcut sends, as the group it names and its closing time — an unreadable time is
 *  none rather than a refusal: the collector never typed it, the browser worked it out. */
export function readFacebookCreateChoice(
  choice: FacebookCreateChoice | null | undefined
): { facebookGroupId: string | null; endsAt: Date | null } {
  const facebookGroupId = choice?.facebookGroupId?.trim() || null;
  const endsAt = choice?.endsAt ? new Date(choice.endsAt) : null;
  return {
    facebookGroupId,
    endsAt: facebookGroupId && endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
  };
}

/** A bid increment as typed on the offer form: blank is none, anything else a figure above zero. */
export function parseBidIncrement(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: "The bid increment must be a figure above 0." };
  }
  return { ok: true, value: roundAmount(n) };
}

/** One lot of a post, its figures already written out the way the post states them. */
export interface FacebookPostLotText {
  /** The lot's number in a multi-lot post, or null for an offer posted alone — `{lot}` is then empty. */
  lotNo: number | null;
  description: string;
  catalog: string;
  /** `10.00 PLN`, or empty when the auction states none. */
  startingPrice: string;
  increment: string;
  closesAt: string;
}

/** What a post with no template of its own says per lot: what is auctioned, and nothing invented. */
export const FACEBOOK_FALLBACK_POST_TEMPLATE = "{description}";

const KNOWN_TOKENS = new Set<string>(FACEBOOK_POST_PLACEHOLDERS.map((p) => p.token));

/**
 * One lot's text: the group's template with its placeholders filled in. A token the template carries
 * that is not a placeholder is **kept as typed** — the title template's rule, and what the settings
 * editor already warns about while it is typed (`unknownPostPlaceholders`).
 */
export function renderFacebookLotText(template: string, lot: FacebookPostLotText): string {
  const source = template.trim() ? template : FACEBOOK_FALLBACK_POST_TEMPLATE;
  const values: Record<string, string> = {
    "{description}": lot.description,
    "{catalog}": lot.catalog,
    "{startingPrice}": lot.startingPrice,
    "{increment}": lot.increment,
    "{closesAt}": lot.closesAt,
    "{lot}": lot.lotNo == null ? "" : String(lot.lotNo),
  };
  return source
    .replace(/\{[A-Za-z]+\}/g, (token) => (KNOWN_TOKENS.has(token) ? values[token] : token))
    .trim();
}

/**
 * The whole post: each lot's text in lot order, a blank line between them, and the group's standing
 * note under the last — once, however many lots the post holds. Empty parts are left out rather than
 * leaving a gap.
 */
export function renderFacebookPostText(
  template: string,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): string {
  const parts = [...lots]
    .sort((a, b) => (a.lotNo ?? 0) - (b.lotNo ?? 0))
    .map((lot) => renderFacebookLotText(template, lot));
  if (standingNote.trim()) parts.push(standingNote.trim());
  return parts.filter((p) => p !== "").join("\n\n");
}

/** A figure as a post states it: `10.00 PLN`, or empty when there is none. */
export function facebookMoney(amount: string | null, currency: string): string {
  return amount ? `${amount} ${currency}` : "";
}

/** Why a set of offers cannot be posted together, or null when they can (ADR-0061 §2). The server
 *  asks this before writing anything; the reasons are the collector's to fix, so each is named. */
export interface FacebookPostCandidate {
  offerNo: number;
  facebookGroupId: string | null;
  facebookPostId: string | null;
  state: string;
  url: string | null;
}

export function facebookPostRefusal(offers: readonly FacebookPostCandidate[]): string | null {
  if (offers.length < 2) return "A post with several lots needs at least two offers.";
  const notFacebook = offers.filter((o) => o.facebookGroupId === null);
  if (notFacebook.length > 0) {
    return `${listOfferNos(notFacebook)} ${notFacebook.length === 1 ? "is" : "are"} not a Facebook auction.`;
  }
  if (new Set(offers.map((o) => o.facebookGroupId)).size > 1) {
    return "The lots of one post are in one group — these offers are in different groups.";
  }
  const inPost = offers.filter((o) => o.facebookPostId !== null);
  if (inPost.length > 0) {
    return `${listOfferNos(inPost)} ${inPost.length === 1 ? "is" : "are"} already a lot of another post.`;
  }
  const posted = offers.filter((o) => o.state !== "preparing" && o.state !== "ready");
  if (posted.length > 0) {
    return `${listOfferNos(posted)} ${posted.length === 1 ? "is" : "are"} already up or closed — only offers not yet posted can be put in a post.`;
  }
  return null;
}

/** A copy already in an active Facebook auction, and the auction it is in. */
export interface FacebookAuctionCopy {
  itemNo: number;
  offerNo: number;
  groupName: string;
}

/**
 * Why these copies cannot go into another Facebook auction (ADR-0061 §5): a copy is in one active
 * Facebook auction at a time, in any group. Names the auction each is in, since that auction is what
 * the collector has to look at — it may have ended without being closed here.
 */
export function describeFacebookAuctionCopies(copies: readonly FacebookAuctionCopy[]): string {
  const auctions = [...new Map(copies.map((c) => [c.offerNo, c])).values()].map(
    (c) => `offer #${c.offerNo} in ${c.groupName}`
  );
  const subject =
    copies.length === 1
      ? `Copy #${copies[0].itemNo} is`
      : `Copies ${copies.map((c) => `#${c.itemNo}`).join(", ")} are`;
  return `${subject} already in an active Facebook auction: ${auctions.join(", ")}. A copy is in one Facebook auction at a time — close or withdraw that one first.`;
}

function listOfferNos(offers: readonly { offerNo: number }[]): string {
  const nos = offers.map((o) => `#${o.offerNo}`);
  const named = nos.length === 1 ? nos[0] : `${nos.slice(0, -1).join(", ")} and ${nos[nos.length - 1]}`;
  return `Offer${nos.length === 1 ? "" : "s"} ${named}`;
}
