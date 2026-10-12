// The rules a Facebook offer and its post are prepared by (#1544; ADR-0061 §2, §3, §6) — pure, no
// Prisma and no `server-only`, because the offer form and the offer's Facebook card are client
// components and the closing time is a local time of day: it can only be turned into an instant in
// the browser, the one place the collector's zone is known (the `endsAt` field's rule, #490).
//
// What lives here is the arithmetic a group's defaults become on a new auction, and the text of the
// kit: the group's post template filled in per lot — an auction's or a quick buy's, whichever the lot
// is (#1671) — with the note on shipping, payment and terms where its `{terms}` says (#1689). A post
// is **only what its template places** (#1692): nothing is substituted, added or fallen back to, and
// what comes out empty is named on the card (`facebookPostGaps`) rather than filled in. An offer may
// carry its **own** template (#1780), which writes that lot instead of the group's. Once the offer is
// published its lot is **frozen** (#1800): what it was written from is kept, and drawn from then on.
//
// A post of several lots is laid out one of two ways (#1841): every lot's text in the post's own text,
// or — the *captioned* layout — one photo per lot, the lot's text that photo's caption, and the post's
// text a shared one of its own (`renderFacebookCaptionedPost`).

import { generatedAmount, normalizeDecimalInput, roundAmount } from "./decimal-input";
import {
  FACEBOOK_RETIRED_PLACEHOLDERS,
  FACEBOOK_TERMS_PLACEHOLDER,
  facebookTemplatePlaceholders,
  toFacebookMultiLotLayout,
  type FacebookMultiLotLayout,
  type FacebookStartingPriceMode,
  type FacebookTemplateRole,
} from "./facebook-group-rules";
import { isAuctionListing, type OfferListingType } from "./offer-rules";

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
 * Whether a link is to a post still **waiting for a group administrator** (#1779): Facebook hands
 * back an address with a `pending_posts` segment while the post is held, so recording one proposes
 * *Pending* rather than *Active*. Only a proposal — the collector's tick decides.
 */
export function isFacebookPendingPostUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return false;
  return url.pathname.split("/").includes("pending_posts");
}

/** What the approval of a Facebook post asks about its closing time (#1779): the closing time the
 *  post's auctions carry — set when the post was written — and the group's length and time of day,
 *  which the browser turns into a proposal counted from the approval day. */
export interface FacebookApprovalClosing {
  /** ISO-8601, or null when the auctions carry none. */
  endsAt: string | null;
  auctionDays: number | null;
  closingTime: string | null;
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
  /** `{offer}`: the offer's own number (#1694), bare — the template writes any `#` around it. */
  offerNo: number;
  /** Which of the group's templates the lot is written from (#1671). */
  listingType: OfferListingType;
  /** `{title}`: the offer's title (#1671). */
  title: string;
  /** `{description}`: the offer's description, empty when it has none (#1692) — never its title. */
  description: string;
  /** `{catalog}`, retired (#1671) and still filled in where a template carries it. */
  catalog: string;
  /** An auction's figures — `10 PLN`, `10.50 PLN`, or empty when it states none. */
  startingPrice: string;
  increment: string;
  closesAt: string;
  /** A quick buy's asking price (#1671), the same way. */
  price: string;
  /** The offer's own post template (#1780), written for its type — null, or absent, follows the
   *  group's template for that type. */
  ownTemplate?: string | null;
}

/** The group's two post templates (#1671): a post's lot is written from the one matching its type,
 *  never the other. */
export interface FacebookPostTemplates {
  auction: string;
  quickBuy: string;
}

/** The templates a **captioned** post of several lots is written from (#1841): a caption per listing
 *  type, and the post's shared text. */
export interface FacebookCaptionTemplates {
  auction: string;
  quickBuy: string;
  /** The captioned post's own text — the note, a heading, the lots' offer numbers. */
  post: string;
}

const TOKEN = /\{[A-Za-z]+\}/g;

/** The placeholders a lot of this type fills in: its type's own — its post's, or its caption's
 *  (#1841) — and, in a post template, the retired ones (#1671). */
function knownTokens(listingType: OfferListingType, role: FacebookTemplateRole = "post"): Set<string> {
  return new Set<string>([
    ...facebookTemplatePlaceholders(role, listingType).map((p) => p.token),
    ...(role === "post" ? FACEBOOK_RETIRED_PLACEHOLDERS : []),
  ]);
}

/** What each placeholder becomes for this lot. `{terms}` is `terms`, empty unless this lot is where
 *  the post states the note (#1689). */
function placeholderValues(lot: FacebookPostLotText, terms: string): Record<string, string> {
  return {
    "{title}": lot.title,
    "{description}": lot.description,
    "{catalog}": lot.catalog,
    "{startingPrice}": lot.startingPrice,
    "{increment}": lot.increment,
    "{closesAt}": lot.closesAt,
    "{price}": lot.price,
    "{lot}": lot.lotNo == null ? "" : String(lot.lotNo),
    "{offer}": String(lot.offerNo),
    "{terms}": terms.trim(),
  };
}

/**
 * A stretch of a post (#1772): what the template wrote — markup included — or what a placeholder put
 * there. The two are kept apart so the formatting reads only the template's own text: a value is
 * inserted as text and never interpreted as formatting (`facebook-post-format.ts`).
 */
export interface FacebookPostPart {
  /** True for a placeholder's value, false for the template's own text. */
  value: boolean;
  text: string;
}

function partsText(parts: readonly FacebookPostPart[]): string {
  return parts.map((p) => p.text).join("");
}

/**
 * One lot's text: its type's template with that type's placeholders filled in, and **nothing else**
 * (#1692) — an empty template is an empty lot, an empty placeholder is empty, and the template's line
 * breaks stay exactly where it has them. A token the template carries that is not one of them is
 * **kept as typed** — the title template's rule, and what the settings editor already warns about
 * while it is typed (`unknownPostPlaceholders`) — so an auction's `{closesAt}` left in a quick buy's
 * template is seen, not quietly emptied. A retired placeholder is still filled in (#1671), so no post
 * loses text the collector has not been told of. `{terms}` is the note on shipping, payment and terms
 * (#1689) — `terms`, empty unless this lot is where the post states it.
 */
export function renderFacebookLotParts(
  template: string,
  lot: FacebookPostLotText,
  terms = "",
  role: "post" | "caption" = "post"
): FacebookPostPart[] {
  return fillTemplate(template, knownTokens(lot.listingType, role), placeholderValues(lot, terms));
}

/** A template with the known tokens replaced by their values, everything else kept as typed. */
function fillTemplate(template: string, known: Set<string>, values: Record<string, string>): FacebookPostPart[] {
  const parts: FacebookPostPart[] = [];
  let from = 0;
  for (const match of template.matchAll(TOKEN)) {
    const token = match[0];
    if (!known.has(token)) continue;
    if (match.index > from) parts.push({ value: false, text: template.slice(from, match.index) });
    parts.push({ value: true, text: values[token] });
    from = match.index + token.length;
  }
  if (from < template.length) parts.push({ value: false, text: template.slice(from) });
  return parts;
}

/** {@link renderFacebookLotParts} as one string — the lot's text as the template's source reads. */
export function renderFacebookLotText(template: string, lot: FacebookPostLotText, terms = ""): string {
  return partsText(renderFacebookLotParts(template, lot, terms));
}

/** Parts as one string — the source a part list was rendered from. */
export function facebookPartsText(parts: readonly FacebookPostPart[]): string {
  return partsText(parts);
}

/** The group's template a lot of `listingType` is written from (#1671). */
export function facebookTemplateFor(templates: FacebookPostTemplates, listingType: OfferListingType): string {
  return listingType === "auction" ? templates.auction : templates.quickBuy;
}

/** The template this lot is written from: its offer's own where it has one (#1780) — even an empty
 *  one, which is the offer's choice and not a gap to fill — else its group's for its type. */
export function facebookLotTemplate(
  templates: FacebookPostTemplates,
  lot: Pick<FacebookPostLotText, "listingType" | "ownTemplate">
): string {
  return lot.ownTemplate ?? facebookTemplateFor(templates, lot.listingType);
}

/** The caption template a lot of `listingType` is written from in a captioned post (#1841). */
export function facebookCaptionTemplateFor(captions: FacebookCaptionTemplates, listingType: OfferListingType): string {
  return listingType === "auction" ? captions.auction : captions.quickBuy;
}

/** The template a lot's **caption** is written from (#1841): its offer's own where it has one (#1780)
 *  — the lot's text is its caption here, so that is what the offer's own words write — else its
 *  group's caption template for its type. */
export function facebookCaptionLotTemplate(
  captions: FacebookCaptionTemplates,
  lot: Pick<FacebookPostLotText, "listingType" | "ownTemplate">
): string {
  return lot.ownTemplate ?? facebookCaptionTemplateFor(captions, lot.listingType);
}

/** The template a lot is written from in a post of `layout` — its post text's, or its caption's. */
export function facebookLayoutLotTemplate(
  layout: FacebookMultiLotLayout,
  templates: FacebookPostTemplates,
  captions: FacebookCaptionTemplates,
  lot: Pick<FacebookPostLotText, "listingType" | "ownTemplate">
): string {
  return layout === "captions" ? facebookCaptionLotTemplate(captions, lot) : facebookLotTemplate(templates, lot);
}

function inLotOrder<T extends { lotNo: number | null }>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => (a.lotNo ?? 0) - (b.lotNo ?? 0));
}

/**
 * The whole post: each lot's text in lot order — each from its own type's template, or its offer's
 * own (#1780) — a blank line between them. The note on shipping, payment and terms goes where the **last** lot's template puts
 * `{terms}` (#1689) — once, however many lots the post holds, as it was when it was appended under
 * the last — and nowhere when that template has none. A lot with no template has no text, and adds no
 * gap between the others; what is in a lot's text is its template's, line breaks included (#1692).
 */
export function renderFacebookPostParts(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): FacebookPostPart[] {
  const sorted = inLotOrder(lots);
  const written = sorted
    .map((lot, i) =>
      renderFacebookLotParts(
        facebookLotTemplate(templates, lot),
        lot,
        i === sorted.length - 1 ? standingNote : ""
      )
    )
    .filter((parts) => partsText(parts).trim() !== "");
  return written.flatMap((parts, i) => (i === 0 ? parts : [{ value: false, text: "\n\n" }, ...parts]));
}

/** {@link renderFacebookPostParts} as one string — the post's source, its formatting as typed. */
export function renderFacebookPostText(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): string {
  return partsText(renderFacebookPostParts(templates, standingNote, lots));
}

/** A placeholder a lot's template places that comes out empty, and the lot it is in. */
export interface FacebookEmptyPlaceholder {
  /** The lot's number in a multi-lot post, or null for an offer posted alone. */
  lotNo: number | null;
  token: string;
}

/** What a post is missing (#1692), for the card to name: the templates its lots' types have none of,
 *  the lots whose own template is empty (#1780), and the placeholders its templates place that are
 *  empty. */
export interface FacebookPostGaps {
  missingTemplates: OfferListingType[];
  /** The lots (by `lotNo`, null for an offer posted alone) whose offer's own template is empty. */
  emptyOwnTemplates: (number | null)[];
  emptyPlaceholders: FacebookEmptyPlaceholder[];
}

/**
 * What the post as `renderFacebookPostText` writes it is missing (#1692) — nothing is filled in to hide
 * it, so the card names it instead. A type with lots in the post that follow the group and no template
 * is missing; a lot whose own template (#1780) is empty is named by itself, since the group's template
 * is not what it lacks; a placeholder the template places and the lot leaves empty is named per lot,
 * once per token. Two are
 * empty by the post's own rule rather than for want of anything, and are not named: `{lot}` on an
 * offer posted alone, and `{terms}` in every lot but the last, where the note is stated once.
 */
export function facebookPostGaps(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): FacebookPostGaps {
  const sorted = inLotOrder(lots);
  const followsGroup = (lot: FacebookPostLotText) => lot.ownTemplate == null;
  const missingTemplates = (["auction", "fixed"] as const).filter(
    (type) =>
      sorted.some((lot) => followsGroup(lot) && lot.listingType === type) &&
      !facebookTemplateFor(templates, type).trim()
  );
  const emptyOwnTemplates = sorted
    .filter((lot) => !followsGroup(lot) && !lot.ownTemplate!.trim())
    .map((lot) => lot.lotNo);
  const emptyPlaceholders: FacebookEmptyPlaceholder[] = [];
  sorted.forEach((lot, i) => {
    const template = facebookLotTemplate(templates, lot);
    const known = knownTokens(lot.listingType);
    const last = i === sorted.length - 1;
    const values = placeholderValues(lot, last ? standingNote : "");
    const seen = new Set<string>();
    for (const token of template.match(TOKEN) ?? []) {
      if (seen.has(token) || !known.has(token)) continue;
      seen.add(token);
      if (token === "{lot}" && lot.lotNo == null) continue;
      if (token === FACEBOOK_TERMS_PLACEHOLDER.token && !last) continue;
      if (values[token].trim() === "") emptyPlaceholders.push({ lotNo: lot.lotNo, token });
    }
  });
  return { missingTemplates, emptyOwnTemplates, emptyPlaceholders };
}

/** One lot's caption in a captioned post (#1841): the photo it goes under, by lot. */
export interface FacebookCaption {
  lotNo: number | null;
  offerNo: number;
  parts: FacebookPostPart[];
}

/** A captioned post (#1841): its shared text, and each lot's caption in lot order. */
export interface FacebookCaptionedPost {
  post: FacebookPostPart[];
  captions: FacebookCaption[];
}

/**
 * A post of several lots laid out with **each lot's text in its photo's caption** (#1841). Each lot's
 * caption is its type's caption template — or its offer's own (#1780) — filled in as a lot's text is,
 * without `{terms}`: the note goes in the post's shared text, which carries `{offer}` (the lots' offer
 * numbers, bare, in lot order) and `{terms}`. Nothing is added or fallen back to (#1692): an empty
 * template is an empty caption or an empty post.
 */
export function renderFacebookCaptionedPost(
  captions: FacebookCaptionTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): FacebookCaptionedPost {
  const sorted = inLotOrder(lots);
  return {
    post: fillTemplate(captions.post, knownTokens("auction", "captionPost"), captionPostValues(sorted, standingNote)),
    captions: sorted.map((lot) => ({
      lotNo: lot.lotNo,
      offerNo: lot.offerNo,
      parts: renderFacebookLotParts(facebookCaptionLotTemplate(captions, lot), lot, "", "caption"),
    })),
  };
}

function captionPostValues(sorted: readonly FacebookPostLotText[], standingNote: string): Record<string, string> {
  return {
    "{offer}": sorted.map((lot) => String(lot.offerNo)).join(", "),
    [FACEBOOK_TERMS_PLACEHOLDER.token]: standingNote.trim(),
  };
}

/** What a captioned post is missing (#1841): {@link FacebookPostGaps} for its captions — the caption
 *  templates its lots' types have none of, the lots whose own template is empty, the placeholders a
 *  caption leaves empty — and for its shared text, whether there is none and the placeholders it
 *  leaves empty (named with `lotNo: null`). */
export interface FacebookCaptionedPostGaps extends FacebookPostGaps {
  missingPostText: boolean;
}

export function facebookCaptionedPostGaps(
  captions: FacebookCaptionTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[]
): FacebookCaptionedPostGaps {
  const sorted = inLotOrder(lots);
  const followsGroup = (lot: FacebookPostLotText) => lot.ownTemplate == null;
  const missingTemplates = (["auction", "fixed"] as const).filter(
    (type) =>
      sorted.some((lot) => followsGroup(lot) && lot.listingType === type) &&
      !facebookCaptionTemplateFor(captions, type).trim()
  );
  const emptyOwnTemplates = sorted
    .filter((lot) => !followsGroup(lot) && !lot.ownTemplate!.trim())
    .map((lot) => lot.lotNo);
  const emptyPlaceholders: FacebookEmptyPlaceholder[] = [];
  const postValues = captionPostValues(sorted, standingNote);
  const postKnown = knownTokens("auction", "captionPost");
  for (const token of new Set(captions.post.match(TOKEN) ?? [])) {
    if (postKnown.has(token) && postValues[token].trim() === "") emptyPlaceholders.push({ lotNo: null, token });
  }
  for (const lot of sorted) {
    const known = knownTokens(lot.listingType, "caption");
    const values = placeholderValues(lot, "");
    for (const token of new Set(facebookCaptionLotTemplate(captions, lot).match(TOKEN) ?? [])) {
      if (!known.has(token)) continue;
      if (token === "{lot}" && lot.lotNo == null) continue;
      if (values[token].trim() === "") emptyPlaceholders.push({ lotNo: lot.lotNo, token });
    }
  }
  return {
    missingTemplates,
    emptyOwnTemplates,
    emptyPlaceholders,
    missingPostText: !captions.post.trim(),
  };
}

/**
 * A lot's post as it was published (#1800): the template it was written from and everything that
 * filled it in, kept from the moment the offer first went up — Pending or Active — so that editing a
 * template, the offer's own or its figures leaves what the group shows exactly as it was posted. Raw
 * as the kit carries them: the closing time is written out in the browser, the one place the zone is
 * known (#490), so an instant is kept rather than the words.
 */
export interface FacebookFrozenLot {
  /** When the lot was frozen, ISO-8601. */
  frozenAt: string;
  listingType: OfferListingType;
  /** The template the lot was written from — its offer's own (#1780), or its group's for its type. */
  template: string;
  /** The note on shipping, payment and terms as it read (#1689); a post states the last lot's. */
  standingNote: string;
  title: string;
  description: string;
  catalog: string;
  startingPrice: string | null;
  bidIncrement: string | null;
  /** A quick buy's asking price; null on an auction, whose price is its running bid. */
  price: string | null;
  currency: string;
  /** ISO-8601, or null. The one figure that moves after freezing: an approval that states a new
   *  closing time writes it here too (#1800, decided with the collector on 2026-10-11). */
  endsAt: string | null;
  /** How the lot's post was laid out (#1841) — `captions` when `template` is the lot's caption and
   *  `postText` the post's shared text. A snapshot older than the layout is `text`. */
  layout: FacebookMultiLotLayout;
  /** A captioned post's shared text as it was published (#1841); empty in the `text` layout. */
  postText: string;
}

/** A stored snapshot read back, or null when there is none or it is not one — a lot with no readable
 *  snapshot is drawn live, as it was before #1800. */
export function readFacebookFrozenLot(value: unknown): FacebookFrozenLot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string) : null);
  const optional = (key: string) => (v[key] == null ? null : text(key));
  const frozenAt = text("frozenAt");
  const template = text("template");
  const listingType = v.listingType === "auction" || v.listingType === "fixed" ? v.listingType : null;
  if (frozenAt === null || template === null || listingType === null) return null;
  return {
    frozenAt,
    listingType,
    template,
    standingNote: text("standingNote") ?? "",
    title: text("title") ?? "",
    description: text("description") ?? "",
    catalog: text("catalog") ?? "",
    startingPrice: optional("startingPrice"),
    bidIncrement: optional("bidIncrement"),
    price: optional("price"),
    currency: text("currency") ?? "",
    endsAt: optional("endsAt"),
    layout: toFacebookMultiLotLayout(text("layout")),
    postText: text("postText") ?? "",
  };
}

/** One lot as the offer's kit hands it over: its figures as they are now, and its post as it was
 *  published, if it has been (#1800). */
export interface FacebookPostSourceLot {
  offerId: string;
  lotNo: number | null;
  offerNo: number;
  listingType: OfferListingType;
  title: string;
  description: string;
  catalog: string;
  startingPrice: string | null;
  bidIncrement: string | null;
  currency: string;
  endsAt: string | null;
  /** An auction's running bid, a quick buy's asking price. */
  price: string;
  ownTemplate: string | null;
  frozen: FacebookFrozenLot | null;
}

/** What a post is rendered from: the templates and note, and each lot written out. `frozenAt` is when
 *  the post was published — set only when every lot is drawn as it was posted. `layout` is how the
 *  post is laid out (#1841), and `captions` the templates a captioned one is written from. */
export interface FacebookPostSource {
  templates: FacebookPostTemplates;
  captions: FacebookCaptionTemplates;
  layout: FacebookMultiLotLayout;
  standingNote: string;
  lots: FacebookPostLotText[];
  frozenAt: string | null;
}

/** The group's templates and note as the source reads them, and the layout the post has **now** — its
 *  own, or its group's (#1841); `text` for an offer posted alone. */
export interface FacebookPostSourceGroup {
  postTemplate: string;
  quickBuyTemplate: string;
  standingNote: string;
  auctionCaptionTemplate: string;
  quickBuyCaptionTemplate: string;
  captionPostTemplate: string;
  layout: FacebookMultiLotLayout;
}

/**
 * The post to draw (#1800): a lot that has been published as it was posted — its own template, note
 * and figures, whatever has changed since — and a lot not yet published from its group's templates and
 * its figures now. `live` names the lots drawn as they would be posted **now** even though frozen: a
 * repost puts the current template and figures up again (#1718). The note is the last lot's: frozen
 * with it, or the group's.
 */
export function facebookPostSource<L extends FacebookPostSourceLot>(
  group: FacebookPostSourceGroup,
  lots: readonly L[],
  closesAt: (iso: string | null) => string,
  live: (lot: L) => boolean = () => false
): FacebookPostSource {
  const frozenOf = (lot: L) => (live(lot) ? null : lot.frozen);
  const texts = lots.map((lot): FacebookPostLotText => {
    const frozen = frozenOf(lot);
    const figures = frozen ?? { ...lot, price: lot.price as string | null };
    return {
      lotNo: lot.lotNo,
      offerNo: lot.offerNo,
      listingType: figures.listingType,
      title: figures.title,
      description: figures.description,
      catalog: figures.catalog,
      startingPrice: facebookMoney(figures.startingPrice, figures.currency),
      increment: facebookMoney(figures.bidIncrement, figures.currency),
      closesAt: closesAt(figures.endsAt),
      price: isAuctionListing(figures.listingType) ? "" : facebookMoney(figures.price, figures.currency),
      ownTemplate: frozen ? frozen.template : lot.ownTemplate,
    };
  });
  const last = inLotOrder(lots).at(-1);
  const lastFrozen = last ? frozenOf(last) : null;
  const frozenAts = lots.map((lot) => frozenOf(lot)?.frozenAt);
  const allFrozen = lots.length > 0 && frozenAts.every((at): at is string => at !== undefined);
  // A published post keeps the layout it went up in and its shared text (#1841), read off its last
  // lot as the note is.
  return {
    templates: { auction: group.postTemplate, quickBuy: group.quickBuyTemplate },
    captions: {
      auction: group.auctionCaptionTemplate,
      quickBuy: group.quickBuyCaptionTemplate,
      post: lastFrozen ? lastFrozen.postText : group.captionPostTemplate,
    },
    layout: lastFrozen ? lastFrozen.layout : group.layout,
    standingNote: lastFrozen ? lastFrozen.standingNote : group.standingNote,
    lots: texts,
    frozenAt: allFrozen ? (frozenAts as string[]).reduce((a, b) => (b > a ? b : a)) : null,
  };
}

/** A figure as a post states it: `10 PLN`, `10.50 PLN` (#1787), or empty when there is none. */
export function facebookMoney(amount: string | null, currency: string): string {
  return amount ? `${generatedAmount(amount)} ${currency}` : "";
}

/** Whether a lot has gone up with its post — anything past Ready. A post is up once one of its lots
 *  is (#1668): the post's link is each lot's own listing link, so there is no post-level mark to read. */
export function isFacebookLotPosted(state: string): boolean {
  return state !== "preparing" && state !== "ready";
}

/** The link of a post holding several lots, read off its lots (#1778): the one most of them carry,
 *  since publishing writes it into every lot with no link of its own and a lot keeping its photo's
 *  link is the exception. The first lot's wins a tie; null when none carries a link. */
export function facebookPostLink(lots: readonly { url: string | null }[]): string | null {
  const counts = new Map<string, number>();
  for (const lot of lots) {
    const url = lot.url?.trim();
    if (url) counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [url, n] of counts) if (best === null || n > counts.get(best)!) best = url;
  return best;
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
