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

import { normalizeDecimalInput, roundAmount } from "./decimal-input";
import {
  FACEBOOK_POST_TITLE_PLACEHOLDER,
  FACEBOOK_RETIRED_PLACEHOLDERS,
  FACEBOOK_TERMS_PLACEHOLDER,
  facebookTemplatePlaceholders,
  toFacebookMultiLotLayout,
  type FacebookMultiLotLayout,
  type FacebookStartingPriceMode,
  type FacebookTemplateRole,
} from "./facebook-group-rules";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { isAuctionListing, offerFileSlug, type OfferListingType } from "./offer-rules";
import {
  DEFAULT_CURRENCY_STYLE,
  isCurrencyStyle,
  resolveTemplateToken,
  splitTemplateToken,
  TEMPLATE_TOKEN,
  templateNumbers,
  writtenAmount,
  type CurrencyStyle,
  type TemplateValue,
} from "./template-amount";

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
  /** An auction's figures as 2-dp strings, null where it states none — written out by the placeholder
   *  in the currency style it asks for (#2028): `10 zł`, `10 PLN`, `10`. */
  startingPrice: string | null;
  increment: string | null;
  closesAt: string;
  /** A quick buy's asking price (#1671), the same way; null on an auction. */
  price: string | null;
  /** The currency the figures are in. */
  currency: string;
  /** What an amount placeholder with no parameter writes: the symbol (#2028), or the code for a lot
   *  frozen before there were symbols (#1800). Absent is the symbol. */
  currencyStyle?: CurrencyStyle;
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

const TOKEN = TEMPLATE_TOKEN;

/** The placeholders a lot of this type fills in: its type's own — its post's, or its caption's
 *  (#1841) — and, in a post template, the retired ones (#1671). */
function knownTokens(listingType: OfferListingType, role: FacebookTemplateRole = "post"): Set<string> {
  return new Set<string>([
    ...facebookTemplatePlaceholders(role, listingType).map((p) => p.token),
    ...(role === "post" ? FACEBOOK_RETIRED_PLACEHOLDERS : []),
  ]);
}

/** The post a text names (#1854, #1862): its number, and its title — null on a post made before titles
 *  until it is given one, or on a post of one whose offer has no title (#2116). */
export interface FacebookPostName {
  postNo: number;
  title: string | null;
}

/** A multi-lot post as the app names it wherever it is named (#1862): *Post #1 · Generalgouvernement
 *  1940–44*, or *Post #1* while a post made before titles has none. */
export function facebookPostLabel(post: FacebookPostName): string {
  const title = post.title?.trim();
  return title ? `Post #${post.postNo} · ${title}` : `Post #${post.postNo}`;
}

/** Why a post cannot be given this title, or null when it can (#1862): every multi-lot post has one,
 *  so a blank title is refused — on *Post together* and on renaming alike. */
export function facebookPostTitleRefusal(title: string): string | null {
  return title.trim() ? null : "A post needs a title.";
}

/** Where *Add to titles…* / *Remove from titles…* work on every lot's title (#2033). */
export type FacebookTitleEdge = "start" | "end";

/** Whether the words go onto the titles or come off them (#2033). */
export type FacebookTitleWordsMode = "add" | "remove";

/**
 * One lot's title with `words` added at, or removed from, its `edge` (#2033) — or null when it stays as
 * it is. Added words are joined to the title by one space. Removing takes them away only where the
 * title starts or ends with them exactly — as whole words, so *Rare* does not cut *Rarest* — together
 * with the space that joined them, and never leaves a title empty: a title that is nothing but the
 * words keeps them.
 */
export function facebookTitleWithWords(
  title: string,
  words: string,
  edge: FacebookTitleEdge,
  mode: FacebookTitleWordsMode
): string | null {
  const text = words.trim();
  const base = title.trim();
  if (!text) return null;
  if (mode === "add") {
    if (!base) return text;
    return edge === "start" ? `${text} ${base}` : `${base} ${text}`;
  }
  if (edge === "start" ? !base.startsWith(text) : !base.endsWith(text)) return null;
  const rest = edge === "start" ? base.slice(text.length) : base.slice(0, base.length - text.length);
  // The words' own edge character and the title's character beside them: a cut between two letters or
  // digits would split a word.
  const inner = edge === "start" ? text[text.length - 1] : text[0];
  const beside = edge === "start" ? rest[0] : rest[rest.length - 1];
  if (beside !== undefined && WORD_CHAR.test(inner) && WORD_CHAR.test(beside)) return null;
  return rest.trim() || null;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** What `{post}` and `{postTitle}` become: the post's number and title, empty where there is none. */
function postNameValues(post: FacebookPostName | null): Record<string, TemplateValue> {
  return {
    "{post}": templateNumbers(post?.postNo),
    [FACEBOOK_POST_TITLE_PLACEHOLDER.token]: post?.title?.trim() ?? "",
  };
}

/** What each placeholder becomes for this lot. `{terms}` is `terms`, empty unless this lot is where
 *  the post states the note (#1689); `{post}` and `{postTitle}` are the post's number (#1854) and
 *  title (#1862) — empty where there is none. */
function placeholderValues(
  lot: FacebookPostLotText,
  terms: string,
  post: FacebookPostName | null = null
): Record<string, TemplateValue> {
  const money = (amount: string | null) => (style: CurrencyStyle) =>
    amount ? writtenAmount(amount, lot.currency, style) : "";
  return {
    "{title}": lot.title,
    "{description}": lot.description,
    "{catalog}": lot.catalog,
    "{startingPrice}": money(lot.startingPrice),
    "{increment}": money(lot.increment),
    "{closesAt}": lot.closesAt,
    "{price}": money(lot.price),
    "{lot}": templateNumbers(lot.lotNo),
    "{offer}": templateNumbers(lot.offerNo),
    "{terms}": terms.trim(),
    ...postNameValues(post),
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
 * (#1689) — `terms`, empty unless this lot is where the post states it. `post` is what `{post}` and
 * `{postTitle}` become (#1854, #1862) — in every template since #2116, every Facebook offer being in
 * a post from the moment it is made.
 */
export function renderFacebookLotParts(
  template: string,
  lot: FacebookPostLotText,
  terms = "",
  role: "post" | "caption" = "post",
  post: FacebookPostName | null = null
): FacebookPostPart[] {
  return fillTemplate(
    template,
    knownTokens(lot.listingType, role),
    placeholderValues(lot, terms, post),
    lotCurrencyStyle(lot)
  );
}

function lotCurrencyStyle(lot: FacebookPostLotText): CurrencyStyle {
  return lot.currencyStyle ?? DEFAULT_CURRENCY_STYLE;
}

/** What `token` becomes among the `known` placeholders, or null when it is none of them — another
 *  type's placeholder, or a currency parameter that is not one (#2028) — and so stays as typed. */
function knownValue(
  token: string,
  known: Set<string>,
  values: Record<string, TemplateValue>,
  style: CurrencyStyle
): string | null {
  return known.has(splitTemplateToken(token).placeholder) ? resolveTemplateToken(token, values, style) : null;
}

/** A template with the known tokens replaced by their values, everything else kept as typed. */
function fillTemplate(
  template: string,
  known: Set<string>,
  values: Record<string, TemplateValue>,
  style: CurrencyStyle = DEFAULT_CURRENCY_STYLE
): FacebookPostPart[] {
  const parts: FacebookPostPart[] = [];
  let from = 0;
  for (const match of template.matchAll(TOKEN)) {
    const token = match[0];
    const value = knownValue(token, known, values, style);
    if (value === null) continue;
    if (match.index > from) parts.push({ value: false, text: template.slice(from, match.index) });
    parts.push({ value: true, text: value });
    from = match.index + token.length;
  }
  if (from < template.length) parts.push({ value: false, text: template.slice(from) });
  return parts;
}

/** {@link renderFacebookLotParts} as one string — the lot's text as the template's source reads. */
export function renderFacebookLotText(
  template: string,
  lot: FacebookPostLotText,
  terms = "",
  post: FacebookPostName | null = null
): string {
  return partsText(renderFacebookLotParts(template, lot, terms, "post", post));
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

/** Which of its offer's texts a lot's template prints (#1889): `{title}` the title, `{description}`
 *  the description — the two through which a name of the offer's own templates reaches the post. The
 *  post's and the caption's other placeholders are figures, numbers and the collector's own words. */
export function facebookLotPrintedTexts(template: string): ("name" | "description")[] {
  const tokens = new Set(template.match(TOKEN) ?? []);
  return [
    ...(tokens.has("{title}") ? (["name"] as const) : []),
    ...(tokens.has("{description}") ? (["description"] as const) : []),
  ];
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
 * `post` is the post the lots are in, whose number and title `{post}` and `{postTitle}` write (#2116).
 */
export function renderFacebookPostParts(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[],
  post: FacebookPostName | null = null
): FacebookPostPart[] {
  const sorted = inLotOrder(lots);
  const written = sorted
    .map((lot, i) =>
      renderFacebookLotParts(
        facebookLotTemplate(templates, lot),
        lot,
        i === sorted.length - 1 ? standingNote : "",
        "post",
        post
      )
    )
    .filter((parts) => partsText(parts).trim() !== "");
  return written.flatMap((parts, i) => (i === 0 ? parts : [{ value: false, text: "\n\n" }, ...parts]));
}

/** {@link renderFacebookPostParts} as one string — the post's source, its formatting as typed. */
export function renderFacebookPostText(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[],
  post: FacebookPostName | null = null
): string {
  return partsText(renderFacebookPostParts(templates, standingNote, lots, post));
}

/** A placeholder a lot's template places that comes out empty, and the lot it is in. */
export interface FacebookEmptyPlaceholder {
  /** The lot's number in a multi-lot post, or null for an offer posted alone. */
  lotNo: number | null;
  token: string;
}

/** What a post is missing (#1692), for the card to name: the templates its lots' types have none of,
 *  the lots whose own template is empty (#1780), and the placeholders its templates place that are
 *  empty. `missingPostTitle` is the post's want of a title (#1862) where a template places
 *  `{postTitle}` — named once for the post, never per lot, since one title fills every place. */
export interface FacebookPostGaps {
  missingTemplates: OfferListingType[];
  /** The lots (by `lotNo`, null for an offer posted alone) whose offer's own template is empty. */
  emptyOwnTemplates: (number | null)[];
  emptyPlaceholders: FacebookEmptyPlaceholder[];
  missingPostTitle: boolean;
}

/**
 * What the post as `renderFacebookPostText` writes it is missing (#1692) — nothing is filled in to hide
 * it, so the card names it instead. A type with lots in the post that follow the group and no template
 * is missing; a lot whose own template (#1780) is empty is named by itself, since the group's template
 * is not what it lacks; a placeholder the template places and the lot leaves empty is named per lot,
 * once per token. Two are
 * empty by the post's own rule rather than for want of anything, and are not named: `{lot}` on an
 * offer posted alone, and `{terms}` in every lot but the last, where the note is stated once. An empty
 * `{postTitle}` is the post's one `missingPostTitle`.
 */
export function facebookPostGaps(
  templates: FacebookPostTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[],
  post: FacebookPostName | null = null
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
  let missingPostTitle = false;
  sorted.forEach((lot, i) => {
    const template = facebookLotTemplate(templates, lot);
    const known = knownTokens(lot.listingType);
    const last = i === sorted.length - 1;
    const values = placeholderValues(lot, last ? standingNote : "", post);
    const seen = new Set<string>();
    for (const written of template.match(TOKEN) ?? []) {
      const value = knownValue(written, known, values, lotCurrencyStyle(lot));
      // Named by the placeholder, whatever currency parameter it was written with (#2028).
      const token = splitTemplateToken(written).placeholder;
      if (value === null || seen.has(token)) continue;
      seen.add(token);
      if (token === "{lot}" && lot.lotNo == null) continue;
      if (token === FACEBOOK_TERMS_PLACEHOLDER.token && !last) continue;
      if (value.trim() !== "") continue;
      if (token === FACEBOOK_POST_TITLE_PLACEHOLDER.token) missingPostTitle = true;
      else emptyPlaceholders.push({ lotNo: lot.lotNo, token });
    }
  });
  return { missingTemplates, emptyOwnTemplates, emptyPlaceholders, missingPostTitle };
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
 * numbers, bare, in lot order) and `{terms}`. Both carry `{post}` and `{postTitle}`, the post's number
 * and title (#1854, #1862). Nothing is added or fallen back to (#1692): an empty template is an empty
 * caption or an empty post, and a post with no title leaves `{postTitle}` empty.
 */
export function renderFacebookCaptionedPost(
  captions: FacebookCaptionTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[],
  post: FacebookPostName | null
): FacebookCaptionedPost {
  const sorted = inLotOrder(lots);
  return {
    post: fillTemplate(
      captions.post,
      knownTokens("auction", "captionPost"),
      captionPostValues(sorted, standingNote, post)
    ),
    captions: sorted.map((lot) => ({
      lotNo: lot.lotNo,
      offerNo: lot.offerNo,
      parts: renderFacebookLotParts(facebookCaptionLotTemplate(captions, lot), lot, "", "caption", post),
    })),
  };
}

function captionPostValues(
  sorted: readonly FacebookPostLotText[],
  standingNote: string,
  post: FacebookPostName | null
): Record<string, TemplateValue> {
  return {
    "{offer}": templateNumbers(...sorted.map((lot) => lot.offerNo)),
    ...postNameValues(post),
    [FACEBOOK_TERMS_PLACEHOLDER.token]: standingNote.trim(),
  };
}

/** What a captioned post is missing (#1841): {@link FacebookPostGaps} for its captions — the caption
 *  templates its lots' types have none of, the lots whose own template is empty, the placeholders a
 *  caption leaves empty — and for its shared text, whether there is none and the placeholders it
 *  leaves empty (named with `lotNo: null`); `missingPostTitle` counts its text and its captions. */
export interface FacebookCaptionedPostGaps extends FacebookPostGaps {
  missingPostText: boolean;
}

export function facebookCaptionedPostGaps(
  captions: FacebookCaptionTemplates,
  standingNote: string,
  lots: readonly FacebookPostLotText[],
  post: FacebookPostName | null
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
  const title = FACEBOOK_POST_TITLE_PLACEHOLDER.token;
  let missingPostTitle = false;
  const postValues = captionPostValues(sorted, standingNote, post);
  const postKnown = knownTokens("auction", "captionPost");
  for (const token of new Set(captions.post.match(TOKEN) ?? [])) {
    const value = knownValue(token, postKnown, postValues, DEFAULT_CURRENCY_STYLE);
    if (value === null || value.trim() !== "") continue;
    if (token === title) missingPostTitle = true;
    else emptyPlaceholders.push({ lotNo: null, token });
  }
  for (const lot of sorted) {
    const known = knownTokens(lot.listingType, "caption");
    const values = placeholderValues(lot, "", post);
    const seen = new Set<string>();
    for (const written of facebookCaptionLotTemplate(captions, lot).match(TOKEN) ?? []) {
      const value = knownValue(written, known, values, lotCurrencyStyle(lot));
      // Named by the placeholder, whatever currency parameter it was written with (#2028).
      const token = splitTemplateToken(written).placeholder;
      if (value === null || seen.has(token)) continue;
      seen.add(token);
      if (token === "{lot}" && lot.lotNo == null) continue;
      if (value.trim() !== "") continue;
      if (token === title) missingPostTitle = true;
      else emptyPlaceholders.push({ lotNo: lot.lotNo, token });
    }
  }
  return {
    missingTemplates,
    emptyOwnTemplates,
    emptyPlaceholders,
    missingPostText: !captions.post.trim(),
    missingPostTitle,
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
  /** The post's title as it was published (#1862) — what `{postTitle}` put up, so renaming the post
   *  afterwards leaves the posted text as it was; empty for a post with none, or an offer posted alone.
   *  Null on a snapshot older than titles, which could not have placed one: the post's title now. */
  postTitle: string | null;
  /** What an amount placeholder with no parameter wrote when the lot was frozen (#2028): the symbol
   *  since then. A snapshot older than symbols wrote the code, and is read back so. */
  currencyStyle: CurrencyStyle;
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
    postTitle: text("postTitle"),
    currencyStyle: isCurrencyStyle(v.currencyStyle) ? v.currencyStyle : "code",
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
 *  post is laid out (#1841), and `captions` the templates a captioned one is written from. `post` is
 *  the multi-lot post's number and title (#1854, #1862) — the title as it was posted once it is up —
 *  and null for an offer posted alone. */
export interface FacebookPostSource {
  templates: FacebookPostTemplates;
  captions: FacebookCaptionTemplates;
  layout: FacebookMultiLotLayout;
  standingNote: string;
  lots: FacebookPostLotText[];
  frozenAt: string | null;
  post: FacebookPostName | null;
}

/** The group's templates and note as the source reads them, and the layout the post has **now** — its
 *  own, or its group's (#1841); `text` for an offer posted alone. `post` is the post the lots are in,
 *  its title as it reads now (#1862); absent or null for an offer in no post. A post of one lot
 *  (#1989) is laid out as `text` and its lot carries no number, so it renders as one posted alone. */
export interface FacebookPostSourceGroup {
  postTemplate: string;
  quickBuyTemplate: string;
  standingNote: string;
  auctionCaptionTemplate: string;
  quickBuyCaptionTemplate: string;
  captionPostTemplate: string;
  layout: FacebookMultiLotLayout;
  post?: FacebookPostName | null;
}

/**
 * The post to draw (#1800): a lot that has been published as it was posted — its own template, note
 * and figures, whatever has changed since — and a lot not yet published from its group's templates and
 * its figures now. `live` names the lots drawn as they would be posted **now** even though frozen: a
 * repost puts the current template and figures up again (#1718). The note is the last lot's: frozen
 * with it, or the group's — and so is the post's title (#1862), while its number is read live: it is
 * the post's identity and never changes.
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
      startingPrice: figures.startingPrice,
      increment: figures.bidIncrement,
      closesAt: closesAt(figures.endsAt),
      price: isAuctionListing(figures.listingType) ? null : figures.price,
      currency: figures.currency,
      currencyStyle: frozen ? frozen.currencyStyle : DEFAULT_CURRENCY_STYLE,
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
    post: group.post
      ? { postNo: group.post.postNo, title: lastFrozen?.postTitle ?? group.post.title }
      : null,
  };
}

/** Whether a lot has gone up with its post — anything past Ready. A post is up once one of its lots
 *  is (#1668): the post's link is each lot's own listing link, so there is no post-level mark to read. */
export function isFacebookLotPosted(state: string): boolean {
  return state !== "preparing" && state !== "ready";
}

/** The moves a multi-lot post's own screen offers as one (#1842), read off its lots' states with the
 *  gates `publishFacebookPost`, `rejectOfferOrPost` and `withdrawOfferOrPost` ask — so a button is
 *  offered only where the server would take it:
 *
 *  - `activate` / `submit` — nothing waiting for approval, every lot Ready or already where the move
 *    takes it, and at least one Ready (a refusal halfway through is finished by asking again). The
 *    screen draws one *Publish…* for `activate` (#1847); `submit` says whether its dialog may offer
 *    *Waiting for approval*;
 *  - `approve` / `reject` / `withdraw` — while any lot waits for the group's approval: the group
 *    approves or turns down the post, and withdrawing a pending post takes it back whole (#1779);
 *  - `backToReady` — while the post is up and a lot of it is still for sale (#1998): a Publish that
 *    was a mistake, or a post gone from the group, taken back to Ready (`facebookBackToReadyPlan`);
 *  - `backToPreparing` — while the post is not up and a lot of it is Ready (#2115): every Ready lot
 *    taken back to Preparing, as each offer's own *Back to preparing* would;
 *  - `takeOut` — a lot may leave the post only until the post is up, and only a post of several lots:
 *    a lot taken out is a post of one (#2116), which the only lot of a post already is;
 *  - `addLots` — offers may join the post as further lots only until it is up, too (#1870);
 *  - `waiting` — the lots still short of Ready before anything has gone up, by lot number. */
export interface FacebookPostMoves {
  activate: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  withdraw: boolean;
  backToReady: boolean;
  backToPreparing: boolean;
  takeOut: boolean;
  addLots: boolean;
  waiting: number[];
}

export function facebookPostMoves(lots: readonly { state: string; lotNo: number | null }[]): FacebookPostMoves {
  const posted = lots.some((l) => isFacebookLotPosted(l.state));
  const pending = lots.some((l) => l.state === "pending");
  const ready = lots.some((l) => l.state === "ready");
  const onlyIn = (states: readonly string[]) => lots.every((l) => states.includes(l.state));
  return {
    activate: !pending && ready && onlyIn(["ready", "active"]),
    submit: !pending && ready && onlyIn(["ready"]),
    approve: pending && onlyIn(["ready", "pending", "active"]),
    reject: pending,
    withdraw: pending,
    backToReady: !pending && lots.some((l) => isFacebookLotUp(l.state)),
    backToPreparing: !posted && ready,
    takeOut: !posted && lots.length > 1,
    addLots: !posted,
    waiting: posted ? [] : lots.filter((l) => l.state !== "ready").map((l) => l.lotNo ?? 0),
  };
}

/** Whether a lot is up in the group and still for sale — running or paused. */
function isFacebookLotUp(state: string): boolean {
  return state === "active" || state === "paused";
}

/** What taking a post that is up back to Ready does to its lots (#1998), as its confirmation names
 *  them: the lots still for sale go back (`going`, in lot order), a lot sold or withdrawn stays where
 *  it is (`staying`) — and then the post is split, the lots going back moving into a new post — and
 *  an auction going back with a bid recorded has it cleared (`bidsCleared`). */
export interface FacebookBackToReadyPlan<T> {
  going: T[];
  staying: T[];
  bidsCleared: T[];
}

export function facebookBackToReadyPlan<T extends { state: string; listingType: OfferListingType; price: string }>(
  lots: readonly T[]
): FacebookBackToReadyPlan<T> {
  const staying = lots.filter((l) => l.state === "sold" || l.state === "withdrawn");
  const going = lots.filter((l) => !staying.includes(l));
  const bidsCleared = going.filter(
    (l) => isFacebookLotUp(l.state) && isAuctionListing(l.listingType) && Number(l.price) > 0
  );
  return { going, staying, bidsCleared };
}

/** Where a multi-lot post stands as a whole (#1842), read off its lots — what the post's screen and
 *  each lot's card say it is: still being prepared, ready to post, waiting for the group's approval,
 *  up in the group, or over (every lot sold or withdrawn). */
export type FacebookPostStage = "preparing" | "ready" | "pending" | "up" | "over";

/** The stages in the order a post passes through them — the list of posts' filter chips (#1850). */
export const FACEBOOK_POST_STAGES: readonly FacebookPostStage[] = ["preparing", "ready", "pending", "up", "over"];

export function isFacebookPostStage(value: string): value is FacebookPostStage {
  return (FACEBOOK_POST_STAGES as readonly string[]).includes(value);
}

export const FACEBOOK_POST_STAGE_LABEL: Record<FacebookPostStage, string> = {
  preparing: "Being prepared",
  ready: "Ready to post",
  pending: "Waiting for approval",
  up: "Up in the group",
  over: "Over",
};

export function facebookPostStage(lots: readonly { state: string }[]): FacebookPostStage {
  if (lots.some((l) => l.state === "pending")) return "pending";
  if (lots.some((l) => l.state === "active" || l.state === "paused")) return "up";
  if (lots.some((l) => isFacebookLotPosted(l.state))) return "over";
  return lots.every((l) => l.state === "ready") ? "ready" : "preparing";
}

/** A post's number as a list filter carries it (#1842): a positive whole number, else no filter. */
export function parseFacebookPostNo(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 && Number.isSafeInteger(n) ? n : undefined;
}

/** The name a lot's photo takes in a post laid out as text (#1544, #1848): its lot, two digits, before
 *  the image's own upload name — what keeps an album's files in lot order, in the ZIP and one by one. */
export function facebookLotPhotoFileName(lotNo: number, fileName: string): string {
  return `lot-${String(lotNo).padStart(2, "0")}-${fileName}`;
}

/** The name of a post's photo archive, in either layout (#1871): its number, then its title's slug —
 *  `12-generalgouvernement-1940-44-photos.zip` — made as an offer's is (#1754), so two posts never
 *  download under one name. A post with no title (one made before #1862) is its number alone. */
export function facebookPostPhotoArchiveName(postNo: number, title: string | null | undefined): string {
  return `${offerFileSlug(title, postNo)}-photos.zip`;
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
  /** How many lots the offer's post holds, itself included — 0 in no post. An offer alone in its post
   *  is free to join another (#2116): its post of one goes. */
  postLots: number;
  state: string;
  url: string | null;
}

/** Whether an offer is a lot of a post of several — the one post it cannot leave by joining another.
 *  An offer alone in its post of one may (#2116). */
function inPostOfSeveral(offer: Pick<FacebookPostCandidate, "facebookPostId" | "postLots">): boolean {
  return offer.facebookPostId !== null && offer.postLots > 1;
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
  const inPost = offers.filter(inPostOfSeveral);
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

/** The post an offer is being added to (#1870): its group, whether that group's posts may mix
 *  auctions and quick buys, and the listing types its lots already are. */
export interface FacebookLotAddTarget {
  postId: string;
  groupId: string;
  mixedListingTypes: boolean;
  lotTypes: readonly OfferListingType[];
}

/**
 * Why one offer cannot become a further lot of an existing post (#1870), or null when it can — the
 * conditions *Post together* asks of every offer, asked of this one against the post: a Facebook offer
 * in the post's group, in no post of several (alone in its post of one, #2116), not yet up, and of a
 * type the post already holds unless its group lets posts mix them. Phrased to follow the offer's
 * number, which the caller puts before it.
 */
export function facebookLotAddRefusal(
  offer: FacebookPostCandidate,
  post: FacebookLotAddTarget
): string | null {
  if (offer.facebookGroupId === null) return "is not a Facebook offer";
  if (offer.facebookGroupId !== post.groupId) return "is in another group";
  if (offer.facebookPostId === post.postId) return "is already a lot of this post";
  if (inPostOfSeveral(offer)) return "is already a lot of another post";
  if (isFacebookLotPosted(offer.state)) return "is already up or closed";
  if (!post.mixedListingTypes && !post.lotTypes.includes(offer.listingType)) {
    const kind = isAuctionListing(offer.listingType) ? "an auction" : "a quick buy";
    const lots = post.lotTypes.every((t) => isAuctionListing(t)) ? "auctions" : "quick buys";
    return `is ${kind} and this post's lots are ${lots}`;
  }
  return null;
}

// ── The order of a post's lots (#1986) ──────────────────────────────────────────────────────────

/** What a lot is offered at, as the post's screen reads it: an auction's recorded bid, else its
 *  starting price; a quick buy's asking price. The *by price* sort orders by the same figure. */
export function facebookLotPrice(lot: {
  listingType: OfferListingType;
  price: string;
  startingPrice: string | null;
}): { label: "Price" | "Bid" | "Start"; amount: string | null } {
  if (!isAuctionListing(lot.listingType)) return { label: "Price", amount: lot.price };
  if (lot.price !== "0.00") return { label: "Bid", amount: lot.price };
  return { label: "Start", amount: lot.startingPrice };
}

/** The shortcuts that sort a whole post (#1986): by catalogue number, or by price either way. */
export type FacebookLotSort = "catalog" | "priceAsc" | "priceDesc";

export const FACEBOOK_LOT_SORTS: readonly FacebookLotSort[] = ["catalog", "priceAsc", "priceDesc"];

export const FACEBOOK_LOT_SORT_LABEL: Record<FacebookLotSort, string> = {
  catalog: "catalogue number",
  priceAsc: "price, lowest first",
  priceDesc: "price, highest first",
};

/**
 * A post's lots in the order a sort shortcut puts them (#1986), as offer ids. By catalogue number is
 * each lot's lowest number (`catalogSortKey`, the stored key's rule); by price is the figure the row
 * shows (`facebookLotPrice`). A lot with no number or no price goes last either way, and lots that
 * tie keep the order they had — the result is a starting point, still adjusted by hand.
 */
export function sortFacebookLots(
  lots: readonly {
    offerId: string;
    catalogSortKey: string | null;
    listingType: OfferListingType;
    price: string;
    startingPrice: string | null;
  }[],
  by: FacebookLotSort
): string[] {
  const priced = (lot: (typeof lots)[number]) => {
    const amount = facebookLotPrice(lot).amount;
    const value = amount === null ? NaN : Number(amount);
    return Number.isFinite(value) ? value : null;
  };
  const compare = (a: (typeof lots)[number], b: (typeof lots)[number]): number => {
    if (by === "catalog") return compareCatalogSortKeys(a.catalogSortKey, b.catalogSortKey);
    const pa = priced(a);
    const pb = priced(b);
    if (pa === pb) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return by === "priceAsc" ? pa - pb : pb - pa;
  };
  // `Array.prototype.sort` is stable, so lots that tie keep their order.
  return [...lots].sort(compare).map((l) => l.offerId);
}

/** Why a new order cannot be written to a post (#1986): it must name every lot of the post once and
 *  nothing else — a lot added or taken out meanwhile makes it stale. Null when it can. */
export function facebookLotOrderRefusal(lotIds: readonly string[], order: readonly string[]): string | null {
  const own = new Set(lotIds);
  const named = new Set(order);
  if (named.size !== order.length || named.size !== own.size || order.some((id) => !own.has(id))) {
    return "The post's lots have changed since this order was made — reload and try again.";
  }
  return null;
}

/** The offers an add turned away, as one sentence naming each with its reason (#1870); null when none
 *  was. */
export function describeRefusedLots(refused: readonly { offerNo: number; reason: string }[]): string | null {
  if (refused.length === 0) return null;
  return `Not added: ${refused.map((r) => `#${r.offerNo} ${r.reason}`).join("; ")}.`;
}

/** A lot of a post with a sold set (#2060), which keeps the post from being deleted. */
export interface FacebookSoldLot {
  lotNo: number;
  offerNo: number;
}

/** What *Delete post…* says before anything goes (#2060). */
export interface FacebookPostDeletion {
  postNo: number;
  title: string | null;
  /** The offers that go with the post — every lot of it. */
  offerCount: number;
  /** The lots with a sold set, in lot order; while there is one the post cannot be deleted. */
  soldLots: FacebookSoldLot[];
  /** Whether the post was submitted to the group — waiting for approval, up or over — so that the
   *  post in the Facebook group is there to be removed by hand. */
  submitted: boolean;
}

/** Why a post cannot be deleted (#2060): the lots with a sold set, named, since such an offer is
 *  withdrawn and never deleted — the sale record must survive. Null when none has. */
export function facebookPostDeleteRefusal(soldLots: readonly FacebookSoldLot[]): string | null {
  if (soldLots.length === 0) return null;
  const named = soldLots.map((l) => `${l.lotNo} (#${l.offerNo})`);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return soldLots.length === 1
    ? `Lot ${list} has a sold set, so the post cannot be deleted. An offer with a sold set is withdrawn, never deleted.`
    : `Lots ${list} have sold sets, so the post cannot be deleted. An offer with a sold set is withdrawn, never deleted.`;
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
