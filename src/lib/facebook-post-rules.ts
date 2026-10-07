// The rules a Facebook offer and its post are prepared by (#1544; ADR-0061 §2, §3, §6) — pure, no
// Prisma and no `server-only`, because the offer form and the offer's Facebook card are client
// components and the closing time is a local time of day: it can only be turned into an instant in
// the browser, the one place the collector's zone is known (the `endsAt` field's rule, #490).
//
// What lives here is the arithmetic a group's defaults become on a new auction, and the text of the
// kit: the group's post template filled in per lot — an auction's or a quick buy's, whichever the lot
// is (#1671) — with the standing note under it.

import { normalizeDecimalInput, roundAmount } from "./decimal-input";
import {
  FACEBOOK_RETIRED_PLACEHOLDERS,
  facebookPostPlaceholders,
  type FacebookStartingPriceMode,
} from "./facebook-group-rules";
import type { OfferListingType } from "./offer-rules";

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
  /** Which of the group's templates the lot is written from (#1671). */
  listingType: OfferListingType;
  /** `{title}`: the offer's title (#1671). */
  title: string;
  description: string;
  /** `{catalog}`, retired (#1671) and still filled in where a template carries it. */
  catalog: string;
  /** An auction's figures — `10.00 PLN`, or empty when it states none. */
  startingPrice: string;
  increment: string;
  closesAt: string;
  /** A quick buy's asking price (#1671), the same way. */
  price: string;
}

/** The group's two post templates (#1671): a post's lot is written from the one matching its type,
 *  never the other. */
export interface FacebookPostTemplates {
  auction: string;
  quickBuy: string;
}

/** What a post with no template of its own says per lot: what is offered, and nothing invented. */
export const FACEBOOK_FALLBACK_POST_TEMPLATE = "{description}";

/**
 * One lot's text: its type's template with that type's placeholders filled in. A token the template
 * carries that is not one of them is **kept as typed** — the title template's rule, and what the
 * settings editor already warns about while it is typed (`unknownPostPlaceholders`) — so an
 * auction's `{closesAt}` left in a quick buy's template is seen, not quietly emptied. A retired
 * placeholder is still filled in (#1671), so no post loses text the collector has not been told of.
 */
export function renderFacebookLotText(template: string, lot: FacebookPostLotText): string {
  const source = template.trim() ? template : FACEBOOK_FALLBACK_POST_TEMPLATE;
  const known = new Set<string>([
    ...facebookPostPlaceholders(lot.listingType).map((p) => p.token),
    ...FACEBOOK_RETIRED_PLACEHOLDERS,
  ]);
  const values: Record<string, string> = {
    "{title}": lot.title,
    "{description}": lot.description,
    "{catalog}": lot.catalog,
    "{startingPrice}": lot.startingPrice,
    "{increment}": lot.increment,
    "{closesAt}": lot.closesAt,
    "{price}": lot.price,
    "{lot}": lot.lotNo == null ? "" : String(lot.lotNo),
  };
  return source
    .replace(/\{[A-Za-z]+\}/g, (token) => (known.has(token) ? values[token] : token))
    .trim();
}

/** The template a lot of `listingType` is written from (#1671). */
export function facebookTemplateFor(templates: FacebookPostTemplates, listingType: OfferListingType): string {
  return listingType === "auction" ? templates.auction : templates.quickBuy;
}

/**
 * The whole post: each lot's text in lot order — each from its own type's template — a blank line
 * between them, and the group's standing note under the last, once, however many lots the post
 * holds. Empty parts are left out rather than leaving a gap.
 */
export function renderFacebookPostText(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): string {
  const parts = [...lots]
    .sort((a, b) => (a.lotNo ?? 0) - (b.lotNo ?? 0))
    .map((lot) => renderFacebookLotText(facebookTemplateFor(templates, lot.listingType), lot));
  if (standingNote.trim()) parts.push(standingNote.trim());
  return parts.filter((p) => p !== "").join("\n\n");
}

/** A figure as a post states it: `10.00 PLN`, or empty when there is none. */
export function facebookMoney(amount: string | null, currency: string): string {
  return amount ? `${amount} ${currency}` : "";
}

/** Whether a lot has gone up with its post — anything past Ready. A post is up once one of its lots
 *  is (#1668): the post's link is each lot's own listing link, so there is no post-level mark to read. */
export function isFacebookLotPosted(state: string): boolean {
  return state !== "preparing" && state !== "ready";
}

/** Why a set of offers cannot be posted together, or null when they can (ADR-0061 §2). The server
 *  asks this before writing anything; the reasons are the collector's to fix, so each is named. */
export interface FacebookPostCandidate {
  offerNo: number;
  facebookGroupId: string | null;
  listingType: OfferListingType;
  facebookPostId: string | null;
  state: string;
  url: string | null;
}

export function facebookPostRefusal(
  offers: readonly FacebookPostCandidate[],
  group: { mixedListingTypes: boolean } = { mixedListingTypes: false }
): string | null {
  if (offers.length < 2) return "A post with several lots needs at least two offers.";
  const notFacebook = offers.filter((o) => o.facebookGroupId === null);
  if (notFacebook.length > 0) {
    return `${listOfferNos(notFacebook)} ${notFacebook.length === 1 ? "is" : "are"} not a Facebook offer.`;
  }
  if (new Set(offers.map((o) => o.facebookGroupId)).size > 1) {
    return "The lots of one post are in one group — these offers are in different groups.";
  }
  if (!group.mixedListingTypes) {
    const mixed = facebookMixedTypesRefusal(offers);
    if (mixed) return mixed;
  }
  const inPost = offers.filter((o) => o.facebookPostId !== null);
  if (inPost.length > 0) {
    return `${listOfferNos(inPost)} ${inPost.length === 1 ? "is" : "are"} already a lot of another post.`;
  }
  const posted = offers.filter((o) => isFacebookLotPosted(o.state));
  if (posted.length > 0) {
    return `${listOfferNos(posted)} ${posted.length === 1 ? "is" : "are"} already up or closed — only offers not yet posted can be put in a post.`;
  }
  return null;
}

/**
 * Why these lots cannot share a post whose group keeps one type per post (#1671), or null when they
 * are all one type: each type named with its offers, so the collector sees which to post apart.
 */
export function facebookMixedTypesRefusal(
  offers: readonly { offerNo: number; listingType: OfferListingType }[]
): string | null {
  const auctions = offers.filter((o) => o.listingType === "auction");
  const quickBuys = offers.filter((o) => o.listingType !== "auction");
  if (auctions.length === 0 || quickBuys.length === 0) return null;
  const named = (list: readonly { offerNo: number }[], one: string, many: string) =>
    `${list.map((o) => `#${o.offerNo}`).join(", ")} ${list.length === 1 ? `is ${one}` : `are ${many}`}`;
  return `The lots of one post share one listing type here: ${named(auctions, "an auction", "auctions")} and ${named(quickBuys, "a quick buy", "quick buys")}. Post them apart, or let this group's posts mix them in Settings → Facebook.`;
}

/** A copy already in an active Facebook offer — an auction or a quick buy (#1671) — and the offer. */
export interface FacebookAuctionCopy {
  itemNo: number;
  offerNo: number;
  groupName: string;
}

/**
 * Why these copies cannot go into another Facebook offer (ADR-0061 §5): a copy is in one active
 * Facebook offer at a time, in any group — an auction or, since #1671, a quick buy, since either
 * sells it. Names the offer each is in, since that offer is what the collector has to look at — it
 * may have ended without being closed here.
 */
export function describeFacebookAuctionCopies(copies: readonly FacebookAuctionCopy[]): string {
  const auctions = [...new Map(copies.map((c) => [c.offerNo, c])).values()].map(
    (c) => `offer #${c.offerNo} in ${c.groupName}`
  );
  const subject =
    copies.length === 1
      ? `Copy #${copies[0].itemNo} is`
      : `Copies ${copies.map((c) => `#${c.itemNo}`).join(", ")} are`;
  return `${subject} already in an active Facebook offer: ${auctions.join(", ")}. A copy is in one Facebook offer at a time, auction or quick buy — close or withdraw that one first.`;
}

function listOfferNos(offers: readonly { offerNo: number }[]): string {
  const nos = offers.map((o) => `#${o.offerNo}`);
  const named = nos.length === 1 ? nos[0] : `${nos.slice(0, -1).join(", ")} and ${nos[nos.length - 1]}`;
  return `Offer${nos.length === 1 ? "" : "s"} ${named}`;
}
