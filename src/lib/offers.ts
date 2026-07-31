import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import {
  allocateOfferNumber,
  getHoldingsValuationByGroup,
  getHoldingsValuationForItems,
  listItemsPaginated,
  type ItemListItem,
} from "./items";
import type { HoldingsSummary } from "./valuation";
import {
  aggregateOfferAsking,
  type OfferPlatformTotal,
  type OfferSummaryRow,
  type OffersAskingSummary,
} from "./offer-summary";
import { getOrFetchRate, getOrFetchRates } from "./exchange-rates";
import type { BaseCurrency } from "./currencies";
import {
  type OfferState,
  isOfferState,
  canTransition,
  isTerminalState,
  requiresSets,
  requiresPrice,
  hasPrice,
  CLOSED_OFFER_STATES,
} from "./offer-rules";
import {
  makeOfferLabeller,
  STAMP_LABEL_SELECT,
  type LabelSetItemRow,
  type OfferLabeller,
} from "./offer-labels";
import { normalizeDescriptionFormat, type DescriptionFormat } from "./description-format";
import { loadColnectConditionMap } from "./colnect";
import {
  evaluateListingPreconditions,
  type ListingBlocker,
} from "./listing-preconditions";
import {
  compareSetItems,
  hasManualItemOrder,
  nextItemSortOrder,
  sortSetItems,
} from "./offer-set-order";
import {
  renderTitleTemplate,
  renderTitleTemplateSegments,
  renderListingTemplate,
  titleFallbackTokens,
  titleFallbacks,
  listingFallbacks,
  templateUsesOfferContext,
  type TitleSegment,
  type TitleFallback,
  type TemplateSet,
  type TitleTemplateCopy,
  type ListingTemplateContext,
} from "./offer-title-template";
import { offerScreenUrl } from "./app-url";
import { TITLE_COPY_SELECT, makeTitleCopyMapper, type TitleCopyRow } from "./title-copy";
import {
  normalizePhotoSides,
  type OfferPhotoConfigInput,
  type PlatformPhotoLimits,
} from "./offer-photo-config";
import type { PlatformTextLimits } from "./listing-text-limits";
import {
  deleteOfferPhotoBytes,
  type OfferPhotoGenerationStatus,
} from "./offer-photo-generation";
import type { OfferAreaYear } from "./listing-groups";

// Server-side domain logic for **offer-owned composition** (ADR-0013, supersedes ADR-0012 §1–§2).
// An `Offer` is a listing on one platform that **owns its composition directly**: it holds N
// `OfferSet`s, each an atomic sellable unit (one or more copies that leave together — a series
// never breaks apart). Nothing is shared between offers; the same physical copy listed elsewhere
// is a separate offer with its own sets, and the `Item` is the cross-platform thread.
//
// This module owns: offer create / edit / delete + the manual lifecycle (preparing → ready →
// active ↔ paused → withdrawn; `sold` is set by the sale flow, #166), set add / rename / remove, the paginated
// offers list + the offer detail read model, the composable-copies picker, the non-blocking
// collision warning, and the derived **"needs action"** overlay (an active offer holding a set
// whose copy has already sold elsewhere — ADR-0013 §4). The pure state machine lives in
// `offer-rules.ts`, the label rules in `offer-set-rules.ts`. All access is owner-scoped.

// ── Errors ────────────────────────────────────────────────────────────────

export type OfferBlockReason =
  | "not-eligible"
  | "terminal"
  | "bad-transition"
  | "no-platform"
  | "no-currency"
  | "empty"
  | "sold-set"
  /** Going live (#336) without an asking price set. */
  | "unpriced"
  /** A reorder (#306) did not carry the current composition — the client is stale. */
  | "bad-order"
  /** Recording a listing (#412) without the URL that *is* the record. */
  | "no-url"
  /** Marking an offer ready (#418) while a listing precondition (#406) still fails. */
  | "listing-preconditions";

/** Raised when an offer action is refused by a domain guard. `message` is user-facing; the
 * server action maps it to an `{ status: "error" }` response. */
export class OfferActionBlockedError extends Error {
  readonly reason: OfferBlockReason;
  constructor(reason: OfferBlockReason, message: string) {
    super(message);
    this.name = "OfferActionBlockedError";
    this.reason = reason;
  }
}

// ── Ownership helpers ───────────────────────────────────────────────────────

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<{ baseCurrency: string }> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, baseCurrency: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  return { baseCurrency: col.baseCurrency };
}

interface OfferRef {
  collectionId: string;
  platformId: string;
  state: OfferState;
}

async function assertOfferOwner(ownerId: string, offerId: string): Promise<OfferRef> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      platformId: true,
      state: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new Error("Offer not found or access denied.");
  }
  return {
    collectionId: offer.collectionId,
    platformId: offer.platformId,
    state: (isOfferState(offer.state) ? offer.state : "active") as OfferState,
  };
}

interface OfferSetRef {
  offerId: string;
  collectionId: string;
  offerState: OfferState;
}

async function assertOfferSetOwner(ownerId: string, setId: string): Promise<OfferSetRef> {
  const set = await prisma.offerSet.findUnique({
    where: { id: setId },
    select: {
      offerId: true,
      offer: { select: { collectionId: true, state: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!set || set.offer.collection.ownerId !== ownerId) {
    throw new Error("Offer set not found or access denied.");
  }
  return {
    offerId: set.offerId,
    collectionId: set.offer.collectionId,
    offerState: (isOfferState(set.offer.state) ? set.offer.state : "active") as OfferState,
  };
}

/** The templates a platform generates its listing texts from, plus the language they are written in.
 * A null / blank template means the field is not generated at all: the title then falls back to the
 * derived label (#209), and the description (#266) / private note (#267) simply stay empty — which is
 * also how a platform without a private-note feature is configured. */
interface PlatformTemplates {
  titleTemplate: string | null;
  descriptionTemplate: string | null;
  privateNoteTemplate: string | null;
  /** Listing language (#293), null when the platform lists in the collection's default language. */
  titleLanguage: string | null;
}

/** What the platform's description field accepts (#319) — seeded onto every offer created on it,
 * exactly as the photo defaults are, so a listing keeps the interpretation it was written for. */
interface PlatformDescriptionFormat {
  descriptionFormat: string;
}

/** The photo defaults a platform seeds onto every offer created on it (#308): which scan sides to
 * include, the per-tile label template (#312), and the collage template (#307) whose render numbers
 * are copied in. The platform's *limits* are deliberately not here — they describe what the platform
 * accepts and are read live at render time (#310). */
interface PlatformPhotoDefaults {
  photoSides: string;
  tileLabelLeftTemplate: string | null;
  tileLabelRightTemplate: string | null;
  defaultCollageTemplateId: string | null;
}

/** The offer photo columns a newly created offer starts with (#308) — the platform's sides and label
 * template, plus the collage numbers copied from its default template. A platform with no default
 * template (or one deleted since) leaves the collage numbers null: there is nothing to render until
 * a template is picked on the offer itself. */
async function seedPhotoConfig(platform: PlatformPhotoDefaults) {
  const template = platform.defaultCollageTemplateId
    ? await prisma.collageTemplate.findUnique({
        where: { id: platform.defaultCollageTemplateId },
        select: { rows: true, columns: true, gapPercent: true, background: true, labelPercent: true },
      })
    : null;
  return {
    photoSides: normalizePhotoSides(platform.photoSides),
    photoLabelLeftTemplate: platform.tileLabelLeftTemplate?.trim() || null,
    photoLabelRightTemplate: platform.tileLabelRightTemplate?.trim() || null,
    collageRows: template?.rows ?? null,
    collageColumns: template?.columns ?? null,
    collageGapPercent: template?.gapPercent ?? null,
    collageBackground: template?.background ?? null,
    collageLabelPercent: template?.labelPercent ?? null,
  };
}

/** Verify a contact exists in the collection and carries the `platform` role; returns its fixed
 * currency (#196), which may be null when not set yet, alongside its listing templates + language. */
async function assertPlatform(
  collectionId: string,
  platformId: string
): Promise<
  PlatformTemplates &
    PlatformPhotoDefaults &
    PlatformDescriptionFormat & {
      platformCurrency: string | null;
      /** The platform's fallback asking price (#362), already a 2-dp string, or null when it has
       * none. Read at creation only — the lowest-priority price suggestion. */
      defaultOfferPrice: string | null;
    }
> {
  const contact = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: {
      platformCurrency: true,
      defaultOfferPrice: true,
      titleTemplate: true,
      descriptionTemplate: true,
      privateNoteTemplate: true,
      descriptionFormat: true,
      titleLanguage: true,
      photoSides: true,
      tileLabelLeftTemplate: true,
      tileLabelRightTemplate: true,
      defaultCollageTemplateId: true,
    },
  });
  if (!contact) {
    throw new OfferActionBlockedError("no-platform", "Choose a platform to list on.");
  }
  return {
    platformCurrency: contact.platformCurrency,
    defaultOfferPrice: contact.defaultOfferPrice?.toFixed(2) ?? null,
    titleTemplate: contact.titleTemplate,
    descriptionTemplate: contact.descriptionTemplate,
    privateNoteTemplate: contact.privateNoteTemplate,
    descriptionFormat: contact.descriptionFormat,
    titleLanguage: contact.titleLanguage,
    photoSides: contact.photoSides,
    tileLabelLeftTemplate: contact.tileLabelLeftTemplate,
    tileLabelRightTemplate: contact.tileLabelRightTemplate,
    defaultCollageTemplateId: contact.defaultCollageTemplateId,
  };
}

/**
 * The platform's fixed currency (#196), inherited and locked by every offer/sale routed to it.
 * When the platform already has a currency it wins (the offer is locked to it). When it has none,
 * this is the first offer/sale on the platform: `fallback` (chosen inline on the offer/sale form)
 * is written to the platform and returned. Throws `no-currency` when unset and no fallback given.
 */
async function resolvePlatformCurrency(
  platformId: string,
  existing: string | null,
  fallback: string | null
): Promise<string> {
  if (existing) return existing;
  const first = fallback?.trim();
  if (!first) {
    throw new OfferActionBlockedError(
      "no-currency",
      "Set this platform's currency before listing an offer on it."
    );
  }
  await prisma.contact.update({
    where: { id: platformId },
    data: { platformCurrency: first },
  });
  return first;
}

// ── Labels ────────────────────────────────────────────────────────────────

/** Sets in their explicit order (#306); `id` keeps the result stable across equal positions. */
const OFFER_SETS_ORDER_BY: Prisma.OfferSetOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { id: "asc" },
];

const OFFER_SETS_SELECT = {
  id: true,
  title: true,
  items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
  saleLines: { select: { id: true }, take: 1 },
} as const;

type OfferSetItemRow = LabelSetItemRow;

type OfferSetRow = {
  id: string;
  title: string | null;
  items: OfferSetItemRow[];
  saleLines: { id: string }[];
};

/** The minimum a query needs to put a set's copies in effective order (#306), for the callers that
 * only care about the copy ids (composition, duplication) and not the labels. */
const SET_ITEM_ORDER_SELECT = {
  itemId: true,
  sortOrder: true,
  item: { select: { stamp: { select: { primaryCatalogSortKey: true } } } },
} as const;

/** Copy ids of a set, in effective order (#306). */
function orderedItemIds(
  items: readonly { itemId: string; sortOrder: number | null; item: { stamp: { primaryCatalogSortKey: number | null } } }[]
): string[] {
  return sortSetItems(
    items.map((li) => ({
      itemId: li.itemId,
      sortOrder: li.sortOrder,
      catalogSortKey: li.item.stamp.primaryCatalogSortKey,
    }))
  ).map((r) => r.itemId);
}

/** A set's copies in effective order (#306) — explicit positions first, then catalog order. */
function orderedItems<T extends { itemId: string; sortOrder: number | null; item: { stamp: { primaryCatalogSortKey: number | null } } }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) =>
    compareSetItems(
      { itemId: a.itemId, sortOrder: a.sortOrder, catalogSortKey: a.item.stamp.primaryCatalogSortKey },
      { itemId: b.itemId, sortOrder: b.sortOrder, catalogSortKey: b.item.stamp.primaryCatalogSortKey }
    )
  );
}

// ── Title generation (#210) ──────────────────────────────────────────────────

/**
 * Generate a listing / set title from a platform's `template` over the copies `itemIds` (#209/#210),
 * but **only when the platform has an explicitly configured template**. A blank / null template means
 * "fall back to the derived label" (#209 — the offer name defaults to the lot label, a set to its
 * copies), so this returns null and the caller leaves the stored title unset. Loads the copies'
 * fields in one query and preserves the caller's order, so a regenerated title is stable. Returns
 * null when nothing resolves (no copies / all fields empty). Token values resolve in the platform's
 * listing `language` where a translation exists (#293), falling back to the default text.
 */
async function generateConfiguredTitle(
  ownerId: string,
  collectionId: string,
  itemIds: string[],
  template: string | null,
  language: string | null = null
): Promise<string | null> {
  if (!template?.trim() || itemIds.length === 0) return null;
  const copies = await titleCopies(ownerId, collectionId, itemIds, language);
  return renderTitleTemplate(template, copies) || null;
}

// ── Listing text generation (#266/#267) ──────────────────────────────────────

/** One set of an offer's composition as the generators see it: its stored title (null when unnamed —
 * `{setTitle}` then renders empty, and a template says `{setTitle|catalog}` to fall back) and the
 * copies it holds, in order. */
interface OfferComposition {
  title: string | null;
  itemIds: readonly string[];
}

/** The listing texts a platform's templates produce for a composition. Each is null when the platform
 * has no template for it, or when nothing resolved. */
export interface GeneratedListingTexts {
  name: string | null;
  description: string | null;
  privateNote: string | null;
}

/** Which of an offer's generated texts a caller means (#266/#267). Also the `Offer` column name. */
export type OfferTextField = "name" | "description" | "privateNote";

/**
 * Generate every listing text a platform has a template for (#209/#210, #266, #267) over one
 * composition, in a single copy load. The title renders over all the copies flat; the description and
 * private note render over the **set-grouped** scope, so their `{#set}` / `{#copy}` blocks enumerate
 * the real listing. A field whose template is blank stays null — the offer name then falls back to the
 * derived label and the longer texts stay empty. Token values resolve in the platform's listing
 * `language` where a translation exists (#293), falling back to the default text.
 *
 * `offerId` is the offer these texts belong to, for the tokens that describe the *offer* rather than
 * its copies (#415). Null while an offer is being created — its row does not exist yet — which makes
 * `{offerUrl}` render empty; {@link syncOfferContextTexts} renders it again once the id is real.
 */
async function generateListingTexts(
  ownerId: string,
  collectionId: string,
  composition: readonly OfferComposition[],
  templates: PlatformTemplates,
  language: string | null,
  offerId: string | null
): Promise<GeneratedListingTexts> {
  const configured = (t: string | null) => (t?.trim() ? t : null);
  const title = configured(templates.titleTemplate);
  const description = configured(templates.descriptionTemplate);
  const privateNote = configured(templates.privateNoteTemplate);
  const copyCount = composition.reduce((n, s) => n + s.itemIds.length, 0);
  if (copyCount === 0 || (!title && !description && !privateNote)) {
    return { name: null, description: null, privateNote: null };
  }
  const [sets, context] = await Promise.all([
    templateSets(ownerId, collectionId, composition, language),
    listingContext(collectionId, offerId, [description, privateNote]),
  ]);
  const copies = sets.flatMap((s) => [...s.copies]);
  return {
    name: title ? renderTitleTemplate(title, copies) || null : null,
    description: description ? renderListingTemplate(description, sets, context) || null : null,
    privateNote: privateNote ? renderListingTemplate(privateNote, sets, context) || null : null,
  };
}

/** The offer-level facts a listing text can resolve (#415) — today just the offer's own link, which
 * needs the collection's slug. Resolved only when a template actually asks for it, so the ordinary
 * generation every composition change triggers pays for no extra query. */
async function listingContext(
  collectionId: string,
  offerId: string | null,
  templates: readonly (string | null)[]
): Promise<ListingTemplateContext> {
  if (!offerId || !templates.some((t) => templateUsesOfferContext(t))) return {};
  // The short address (#416) needs both halves of its route: the collection's slug and the offer's
  // own number. Either missing — a collection deleted under us, an id that is not an offer — leaves
  // the token empty rather than producing an address that resolves to nothing.
  const [collection, offer] = await Promise.all([
    prisma.collection.findUnique({ where: { id: collectionId }, select: { slug: true } }),
    prisma.offer.findUnique({ where: { id: offerId }, select: { offerNo: true } }),
  ]);
  return {
    offerUrl: collection && offer ? offerScreenUrl(collection.slug, offer.offerNo) : null,
  };
}

/** Whether a platform's listing templates hold anything that only exists once the offer's row does
 * (#415) — the one reason a freshly created offer has to render its texts a second time. */
function platformTemplatesUseOfferContext(templates: PlatformTemplates): boolean {
  return (
    templateUsesOfferContext(templates.descriptionTemplate) ||
    templateUsesOfferContext(templates.privateNoteTemplate)
  );
}

/** A composition normalised into the engine's `TemplateSet`s — one query for every copy involved,
 * preserving set order and each set's copy order (so a regenerated text is stable). */
async function templateSets(
  ownerId: string,
  collectionId: string,
  composition: readonly OfferComposition[],
  language: string | null
): Promise<TemplateSet[]> {
  const itemIds = [...new Set(composition.flatMap((s) => [...s.itemIds]))];
  const byId = await titleCopiesById(ownerId, collectionId, itemIds, language);
  return composition.map((s) => ({
    title: s.title,
    copies: s.itemIds.map((id) => byId.get(id)).filter((c) => c != null),
  }));
}

/** An offer's present composition, in set order, for regenerating its texts over what it really
 * lists today. */
async function offerComposition(offerId: string): Promise<OfferComposition[]> {
  const sets = await prisma.offerSet.findMany({
    where: { offerId },
    select: { title: true, items: { select: SET_ITEM_ORDER_SELECT } },
    orderBy: OFFER_SETS_ORDER_BY,
  });
  return sets.map((s) => ({ title: s.title, itemIds: orderedItemIds(s.items) }));
}

/** The copies `itemIds` normalised for the title engine, in the caller's order (so a regenerated
 * title is stable) and resolved in `language`. Shared by generation and preview so the two can
 * never drift. */
async function titleCopies(
  ownerId: string,
  collectionId: string,
  itemIds: string[],
  language: string | null
) {
  const byId = await titleCopiesById(ownerId, collectionId, itemIds, language);
  return itemIds.map((id) => byId.get(id)).filter((c) => c != null);
}

/** The same load, keyed by copy id — how the set-grouped generators (#266/#267) rebuild their
 * composition without depending on the flat result's ordering. Copies that no longer exist (or are
 * not in the collection) are simply absent. */
async function titleCopiesById(
  ownerId: string,
  collectionId: string,
  itemIds: string[],
  language: string | null
): Promise<Map<string, TitleTemplateCopy>> {
  if (itemIds.length === 0) return new Map();
  const [rows, mapCopy] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds }, collectionId }, select: TITLE_COPY_SELECT }),
    makeTitleCopyMapper(ownerId, collectionId, language),
  ]);
  return new Map(rows.map((r: TitleCopyRow) => [r.id, mapCopy(r)]));
}

/** The title a set of `itemIds` would be given on this offer's platform, without writing anything
 * (#297/#298). Returns the title split into segments — the ones resolved from untranslated text are
 * flagged (#298) — the tokens that fell back, for the preview's summary line, and the entity fields
 * behind them, which the dialog offers to fill in place (#299).
 *
 * `language` overrides the platform's listing language, which is how the compose dialog previews a
 * title in another language (#297). Null `segments` means the platform has no template configured:
 * there is nothing to preview and the set keeps its derived label (#209). */
export async function previewOfferTitle(
  ownerId: string,
  offerId: string,
  itemIds: string[],
  language?: string | null
): Promise<OfferTitlePreview | null> {
  const ref = await assertOfferOwner(ownerId, offerId);
  const { titleTemplate, titleLanguage } = await assertPlatform(ref.collectionId, ref.platformId);
  if (!titleTemplate?.trim() || itemIds.length === 0) return null;
  const effectiveLanguage = language === undefined ? titleLanguage : language;
  const copies = await titleCopies(ownerId, ref.collectionId, itemIds, effectiveLanguage);
  return {
    segments: renderTitleTemplateSegments(titleTemplate, copies),
    fallbackTokens: titleFallbackTokens(titleTemplate, copies),
    language: effectiveLanguage,
    gaps: titleFallbacks(titleTemplate, copies),
  };
}

/** What {@link previewOfferTitle} hands the compose dialog: the flagged title (#298) plus the gaps
 * it can fill in place (#299). */
export interface OfferTitlePreview {
  segments: TitleSegment[];
  fallbackTokens: string[];
  /** The language the preview resolved in — null for the collection's default, where nothing can
   * fall back and `gaps` is therefore always empty. */
  language: string | null;
  gaps: TitleFallback[];
}

/** The entity translations missing behind an offer's **already generated** texts (#299): every gap
 * the platform's title, description and private-note templates surface over the offer's present
 * composition, in the platform's own listing language.
 *
 * That language rather than a per-regeneration override (#297): what the offer is listed in is the
 * platform's language, and a one-off regeneration in another language is exactly that — one-off.
 * Empty for a platform with no templates, an empty offer, or a collection listing only in its own
 * default language. */
export async function offerTranslationGaps(
  ownerId: string,
  offerId: string
): Promise<{ language: string | null; gaps: TitleFallback[] }> {
  const ref = await assertOfferOwner(ownerId, offerId);
  const templates = await assertPlatform(ref.collectionId, ref.platformId);
  const language = templates.titleLanguage;
  const composition = await offerComposition(offerId);
  if (!language || composition.length === 0) return { language, gaps: [] };
  const sets = await templateSets(ownerId, ref.collectionId, composition, language);
  const copies = sets.flatMap((s) => [...s.copies]);
  const gaps: TitleFallback[] = [
    ...(templates.titleTemplate?.trim() ? titleFallbacks(templates.titleTemplate, copies) : []),
    ...listingFallbacks(templates.descriptionTemplate, sets),
    ...listingFallbacks(templates.privateNoteTemplate, sets),
  ];
  // The three templates overlap heavily — a description usually repeats the title's tokens — so the
  // union is deduplicated on the entity row, exactly as each template's own list is.
  const seen = new Set<string>();
  return {
    language,
    gaps: gaps.filter((g) => {
      const key = `${g.entityType}:${g.entityId}:${g.entityField}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

// ── "Needs action" derivation (ADR-0013 §4) ──────────────────────────────────

/** One flagged offer: how many of its copies are dead, and the platform it is listed on (so the
 *  filter facets can group without a second pass).
 *
 *  `deadCount` is the figure the list's badge has always shown — copies, counted once each,
 *  whatever killed them. The two beside it count the *reasons* (#367): a copy that is both sold
 *  elsewhere and held by a live auction is one dead copy and two problems, so they may sum to more
 *  than `deadCount` and deliberately are not derived from it. The notification centre needs them
 *  apart because the two ask for different things — a sold copy has to come out of the listing,
 *  a copy under the hammer has to wait for the auction to end (ADR-0013 §4, #167/#215). */
interface NeedsActionRow {
  offerId: string;
  platformId: string;
  deadCount: number;
  /** Copies already sold through another set (#167). */
  soldCount: number;
  /** Copies another active offer currently has in active bidding (#215). */
  biddingCount: number;
}

/**
 * Per active offer, the number of copies held in a set that has already sold elsewhere — a set
 * whose copy is on a `sale_line_item` but **not** through that set's own sale line — or that is
 * held by *another* active offer currently in active bidding (#215). Such an offer is stale on its
 * platform: the collector removes the dead set (decrement) or withdraws. A set that sold through
 * its own line is not counted (it is the sale, not a collision), and fully-sold offers are already
 * `sold` (#166), so only `active` offers are considered.
 *
 * **One SQL query, evaluated in the database** — the previous in-memory derivation had to load
 * every active offer with its sets and copy ids on each call, which is tens of thousands of rows
 * at the collection sizes this is built for. Only flagged offers come back, so the result is small
 * whatever the collection's size. `offerIds` narrows the *reported* offers (a list page asking for
 * its own rows) without narrowing what they are compared against: the collision sources are always
 * the whole collection, or a bid on page 3 would not flag the twin on page 1.
 *
 * Every collision source is reached through a plain join, deliberately: sales **accumulate without
 * bound** (in time there are more sold copies than live ones), so `sale_line_item` must stay a
 * table the planner can either scan or probe by its UNIQUE `itemId` index, whichever its statistics
 * favour — pinning it into a materialized CTE would force a full scan that grows forever. Only the
 * bidding source is materialized: it is bounded by the handful of live auctions, and pre-grouping
 * it per copy turns what was a per-row correlated subplan (~180 ms at 15k offers) into one hash
 * join. `sale_line_item.itemId` is UNIQUE (ADR-0012), so the sale join cannot multiply a copy's row
 * and `COUNT(*)` counts each dead copy exactly once even when it is both sold and bid on.
 *
 * `offerCount > 1` is the mutual case: two live auctions on the same copy flag **both** offers, not
 * an arbitrary one of them.
 */
async function needsActionRows(
  collectionId: string,
  offerIds?: string[]
): Promise<NeedsActionRow[]> {
  if (offerIds && offerIds.length === 0) return [];
  const scope = offerIds
    ? Prisma.sql`AND o."id" IN (${Prisma.join(offerIds)})`
    : Prisma.empty;

  return prisma.$queryRaw<NeedsActionRow[]>`
    WITH bidding_items AS MATERIALIZED (
      SELECT li2."itemId",
             MIN(o2."id") AS "offerId",
             COUNT(DISTINCT o2."id") AS "offerCount"
      FROM "offer" o2
      JOIN "offer_set" s2 ON s2."offerId" = o2."id"
      JOIN "offer_set_item" li2 ON li2."offerSetId" = s2."id"
      WHERE o2."collectionId" = ${collectionId}
        AND o2."state" = 'active'
        AND o2."inActiveBidding" = TRUE
      GROUP BY li2."itemId"
    )
    SELECT o."id" AS "offerId", o."platformId" AS "platformId", COUNT(*)::int AS "deadCount",
           COUNT(*) FILTER (
             WHERE sl."offerSetId" IS NOT NULL AND sl."offerSetId" <> s."id"
           )::int AS "soldCount",
           COUNT(*) FILTER (
             WHERE b."itemId" IS NOT NULL AND (b."offerCount" > 1 OR b."offerId" <> o."id")
           )::int AS "biddingCount"
    FROM "offer" o
    JOIN "offer_set" s ON s."offerId" = o."id"
    JOIN "offer_set_item" li ON li."offerSetId" = s."id"
    LEFT JOIN "sale_line_item" sli ON sli."itemId" = li."itemId"
    LEFT JOIN "sale_line" sl ON sl."id" = sli."saleLineId"
    LEFT JOIN bidding_items b ON b."itemId" = li."itemId"
    WHERE o."collectionId" = ${collectionId}
      AND o."state" = 'active'
      ${scope}
      AND (
        (sl."offerSetId" IS NOT NULL AND sl."offerSetId" <> s."id")
        OR (b."itemId" IS NOT NULL AND (b."offerCount" > 1 OR b."offerId" <> o."id"))
      )
    GROUP BY o."id", o."platformId"
  `;
}

/** The flagged offers as the list rows want them: offer id → dead-copy count. */
async function needsActionCounts(
  collectionId: string,
  offerIds?: string[]
): Promise<Map<string, number>> {
  const rows = await needsActionRows(collectionId, offerIds);
  return new Map(rows.map((r) => [r.offerId, r.deadCount]));
}

/** Which of the two collisions flagged an offer (#367) — see {@link NeedsActionRow}. */
export type OfferActionReason = "sold-elsewhere" | "bidding-conflict";

/** One flagged offer as the notification centre lists it: what to call it, where it is listed, and
 * how many of its copies this reason accounts for. */
export interface OfferNeedingAction {
  offerId: string;
  /** The stored listing title (#209), or the derived label while it has none — the same fallback
   * every offer surface makes. */
  label: string;
  platformName: string;
  /** Copies affected **by this reason**, not the row's whole dead count. */
  count: number;
}

/** The flagged offers per reason: the full count, and the worst few of them. */
export type OffersNeedingAction = Record<
  OfferActionReason,
  { total: number; offers: OfferNeedingAction[] }
>;

/**
 * The needs-action flag split into the two things it actually reports (#367), for the notification
 * centre.
 *
 * One pass over {@link needsActionRows} feeds both buckets, and the offers named by either are
 * fetched and labelled together: the derived label needs the collection's area tree (#379), and
 * reading it twice for what is one panel would be two reads for one screen.
 *
 * Ordered **worst first** — most affected copies, then offer id so a tie cannot reorder between two
 * refreshes — because the panel shows the head of the list and the head should be the one to deal
 * with first.
 */
export async function offersNeedingAction(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<OffersNeedingAction> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await needsActionRows(collectionId);

  function bucket(countOf: (row: NeedsActionRow) => number) {
    const flagged = rows
      .filter((r) => countOf(r) > 0)
      .sort((a, b) => countOf(b) - countOf(a) || a.offerId.localeCompare(b.offerId));
    return { total: flagged.length, head: flagged.slice(0, limit), countOf };
  }

  const sold = bucket((r) => r.soldCount);
  const bidding = bucket((r) => r.biddingCount);

  const ids = [...new Set([...sold.head, ...bidding.head].map((r) => r.offerId))];
  const offers = ids.length
    ? await prisma.offer.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          platform: { select: { name: true } },
          sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
        },
      })
    : [];
  // Only where something is actually unnamed: since #365/#380 a listing is titled on its first
  // composition change, so the tree read is usually not needed at all.
  const labeller = offers.some((o) => !o.name) ? await makeOfferLabeller(collectionId) : null;
  const byId = new Map(
    offers.map((o) => [
      o.id,
      { label: o.name ?? labeller?.offer(o.sets) ?? "Untitled listing", platformName: o.platform.name },
    ])
  );

  function resolve(b: ReturnType<typeof bucket>) {
    return {
      total: b.total,
      offers: b.head.flatMap((row) => {
        const offer = byId.get(row.offerId);
        return offer
          ? [{ offerId: row.offerId, ...offer, count: b.countOf(row) }]
          : [];
      }),
    };
  }

  return { "sold-elsewhere": resolve(sold), "bidding-conflict": resolve(bidding) };
}

// ── Collision lookup (non-blocking warning) ─────────────────────────────────

export interface OfferCollision {
  offerId: string;
  offerLabel: string;
  platformName: string;
  /** How many of the candidate copies this active offer also lists. */
  sharedCount: number;
}

/**
 * **Active** offers on the same platform whose sets already list one of `itemIds` (ADR-0013 —
 * you normally keep at most one active listing of a copy per platform). A *warning* the compose
 * dialog surfaces; nothing is blocked. `excludeOfferId` skips the offer being composed.
 */
export async function findOfferCollisions(
  ownerId: string,
  collectionId: string,
  itemIds: string[],
  platformId: string,
  excludeOfferId?: string
): Promise<OfferCollision[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const targets = new Set(itemIds);
  if (targets.size === 0) return [];

  const offers = await prisma.offer.findMany({
    where: {
      collectionId,
      platformId,
      state: "active",
      ...(excludeOfferId ? { id: { not: excludeOfferId } } : {}),
      sets: { some: { items: { some: { itemId: { in: itemIds } } } } },
    },
    select: {
      id: true,
      platform: { select: { name: true } },
      sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
    },
  });

  const labeller = await makeOfferLabeller(collectionId);
  const collisions: OfferCollision[] = [];
  for (const offer of offers) {
    const items = new Set(offer.sets.flatMap((s) => s.items.map((li) => li.itemId)));
    const shared = [...targets].filter((id) => items.has(id)).length;
    if (shared > 0) {
      collisions.push({
        offerId: offer.id,
        offerLabel: labeller.offer(offer.sets),
        platformName: offer.platform.name,
        sharedCount: shared,
      });
    }
  }
  return collisions;
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface OfferListItem {
  id: string;
  /** The stored listing title (#209), or null when never generated. */
  name: string | null;
  /** Label derived from the offer's sets — the display fallback when `name` is null. */
  label: string;
  platformId: string;
  platformName: string;
  url: string | null;
  price: string;
  currency: string;
  /** The collection base currency, so the row can label `priceBase` (#208). */
  baseCurrency: string;
  /** Asking price converted to the base currency at the current rate (#208), or null when the offer
   * is already in the base currency, has no price yet, or no rate is known. */
  priceBase: string | null;
  state: OfferState;
  /** How many sellable sets the offer holds (its "quantity"). */
  setCount: number;
  /** Total physical copies across all sets. */
  itemCount: number;
  /** Derived (ADR-0013 §4): an active offer holding ≥1 set whose copy sold elsewhere. */
  needsAction: boolean;
  /** How many of its copies have sold elsewhere (drives the badge tooltip). */
  soldCopyCount: number;
  /** "In active bidding" (#215): an auction bid has been placed, committing the collector before
   * the sale is recorded. Independent of `state`/`sold`; freely revertible. */
  inActiveBidding: boolean;
  /** The date the listing went live (#257), or null when not recorded. */
  listingDate: Date | null;
  createdAt: Date;
}

const OFFER_SELECT = {
  id: true,
  name: true,
  platformId: true,
  url: true,
  price: true,
  currency: true,
  state: true,
  inActiveBidding: true,
  listingDate: true,
  createdAt: true,
  platform: { select: { name: true } },
  sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
} as const;

type OfferRow = {
  id: string;
  name: string | null;
  platformId: string;
  url: string | null;
  price: Decimal;
  currency: string;
  state: string;
  inActiveBidding: boolean;
  listingDate: Date | null;
  createdAt: Date;
  platform: { name: string };
  sets: OfferSetRow[];
};

function toListItem(
  row: OfferRow,
  baseCurrency: string,
  labeller: OfferLabeller,
  soldCopyCount = 0
): OfferListItem {
  return {
    id: row.id,
    name: row.name,
    label: labeller.offer(row.sets),
    platformId: row.platformId,
    platformName: row.platform.name,
    url: row.url,
    price: row.price.toFixed(2),
    currency: row.currency,
    baseCurrency,
    priceBase: null, // filled by attachBasePrices (needs the current rate)
    state: (isOfferState(row.state) ? row.state : "active") as OfferState,
    setCount: row.sets.length,
    itemCount: row.sets.reduce((n, s) => n + s.items.length, 0),
    needsAction: soldCopyCount > 0,
    soldCopyCount,
    inActiveBidding: row.inActiveBidding,
    listingDate: row.listingDate,
    createdAt: row.createdAt,
  };
}

/** Fill each item's `priceBase` with its asking price converted to the base currency at the current
 * rate (#208). Distinct currencies are fetched in one batch. Best-effort: a rate lookup failure (no
 * cache, offline) leaves `priceBase` null rather than breaking the list. */
async function attachBasePrices(
  collectionId: string,
  baseCurrency: string,
  // Structural, not `OfferListItem`: the bulk listing workspace's leaner row (#322) carries the same
  // three fields and wants the same conversion.
  items: { price: string; currency: string; priceBase: string | null }[]
): Promise<void> {
  const currencies = [...new Set(items.map((i) => i.currency).filter((c) => c !== baseCurrency))];
  if (currencies.length === 0) return;
  let rates: Map<string, { rate: number }>;
  try {
    rates = await getOrFetchRates(collectionId, baseCurrency as BaseCurrency, currencies);
  } catch {
    return;
  }
  for (const it of items) {
    if (it.currency === baseCurrency) continue;
    const r = rates.get(it.currency);
    const p = Number(it.price);
    if (!r || !(p > 0)) continue;
    it.priceBase = (p * r.rate).toFixed(2);
  }
}

/** Enrich a fetched page of offer rows with their derived "needs action" counts in one query
 * (scoped to this page's offers, but compared against the whole collection), then their
 * base-currency prices (#208). */
async function withNeedsAction(
  rows: OfferRow[],
  collectionId: string,
  baseCurrency: string
): Promise<OfferListItem[]> {
  const [counts, labeller] = await Promise.all([
    needsActionCounts(
      collectionId,
      rows.filter((r) => r.state === "active").map((r) => r.id)
    ),
    makeOfferLabeller(collectionId),
  ]);
  const items = rows.map((r) => toListItem(r, baseCurrency, labeller, counts.get(r.id) ?? 0));
  await attachBasePrices(collectionId, baseCurrency, items);
  return items;
}

export interface OfferListFilters {
  platformId?: string;
  state?: OfferState;
  /** The derived "needs action" overlay (ADR-0013 §4): active offers holding a set whose copy sold
   * elsewhere. Takes precedence over `state`. */
  needsAction?: boolean;
  /** Include closed (sold / withdrawn) offers. Off by default: the list hides dead listings unless
   * the user opts in (#245). Ignored when an explicit `state` filter is set. */
  includeClosed?: boolean;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedOffersResult {
  items: OfferListItem[];
  nextCursor: string | null;
}

/** The offer list's `where`, shared by the paginated list and the summary bar (#317) so both read
 * exactly the same offer set. Pass `needsActionIds` for the derived overlay (ADR-0013 §4): it is
 * resolved to ids first and, as in the list, takes precedence over the state / show-closed choice. */
function offerListWhere(
  collectionId: string,
  filters: Pick<OfferListFilters, "platformId" | "state" | "includeClosed">,
  needsActionIds?: string[]
): Prisma.OfferWhereInput {
  return {
    collectionId,
    ...(filters.platformId ? { platformId: filters.platformId } : {}),
    ...(needsActionIds
      ? { id: { in: needsActionIds } }
      : // An explicit state filter wins; otherwise hide closed (sold / withdrawn) offers unless the
        // user opted in (#245).
        filters.state
        ? { state: filters.state }
        : filters.includeClosed
          ? {}
          : { state: { notIn: [...CLOSED_OFFER_STATES] } }),
  };
}

/** Paginated offers list for the Offers screen (ADR-0013). Filters by platform + state, or by the
 * derived "needs action" overlay — resolved to its flagged offer ids first, then paginated as a
 * normal `where`, so a page never costs more than the offers it shows. */
export async function listOffersPaginated(
  ownerId: string,
  collectionId: string,
  filters: OfferListFilters = {}
): Promise<PaginatedOffersResult> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  if (filters.needsAction) {
    const counts = await needsActionCounts(collectionId);
    if (counts.size === 0) return { items: [], nextCursor: null };
    const rows = await prisma.offer.findMany({
      where: offerListWhere(collectionId, filters, [...counts.keys()]),
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      skip: offset,
      select: OFFER_SELECT,
    });
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const labeller = await makeOfferLabeller(collectionId);
    const items = page.map((r) => toListItem(r, baseCurrency, labeller, counts.get(r.id) ?? 0));
    await attachBasePrices(collectionId, baseCurrency, items);
    return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
  }

  const rows = await prisma.offer.findMany({
    where: offerListWhere(collectionId, filters),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    skip: offset,
    select: OFFER_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: await withNeedsAction(page, collectionId, baseCurrency),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/** Lifecycle order the copy's offers are listed in (#276): live listings first, terminal ones last,
 * so "where is this copy on sale right now?" is answered by the top of the popup. */
const ITEM_OFFER_RANK: Record<OfferState, number> = {
  active: 0,
  paused: 1,
  ready: 2,
  preparing: 3,
  sold: 4,
  withdrawn: 5,
};

/** What the "View offers" popup is scoped to (#276, #349): one copy, every copy of a stamp, or
 * every copy of any stamp in an issue — mirroring the read-only copies popup's targeting (#110). */
export type OfferLookupTarget =
  | { kind: "item"; itemId: string }
  | { kind: "stamp"; stampId: string }
  | { kind: "issue"; issueId: string };

/** The copies a target covers, as the `OfferSetItem` filter reaching them. A stamp matches
 * **exactly**, never rolled up from its variant children — the same rule the copies popup and the
 * copies-held badge follow (#348): the tree shows a child's own entry one line down, so a rollup
 * would report one listing twice. */
function offerTargetItemWhere(target: OfferLookupTarget): Prisma.OfferSetItemWhereInput {
  switch (target.kind) {
    case "item":
      return { itemId: target.itemId };
    case "stamp":
      return { item: { stampId: target.stampId } };
    case "issue":
      return {
        item: { stamp: { issueMemberships: { some: { issueId: target.issueId } } } },
      };
  }
}

/** Every offer referencing a copy of the target, across all platforms and **all** states — the
 * "View offers" popup on the Copies list (#276) and on the Stamps / Issues lists (#349).
 * Unpaginated: what one stamp or issue has been listed in is a handful of offers, and the popup
 * answers a whole question rather than a page of one. Terminal offers are included (unlike the
 * offers list, which hides them by default, #245) — a sold or withdrawn listing is exactly what one
 * asks a piece's history for. */
export async function listOffersForTarget(
  ownerId: string,
  collectionId: string,
  target: OfferLookupTarget
): Promise<OfferListItem[]> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId, sets: { some: { items: { some: offerTargetItemWhere(target) } } } },
    orderBy: { createdAt: "desc" },
    select: OFFER_SELECT,
  });
  const items = await withNeedsAction(rows, collectionId, baseCurrency);
  return items.sort((a, b) => ITEM_OFFER_RANK[a.state] - ITEM_OFFER_RANK[b.state]);
}

/** Distinct platforms that currently have at least one offer, for the list-screen filter and the
 * new-offer dialog's derived-currency lock (#196) and price fallback (#362), so it carries each
 * platform's fixed currency and default asking price. */
export async function listOfferPlatforms(
  ownerId: string,
  collectionId: string
): Promise<
  {
    id: string;
    name: string;
    platformCurrency: string | null;
    defaultOfferPrice: string | null;
    /** The Assistant module that knows this platform's sale form (#406), or null where it is listed
     *  by hand. It rides with the platform because the listing workspace asks it of the platform it
     *  is posting to — whether to offer **List via Assistant** at all (#407). */
    platformModule: string | null;
  }[]
> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId },
    select: {
      platform: {
        select: {
          id: true,
          name: true,
          platformCurrency: true,
          defaultOfferPrice: true,
          platformModule: true,
        },
      },
    },
    distinct: ["platformId"],
    orderBy: { platform: { name: "asc" } },
  });
  return rows.map((r) => ({
    ...r.platform,
    defaultOfferPrice: r.platform.defaultOfferPrice?.toFixed(2) ?? null,
  }));
}

export interface OfferFilterCounts {
  /** Offers per state, within the selected platform. States with no offers are absent. */
  states: Partial<Record<OfferState, number>>;
  /** Flagged offers within the selected platform. */
  needsAction: number;
  /** Offers per platform, under the selected state / needs-action / show-closed choice. */
  platforms: Record<string, number>;
  /** Total across platforms — the "All platforms" option. */
  total: number;
}

/**
 * Counts for the offer list's filter controls (#332), computed **faceted**: every control's count
 * ignores its own dimension and respects the others. So the state chips (and "Needs action") are
 * counted within the selected platform, and each platform option is counted under the selected
 * state — each count is what you would get by clicking that control, not what the list shows now.
 *
 * The needs-action facet can't be a DB `where` (ADR-0013 §4), so it is derived in memory from the
 * collection's `active` offers, exactly as the needs-action list page does.
 */
export async function offerFilterCounts(
  ownerId: string,
  collectionId: string,
  filters: Pick<OfferListFilters, "platformId" | "state" | "needsAction" | "includeClosed"> = {}
): Promise<OfferFilterCounts> {
  await assertCollectionOwner(ownerId, collectionId);

  // The needs-action facet comes back already grouped by platform, so both the chip's own count
  // (within the selected platform) and the platform facet under a needs-action selection are read
  // off the same few flagged rows — no id list travels back into a `where`.
  const [flagged, byState, byPlatform] = await Promise.all([
    needsActionRows(collectionId),
    prisma.offer.groupBy({
      by: ["state"],
      where: { collectionId, ...(filters.platformId ? { platformId: filters.platformId } : {}) },
      _count: { _all: true },
    }),
    // The platform facet respects the state choice the same way the list does: an explicit state
    // wins, otherwise closed offers are counted only when the user opted in (#245). A needs-action
    // selection is not a state, so it is served from `flagged` instead of this query.
    filters.needsAction
      ? Promise.resolve(null)
      : prisma.offer.groupBy({
          by: ["platformId"],
          where: {
            collectionId,
            ...(filters.state
              ? { state: filters.state }
              : filters.includeClosed
                ? {}
                : { state: { notIn: [...CLOSED_OFFER_STATES] } }),
          },
          _count: { _all: true },
        }),
  ]);

  const states: Partial<Record<OfferState, number>> = {};
  for (const row of byState) {
    if (isOfferState(row.state)) states[row.state] = row._count._all;
  }

  const platforms: Record<string, number> = {};
  let total = 0;
  if (byPlatform) {
    for (const row of byPlatform) {
      platforms[row.platformId] = row._count._all;
      total += row._count._all;
    }
  } else {
    for (const row of flagged) {
      platforms[row.platformId] = (platforms[row.platformId] ?? 0) + 1;
      total += 1;
    }
  }

  return {
    states,
    needsAction: filters.platformId
      ? flagged.filter((r) => r.platformId === filters.platformId).length
      : flagged.length,
    platforms,
    total,
  };
}

// ── Summary bar (#317) ───────────────────────────────────────────────────────

/** What the offer list's summary bar shows over the currently filtered offers (#317): the asking
 * value it leads with, and — behind the expander — the catalog value and purchase cost of the
 * copies those offers hold, so "what am I asking" can be read against "what is it worth" and "what
 * did it cost me". */
export interface OffersSummary extends Omit<OffersAskingSummary, "platforms"> {
  /** Catalog value + cost basis over the copies under these offers, **deduplicated**: a copy listed
   * on two platforms is one piece of stock and is valued once, unlike `itemCount`. */
  holdings: HoldingsSummary;
  /** The same three figures per platform, largest asking value first. The catalog/cost columns are
   * deduplicated within each platform, so a copy listed on two of them contributes to both — the
   * platform rows answer "what is on this marketplace", and they do not sum to the total. */
  platforms: OffersSummaryPlatform[];
}

export interface OffersSummaryPlatform extends Omit<OfferPlatformTotal, "itemIds"> {
  holdings: HoldingsSummary;
}

/**
 * Aggregate figures for the offer list's summary bar (#317), over exactly the offers the list is
 * showing — same platform / state / needs-action / show-closed filters, resolved through the same
 * `where`. It deliberately re-reads the whole filtered set rather than summing the loaded pages:
 * a total that grows as you scroll is worse than no total.
 *
 * Rates are fetched once per distinct currency and handed to the pure aggregator; a lookup failure
 * (offline, no cache) leaves those offers counted as unconvertible rather than failing the bar,
 * matching how the list's own per-row conversion degrades (#208).
 */
export async function offersSummary(
  ownerId: string,
  collectionId: string,
  filters: Pick<OfferListFilters, "platformId" | "state" | "needsAction" | "includeClosed"> = {}
): Promise<OffersSummary> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);

  // The needs-action overlay is derived, not a column (ADR-0013 §4), so it resolves to ids first —
  // exactly as the list page does. No flagged offers means an empty slice, not an unfiltered one.
  let needsActionIds: string[] | undefined;
  if (filters.needsAction) {
    needsActionIds = [...(await needsActionCounts(collectionId)).keys()];
    if (needsActionIds.length === 0) {
      return {
        ...aggregateOfferAsking([], baseCurrency, new Map()),
        holdings: await getHoldingsValuationForItems(collectionId, []),
        platforms: [],
      };
    }
  }

  const offers = await prisma.offer.findMany({
    where: offerListWhere(collectionId, filters, needsActionIds),
    select: {
      platformId: true,
      price: true,
      currency: true,
      platform: { select: { name: true } },
      sets: { select: { items: { select: { itemId: true } } } },
    },
  });

  const rows: OfferSummaryRow[] = offers.map((o) => ({
    platformId: o.platformId,
    platformName: o.platform.name,
    price: o.price.toFixed(2),
    currency: o.currency,
    setCount: o.sets.length,
    itemIds: o.sets.flatMap((s) => s.items.map((i) => i.itemId)),
  }));

  const currencies = [...new Set(rows.map((r) => r.currency).filter((c) => c !== baseCurrency))];
  const rates = new Map<string, number>();
  if (currencies.length > 0) {
    try {
      for (const [currency, { rate }] of await getOrFetchRates(
        collectionId,
        baseCurrency as BaseCurrency,
        currencies
      )) {
        rates.set(currency, rate);
      }
    } catch {
      // Leave `rates` empty: those offers land in `unconvertibleCount`, which is the honest answer.
    }
  }

  const { platforms, ...asking } = aggregateOfferAsking(rows, baseCurrency, rates);

  // One valuation pass covers the total and every platform slice: the groups overlap (a copy listed
  // on two marketplaces belongs to both), and valuing each slice on its own would price it twice.
  const TOTAL = "";
  const holdingsByGroup = await getHoldingsValuationByGroup(collectionId, [
    { key: TOTAL, itemIds: [...new Set(rows.flatMap((r) => r.itemIds))] },
    ...platforms.map((p) => ({ key: p.platformId, itemIds: p.itemIds })),
  ]);

  return {
    ...asking,
    holdings: holdingsByGroup.get(TOTAL)!,
    // `itemIds` is the aggregator's handoff to the valuation above, not something the bar renders,
    // so it is dropped rather than shipped to the client.
    platforms: platforms.map((p) => {
      const { itemIds, ...rest } = p;
      void itemIds;
      return { ...rest, holdings: holdingsByGroup.get(p.platformId)! };
    }),
  };
}

// ── Bulk listing workspace (#322) ────────────────────────────────────────────

/** The offer's sets as the workspace reads them: the label select every offer list uses, plus each
 * copy's area links and issued year for the area/year grouping, and the two values the listing
 * preconditions are judged on (#406) — the stamp's Colnect item-ID and the copy's condition. */
const LISTING_SETS_SELECT = {
  id: true,
  title: true,
  items: {
    select: {
      itemId: true,
      sortOrder: true,
      item: {
        select: {
          stampId: true,
          conditionId: true,
          condition: { select: { name: true } },
          stamp: {
            select: {
              // The label select already carries the area links the grouping needs (#379).
              ...STAMP_LABEL_SELECT.stamp.select,
              issuedYear: true,
              colnectId: true,
            },
          },
        },
      },
    },
  },
  saleLines: { select: { id: true }, take: 1 },
} as const;

/** One `ready` offer as the bulk listing workspace lists it: enough for the collapsed line and for
 * grouping, and nothing more. The posting kit itself — the listing texts and the photos — is read per
 * card through the offer detail (#266/#267) and photo-plan (#311) endpoints when the card is
 * expanded, so opening the screen on a big batch does not pay for texts nobody has looked at. */
export interface ListingWorkspaceOffer {
  id: string;
  name: string | null;
  label: string;
  price: string;
  currency: string;
  baseCurrency: string;
  priceBase: string | null;
  setCount: number;
  itemCount: number;
  /** How many images the last generation run stored — what there is to upload right now. */
  photoCount: number;
  /** The generation job's state (#311), so a card can say "never generated" or "failed" without
   * loading the whole plan. */
  photoStatus: OfferPhotoGenerationStatus;
  /** The listing URL, when one was already recorded (an offer can be re-listed, and the activate
   * prompt should not start blank on the second pass). */
  url: string | null;
  /** The distinct (area, year) pairs across the offer's copies, for the grouping and the rail
   * (`listing-groups.ts`). One entry when every copy agrees. */
  areaYears: OfferAreaYear[];
  /** Why this offer cannot be handed to the Assistant to post (#406), empty when it can. The same
   * evaluation the listing-kit endpoint refuses on (#405), so the card and the endpoint can never
   * disagree about whether an offer is postable or why it is not. It says nothing about posting the
   * listing **by hand** — Publish stays open, because a collector typing the form in themselves is
   * exactly who fills a gap the Assistant cannot. */
  blockers: ListingBlocker[];
}

/**
 * Every `ready` offer on one platform, for the bulk listing workspace (#322). Unpaginated on
 * purpose: this is one posting session's worth of work, the caller groups and filters it client-side
 * for instant facets (as the compose picker does), and a `ready` batch is bounded by how many
 * listings a person is about to type in by hand.
 *
 * A copy's **area** is its stamp's primary area link, falling back to any link when none is marked
 * primary — a stamp can sit in several areas, and the grouping needs the one it is filed under, not
 * a set that would make every such offer Mixed. Its **year** is `stamp.issuedYear`, the same year the
 * inventory list filters on (#142).
 */
export async function listReadyOffersForListing(
  ownerId: string,
  collectionId: string,
  platformId: string
): Promise<ListingWorkspaceOffer[]> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  // Which Assistant module, if any, can post to this platform (#406). It decides whether the listing
  // preconditions are asked at all: they are that module's own rules, and reporting "no Colnect
  // item-ID" on a Delcampe batch is noise about a form nobody is going to fill from here.
  const platform = await prisma.contact.findFirst({
    where: { id: platformId, collectionId },
    select: { platformModule: true },
  });
  const platformModule = platform?.platformModule ?? null;
  const rows = await prisma.offer.findMany({
    where: { collectionId, platformId, state: "ready" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      url: true,
      price: true,
      currency: true,
      sets: { select: LISTING_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
      photoEntries: { select: { id: true } },
      photoGeneration: { select: { status: true } },
    },
  });

  // Both lookups are loaded **once for the whole batch** (#404): a posting session is dozens of
  // offers over one collection's areas and a handful of conditions. The condition map is not read at
  // all where no module asks for it.
  const [labeller, conditionMap] = await Promise.all([
    makeOfferLabeller(collectionId),
    platformModule ? loadColnectConditionMap(collectionId) : new Map<string, string>(),
  ]);
  const items: ListingWorkspaceOffer[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: labeller.offer(row.sets),
    price: row.price.toFixed(2),
    currency: row.currency,
    baseCurrency,
    priceBase: null, // filled below, like every other offer list (#208)
    setCount: row.sets.length,
    itemCount: row.sets.reduce((n, s) => n + s.items.length, 0),
    photoCount: row.photoEntries.length,
    photoStatus: (row.photoGeneration?.status as OfferPhotoGenerationStatus) ?? "none",
    url: row.url,
    areaYears: distinctAreaYears(row.sets),
    blockers: listingBlockersFor(row.sets, platformModule, labeller, conditionMap, "ready"),
  }));

  await attachBasePrices(collectionId, baseCurrency, items);
  return items;
}

/** One of the batch's sets, exactly as {@link LISTING_SETS_SELECT} returns it. */
type ListingSetRow = Prisma.OfferSetGetPayload<{ select: typeof LISTING_SETS_SELECT }>;

/**
 * The listing preconditions for one offer of the batch (#406), or **nothing** where the platform
 * names no Assistant module.
 *
 * Silence rather than the `no-platform-module` blocker the evaluator would return: that is a fact
 * about the platform, not something to fix on the offer, and a *Can't list* chip on every card of
 * every Delcampe batch is exactly the noise this check exists to avoid. The listing-kit endpoint
 * still refuses such a platform (#405) — a caller that asked for a posting payload asked for
 * something impossible, which is a different question from what the collector should go and fix.
 *
 * The state is the caller's, not a constant: the workspace only ever reads `ready` offers, while an
 * offer's own screen (#414) evaluates whatever it is looking at — where `not-ready` returning alone
 * is the honest answer, and the surface simply does not offer the button.
 */
function listingBlockersFor(
  sets: readonly ListingSetRow[],
  platformModule: string | null,
  labeller: OfferLabeller,
  conditionMap: Map<string, string>,
  state: OfferState
): ListingBlocker[] {
  if (!platformModule) return [];
  return evaluateListingPreconditions({
    platformModule,
    state,
    sets: sets.map((set) => ({
      setId: set.id,
      label: labeller.set(set),
      copies: orderedItems(set.items).map(({ itemId, item }) => ({
        itemId,
        label: labeller.copy(item.stamp),
        stampId: item.stampId,
        catalogItemId: item.stamp.colnectId?.trim() || null,
        conditionId: item.conditionId,
        conditionName: item.condition.name,
        platformCondition: conditionMap.get(item.conditionId) ?? null,
      })),
    })),
  });
}

/**
 * The listing preconditions (#406) for one offer, judged at **`ready`** — the state it is about to
 * reach (#418), never the one it is in.
 *
 * The gate sits on `preparing → ready` and nowhere else in the lifecycle, because that transition is
 * what the collector means by "this listing is assembled": a fault caught here is fixed while the
 * offer is still being put together, rather than surfacing in the bulk listing workspace at the
 * moment there are thirty of them to post. Later transitions are deliberately left open — an offer
 * already live is a listing that exists, and refusing to pause or withdraw it over a mapping gap
 * would trap the collector.
 *
 * Empty for a platform naming no Assistant module, exactly as {@link listingBlockersFor} is: these
 * are one module's rules, and a marketplace listed by hand has nothing to fail. That is also why the
 * condition map is not read for one.
 */
async function readReadyBlockers(collectionId: string, offerId: string): Promise<ListingBlocker[]> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      platform: { select: { platformModule: true } },
      sets: { select: LISTING_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
    },
  });
  if (!offer) return [];
  const platformModule = offer.platform.platformModule;
  if (!platformModule) return [];
  const [labeller, conditionMap] = await Promise.all([
    makeOfferLabeller(collectionId),
    loadColnectConditionMap(collectionId),
  ]);
  return listingBlockersFor(offer.sets, platformModule, labeller, conditionMap, "ready");
}

type AreaLinkedSet = {
  items: {
    item: {
      stamp: {
        issuedYear: number | null;
        stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
      };
    };
  }[];
};

/** The distinct (primary area, issued year) pairs across an offer's copies, in first-seen order. */
function distinctAreaYears(sets: AreaLinkedSet[]): OfferAreaYear[] {
  const seen = new Map<string, OfferAreaYear>();
  for (const set of sets) {
    for (const { item } of set.items) {
      const links = item.stamp.stampAreaLinks;
      const areaId = (links.find((l) => l.isPrimary) ?? links[0])?.collectionAreaId ?? null;
      const year = item.stamp.issuedYear;
      const key = `${areaId ?? ""}:${year ?? ""}`;
      if (!seen.has(key)) seen.set(key, { areaId, year });
    }
  }
  return [...seen.values()];
}

/**
 * Publish a prepared offer (#322): record the listing URL the platform gave back, then move
 * `ready → active`, which stamps the listing date (#320).
 *
 * The URL is written **after** the transition so a refused publication — an offer that lost its last
 * set, or its price — leaves nothing behind: a listing URL on an offer that never went live would be
 * a false record of a live listing. `null` clears the field, and a listing may legitimately have no
 * URL yet (the platform hands one out only once the listing is approved); the header stays editable
 * afterwards either way.
 */
export async function publishOffer(
  ownerId: string,
  offerId: string,
  url: string | null
): Promise<void> {
  await setOfferState(ownerId, offerId, "active");
  await patchOffer(ownerId, offerId, { url });
}

/** What recording a listing did, so the caller can say so rather than guess (#412). */
export type OfferListedOutcome = "activated" | "url-recorded" | "unchanged";

/**
 * Record that this offer has been listed at `url` (#412) — the write-back behind the Assistant's
 * capture of the sale URL, and the one place the platform's own answer reaches the record.
 *
 * It is `publishOffer` with **one** difference: it is idempotent. The URL comes back once but may be
 * delivered twice — the page that handed the offer over publishes it when it is still on screen, and
 * the extension posts it when no page took the answer, both by design — so arriving second must be a
 * no-op and not a refusal.
 *
 *   • `ready` → publish exactly as the workspace does: transition first (which stamps the listing
 *     date, #320), then the URL, so a refused publication leaves no listing URL behind.
 *   • already `active` → the listing is already live. A **blank** URL is filled in, because that is
 *     the field this exists to save from being pasted by hand; one that is already recorded is left
 *     alone, since a URL on the record was either put there by the collector or by this same capture.
 *   • anything else → refused. A paused, sold or preparing offer is not something a marketplace
 *     submission may quietly take live.
 */
export async function recordOfferListed(
  ownerId: string,
  offerId: string,
  url: string
): Promise<OfferListedOutcome> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new OfferActionBlockedError("no-url", "A listing URL is required.");
  }
  const ref = await assertOfferOwner(ownerId, offerId);

  if (ref.state === "ready") {
    await publishOffer(ownerId, offerId, trimmed);
    return "activated";
  }
  if (ref.state === "active") {
    const row = await prisma.offer.findUnique({ where: { id: offerId }, select: { url: true } });
    if (row?.url) return "unchanged";
    await patchOffer(ownerId, offerId, { url: trimmed });
    return "url-recorded";
  }
  throw new OfferActionBlockedError(
    "bad-transition",
    `This offer is ${ref.state}, so a listing cannot be recorded against it.`
  );
}

export interface OfferDetailSet {
  id: string;
  title: string | null;
  label: string;
  /** The set's copies in effective order (#306) — hand-corrected when the collector reordered
   * them, otherwise derived from catalog order. `copyLabels` follows the same order. */
  itemIds: string[];
  copyLabels: string[];
  /** The copy order was hand-corrected rather than derived from catalog order (#306). Drives the
   * "Reset to catalog order" action. */
  manualCopyOrder: boolean;
  /** What this set is worth and what it cost (#378): the catalogue value of its copies and their
   * frozen purchase cost, the same holdings pair the summary bars carry (#134/#179) — so the asking
   * price can be judged per set, which is what a buyer actually takes. Both are base-currency
   * figures: a catalog value is valued in base, and a cost basis is frozen there. */
  holdings: HoldingsSummary;
  /** The same two figures **in the offer's own currency**, converted at the current rate — the
   * currency the asking price is stated in, so the comparison needs no arithmetic in the reader's
   * head. Null when the offer already prices in the base currency (there is nothing to add) or no
   * rate is known; each amount is null when its own figure has nothing to convert. */
  holdingsInOfferCurrency: {
    currency: string;
    catalogAmount: string | null;
    costAmount: string | null;
  } | null;
  /** This set has left on a sale (sold through this offer). */
  sold: boolean;
  /** A copy of this set has sold **elsewhere** — the set is stale and should be removed. */
  needsAction: boolean;
}

/**
 * The offer's sets **taken together** (#378): what the whole listing is worth and what it cost, and
 * the same two figures per set. Both questions are asked at once because they answer different
 * things — the total is what leaves the shelf if everything sells, the average is what one buyer
 * takes, which is the figure an asking price is set against (and is exactly how `suggestedPrice`
 * is derived, #190).
 *
 * An average divides by the sets that **had** a figure, not by every set: an unpriced set is a gap
 * in the data, and letting it drag the average down would report a listing as cheaper than anything
 * in it actually is. The divisors are carried so the screen can say what was counted.
 *
 * Every amount is a base-currency 2-dp string, null when nothing under it is priced / costed;
 * `inOfferCurrency` repeats them in the offer's own currency exactly as a set's own figures do.
 */
export interface OfferSetsTotals {
  setCount: number;
  catalogTotal: string | null;
  catalogAverage: string | null;
  /** Sets carrying a catalogue value — the catalogue average's divisor. */
  catalogValuedSets: number;
  costTotal: string | null;
  costAverage: string | null;
  /** Sets carrying a cost basis — the cost average's divisor. */
  costKnownSets: number;
  inOfferCurrency: {
    currency: string;
    catalogTotal: string | null;
    catalogAverage: string | null;
    costTotal: string | null;
    costAverage: string | null;
  } | null;
}

export interface OfferDetail {
  id: string;
  collectionId: string;
  /** The stored listing title (#209), or null when never generated. */
  name: string | null;
  /** Label derived from the offer's sets — the display fallback when `name` is null. */
  label: string;
  /** The listing description (#266) and the seller-only private note (#267), or null when the
   * platform generated none and nothing was written by hand. */
  description: string | null;
  privateNote: string | null;
  /** How the description is written (#319) — the offer's own copy of the platform's setting, driving
   * how it renders on screen and what the copy action puts on the clipboard. The private note has no
   * format; it is always plain. */
  descriptionFormat: DescriptionFormat;
  /** Which generated texts the platform actually has a template for (#266/#267) — each field's
   * ↻ Regenerate control enables itself on this. */
  regeneratable: Record<OfferTextField, boolean>;
  /** Which of them the collector has written by hand (#380). Such a field no longer follows the
   * offer's composition, which the screen says beside it — otherwise "why didn't my title update?"
   * has no visible answer. */
  edited: Record<OfferTextField, boolean>;
  platformId: string;
  platformName: string;
  /** The platform's listing language (#293), or null when it lists in the collection's default
   * language. Seeds the compose dialog's language selector (#297). */
  platformTitleLanguage: string | null;
  url: string | null;
  price: string;
  currency: string;
  /** The collection base currency, to label `priceBase` (#208). */
  baseCurrency: string;
  /** Asking price converted to the base currency at the current rate (#208), or null when already in
   * the base currency, unpriced, or no rate is known. */
  priceBase: string | null;
  state: OfferState;
  needsAction: boolean;
  /** "In active bidding" (#215): an auction bid has been placed, committing the collector before
   * the sale is recorded. Independent of `state`/`sold`; freely revertible. */
  inActiveBidding: boolean;
  /** Derived suggested asking price **in the offer's currency**: the average catalog value per set
   * (a buyer takes one set), converted from base at the current FX rate. Null when nothing is
   * valued or no rate is available. */
  suggestedPrice: string | null;
  /** Sets with no computable catalog value (excluded from the average). */
  suggestedUnpricedSets: number;
  sets: OfferDetailSet[];
  /** The sets summed and averaged (#378) — see {@link OfferSetsTotals}. */
  setsTotals: OfferSetsTotals;
  /** The date the listing went live (#257), or null when not recorded. */
  listingDate: Date | null;
  /** This listing's own photo configuration (#308) — sides, tile label template and the collage
   * numbers copied from a template. Seeded at creation, edited from the photo-settings dialog. */
  photoConfig: OfferPhotoConfigInput;
  /** The platform's hard photo limits (#308), read **live** rather than from the offer: they say
   * what the platform accepts today, and the renderer (#310) obeys the current values. */
  platformPhotoLimits: PlatformPhotoLimits;
  /** The platform's listing-text caps (#403), read live for exactly the same reason — every surface
   * that writes or copies the description / private note counts against the current values. */
  platformTextLimits: PlatformTextLimits;
  /** The Assistant module that knows this platform's sale form (#406), or null where it is listed by
   * hand — which is what decides whether this screen offers **List via Assistant** at all (#414). */
  platformModule: string | null;
  /** Why the Assistant cannot post this offer (#406), empty when it can and always empty for a
   * platform with no module — the same evaluation the workspace row and the listing-kit endpoint
   * (#405) use. Note it is evaluated at the offer's **own** state, so anything not Ready reports
   * `not-ready` alone. */
  listingBlockers: ListingBlocker[];
  /** Why this offer cannot be marked **Ready** (#418) — the same preconditions, judged at the state
   * it is about to reach rather than at the one it is in. Non-empty only while `preparing`, which is
   * the one transition the gate sits on; every other state reports nothing, because there is no such
   * step to take from it. */
  readyBlockers: ListingBlocker[];
  createdAt: Date;
}

/** Full offer read model for the detail / compose screen (ADR-0013): the offer header plus each
 * of its sets, with per-set sold / needs-action status. */
export async function getOfferDetail(ownerId: string, offerId: string): Promise<OfferDetail | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      name: true,
      description: true,
      privateNote: true,
      nameEdited: true,
      descriptionEdited: true,
      privateNoteEdited: true,
      descriptionFormat: true,
      collectionId: true,
      platformId: true,
      url: true,
      price: true,
      currency: true,
      state: true,
      inActiveBidding: true,
      listingDate: true,
      createdAt: true,
      photoSides: true,
      photoLabelLeftTemplate: true,
      photoLabelRightTemplate: true,
      collageRows: true,
      collageColumns: true,
      collageGapPercent: true,
      collageBackground: true,
      collageLabelPercent: true,
      collection: { select: { ownerId: true, baseCurrency: true } },
      platform: {
        select: {
          name: true,
          titleLanguage: true,
          titleTemplate: true,
          descriptionTemplate: true,
          privateNoteTemplate: true,
          maxPhotos: true,
          maxPhotoEdge: true,
          maxPhotoFileSizeMib: true,
          maxDescriptionLength: true,
          maxPrivateNoteLength: true,
          platformModule: true,
        },
      },
      // The set select is a superset of `LISTING_SETS_SELECT`, so this screen's own rows are what
      // the listing preconditions (#406) are evaluated over — one shape, so the offer's screen, the
      // workspace row and the listing-kit endpoint cannot disagree about whether it is postable.
      sets: {
        orderBy: OFFER_SETS_ORDER_BY,
        select: {
          id: true,
          title: true,
          items: {
            select: {
              itemId: true,
              sortOrder: true,
              item: {
                select: {
                  ...STAMP_LABEL_SELECT,
                  stampId: true,
                  conditionId: true,
                  condition: { select: { name: true } },
                  stamp: {
                    select: { ...STAMP_LABEL_SELECT.stamp.select, issuedYear: true, colnectId: true },
                  },
                },
              },
            },
          },
          saleLines: { select: { id: true }, take: 1 },
        },
      },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) return null;

  const state = (isOfferState(offer.state) ? offer.state : "active") as OfferState;
  const baseCurrency = offer.collection.baseCurrency;
  // Which copies across this offer sold, and through which set (own sale vs. collision).
  const allIds = offer.sets.flatMap((s) => s.items.map((li) => li.itemId));
  const soldRows =
    allIds.length > 0
      ? await prisma.saleLineItem.findMany({
          where: { itemId: { in: allIds } },
          select: { itemId: true, saleLine: { select: { offerSetId: true } } },
        })
      : [];
  const soldViaSet = new Map(soldRows.map((r) => [r.itemId, r.saleLine.offerSetId]));

  // Copies held by another active offer currently "in active bidding" (#215) — same collision
  // treatment as an actual sale, without a sale line existing yet.
  const biddingRows =
    allIds.length > 0
      ? await prisma.offerSetItem.findMany({
          where: {
            itemId: { in: allIds },
            offerSet: { offer: { id: { not: offerId }, inActiveBidding: true, state: "active" } },
          },
          select: { itemId: true },
        })
      : [];
  const biddingElsewhere = new Set(biddingRows.map((r) => r.itemId));

  // Per-set catalogue value + purchase cost (#378), and the labels (#379), both resolved once for
  // the whole offer. The holdings pair is the same one the summary bars show (#134/#179), read
  // through `getHoldingsValuationByGroup` so every copy is fetched and valued **once** even though
  // the sets are asked about one by one.
  // The condition map is read only where a module asks for it (#404/#406) — a platform listed by
  // hand pays for none of the precondition machinery, exactly as in the batch read.
  const platformModule = offer.platform.platformModule;
  const [labeller, holdingsBySet, conditionMap] = await Promise.all([
    makeOfferLabeller(offer.collectionId),
    getHoldingsValuationByGroup(
      offer.collectionId,
      offer.sets.map((s) => ({ key: s.id, itemIds: s.items.map((li) => li.itemId) }))
    ),
    platformModule ? loadColnectConditionMap(offer.collectionId) : new Map<string, string>(),
  ]);

  // The base → offer-currency rate, fetched **once** for the whole screen: every set's two figures
  // and the suggested asking price are all converted with it. Null when the offer already prices in
  // the base currency, or when no rate is available (the figures then stay base-only rather than
  // being quietly wrong).
  let baseToOffer: number | null = null;
  if (offer.currency !== baseCurrency) {
    try {
      baseToOffer = (await getOrFetchRate(offer.collectionId, baseCurrency, offer.currency)).rate;
    } catch {
      baseToOffer = null;
    }
  }

  const sets: OfferDetailSet[] = offer.sets.map((s) => {
    const items = orderedItems(s.items);
    const holdings = holdingsBySet.get(s.id)!;
    const sold = s.saleLines.length > 0;
    const needs =
      state === "active" &&
      !sold &&
      s.items.some((li) => {
        const via = soldViaSet.get(li.itemId);
        if (via != null && via !== s.id) return true;
        return biddingElsewhere.has(li.itemId);
      });
    return {
      id: s.id,
      title: s.title,
      label: labeller.set(s),
      itemIds: items.map((li) => li.itemId),
      copyLabels: items.map((li) => labeller.copy(li.item.stamp)),
      manualCopyOrder: hasManualItemOrder(s.items),
      holdings,
      holdingsInOfferCurrency:
        baseToOffer === null
          ? null
          : {
              currency: offer.currency,
              catalogAmount:
                holdings.pricedCount === 0
                  ? null
                  : (Number(holdings.totalBaseAmount) * baseToOffer).toFixed(2),
              costAmount:
                holdings.cost.knownCount === 0
                  ? null
                  : (Number(holdings.cost.totalCostBasis) * baseToOffer).toFixed(2),
            },
      sold,
      needsAction: needs,
    };
  });

  // Suggested asking price: average base-currency catalog value per set (a buyer takes one set),
  // converted to the offer's currency at the current rate. Summed from the per-set figures above
  // rather than from a second valuation pass — a set counts as valued when *some* copy of it priced,
  // which is exactly what `pricedCount` says.
  let sumSetCV = 0;
  let valuedSets = 0;
  for (const s of sets) {
    if (s.holdings.pricedCount === 0) continue;
    sumSetCV += Number(s.holdings.totalBaseAmount);
    valuedSets++;
  }
  let suggestedPrice: string | null = null;
  if (valuedSets > 0) {
    const avgBase = sumSetCV / valuedSets;
    // Same rate the per-set figures used — an offer already in base converts 1:1, and a missing rate
    // leaves no suggestion rather than one in the wrong currency.
    const rate = offer.currency === baseCurrency ? 1 : baseToOffer;
    suggestedPrice = rate === null ? null : (avgBase * rate).toFixed(2);
  }

  // The same two figures over the whole listing (#378): summed, and averaged over the sets that
  // carried one. Summed from the per-set figures rather than re-aggregated, because an offer never
  // lists a copy twice — the sets partition its copies, so the parts add up to the whole exactly.
  let sumCost = 0;
  let costedSets = 0;
  for (const s of sets) {
    if (s.holdings.cost.knownCount === 0) continue;
    sumCost += Number(s.holdings.cost.totalCostBasis);
    costedSets++;
  }
  const money = (n: number | null) => (n === null ? null : n.toFixed(2));
  const inOffer = (n: number | null) =>
    n === null || baseToOffer === null ? null : (n * baseToOffer).toFixed(2);
  const catalogTotalNum = valuedSets > 0 ? sumSetCV : null;
  const catalogAverageNum = valuedSets > 0 ? sumSetCV / valuedSets : null;
  const costTotalNum = costedSets > 0 ? sumCost : null;
  const costAverageNum = costedSets > 0 ? sumCost / costedSets : null;
  const setsTotals: OfferSetsTotals = {
    setCount: sets.length,
    catalogTotal: money(catalogTotalNum),
    catalogAverage: money(catalogAverageNum),
    catalogValuedSets: valuedSets,
    costTotal: money(costTotalNum),
    costAverage: money(costAverageNum),
    costKnownSets: costedSets,
    inOfferCurrency:
      baseToOffer === null
        ? null
        : {
            currency: offer.currency,
            catalogTotal: inOffer(catalogTotalNum),
            catalogAverage: inOffer(catalogAverageNum),
            costTotal: inOffer(costTotalNum),
            costAverage: inOffer(costAverageNum),
          },
  };

  // Asking price converted to base at the current rate (#208). Skipped when already in base or
  // unpriced; a missing rate leaves it null.
  const priceNum = Number(offer.price);
  let priceBase: string | null = null;
  if (offer.currency !== baseCurrency && priceNum > 0) {
    try {
      const { rate } = await getOrFetchRate(offer.collectionId, offer.currency, baseCurrency);
      priceBase = (priceNum * rate).toFixed(2);
    } catch {
      priceBase = null;
    }
  }

  return {
    id: offer.id,
    collectionId: offer.collectionId,
    name: offer.name,
    label: labeller.offer(offer.sets),
    description: offer.description,
    privateNote: offer.privateNote,
    descriptionFormat: normalizeDescriptionFormat(offer.descriptionFormat),
    regeneratable: {
      name: !!offer.platform.titleTemplate?.trim(),
      description: !!offer.platform.descriptionTemplate?.trim(),
      privateNote: !!offer.platform.privateNoteTemplate?.trim(),
    },
    edited: {
      name: offer.nameEdited,
      description: offer.descriptionEdited,
      privateNote: offer.privateNoteEdited,
    },
    platformId: offer.platformId,
    platformName: offer.platform.name,
    platformTitleLanguage: offer.platform.titleLanguage,
    url: offer.url,
    price: offer.price.toFixed(2),
    currency: offer.currency,
    baseCurrency,
    priceBase,
    state,
    needsAction: sets.some((s) => s.needsAction),
    inActiveBidding: offer.inActiveBidding,
    suggestedPrice,
    suggestedUnpricedSets: offer.sets.length - valuedSets,
    sets,
    setsTotals,
    listingDate: offer.listingDate,
    photoConfig: {
      photoSides: normalizePhotoSides(offer.photoSides),
      photoLabelLeftTemplate: offer.photoLabelLeftTemplate,
      photoLabelRightTemplate: offer.photoLabelRightTemplate,
      // The collage numbers are written as a group, so one non-null column means the whole set is
      // there; a platform with no default template leaves them all null (no collage to render yet).
      collage:
        offer.collageRows != null &&
        offer.collageColumns != null &&
        offer.collageGapPercent != null &&
        offer.collageBackground != null &&
        offer.collageLabelPercent != null
          ? {
              collageRows: offer.collageRows,
              collageColumns: offer.collageColumns,
              collageGapPercent: offer.collageGapPercent,
              collageBackground: offer.collageBackground,
              collageLabelPercent: offer.collageLabelPercent,
            }
          : null,
    },
    platformPhotoLimits: {
      maxPhotos: offer.platform.maxPhotos,
      maxPhotoEdge: offer.platform.maxPhotoEdge,
      maxPhotoFileSizeMib: offer.platform.maxPhotoFileSizeMib,
    },
    platformTextLimits: {
      maxDescriptionLength: offer.platform.maxDescriptionLength,
      maxPrivateNoteLength: offer.platform.maxPrivateNoteLength,
    },
    platformModule,
    listingBlockers: listingBlockersFor(offer.sets, platformModule, labeller, conditionMap, state),
    // The same evaluation at the target state (#418), so the header can disable **Mark ready** with
    // the reasons rather than let the collector press it and be refused. It reuses this screen's own
    // sets and condition map — a second read would be the same answer at twice the cost.
    readyBlockers:
      state === "preparing"
        ? listingBlockersFor(offer.sets, platformModule, labeller, conditionMap, "ready")
        : [],
    createdAt: offer.createdAt,
  };
}

/** Distinct issue ids across every copy in an offer's sets, for the sets view's issue-group
 * headers (loaded once on the page, mirrors the sale/purchase views). */
export async function getOfferIssueIds(offerId: string): Promise<string[]> {
  const rows = await prisma.issueMember.findMany({
    where: {
      stamp: { items: { some: { offerSetMemberships: { some: { offerSet: { offerId } } } } } },
    },
    select: { issueId: true },
    distinct: ["issueId"],
  });
  return rows.map((r) => r.issueId);
}

/** Every physical copy across an offer's sets, enriched as `ItemListItem`s (same shape as the
 * Copies screen). An offer is one listing, so its copy count is bounded — loaded in one query and
 * grouped by set client-side for the rich sets view. */
export async function listOfferCopies(ownerId: string, offerId: string): Promise<ItemListItem[]> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      collection: { select: { ownerId: true } },
      sets: { select: { items: { select: { itemId: true } } } },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new Error("Offer not found or access denied.");
  }
  const ids = [...new Set(offer.sets.flatMap((s) => s.items.map((i) => i.itemId)))];
  if (ids.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, offer.collectionId, { ids, pageSize: ids.length });
  return items;
}

/** Copies eligible to add to an offer set (composition picker): *For sale*, delivered, not sold,
 * and not already in a set of this offer. */
export async function listComposableCopies(
  ownerId: string,
  collectionId: string,
  opts: { offerId?: string; areaIds?: string[]; search?: string; year?: number | "none" } = {}
): Promise<ItemListItem[]> {
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    forSale: true,
    deliveryState: "delivered",
    excludeSold: true,
    notInOfferId: opts.offerId,
    areaIds: opts.areaIds,
    search: opts.search,
    year: opts.year,
    sortDir: "asc",
    pageSize: 1000,
  });
  return items;
}

export interface ComposeTargetSet {
  offerSetId: string;
  label: string;
  itemIds: string[];
  itemLabels: string[];
  /** Which of the copies being added this set already holds. A destination is only *disabled* when
   * it holds every one of them (nothing left to add); holding some is a note, and those copies are
   * dropped from the add — a selection is rarely all-or-nothing (#372/#373). */
  containsItemIds: string[];
}

export interface ComposeTargetOffer {
  offerId: string;
  platformId: string;
  platformName: string;
  label: string;
  price: string;
  currency: string;
  state: OfferState;
  sets: ComposeTargetSet[];
  /** Which of the copies being added are already listed somewhere in this offer (any set) — an
   * offer never lists the same copy twice, so a new set may not hold them either. */
  containsItemIds: string[];
}

export interface ComposeTargets {
  offers: ComposeTargetOffer[];
  /** Enriched copies across the target offers' sets, for the picker's expandable set details. */
  copies: ItemListItem[];
}

const COMPOSE_TARGET_STATES = ["preparing", "ready", "active", "paused"] as const;
const COMPOSE_STATE_RANK: Record<string, number> = { preparing: 0, ready: 1, active: 2, paused: 3 };

/** Offers copies can be added to from the inventory list (#188): the collection's non-terminal
 * offers (preparing / ready / active / paused, all platforms), each with its sets, ordered
 * preparing → ready → active → paused then newest first. When `itemIds` is given, the sets and
 * offers already holding any of those copies report which ones, so the picker can disable a
 * destination that has nothing left to gain and note the rest (an offer never lists a copy twice).
 * Enriched copies for every listed set ride along for the picker's expandable set details. */
export async function listComposeTargets(
  ownerId: string,
  collectionId: string,
  itemIds: string[] = []
): Promise<ComposeTargets> {
  await assertCollectionOwner(ownerId, collectionId);
  const adding = new Set(itemIds);
  const rows = await prisma.offer.findMany({
    where: { collectionId, state: { in: [...COMPOSE_TARGET_STATES] } },
    orderBy: { createdAt: "desc" },
    select: OFFER_SELECT,
  });
  const labeller = await makeOfferLabeller(collectionId);

  const offers: ComposeTargetOffer[] = rows
    .map((r) => {
      const sets: ComposeTargetSet[] = r.sets.map((s) => ({
        offerSetId: s.id,
        label: labeller.set(s),
        itemIds: s.items.map((li) => li.itemId),
        itemLabels: s.items.map((li) => labeller.copy(li.item.stamp)),
        containsItemIds: s.items.map((li) => li.itemId).filter((id) => adding.has(id)),
      }));
      return {
        offerId: r.id,
        platformId: r.platformId,
        platformName: r.platform.name,
        label: labeller.offer(r.sets),
        price: r.price.toFixed(2),
        currency: r.currency,
        state: (isOfferState(r.state) ? r.state : "active") as OfferState,
        sets,
        containsItemIds: [...new Set(sets.flatMap((s) => s.containsItemIds))],
      };
    })
    .sort(
      (a, b) => (COMPOSE_STATE_RANK[a.state] ?? 9) - (COMPOSE_STATE_RANK[b.state] ?? 9)
    );

  const ids = [...new Set(rows.flatMap((r) => r.sets.flatMap((s) => s.items.map((li) => li.itemId))))];
  const copies = ids.length
    ? (await listItemsPaginated(ownerId, collectionId, { ids, pageSize: ids.length })).items
    : [];

  return { offers, copies };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface OfferInput {
  platformId: string;
  url: string | null;
  price: string;
  /** First-offer fallback currency (#196): used only to set the platform's currency when it has
   * none yet. Ignored once the platform has a currency — the offer is locked to the platform's. */
  currency: string;
  /** The date the listing went live (#257), or null when not recorded. Stored on create + edit. */
  listingDate: Date | null;
  /** The status to create the offer in (#257): `preparing` (default), or a live `ready` / `active`
   * when the offer lists something. Ignored by {@link updateOffer} — an existing offer's lifecycle is
   * driven by its dedicated controls, not the header form. */
  state: OfferState;
}

/**
 * Create an offer on a platform (ADR-0013, #188). It starts `preparing` unless the collector states
 * a live status up front (#257): `ready` / `active` are honoured only when the offer lists something,
 * so `opts.seedItemIds` (the quick-start / add-to-offer create path, #189/#241) seeds its first set
 * **atomically** — offer + set + live status commit together, or nothing does. `opts.seedPerCopy`
 * splits that seed into one single-copy set each (#372), the shape a quantity listing needs.
 * Currency is inherited
 * from the platform (#196) — locked to the platform's, or set from `input.currency` on the first
 * offer/sale and snapshotted here. Sets beyond the seed are composed on the detail screen.
 */
export async function createOffer(
  ownerId: string,
  collectionId: string,
  input: OfferInput,
  opts: { seedItemIds?: string[]; seedPerCopy?: boolean } = {}
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await assertPlatform(collectionId, input.platformId);
  const currency = await resolvePlatformCurrency(input.platformId, platform.platformCurrency, input.currency);

  // Asking price, falling back to the platform's default (#362). That default is the *lowest*
  // priority suggestion: a lot's suggested price (#190) and the copies' catalog value (#230) both
  // reach the form as a filled-in figure, so anything submitted here already outranks it. Resolved
  // before the live-status checks, so creating straight as `ready` on a flat-price platform is not
  // rejected as unpriced.
  const price = hasPrice(input.price) ? input.price : (platform.defaultOfferPrice ?? input.price);

  const targetState = input.state;
  if (isTerminalState(targetState)) {
    throw new OfferActionBlockedError("bad-transition", "An offer cannot be created already closed.");
  }

  // Seed copies for the quick-start / add-to-offer create path (#189/#241): validate addability up
  // front, then write the first set inside the transaction. A chosen live status can then be honoured.
  const seedIds = opts.seedItemIds?.length
    ? await assertAddableCopies(collectionId, opts.seedItemIds)
    : [];
  if (opts.seedItemIds?.length && seedIds.length === 0) {
    throw new OfferActionBlockedError("empty", "That copy can't be listed — it may have already sold.");
  }
  // A live status (ready / active) requires the offer to actually list something (#246). Reject it
  // before creating anything, so no half-open draft is left behind.
  if (requiresSets(targetState) && seedIds.length === 0) {
    throw new OfferActionBlockedError(
      "empty",
      `An offer can't start ${targetState} with no sets — compose it first, then advance it.`
    );
  }
  // A prepared or live listing needs an asking price (#336) — creating one straight as `ready` /
  // `active` skips the transition, so the same rule applies here.
  if (requiresPrice(targetState) && !hasPrice(price)) {
    throw new OfferActionBlockedError(
      "unpriced",
      `An offer can't start ${targetState} with no asking price — set a price first.`
    );
  }

  // Generate the listing texts (#209/#210, #266, #267) from the platform's configured templates over
  // the seed copies — the seed is the offer's first (and so far only) set. A field with no template
  // configured, or no seed copies yet, stays null: the name falls back to the derived label and the
  // longer texts stay empty until the collector composes and regenerates.
  // How the seed is packaged (#372): one set holding everything (a series sold together), or —
  // `seedPerCopy` — one single-copy set each, the quantity listing a stock of duplicates has to be
  // on a platform that refuses a second offer for the same stamp in the same condition.
  const seedComposition = opts.seedPerCopy
    ? seedIds.map((itemId) => ({ title: null, itemIds: [itemId] }))
    : [{ title: null, itemIds: seedIds }];
  const { name, description, privateNote } = await generateListingTexts(
    ownerId,
    collectionId,
    seedComposition,
    platform,
    platform.titleLanguage,
    // No id yet — a template using `{offerUrl}` is rendered again below, once the row exists (#415).
    null
  );

  // The offer's own photo configuration (#308), copied from the platform's defaults and its default
  // collage template. Held on the offer from here on, so changing a platform setting later never
  // alters this listing's photos.
  const photoConfig = await seedPhotoConfig(platform);

  const offerId = await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.create({
      data: {
        collectionId,
        // Inside the transaction, so a rolled-back creation returns the number too (#416).
        offerNo: await allocateOfferNumber(tx, collectionId),
        platformId: input.platformId,
        name,
        description,
        privateNote,
        // The format the description is written in (#319), seeded from the platform for the same
        // reason the photo configuration is: this listing's text was composed for that field.
        descriptionFormat: normalizeDescriptionFormat(platform.descriptionFormat),
        ...photoConfig,
        url: input.url,
        price,
        currency,
        listingDate: input.listingDate,
        // Set the target state directly (creation states the real-world status; the step-through
        // graph governs later manual changes). Guarded above against terminal / set-less-live.
        state: targetState,
      },
      select: { id: true },
    });
    // The seed is the new offer's first set(s) (#306); their copies start derived (catalog order).
    for (const [index, set] of seedComposition.entries()) {
      if (set.itemIds.length === 0) continue;
      await tx.offerSet.create({
        data: {
          offerId: offer.id,
          sortOrder: index,
          items: { create: set.itemIds.map((itemId) => ({ itemId })) },
        },
      });
    }
    return offer.id;
  });
  await syncOfferContextTexts(ownerId, offerId, platform);
  return offerId;
}

/** Render the listing texts once more, now that the offer has an id (#415). A no-op for every
 * platform whose templates do not name an offer-level token, which is why it can sit on the creation
 * path at all: the texts were already generated over the same composition a moment ago, and the only
 * thing that changed is that `{offerUrl}` now has an answer. It goes through
 * {@link syncGeneratedTexts} rather than repeating the write, so the edited-flag and terminal-state
 * rules stay in one place. */
async function syncOfferContextTexts(
  ownerId: string,
  offerId: string,
  platform: PlatformTemplates
): Promise<void> {
  if (!platformTemplatesUseOfferContext(platform)) return;
  await syncGeneratedTexts(ownerId, offerId);
}

export interface DuplicateOfferResult {
  id: string;
  /** Copies dropped from the clone because they had already sold elsewhere (ADR-0013 §4). */
  skippedCopies: number;
}

/** List the same composition on another platform (#200): clone an offer's sets + item membership
 * into a new `preparing` offer, prompting only for platform / price / currency (URL starts blank).
 * The clone is an independent snapshot (ADR-0013 §1) — editing either offer afterwards is
 * independent, since sets are copied rather than shared. Copies that have already sold elsewhere
 * (globally retired) are skipped, and any set left empty by that is dropped; the count of skipped
 * copies is returned so the caller can surface a note. Works from any source state — the clone is
 * always a fresh draft. */
export async function duplicateOffer(
  ownerId: string,
  sourceOfferId: string,
  input: OfferInput
): Promise<DuplicateOfferResult> {
  const ref = await assertOfferOwner(ownerId, sourceOfferId);
  const platform = await assertPlatform(ref.collectionId, input.platformId);
  const currency = await resolvePlatformCurrency(input.platformId, platform.platformCurrency, input.currency);

  // Source composition + which of its copies have sold elsewhere (dropped from the clone).
  const sets = (
    await prisma.offerSet.findMany({
      where: { offerId: sourceOfferId },
      select: { title: true, items: { select: SET_ITEM_ORDER_SELECT } },
      orderBy: OFFER_SETS_ORDER_BY,
    })
    // The clone keeps the source's order at both levels (#306): sets in their explicit order, copies
    // in effective order — carrying the "hand-corrected" flag so a derived set stays derived.
  ).map((s) => ({ title: s.title, itemIds: orderedItemIds(s.items), manualItemOrder: hasManualItemOrder(s.items) }));
  const allItemIds = sets.flatMap((s) => s.itemIds);
  const soldRows = allItemIds.length
    ? await prisma.saleLineItem.findMany({
        where: { itemId: { in: allItemIds } },
        select: { itemId: true },
      })
    : [];
  const soldIds = new Set(soldRows.map((r) => r.itemId));

  let skippedCopies = 0;
  const cloneSets = sets
    .map((s) => {
      const keep = s.itemIds.filter((id) => !soldIds.has(id));
      skippedCopies += s.itemIds.length - keep.length;
      return { title: s.title, itemIds: keep, manualItemOrder: s.manualItemOrder };
    })
    .filter((s) => s.itemIds.length > 0);

  const targetState = input.state;
  if (isTerminalState(targetState)) {
    throw new OfferActionBlockedError("bad-transition", "An offer cannot be created already closed.");
  }
  // A live status (ready / active) requires ≥1 set (#246): reject when every source copy had sold and
  // the clone would be empty, before creating anything.
  if (requiresSets(targetState) && cloneSets.length === 0) {
    throw new OfferActionBlockedError(
      "empty",
      `Nothing left to list — every copy has sold elsewhere, so the copy can't start ${targetState}.`
    );
  }
  // Same price rule as a fresh creation (#336): the clone is priced for its own platform, so a
  // blank price cannot start prepared or live either.
  if (requiresPrice(targetState) && !hasPrice(input.price)) {
    throw new OfferActionBlockedError(
      "unpriced",
      `An offer can't start ${targetState} with no asking price — set a price first.`
    );
  }

  // Generate the clone's listing texts from the *new* platform's configured templates over its kept
  // sets (#209/#210, #266, #267) — the clone is a listing on another platform, so it gets that
  // platform's wording, not the source offer's. Null for every field that platform has no template for.
  const { name, description, privateNote } = await generateListingTexts(
    ownerId,
    ref.collectionId,
    cloneSets,
    platform,
    platform.titleLanguage,
    null // as in `createOffer` (#415): the clone's own id exists only after the transaction.
  );

  // Photo configuration follows the same rule as the texts (#308): the clone is a listing on another
  // platform, so it is seeded from *that* platform's defaults rather than copied from the source.
  const photoConfig = await seedPhotoConfig(platform);

  const id = await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.create({
      data: {
        collectionId: ref.collectionId,
        offerNo: await allocateOfferNumber(tx, ref.collectionId), // #416, as in `createOffer`
        platformId: input.platformId,
        name,
        description,
        privateNote,
        // The format the description is written in (#319), seeded from the platform for the same
        // reason the photo configuration is: this listing's text was composed for that field.
        descriptionFormat: normalizeDescriptionFormat(platform.descriptionFormat),
        ...photoConfig,
        url: input.url,
        price: input.price,
        currency,
        listingDate: input.listingDate,
        state: targetState,
      },
      select: { id: true },
    });
    for (const [index, s] of cloneSets.entries()) {
      await tx.offerSet.create({
        data: {
          offerId: offer.id,
          title: s.title,
          sortOrder: index,
          items: {
            create: s.itemIds.map((itemId, i) => ({
              itemId,
              // `itemIds` is already in effective order: a hand-corrected set is cloned with
              // explicit positions, a derived one stays derived (#306).
              sortOrder: s.manualItemOrder ? i : null,
            })),
          },
        },
      });
    }
    return offer.id;
  });

  await syncOfferContextTexts(ownerId, id, platform); // #415, as in `createOffer`
  return { id, skippedCopies };
}

/** Edit an offer's platform / URL / price. Terminal offers (sold / withdrawn) are frozen. Currency
 * is not edited here (#196): it is a per-offer snapshot inherited from the platform at creation, so
 * editing an offer never rewrites it. */
export async function updateOffer(
  ownerId: string,
  offerId: string,
  input: OfferInput
): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only and cannot be edited.`);
  }
  // The same invariant the transition guard enforces (#336): a ready or active offer always has a
  // price, so an edit cannot clear it back out from under one.
  if (requiresPrice(ref.state) && !hasPrice(input.price)) {
    throw new OfferActionBlockedError("unpriced", `A ${ref.state} offer must keep an asking price.`);
  }
  await assertPlatform(ref.collectionId, input.platformId);
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      platformId: input.platformId,
      url: input.url,
      price: input.price,
      // Listing date is editable on the header form (#257); the status is not — an existing offer's
      // lifecycle is driven by its dedicated controls, so `input.state` is ignored here.
      listingDate: input.listingDate,
    },
  });
}

export interface OfferPatch {
  platformId?: string;
  url?: string | null;
  price?: string;
  /** The listing title (#209). Blank clears it back to null (the UI then shows the derived label).
   * Editable in every state for record-keeping, like the URL. */
  name?: string | null;
  /** The listing description (#266) and the seller-only private note (#267). Same contract as the
   * title: blank clears back to null, editable in every state. */
  description?: string | null;
  privateNote?: string | null;
  /** How the description is read (#319). Normalised, so an unknown value falls back to plain text. */
  descriptionFormat?: string;
}

/** Patch one or more offer header fields in place (ADR-0013) — the detail screen edits name / price
 * / URL individually. Currency is not patchable (#196): it is inherited and locked from the
 * platform. Terminal offers freeze price and platform, but the listing URL and title stay editable
 * in every state for record-keeping (#213, #209); a changed platform is re-validated. */
export async function patchOffer(ownerId: string, offerId: string, patch: OfferPatch): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  const touchesFrozenField = patch.platformId !== undefined || patch.price !== undefined;
  if (isTerminalState(ref.state) && touchesFrozenField) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only and cannot be edited.`);
  }
  // A ready or active offer always has a price (#336): clearing it in place is refused for the same
  // reason advancing to those states without one is.
  if (patch.price !== undefined && requiresPrice(ref.state) && !hasPrice(patch.price)) {
    throw new OfferActionBlockedError("unpriced", `A ${ref.state} offer must keep an asking price.`);
  }
  if (patch.platformId !== undefined) {
    await assertPlatform(ref.collectionId, patch.platformId);
  }
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      ...(patch.platformId !== undefined ? { platformId: patch.platformId } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      // Writing a generated text by hand takes it off the template (#380): from here on the field is
      // the collector's, and a composition change re-renders the others around it. **Clearing** it
      // hands it back — the flag protects written wording, and an emptied field holds none; blanking
      // the title is how one asks for the derived label again (#209), which follows the composition
      // by definition. It is the same rule the migration read existing offers by.
      ...(patch.name !== undefined ? { name: patch.name, nameEdited: patch.name !== null } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description, descriptionEdited: patch.description !== null }
        : {}),
      ...(patch.privateNote !== undefined
        ? { privateNote: patch.privateNote, privateNoteEdited: patch.privateNote !== null }
        : {}),
      ...(patch.descriptionFormat !== undefined
        ? { descriptionFormat: normalizeDescriptionFormat(patch.descriptionFormat) }
        : {}),
    },
  });
}

/**
 * Replace an offer's photo configuration (#308) — sides, tile label template and the collage numbers
 * copied from a template. The whole configuration is written at once, mirroring the dialog's single
 * save; a null `collage` clears the numbers back to "none picked yet".
 *
 * Allowed in every state: like the listing texts, this is preparation and record-keeping, never a
 * live claim about the listing. Editing it marks the generated photo plan out of date (#311).
 */
export async function updateOfferPhotoConfig(
  ownerId: string,
  offerId: string,
  config: OfferPhotoConfigInput
): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      photoSides: config.photoSides,
      photoLabelLeftTemplate: config.photoLabelLeftTemplate,
      photoLabelRightTemplate: config.photoLabelRightTemplate,
      collageRows: config.collage?.collageRows ?? null,
      collageColumns: config.collage?.collageColumns ?? null,
      collageGapPercent: config.collage?.collageGapPercent ?? null,
      collageBackground: config.collage?.collageBackground ?? null,
      collageLabelPercent: config.collage?.collageLabelPercent ?? null,
    },
  });
}

/** Regenerate **one** of an offer's generated listing texts (#209/#210, #266, #267) — its title,
 * description or private note — from the platform's current template over the offer's present
 * composition, overwriting any manual edit. That is also how a hand-written field is handed **back**
 * to the template (#380): the ↻ clears the field's edited flag, so it follows the composition again.
 * Returns the new value (null when the platform has no
 * template for that field, or the offer lists nothing yet: the title then falls back to the derived
 * label and the longer texts stay empty). Allowed in every state — these are record-keeping, never a
 * live claim.
 *
 * `language` (#297) regenerates in a language other than the platform's own — a one-off override,
 * not remembered: only the resulting text is stored, and it stays editable (#209). */
export async function regenerateOfferText(
  ownerId: string,
  offerId: string,
  field: OfferTextField,
  language?: string | null
): Promise<string | null> {
  const ref = await assertOfferOwner(ownerId, offerId);
  const platform = await assertPlatform(ref.collectionId, ref.platformId);
  const composition = await offerComposition(offerId);
  // Only the asked-for field's template is handed to the generator, so the others are neither
  // rendered nor written — a regenerated description never disturbs a hand-edited title.
  const only: PlatformTemplates = {
    titleTemplate: null,
    descriptionTemplate: null,
    privateNoteTemplate: null,
    titleLanguage: platform.titleLanguage,
    ...(field === "name"
      ? { titleTemplate: platform.titleTemplate }
      : field === "description"
        ? { descriptionTemplate: platform.descriptionTemplate }
        : { privateNoteTemplate: platform.privateNoteTemplate }),
  };
  const texts = await generateListingTexts(
    ownerId,
    ref.collectionId,
    composition,
    only,
    language === undefined ? platform.titleLanguage : language,
    offerId
  );
  const value = texts[field];
  await prisma.offer.update({
    where: { id: offerId },
    data: { [field]: value, [EDITED_FLAG[field]]: false },
  });
  return value;
}

/** The `Offer` column recording that a generated text was written by hand (#380). */
const EDITED_FLAG: Record<OfferTextField, "nameEdited" | "descriptionEdited" | "privateNoteEdited"> = {
  name: "nameEdited",
  description: "descriptionEdited",
  privateNote: "privateNoteEdited",
};

/**
 * Bring the offer's generated listing texts back in step with what it actually lists (#380).
 *
 * Called after **every** mutation that changes what {@link offerComposition} returns — a set added or
 * removed, copies added to one, a set renamed, either order rearranged. Each field is re-rendered
 * from the platform's template, and written only when:
 *
 * - the collector has **not** written that field themselves (`*Edited`, set by {@link patchOffer} and
 *   cleared by {@link regenerateOfferText}). A hand-written listing is the author's, and a listing
 *   growing by one copy is no reason to throw their wording away; and
 * - the platform actually configures a template for it. A template since cleared leaves the last
 *   generated text standing rather than emptying a live listing's description as a side effect of a
 *   settings change elsewhere.
 *
 * Terminal offers are left alone entirely: what a sold listing said is history.
 *
 * This subsumes the old title backfill (#365): an offer created empty rendered its title over no
 * copies at all, so nothing was written — composing it now writes the title, for the same reason it
 * refreshes it later.
 */
async function syncGeneratedTexts(ownerId: string, offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      platformId: true,
      state: true,
      nameEdited: true,
      descriptionEdited: true,
      privateNoteEdited: true,
    },
  });
  if (!offer) return;
  // A sold or withdrawn listing is a *record* of what was listed, so nothing rewrites its wording
  // behind the collector's back — ↻ Regenerate still works there, deliberately, because that is an
  // explicit act. (The only composition change a terminal offer allows is removing a set.)
  if (isOfferState(offer.state) && isTerminalState(offer.state)) return;
  const platform = await assertPlatform(offer.collectionId, offer.platformId);
  // Only the fields still following the template are rendered at all — the generator is handed
  // nothing for the others, so an edited field costs neither a render nor a write.
  const templates: PlatformTemplates = {
    titleTemplate: offer.nameEdited ? null : platform.titleTemplate,
    descriptionTemplate: offer.descriptionEdited ? null : platform.descriptionTemplate,
    privateNoteTemplate: offer.privateNoteEdited ? null : platform.privateNoteTemplate,
    titleLanguage: platform.titleLanguage,
  };
  if (!templates.titleTemplate?.trim() && !templates.descriptionTemplate?.trim() && !templates.privateNoteTemplate?.trim()) {
    return;
  }
  const composition = await offerComposition(offerId);
  const texts = await generateListingTexts(
    ownerId,
    offer.collectionId,
    composition,
    templates,
    platform.titleLanguage,
    offerId
  );
  // A field whose template rendered nothing at all (an empty offer, every token blank) keeps what it
  // has: the derived label already stands in for a missing title, and blanking a description because
  // one render came out empty would lose more than it fixed.
  const data = Object.fromEntries(
    (Object.keys(texts) as OfferTextField[])
      .filter((field) => texts[field] !== null)
      .map((field) => [field, texts[field]])
  );
  if (Object.keys(data).length > 0) {
    await prisma.offer.update({ where: { id: offerId }, data });
  }
}

/** Move an offer through its manual lifecycle (preparing → ready → active ↔ paused → withdrawn,
 * reversible; #246). `sold` is owned by the sale flow (#166) and rejected here.
 *
 * Publishing — `ready → active` — also stamps the listing date (#320); see the note at the update. */
export async function setOfferState(ownerId: string, offerId: string, to: OfferState): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (to === "sold") {
    throw new OfferActionBlockedError("bad-transition", "An offer is marked sold by recording a sale, not directly.");
  }
  if (!canTransition(ref.state, to)) {
    throw new OfferActionBlockedError("bad-transition", `Cannot move an offer from ${ref.state} to ${to}.`);
  }
  // Marking an offer ready or publishing it (Activate, #188/#246): it must actually list something.
  if (requiresSets(to)) {
    const setCount = await prisma.offerSet.count({ where: { offerId } });
    if (setCount === 0) {
      const verb = to === "active" ? "activating" : "marking this offer ready";
      throw new OfferActionBlockedError("empty", `Add at least one set before ${verb}.`);
    }
  }
  // Marking it ready is also where the listing preconditions are asked (#418) — see
  // {@link readReadyBlockers} for why here and nowhere else in the lifecycle.
  if (to === "ready") {
    const blockers = await readReadyBlockers(ref.collectionId, offerId);
    if (blockers.length > 0) {
      throw new OfferActionBlockedError(
        "listing-preconditions",
        `This offer cannot be listed on its platform yet: ${blockers.map((b) => b.message).join(" ")}`
      );
    }
  }
  // The same two targets also need an asking price (#336): an offer with no price is not prepared,
  // and publishing one is never intentional.
  if (requiresPrice(to)) {
    const row = await prisma.offer.findUnique({ where: { id: offerId }, select: { price: true } });
    if (!row || !hasPrice(row.price.toFixed(2))) {
      const verb = to === "active" ? "activating" : "marking this offer ready";
      throw new OfferActionBlockedError("unpriced", `Set an asking price before ${verb}.`);
    }
  }
  // Publishing (#320): `ready → active` is the moment the listing actually goes live, so it stamps
  // the listing date. It is the one transition that does — resuming a paused offer is not a first
  // publication, and going back to `preparing` is not one either.
  //
  // An offer *created* directly as `active` (#257) never passes through here, so the date the
  // collector typed in the creation dialog is left exactly as entered. The stamp is a starting
  // value, not a lock: the header form edits it afterwards like any other field.
  const publishing = ref.state === "ready" && to === "active";
  await prisma.offer.update({
    where: { id: offerId },
    data: { state: to, ...(publishing ? { listingDate: todayUtcDate() } : {}) },
  });
}

/** Today at UTC midnight — the shape `Offer.listingDate` (`@db.Date`) stores, matching how
 *  {@link parseOfferDate} normalizes a typed `YYYY-MM-DD`. */
function todayUtcDate(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Set (or clear) "in active bidding" (#215): an auction-platform offer that has received a bid,
 * committing the collector before the sale is actually recorded. Independent axis from `state` —
 * no transition rules, freely revertible (the auction can still fail to close). Only meaningful on
 * a live (`active`) offer; setting it elsewhere is a no-op guard, not an error, since the collector
 * may toggle it around other lifecycle changes. */
export async function setOfferInActiveBidding(
  ownerId: string,
  offerId: string,
  value: boolean
): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (value && ref.state !== "active") {
    throw new OfferActionBlockedError(
      "bad-transition",
      "Only an active offer can be marked in active bidding."
    );
  }
  await prisma.offer.update({ where: { id: offerId }, data: { inActiveBidding: value } });
}

/** Delete an offer and all its sets (the underlying copies are untouched). Blocked when any set
 * has sold — the sale record must survive (`sale_line.offerSetId` is `Restrict`). */
export async function deleteOffer(ownerId: string, offerId: string): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  const soldSets = await prisma.saleLine.count({ where: { offerSet: { offerId } } });
  if (soldSets > 0) {
    throw new OfferActionBlockedError(
      "sold-set",
      "This offer has sold sets and cannot be deleted. Withdraw it instead."
    );
  }
  // Generated listing images (#311) hang off the offer. The cascade drops their rows but never the
  // files, so their bytes go first, while the rows can still be read.
  await deleteOfferPhotoBytes(offerId);
  await prisma.offer.delete({ where: { id: offerId } });
}

/** Verify copies are addable to a set: they belong to the collection, have not already sold, and —
 * when `excludeOfferId` is given — are not already listed elsewhere in that same offer (an offer
 * never lists the same copy twice). Returns the valid, addable ids. */
async function assertAddableCopies(
  collectionId: string,
  itemIds: string[],
  excludeOfferId?: string
): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const valid = await prisma.item.findMany({
    // A copy the collector no longer holds cannot be listed (#394) — the listing would advertise
    // something they cannot ship. Enforced here rather than at each caller: this is the one
    // chokepoint every composition path goes through.
    where: { id: { in: itemIds }, collectionId, disposedAt: null },
    select: { id: true },
  });
  const validIds = new Set(valid.map((v) => v.id));
  const sold = await prisma.saleLineItem.findMany({
    where: { itemId: { in: [...validIds] } },
    select: { itemId: true },
  });
  const soldIds = new Set(sold.map((r) => r.itemId));
  const inOffer = excludeOfferId ? await itemsInOffer(excludeOfferId, [...validIds]) : new Set<string>();
  return [...validIds].filter((id) => !soldIds.has(id) && !inOffer.has(id));
}

/** Which of `itemIds` are already held by some set of `offerId` (an offer never lists a copy
 * twice). */
async function itemsInOffer(offerId: string, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await prisma.offerSetItem.findMany({
    where: { itemId: { in: itemIds }, offerSet: { offerId } },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
}

/** The position a set added to `offerId` takes (#306): the end of the offer's current order. */
async function nextSetSortOrder(offerId: string): Promise<number> {
  const last = await prisma.offerSet.aggregate({
    where: { offerId },
    _max: { sortOrder: true },
  });
  return (last._max.sortOrder ?? -1) + 1;
}

/** Add one set (holding `itemIds`, sold together) to an offer. A single copy makes a single-item
 * set; several copies make a komplet. Returns the new set id. */
export async function addOfferSet(
  ownerId: string,
  offerId: string,
  itemIds: string[],
  title?: string | null,
  language?: string | null
): Promise<string> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only.`);
  }
  const addable = await assertAddableCopies(ref.collectionId, itemIds, offerId);
  if (addable.length === 0) {
    throw new OfferActionBlockedError("empty", "Add at least one available copy to the set.");
  }
  // Set/lot title (#210): an explicit title wins; otherwise pre-fill from the platform's configured
  // template over this set's copies. Null (no template) leaves the label derived from the copies.
  const explicit = title?.trim() || null;
  const { titleTemplate, titleLanguage } = await assertPlatform(ref.collectionId, ref.platformId);
  // `language` (#297) is the compose dialog's per-add override; without one the platform's own
  // listing language applies. Nothing about the choice is stored — the title it produced is.
  const effectiveLanguage = language === undefined ? titleLanguage : language;
  const setTitle = explicit ?? (await generateConfiguredTitle(ownerId, ref.collectionId, addable, titleTemplate, effectiveLanguage));
  const set = await prisma.offerSet.create({
    data: {
      offerId,
      title: setTitle,
      sortOrder: await nextSetSortOrder(offerId),
      items: { create: addable.map((itemId) => ({ itemId })) },
    },
    select: { id: true },
  });
  // The composition changed — re-render the texts still following the platform's templates (#380),
  // which is also what gives an offer created empty the title it could not be generated with (#365).
  await syncGeneratedTexts(ownerId, offerId);
  return set.id;
}

/** Add each copy as its **own** single-item set — the fast path for a stock of duplicates (a
 * "quantity" listing of interchangeable singles). Returns the new set ids. */
export async function addOfferSetsPerCopy(
  ownerId: string,
  offerId: string,
  itemIds: string[],
  language?: string | null
): Promise<string[]> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only.`);
  }
  const addable = await assertAddableCopies(ref.collectionId, itemIds, offerId);
  if (addable.length === 0) {
    throw new OfferActionBlockedError("empty", "Add at least one available copy.");
  }
  // Pre-fill each single-copy set's title from the platform's configured template (#210), computed
  // per copy so each stands alone. Null (no template) leaves each label derived from its copy.
  const { titleTemplate, titleLanguage } = await assertPlatform(ref.collectionId, ref.platformId);
  const effectiveLanguage = language === undefined ? titleLanguage : language; // per-add override (#297)
  const titles = new Map<string, string | null>();
  for (const itemId of addable) {
    titles.set(itemId, await generateConfiguredTitle(ownerId, ref.collectionId, [itemId], titleTemplate, effectiveLanguage));
  }
  const ids: string[] = [];
  const firstSortOrder = await nextSetSortOrder(offerId);
  await prisma.$transaction(async (tx) => {
    for (const [index, itemId] of addable.entries()) {
      const set = await tx.offerSet.create({
        data: {
          offerId,
          title: titles.get(itemId) ?? null,
          sortOrder: firstSortOrder + index,
          items: { create: [{ itemId }] },
        },
        select: { id: true },
      });
      ids.push(set.id);
    }
  });
  await syncGeneratedTexts(ownerId, offerId); // #380/#365, as in addOfferSet
  return ids;
}

/** Add copies to an **existing** set, turning a single into a series / komplet (#188). The owning
 * offer must be non-terminal; each copy must belong to the collection, be unsold, and not already
 * be listed anywhere in that offer. Copies that fail those checks are dropped rather than rejecting
 * the whole add — the selection may have been made before one of them sold — and the number
 * actually added is returned so the caller can say so. */
export async function addItemsToOfferSet(
  ownerId: string,
  setId: string,
  itemIds: string[]
): Promise<number> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  if (isTerminalState(ref.offerState)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.offerState} offer is read-only.`);
  }
  const addable = await assertAddableCopies(ref.collectionId, itemIds, ref.offerId);
  if (addable.length === 0) {
    throw new OfferActionBlockedError(
      "empty",
      itemIds.length === 1
        ? "That copy can't be added — it may have sold or already be in this offer."
        : "None of those copies can be added — they may have sold or already be in this offer."
    );
  }
  // Where the copies land (#306): a derived set stays derived (they slot into their catalog
  // positions), a hand-corrected one appends them at the end, in the order they were picked.
  const existing = await prisma.offerSetItem.findMany({
    where: { offerSetId: setId },
    select: { sortOrder: true },
  });
  // `null` is a derived set staying derived, so it must be carried, never counted up from.
  const base = nextItemSortOrder(existing);
  await prisma.$transaction(
    addable.map((itemId, i) =>
      prisma.offerSetItem.create({
        data: { offerSetId: setId, itemId, sortOrder: base === null ? null : base + i },
      })
    )
  );
  await syncGeneratedTexts(ownerId, ref.offerId); // #380/#365, as in addOfferSet
  return addable.length;
}

/** Reorder an offer's sets (#306). `setIds` must be a **full permutation** of the offer's current
 * sets — a partial list is rejected rather than silently applied, so a stale client (a set added or
 * removed in another tab) cannot half-write an order. Positions are rewritten dense and 0-based. */
export async function reorderOfferSets(
  ownerId: string,
  offerId: string,
  setIds: string[]
): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only.`);
  }
  const current = await prisma.offerSet.findMany({ where: { offerId }, select: { id: true } });
  assertPermutation(
    current.map((s) => s.id),
    setIds,
    "The offer's sets changed — reload and try reordering again."
  );
  await prisma.$transaction(
    setIds.map((id, index) =>
      prisma.offerSet.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  // Order is part of the composition the texts are rendered over (#380) — a description enumerating
  // the listing lists it in this order.
  await syncGeneratedTexts(ownerId, offerId);
}

/** Reorder the copies inside one set (#306), hand-correcting it away from derived catalog order.
 * `itemIds` must be a full permutation of the set's current copies; every copy gets an explicit
 * position, so the set becomes hand-corrected as a whole. */
export async function reorderOfferSetItems(
  ownerId: string,
  setId: string,
  itemIds: string[]
): Promise<void> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  if (isTerminalState(ref.offerState)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.offerState} offer is read-only.`);
  }
  const current = await prisma.offerSetItem.findMany({
    where: { offerSetId: setId },
    select: { itemId: true },
  });
  assertPermutation(
    current.map((li) => li.itemId),
    itemIds,
    "The set's copies changed — reload and try reordering again."
  );
  await prisma.$transaction(
    itemIds.map((itemId, index) =>
      prisma.offerSetItem.update({
        where: { offerSetId_itemId: { offerSetId: setId, itemId } },
        data: { sortOrder: index },
      })
    )
  );
  await syncGeneratedTexts(ownerId, ref.offerId); // #380, as in reorderOfferSets
}

/** Drop a set's hand-corrected copy order (#306): every position back to null, so the set derives
 * its order from the catalog sort key again. */
export async function resetOfferSetItemOrder(ownerId: string, setId: string): Promise<void> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  if (isTerminalState(ref.offerState)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.offerState} offer is read-only.`);
  }
  await prisma.offerSetItem.updateMany({ where: { offerSetId: setId }, data: { sortOrder: null } });
  await syncGeneratedTexts(ownerId, ref.offerId); // #380, as in reorderOfferSets
}

/** Guard for the reorder mutations: `next` must contain exactly the ids in `current`, once each. */
function assertPermutation(current: string[], next: string[], message: string): void {
  const have = new Set(current);
  const seen = new Set<string>();
  for (const id of next) {
    if (!have.has(id) || seen.has(id)) throw new OfferActionBlockedError("bad-order", message);
    seen.add(id);
  }
  if (seen.size !== have.size) throw new OfferActionBlockedError("bad-order", message);
}

/** Rename a set (its label falls back to its copies when blank). */
export async function updateOfferSet(ownerId: string, setId: string, title: string | null): Promise<void> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  await prisma.offerSet.update({ where: { id: setId }, data: { title: title?.trim() || null } });
  // A set's title is what `{setTitle}` renders (#266), so it is composition as far as the texts are
  // concerned (#380).
  await syncGeneratedTexts(ownerId, ref.offerId);
}

/** Remove a set from its offer (its copies stay in inventory). This is the coordination action —
 * removing a set whose copy sold elsewhere decrements the listing. Blocked once the set itself has
 * sold (`sale_line.offerSetId` is `Restrict`). */
export async function removeOfferSet(ownerId: string, setId: string): Promise<void> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  const soldLines = await prisma.saleLine.count({ where: { offerSetId: setId } });
  if (soldLines > 0) {
    throw new OfferActionBlockedError(
      "sold-set",
      "This set has sold and cannot be removed — its sale record references it."
    );
  }
  await prisma.offerSet.delete({ where: { id: setId } });
  // The listing lists one set fewer — the texts still following the template say so (#380).
  await syncGeneratedTexts(ownerId, ref.offerId);
}
