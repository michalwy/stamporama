import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import {
  getHoldingsValuationByGroup,
  getHoldingsValuationForItems,
  listItemsPaginated,
  valuateItemsByIds,
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
import { deriveSetLabel, deriveOfferLabel } from "./offer-set-rules";
import { normalizeDescriptionFormat, type DescriptionFormat } from "./description-format";
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
  type TitleSegment,
  type TitleFallback,
  type TemplateSet,
  type TitleTemplateCopy,
} from "./offer-title-template";
import { TITLE_COPY_SELECT, makeTitleCopyMapper, type TitleCopyRow } from "./title-copy";
import {
  normalizePhotoSides,
  type OfferPhotoConfigInput,
  type PlatformPhotoLimits,
} from "./offer-photo-config";
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
  | "bad-order";

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

/** Short copy label from a stamp select — primary catalog number, else name. */
function copyLabel(stamp: { name: string | null; catalogNumbers: { number: string }[] }): string {
  return stamp.catalogNumbers[0]?.number ?? stamp.name ?? "Copy";
}

const STAMP_LABEL_SELECT = {
  stamp: {
    select: {
      name: true,
      catalogNumbers: { select: { number: true }, take: 1 },
      // The denormalized catalog sort key (ADR-0014) a set's derived copy order falls back to (#306).
      primaryCatalogSortKey: true,
    },
  },
} as const;

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

type OfferSetItemRow = {
  itemId: string;
  sortOrder: number | null;
  item: { stamp: { name: string | null; catalogNumbers: { number: string }[]; primaryCatalogSortKey: number | null } };
};

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

function setLabel(set: OfferSetRow): string {
  return deriveSetLabel(set.title, orderedItems(set.items).map((li) => copyLabel(li.item.stamp)));
}

function offerLabel(sets: OfferSetRow[]): string {
  return deriveOfferLabel(sets.map(setLabel));
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
 */
async function generateListingTexts(
  ownerId: string,
  collectionId: string,
  composition: readonly OfferComposition[],
  templates: PlatformTemplates,
  language: string | null
): Promise<GeneratedListingTexts> {
  const configured = (t: string | null) => (t?.trim() ? t : null);
  const title = configured(templates.titleTemplate);
  const description = configured(templates.descriptionTemplate);
  const privateNote = configured(templates.privateNoteTemplate);
  const copyCount = composition.reduce((n, s) => n + s.itemIds.length, 0);
  if (copyCount === 0 || (!title && !description && !privateNote)) {
    return { name: null, description: null, privateNote: null };
  }
  const sets = await templateSets(ownerId, collectionId, composition, language);
  const copies = sets.flatMap((s) => [...s.copies]);
  return {
    name: title ? renderTitleTemplate(title, copies) || null : null,
    description: description ? renderListingTemplate(description, sets) || null : null,
    privateNote: privateNote ? renderListingTemplate(privateNote, sets) || null : null,
  };
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
 *  filter facets can group without a second pass). */
interface NeedsActionRow {
  offerId: string;
  platformId: string;
  deadCount: number;
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
    SELECT o."id" AS "offerId", o."platformId" AS "platformId", COUNT(*)::int AS "deadCount"
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

  const collisions: OfferCollision[] = [];
  for (const offer of offers) {
    const items = new Set(offer.sets.flatMap((s) => s.items.map((li) => li.itemId)));
    const shared = [...targets].filter((id) => items.has(id)).length;
    if (shared > 0) {
      collisions.push({
        offerId: offer.id,
        offerLabel: offerLabel(offer.sets),
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

function toListItem(row: OfferRow, baseCurrency: string, soldCopyCount = 0): OfferListItem {
  return {
    id: row.id,
    name: row.name,
    label: offerLabel(row.sets),
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
  const counts = await needsActionCounts(
    collectionId,
    rows.filter((r) => r.state === "active").map((r) => r.id)
  );
  const items = rows.map((r) => toListItem(r, baseCurrency, counts.get(r.id) ?? 0));
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
    const items = page.map((r) => toListItem(r, baseCurrency, counts.get(r.id) ?? 0));
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
  { id: string; name: string; platformCurrency: string | null; defaultOfferPrice: string | null }[]
> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId },
    select: {
      platform: {
        select: { id: true, name: true, platformCurrency: true, defaultOfferPrice: true },
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
 * copy's area links and issued year for the area/year grouping. */
const LISTING_SETS_SELECT = {
  id: true,
  title: true,
  items: {
    select: {
      itemId: true,
      sortOrder: true,
      item: {
        select: {
          stamp: {
            select: {
              ...STAMP_LABEL_SELECT.stamp.select,
              issuedYear: true,
              stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
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

  const items: ListingWorkspaceOffer[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: offerLabel(row.sets),
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
  }));

  await attachBasePrices(collectionId, baseCurrency, items);
  return items;
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
  /** This set has left on a sale (sold through this offer). */
  sold: boolean;
  /** A copy of this set has sold **elsewhere** — the set is stale and should be removed. */
  needsAction: boolean;
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
  /** The date the listing went live (#257), or null when not recorded. */
  listingDate: Date | null;
  /** This listing's own photo configuration (#308) — sides, tile label template and the collage
   * numbers copied from a template. Seeded at creation, edited from the photo-settings dialog. */
  photoConfig: OfferPhotoConfigInput;
  /** The platform's hard photo limits (#308), read **live** rather than from the offer: they say
   * what the platform accepts today, and the renderer (#310) obeys the current values. */
  platformPhotoLimits: PlatformPhotoLimits;
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
        },
      },
      sets: {
        orderBy: OFFER_SETS_ORDER_BY,
        select: {
          id: true,
          title: true,
          items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
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

  const sets: OfferDetailSet[] = offer.sets.map((s) => {
    const items = orderedItems(s.items);
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
      label: setLabel(s),
      itemIds: items.map((li) => li.itemId),
      copyLabels: items.map((li) => copyLabel(li.item.stamp)),
      manualCopyOrder: hasManualItemOrder(s.items),
      sold,
      needsAction: needs,
    };
  });

  // Suggested asking price: average base-currency catalog value per set (a buyer takes one set),
  // converted to the offer's currency at the current rate.
  const valuations = await valuateItemsByIds(offer.collectionId, allIds);
  let sumSetCV = 0;
  let valuedSets = 0;
  for (const s of offer.sets) {
    let setTotal = 0;
    let anyValued = false;
    for (const li of s.items) {
      const base = valuations.get(li.itemId)?.baseAmount;
      if (base != null) {
        setTotal += base;
        anyValued = true;
      }
    }
    if (anyValued) {
      sumSetCV += setTotal;
      valuedSets++;
    }
  }
  let suggestedPrice: string | null = null;
  if (valuedSets > 0) {
    const avgBase = sumSetCV / valuedSets;
    try {
      const { rate } = await getOrFetchRate(offer.collectionId, baseCurrency, offer.currency);
      suggestedPrice = (avgBase * rate).toFixed(2);
    } catch {
      suggestedPrice = null; // no rate to the offer currency → no suggestion
    }
  }

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
    label: offerLabel(offer.sets),
    description: offer.description,
    privateNote: offer.privateNote,
    descriptionFormat: normalizeDescriptionFormat(offer.descriptionFormat),
    regeneratable: {
      name: !!offer.platform.titleTemplate?.trim(),
      description: !!offer.platform.descriptionTemplate?.trim(),
      privateNote: !!offer.platform.privateNoteTemplate?.trim(),
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
  /** The copy being added is already in this set — the picker disables it (no double-listing). */
  containsItem: boolean;
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
  /** The copy is already listed somewhere in this offer (any set) — no new set may hold it either. */
  containsItem: boolean;
}

export interface ComposeTargets {
  offers: ComposeTargetOffer[];
  /** Enriched copies across the target offers' sets, for the picker's expandable set details. */
  copies: ItemListItem[];
}

const COMPOSE_TARGET_STATES = ["preparing", "ready", "active", "paused"] as const;
const COMPOSE_STATE_RANK: Record<string, number> = { preparing: 0, ready: 1, active: 2, paused: 3 };

/** Offers a copy can be added to from the inventory list (#188): the collection's non-terminal
 * offers (preparing / ready / active / paused, all platforms), each with its sets, ordered
 * preparing → ready → active → paused then newest first. When `itemId` is given, the sets and offers already holding
 * that copy are flagged so the picker can disable them (an offer never lists a copy twice).
 * Enriched copies for every listed set ride along for the picker's expandable set details. */
export async function listComposeTargets(
  ownerId: string,
  collectionId: string,
  itemId?: string
): Promise<ComposeTargets> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId, state: { in: [...COMPOSE_TARGET_STATES] } },
    orderBy: { createdAt: "desc" },
    select: OFFER_SELECT,
  });

  const offers: ComposeTargetOffer[] = rows
    .map((r) => {
      const sets: ComposeTargetSet[] = r.sets.map((s) => ({
        offerSetId: s.id,
        label: setLabel(s),
        itemIds: s.items.map((li) => li.itemId),
        itemLabels: s.items.map((li) => copyLabel(li.item.stamp)),
        containsItem: !!itemId && s.items.some((li) => li.itemId === itemId),
      }));
      return {
        offerId: r.id,
        platformId: r.platformId,
        platformName: r.platform.name,
        label: offerLabel(r.sets),
        price: r.price.toFixed(2),
        currency: r.currency,
        state: (isOfferState(r.state) ? r.state : "active") as OfferState,
        sets,
        containsItem: sets.some((s) => s.containsItem),
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
 * **atomically** — offer + set + live status commit together, or nothing does. Currency is inherited
 * from the platform (#196) — locked to the platform's, or set from `input.currency` on the first
 * offer/sale and snapshotted here. Sets beyond the seed are composed on the detail screen.
 */
export async function createOffer(
  ownerId: string,
  collectionId: string,
  input: OfferInput,
  opts: { seedItemIds?: string[] } = {}
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
  const { name, description, privateNote } = await generateListingTexts(
    ownerId,
    collectionId,
    [{ title: null, itemIds: seedIds }],
    platform,
    platform.titleLanguage
  );

  // The offer's own photo configuration (#308), copied from the platform's defaults and its default
  // collage template. Held on the offer from here on, so changing a platform setting later never
  // alters this listing's photos.
  const photoConfig = await seedPhotoConfig(platform);

  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.create({
      data: {
        collectionId,
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
    if (seedIds.length > 0) {
      await tx.offerSet.create({
        // The seed is the new offer's first set (#306); its copies start derived (catalog order).
        data: { offerId: offer.id, sortOrder: 0, items: { create: seedIds.map((itemId) => ({ itemId })) } },
      });
    }
    return offer.id;
  });
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
    platform.titleLanguage
  );

  // Photo configuration follows the same rule as the texts (#308): the clone is a listing on another
  // platform, so it is seeded from *that* platform's defaults rather than copied from the source.
  const photoConfig = await seedPhotoConfig(platform);

  const id = await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.create({
      data: {
        collectionId: ref.collectionId,
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
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.privateNote !== undefined ? { privateNote: patch.privateNote } : {}),
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
 * composition, overwriting any manual edit. Returns the new value (null when the platform has no
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
    language === undefined ? platform.titleLanguage : language
  );
  const value = texts[field];
  await prisma.offer.update({ where: { id: offerId }, data: { [field]: value } });
  return value;
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
    where: { id: { in: itemIds }, collectionId },
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
  return ids;
}

/** Add a single copy to an **existing** set, turning a single into a series / komplet (#188). The
 * owning offer must be non-terminal; the copy must belong to the collection, be unsold, and not
 * already listed anywhere in that offer. */
export async function addItemToOfferSet(ownerId: string, setId: string, itemId: string): Promise<void> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  if (isTerminalState(ref.offerState)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.offerState} offer is read-only.`);
  }
  const addable = await assertAddableCopies(ref.collectionId, [itemId], ref.offerId);
  if (addable.length === 0) {
    throw new OfferActionBlockedError(
      "empty",
      "That copy can't be added — it may have sold or already be in this offer."
    );
  }
  // Where the copy lands (#306): a derived set stays derived (it slots into its catalog position),
  // a hand-corrected one appends the copy at the end.
  const existing = await prisma.offerSetItem.findMany({
    where: { offerSetId: setId },
    select: { sortOrder: true },
  });
  await prisma.offerSetItem.create({
    data: { offerSetId: setId, itemId: addable[0], sortOrder: nextItemSortOrder(existing) },
  });
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
}

/** Drop a set's hand-corrected copy order (#306): every position back to null, so the set derives
 * its order from the catalog sort key again. */
export async function resetOfferSetItemOrder(ownerId: string, setId: string): Promise<void> {
  const ref = await assertOfferSetOwner(ownerId, setId);
  if (isTerminalState(ref.offerState)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.offerState} offer is read-only.`);
  }
  await prisma.offerSetItem.updateMany({ where: { offerSetId: setId }, data: { sortOrder: null } });
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
  await assertOfferSetOwner(ownerId, setId);
  await prisma.offerSet.update({ where: { id: setId }, data: { title: title?.trim() || null } });
}

/** Remove a set from its offer (its copies stay in inventory). This is the coordination action —
 * removing a set whose copy sold elsewhere decrements the listing. Blocked once the set itself has
 * sold (`sale_line.offerSetId` is `Restrict`). */
export async function removeOfferSet(ownerId: string, setId: string): Promise<void> {
  await assertOfferSetOwner(ownerId, setId);
  const soldLines = await prisma.saleLine.count({ where: { offerSetId: setId } });
  if (soldLines > 0) {
    throw new OfferActionBlockedError(
      "sold-set",
      "This set has sold and cannot be removed — its sale record references it."
    );
  }
  await prisma.offerSet.delete({ where: { id: setId } });
}
