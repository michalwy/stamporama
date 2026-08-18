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
import { collidingItemIdsByOffer } from "./offer-collision-rules";
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
  auctionNeedsResolution,
  CLOSED_OFFER_STATES,
  OPEN_OFFER_STATES,
  type OfferListingType,
  isAuctionListing,
  normalizeListingType,
  pricingReadyFor,
} from "./offer-rules";
import {
  makeOfferLabeller,
  STAMP_LABEL_SELECT,
  type LabelSetItemRow,
  type OfferLabeller,
} from "./offer-labels";
import {
  headerChangeIsDrift,
  isListedState,
  LISTED_OFFER_STATES,
} from "./offer-listing-drift";
import { claimCovers, type AllegroPaymentStatus } from "./allegro-sync-rules";
import { parseOfferAddressSearch } from "./offer-search";
import { urlNamesPlatformOffer } from "./platform-offer-url";
import { parseEntityNoSearch } from "./quick-jump";
import { normalizeDescriptionFormat, type DescriptionFormat } from "./description-format";
import { loadColnectConditionMap } from "./colnect";
import { colnectGradeFor } from "./colnect-conditions";
import { catalogChipCopyValueFromLabel } from "./catalog-number";
import { colnectMarketUrl, colnectSearchUrl, colnectStampUrl } from "./colnect-link";
import {
  resolveListingCatalogItemIds,
  type ResolvedCatalogItemId,
} from "./listing-catalog-ids";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import {
  evaluateListingPreconditions,
  type ListingBlocker,
  type ListingMode,
} from "./listing-preconditions";
import {
  hasListingModule,
  usesPlatformCatalogue,
  usesPlatformConditions,
} from "./platform-modules";
import {
  backfillAllegroCategory,
  getAllegroOfferListingConfig,
  learnAllegroCategoryFromReadyOffer,
  type AllegroOfferListingConfig,
} from "./allegro-offer-listing";
import {
  backfillDelcampeCategory,
  getDelcampeOfferListingConfig,
  learnDelcampeCategoryFromReadyOffer,
  type DelcampeOfferListingConfig,
} from "./delcampe-offer-listing";
import {
  evaluatePhotoReadiness,
  type PhotoReadinessBlocker,
  type ReadyBlocker,
} from "./offer-photo-readiness";
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
  templateUsesListedAs,
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
import { normalizeCollageGridMode } from "./collage-template-rules";
import type { PlatformTextLimits } from "./listing-text-limits";
import {
  deleteOfferPhotoBytes,
  readOfferPhotoReadiness,
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
  /** How the listing is sold (#449) — what decides whether a price write is a *bid refresh* worth
   * dating, or a seller changing their own asking price. */
  listingType: OfferListingType;
  /** The stored price as a 2-dp string, so a write that leaves it where it was is not dated as a
   * fresh observation (#449). */
  price: string;
}

async function assertOfferOwner(ownerId: string, offerId: string): Promise<OfferRef> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      platformId: true,
      state: true,
      listingType: true,
      price: true,
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
    listingType: normalizeListingType(offer.listingType),
    price: offer.price.toFixed(2),
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
  /** #521: photograph single-copy sets on their own while this platform's photo limit has room. */
  photoPreferSingles: boolean;
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
        select: {
          gridMode: true,
          rows: true,
          columns: true,
          gapPercent: true,
          background: true,
          labelPercent: true,
        },
      })
    : null;
  return {
    photoSides: normalizePhotoSides(platform.photoSides),
    photoPreferSingles: platform.photoPreferSingles,
    photoLabelLeftTemplate: platform.tileLabelLeftTemplate?.trim() || null,
    photoLabelRightTemplate: platform.tileLabelRightTemplate?.trim() || null,
    collageGridMode: template ? normalizeCollageGridMode(template.gridMode) : null,
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
      /** The platform's fallback **starting price** for a new auction (#362, narrowed in #449),
       * already a 2-dp string, or null. Read at creation only — it outranks the price suggestions
       * read off the goods (#553), and is stored only while the platform's default type is
       * `auction`. */
      defaultStartingPrice: string | null;
      /** How a new offer here is sold by default (#449), or null for "no preference" — read at
       * creation exactly as the price above is, and outranked by anything the form states. */
      defaultListingType: string | null;
      /** The extension's platform module (#406), or null for a marketplace listed by hand. Read here
       * because a generated listing text can name the catalogue entry the piece stands under
       * (`{listedAs}`, #619), which only a platform listing *against* a catalogue has. */
      platformModule: string | null;
    }
> {
  const contact = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: {
      platformCurrency: true,
      defaultStartingPrice: true,
      defaultListingType: true,
      platformModule: true,
      titleTemplate: true,
      descriptionTemplate: true,
      privateNoteTemplate: true,
      descriptionFormat: true,
      titleLanguage: true,
      photoSides: true,
      photoPreferSingles: true,
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
    defaultStartingPrice: contact.defaultStartingPrice?.toFixed(2) ?? null,
    defaultListingType: contact.defaultListingType,
    platformModule: contact.platformModule,
    titleTemplate: contact.titleTemplate,
    descriptionTemplate: contact.descriptionTemplate,
    privateNoteTemplate: contact.privateNoteTemplate,
    descriptionFormat: contact.descriptionFormat,
    titleLanguage: contact.titleLanguage,
    photoSides: contact.photoSides,
    photoPreferSingles: contact.photoPreferSingles,
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
 *
 * `platformModule` (#406) decides whether `{listedAs}` (#619) can say anything: the variant a listing
 * stands under is a claim about the platform's own catalogue, so a marketplace listing by category
 * gets an empty token rather than a number read off a catalogue it is not in (#493's rule). The other
 * two unknown-variant additions are facts about the goods and are resolved for every platform.
 */
async function generateListingTexts(
  ownerId: string,
  collectionId: string,
  composition: readonly OfferComposition[],
  templates: PlatformTemplates,
  language: string | null,
  offerId: string | null,
  platformModule: string | null
): Promise<GeneratedListingTexts> {
  const configured = (t: string | null) => (t?.trim() ? t : null);
  const title = configured(templates.titleTemplate);
  const description = configured(templates.descriptionTemplate);
  const privateNote = configured(templates.privateNoteTemplate);
  const copyCount = composition.reduce((n, s) => n + s.itemIds.length, 0);
  if (copyCount === 0 || (!title && !description && !privateNote)) {
    return { name: null, description: null, privateNote: null };
  }
  const [context, listedAs] = await Promise.all([
    listingContext(collectionId, offerId, [description, privateNote]),
    listedAsByItem(collectionId, composition, platformModule, [description, privateNote]),
  ]);
  const sets = await templateSets(ownerId, collectionId, composition, language, listedAs);
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

/** Which catalogue entry each copy's listing stands under, for `{listedAs}` (#619) — keyed by copy
 * id, and holding only the copies that resolved to a variant at all.
 *
 * It is #616's own answer, read through the one function that derives it, so a description cannot
 * name a different variant than the form is filled with. Three things make it free for every render
 * that does not ask: a template naming no `{listedAs}` (the guard `{offerUrl}`'s slug lookup uses,
 * #415), a platform listing against no catalogue (#493), and an offer with no copies. Where it *is*
 * asked, the rollup costs one valuation pass over the whole composition — which is why the copies are
 * resolved in one call rather than one per set.
 *
 * The **title** is deliberately not offered the token's value: `{listedAs}` is not a title token, and
 * a title regenerating on every composition change must not pay for a valuation. It renders empty
 * there, `{offerUrl}`'s rule exactly. */
async function listedAsByItem(
  collectionId: string,
  composition: readonly OfferComposition[],
  platformModule: string | null,
  templates: readonly (string | null)[]
): Promise<Map<string, string>> {
  if (!usesPlatformCatalogue(platformModule) || !templates.some((t) => templateUsesListedAs(t))) {
    return new Map();
  }
  const itemIds = [...new Set(composition.flatMap((s) => [...s.itemIds]))];
  if (itemIds.length === 0) return new Map();
  const [items, labeller] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: itemIds }, collectionId },
      select: {
        id: true,
        stampId: true,
        conditionId: true,
        certificateStatusId: true,
        formatId: true,
        stamp: { select: { colnectId: true, variants: { select: VARIANT_FLAG_SELECT } } },
      },
    }),
    makeOfferLabeller(collectionId),
  ]);
  const resolved = await resolveListingCatalogItemIds(
    collectionId,
    items.map((item) => ({
      itemId: item.id,
      stampId: item.stampId,
      conditionId: item.conditionId,
      certificateStatusId: item.certificateStatusId,
      formatId: item.formatId,
      unknownVariant: isUnknownVariantStamp(item.stamp),
      ownCatalogItemId: item.stamp.colnectId?.trim() || null,
    })),
    labeller
  );
  // `sourceLabel` is non-null exactly where the listing was derived from a variant — an umbrella
  // matched by hand keeps its own entry and has no variant to name, and a tree that could not be
  // resolved (#617) has none either. Both leave the token empty, which the tidy passes already handle.
  return new Map(
    [...resolved].flatMap(([itemId, r]) => (r.sourceLabel ? ([[itemId, r.sourceLabel]] as const) : []))
  );
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
 * preserving set order and each set's copy order (so a regenerated text is stable). `listedAs`
 * (#619) is folded onto the copies here because that is the last point a copy still has an id: the
 * engine's `TitleTemplateCopy` deliberately carries none. */
async function templateSets(
  ownerId: string,
  collectionId: string,
  composition: readonly OfferComposition[],
  language: string | null,
  listedAs: ReadonlyMap<string, string> = new Map()
): Promise<TemplateSet[]> {
  const itemIds = [...new Set(composition.flatMap((s) => [...s.itemIds]))];
  const byId = await titleCopiesById(ownerId, collectionId, itemIds, language);
  return composition.map((s) => ({
    title: s.title,
    copies: s.itemIds.flatMap((id) => {
      const copy = byId.get(id);
      if (!copy) return [];
      const variant = listedAs.get(id);
      return [variant ? { ...copy, listedAs: variant } : copy];
    }),
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
  /** Copies another active offer has already **sold on a connected platform** (#499), the sale not
   * being recorded here yet — so `sale_line_item` says nothing about them and the two sources above
   * cannot see it. */
  platformSaleCount: number;
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
  offerIds?: string[],
  /** The offers with an unrecorded platform sale (#499), where the caller has already resolved them
   * — one request must not ask that comparison for twice. */
  platformSoldIds?: string[]
): Promise<NeedsActionRow[]> {
  if (offerIds && offerIds.length === 0) return [];
  const scope = offerIds
    ? Prisma.sql`AND o."id" IN (${Prisma.join(offerIds)})`
    : Prisma.empty;

  // Which offers have sold on a platform without the sale being recorded (#499) is decided in one
  // place — `unrecordedPlatformSales`, which compares an order against the sale claiming it — and
  // handed to the query as ids. Restating that comparison in SQL would be a second definition of
  // "recorded", which is the one thing this and the Allegro worklist must never have.
  const platformSold =
    platformSoldIds ?? [...(await unrecordedPlatformSales(collectionId)).keys()];
  const platformSoldItems = platformSold.length
    ? Prisma.sql`
      SELECT li4."itemId",
             MIN(o4."id") AS "offerId",
             COUNT(DISTINCT o4."id") AS "offerCount"
      FROM "offer" o4
      JOIN "offer_set" s4 ON s4."offerId" = o4."id"
      JOIN "offer_set_item" li4 ON li4."offerSetId" = s4."id"
      WHERE o4."id" IN (${Prisma.join(platformSold)})
        AND o4."state" = 'active'
      GROUP BY li4."itemId"`
    : // No outstanding sale anywhere: an empty relation of the right shape, so the query below needs
      // no second spelling.
      Prisma.sql`SELECT NULL::text AS "itemId", NULL::text AS "offerId", 0::bigint AS "offerCount" WHERE FALSE`;

  return prisma.$queryRaw<NeedsActionRow[]>`
    WITH platform_sold_items AS MATERIALIZED (${platformSoldItems}),
    bidding_items AS MATERIALIZED (
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
           )::int AS "biddingCount",
           COUNT(*) FILTER (
             WHERE p."itemId" IS NOT NULL AND (p."offerCount" > 1 OR p."offerId" <> o."id")
           )::int AS "platformSaleCount"
    FROM "offer" o
    JOIN "offer_set" s ON s."offerId" = o."id"
    JOIN "offer_set_item" li ON li."offerSetId" = s."id"
    LEFT JOIN "sale_line_item" sli ON sli."itemId" = li."itemId"
    LEFT JOIN "sale_line" sl ON sl."id" = sli."saleLineId"
    LEFT JOIN bidding_items b ON b."itemId" = li."itemId"
    LEFT JOIN platform_sold_items p ON p."itemId" = li."itemId"
    WHERE o."collectionId" = ${collectionId}
      AND o."state" = 'active'
      ${scope}
      AND (
        (sl."offerSetId" IS NOT NULL AND sl."offerSetId" <> s."id")
        OR (b."itemId" IS NOT NULL AND (b."offerCount" > 1 OR b."offerId" <> o."id"))
        OR (p."itemId" IS NOT NULL AND (p."offerCount" > 1 OR p."offerId" <> o."id"))
      )
    GROUP BY o."id", o."platformId"
  `;
}

/** The flagged offers as the list rows want them: offer id → dead-copy count. */
async function needsActionCounts(
  collectionId: string,
  offerIds?: string[],
  platformSoldIds?: string[]
): Promise<Map<string, number>> {
  const rows = await needsActionRows(collectionId, offerIds, platformSoldIds);
  return new Map(rows.map((r) => [r.offerId, r.deadCount]));
}

/** Which of the two collisions flagged an offer (#367) — see {@link NeedsActionRow}. */
export type OfferActionReason = "sold-elsewhere" | "bidding-conflict" | "platform-sale-conflict";

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
  const platformSale = bucket((r) => r.platformSaleCount);

  const ids = [
    ...new Set([...sold.head, ...bidding.head, ...platformSale.head].map((r) => r.offerId)),
  ];
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

  return {
    "sold-elsewhere": resolve(sold),
    "bidding-conflict": resolve(bidding),
    "platform-sale-conflict": resolve(platformSale),
  };
}

/**
 * The `where` for an offer whose live listing no longer matches this record (#542).
 *
 * **Both** halves, always: the flag is set *and* the offer is still up. Written once and read by the
 * filter, the id resolution and the notification centre, so no surface can decide for itself whether
 * a withdrawn listing still counts (it does not — what a closed listing said is history).
 */
const LISTING_DRIFT_WHERE: Prisma.OfferWhereInput = {
  listingContentChangedAt: { not: null },
  state: { in: [...LISTED_OFFER_STATES] },
};

/** One live listing that no longer matches its offer (#542), as the notification centre lists it. */
export interface ChangedListingOffer {
  offerId: string;
  label: string;
  platformName: string;
  /** When it started diverging — the first change since the listing was last in step. */
  changedAt: Date;
  /** `active` or `paused`, so the row can say a paused listing is not in front of buyers right now. */
  state: OfferState;
}

/**
 * Live listings changed since they were posted (#542), oldest divergence first.
 *
 * Oldest first, unlike the notice groups beside it: this is not news, it is a backlog, and the one
 * that has been wrong longest is the one that has been costing the longest. It never expires of its
 * own accord either — nothing in the app can observe a marketplace being corrected — so it leaves
 * only when the update is pushed, the offer is republished, or the collector says it is in step.
 */
export async function offersWithChangedListing(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<{ total: number; offers: ChangedListingOffer[] }> {
  await assertCollectionOwner(ownerId, collectionId);

  const where: Prisma.OfferWhereInput = { collectionId, ...LISTING_DRIFT_WHERE };
  const [total, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      orderBy: [{ listingContentChangedAt: "asc" }, { offerNo: "desc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        state: true,
        listingContentChangedAt: true,
        platform: { select: { name: true } },
        sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
      },
    }),
  ]);

  const labeller = rows.some((row) => !row.name) ? await makeOfferLabeller(collectionId) : null;

  return {
    total,
    offers: rows.map((row) => ({
      offerId: row.id,
      label: row.name ?? labeller?.offer(row.sets) ?? "Untitled listing",
      platformName: row.platform.name,
      // Non-null by the `where`.
      changedAt: row.listingContentChangedAt!,
      state: (isOfferState(row.state) ? row.state : "active") as OfferState,
    })),
  };
}

/** The flagged offers as the overlays want them: one row per offer, with the platform the facet
 * counts group by. Deliberately the same shape `needsActionRows` hands back for its own flagged set,
 * since #542 folded the two into one selection. */
async function listingDriftRows(
  collectionId: string,
  /** The search's own resolved ids, where one is active (#465) — narrowing the *reported* offers,
   * exactly as `needsActionRows` takes it. An empty list is an empty answer, not an open one. */
  offerIds?: string[]
): Promise<{ offerId: string; platformId: string }[]> {
  if (offerIds && offerIds.length === 0) return [];
  const rows = await prisma.offer.findMany({
    where: {
      collectionId,
      ...LISTING_DRIFT_WHERE,
      ...(offerIds ? { id: { in: offerIds } } : {}),
    },
    select: { id: true, platformId: true },
  });
  return rows.map((r) => ({ offerId: r.id, platformId: r.platformId }));
}

/** One auction a connected platform reported on (#481), as the notification centre lists it. */
export interface OfferWithObservedBid {
  offerId: string;
  label: string;
  platformName: string;
  /** How many have bid, as the sync last read it. */
  bidderCount: number;
  /** The standing bid and its currency — the figure the sync wrote. */
  price: string;
  currency: string;
  /** When that figure was last confirmed against the platform. Null where the bid itself could not
   * be written (a listing quoted in another currency), the count having been the only observation. */
  checkedAt: Date | null;
}

/**
 * The two things the notification centre asks about an auction the app flagged itself (#481).
 *
 * - `notice` — **the app just did this**, and the collector has not seen it yet. An event, not a
 *   state: a hundred running auctions with bids on them are a hundred things already known, and a
 *   panel that listed them all until they closed would say nothing at all. The row leaves when the
 *   notice is acknowledged (opening the offer is that), or when the offer stops being live.
 * - `withdrawn` — the flag stands on an auction the platform now reports **no bidders** on, a bid
 *   having been cancelled. This one does not expire, because it is the one case where the flag is
 *   genuinely waiting on a decision: stock is being held out of every other listing for a bid that
 *   no longer exists, and only the collector can clear it (#215).
 *
 * The two never overlap: a fresh notice is raised with a bidder on the listing.
 *
 * Live offers only. A sold or withdrawn listing is not something to be told about again, and the
 * flag on it has already done its work.
 */
export type BiddingNoticeKind = "notice" | "withdrawn";

export async function offersWithObservedBidding(
  ownerId: string,
  collectionId: string,
  kind: BiddingNoticeKind,
  limit: number
): Promise<{ total: number; offers: OfferWithObservedBid[] }> {
  await assertCollectionOwner(ownerId, collectionId);

  const where = {
    collectionId,
    state: "active",
    inActiveBidding: true,
    ...(kind === "notice"
      ? { biddingNoticeAt: { not: null } }
      : // Only ever a *sync-observed* zero: `bidderCount` is null on everything no sync has read,
        // so an offer flagged by hand on a platform with no connection is never claimed to have
        // lost a bid it was never known to have.
        { bidderCount: 0 }),
  } as const;

  const [total, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      // Newest first — the notice raised last, or the withdrawal seen last.
      orderBy: [
        kind === "notice" ? { biddingNoticeAt: "desc" } : { priceCheckedAt: "desc" },
        { offerNo: "desc" },
      ],
      take: limit,
      select: {
        id: true,
        name: true,
        price: true,
        currency: true,
        bidderCount: true,
        priceCheckedAt: true,
        biddingNoticeAt: true,
        platform: { select: { name: true } },
        sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
      },
    }),
  ]);

  const labeller = rows.some((row) => !row.name) ? await makeOfferLabeller(collectionId) : null;

  return {
    total,
    offers: rows.map((row) => ({
      offerId: row.id,
      label: row.name ?? labeller?.offer(row.sets) ?? "Untitled listing",
      platformName: row.platform.name,
      bidderCount: row.bidderCount ?? 0,
      price: row.price.toFixed(2),
      currency: row.currency,
      // The date the row is *about*: when the app raised the notice, or when it last confirmed the
      // bidding on an auction whose bid has gone.
      checkedAt: kind === "notice" ? (row.biddingNoticeAt ?? row.priceCheckedAt) : row.priceCheckedAt,
    })),
  };
}

/** A listing that has **sold on a connected platform** with no sale recorded here yet (#499). */
export interface UnrecordedPlatformSale {
  /** The marketplace's own order number — what the worklist is keyed on, and what a sale recorded
   * from it carries as its `externalRef`. */
  orderId: string;
  /** What the platform says about the money: `paid`, or `unpaid` while the buyer has not settled.
   * Never `cancelled` — a withdrawn order is not a sale waiting to be recorded. */
  paymentStatus: Exclude<AllegroPaymentStatus, "cancelled">;
  boughtAt: Date;
}

/**
 * Which offers have sold on Allegro without the sale having been recorded here (#499).
 *
 * The observation is the sync's (#467) and the definition of *recorded* is the worklist's — shared
 * through `claimCovers`, so this flag and that screen can never disagree about what is outstanding.
 * What is added here is only where it is **shown**: the offer list is the screen the collector works
 * from, and until now a listing that had sold went on reading *Active* there with its copies still
 * in every other listing they are in.
 *
 * Deliberately scoped to **live** offers. Orders accumulate without bound — in time there are more
 * of them than there are listings — while what can still be flagged is bounded by what is up for
 * sale, so the read is bounded by the smaller of the two. A `sold` offer is the sale recorded, which
 * is the thing this is waiting for; a withdrawn one is a decision already taken.
 *
 * Where an offer has more than one outstanding order against it — a quantity listing bought by two
 * people — the **earliest** is reported: it is the one that has been waiting longest, and the row
 * has space for one.
 *
 * `offerIds` narrows the read to a known set — what an offer's **own screen** asks for (#505),
 * where the answer is about one listing and the collection-wide scan is the whole cost of it.
 */
export async function unrecordedPlatformSales(
  collectionId: string,
  offerIds?: string[]
): Promise<Map<string, UnrecordedPlatformSale>> {
  if (offerIds?.length === 0) return new Map();
  const lines = await prisma.allegroOrderLine.findMany({
    where: {
      collectionId,
      offerId: offerIds ? { in: offerIds } : { not: null },
      offer: { state: { in: [...OPEN_OFFER_STATES] } },
      allegroOrder: {
        // A cancelled order is not a sale (`lineAwaitsSale`), and one a merged order has taken over
        // (#495) is asked for on the order that absorbed it, never twice.
        paymentStatus: { not: "cancelled" },
        supersededByOrderId: null,
      },
    },
    orderBy: { boughtAt: "asc" },
    select: {
      offerId: true,
      allegroOrder: { select: { orderId: true, paymentStatus: true, boughtAt: true } },
    },
  });
  if (lines.length === 0) return new Map();

  const claims = await prisma.sale.findMany({
    where: { collectionId, externalRef: { in: [...new Set(lines.map((l) => l.allegroOrder.orderId))] } },
    select: { externalRef: true, lines: { select: { offerId: true } } },
  });
  const claimByOrder = new Map(
    claims.flatMap((sale) =>
      sale.externalRef ? [[sale.externalRef, sale.lines.map((line) => line.offerId)] as const] : []
    )
  );

  const out = new Map<string, UnrecordedPlatformSale>();
  for (const line of lines) {
    const { orderId, paymentStatus, boughtAt } = line.allegroOrder;
    if (claimCovers(claimByOrder.get(orderId) ?? null, line.offerId)) continue;
    // Earliest first from the query, so the first one seen for an offer is the one to report.
    if (!line.offerId || out.has(line.offerId)) continue;
    out.set(line.offerId, {
      orderId,
      paymentStatus: paymentStatus === "paid" ? "paid" : "unpaid",
      boughtAt,
    });
  }
  return out;
}

/** One listing sold on a connected platform, as the notification centre lists it (#499). */
export interface PlatformSaleOffer {
  offerId: string;
  label: string;
  platformName: string;
  orderId: string;
  paymentStatus: Exclude<AllegroPaymentStatus, "cancelled">;
  boughtAt: Date;
}

/**
 * Listings sold on a connected platform with no sale recorded here (#499), for the bell.
 *
 * The same set the offer list's own chip shows — {@link unrecordedPlatformSales} — read
 * **longest-waiting first**: an order from last week with the copies still listed elsewhere is worse
 * than one from this morning, and nothing else will bring it up again on its own.
 */
export async function offersWithPlatformSale(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<{ total: number; offers: PlatformSaleOffer[] }> {
  await assertCollectionOwner(ownerId, collectionId);
  const sales = [...(await unrecordedPlatformSales(collectionId)).entries()].sort(
    ([, a], [, b]) => a.boughtAt.getTime() - b.boughtAt.getTime()
  );
  if (sales.length === 0) return { total: 0, offers: [] };

  const head = sales.slice(0, limit);
  const rows = await prisma.offer.findMany({
    where: { id: { in: head.map(([offerId]) => offerId) } },
    select: {
      id: true,
      name: true,
      platform: { select: { name: true } },
      sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
    },
  });
  const labeller = rows.some((row) => !row.name) ? await makeOfferLabeller(collectionId) : null;
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    total: sales.length,
    offers: head.flatMap(([offerId, sale]) => {
      const row = byId.get(offerId);
      return row
        ? [
            {
              offerId,
              label: row.name ?? labeller?.offer(row.sets) ?? "Untitled listing",
              platformName: row.platform.name,
              ...sale,
            },
          ]
        : [];
    }),
  };
}

/** One auction that ended with a bid on it and is still waiting to be resolved (#490). */
export interface EndedAuctionOffer {
  offerId: string;
  label: string;
  platformName: string;
  /** The standing bid the listing closed at, and its currency. */
  price: string;
  currency: string;
  /** When it closed — what the row is *about*, and what the panel ages ("2 days ago"). */
  endsAt: Date;
}

/**
 * Auctions the notification centre reports as needing resolution (#490).
 *
 * The same set the offer list's own chip shows — {@link endedAuctionWhere}, so "see all" lands on
 * exactly the rows counted here — read **longest closed first**: an auction that ended a week ago
 * with a buyer waiting is worse than one that ended an hour ago, and nothing else on this screen
 * will bring it up again.
 */
export async function offersWithEndedAuction(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<{ total: number; offers: EndedAuctionOffer[] }> {
  await assertCollectionOwner(ownerId, collectionId);

  const where: Prisma.OfferWhereInput = {
    collectionId,
    AND: endedAuctionWhere(new Date()),
  };

  const [total, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      orderBy: [{ endsAt: "asc" }, { offerNo: "desc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        price: true,
        currency: true,
        endsAt: true,
        platform: { select: { name: true } },
        sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
      },
    }),
  ]);

  const labeller = rows.some((row) => !row.name) ? await makeOfferLabeller(collectionId) : null;

  return {
    total,
    offers: rows.map((row) => ({
      offerId: row.id,
      label: row.name ?? labeller?.offer(row.sets) ?? "Untitled listing",
      platformName: row.platform.name,
      price: row.price.toFixed(2),
      currency: row.currency,
      // Non-null by the `where` — an auction with no closing time is never in this set.
      endsAt: row.endsAt!,
    })),
  };
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

// ── Stamp × condition collisions (#513) ─────────────────────────────────────

/** A live offer that already lists the same stamp in the same condition as some of the copies being
 * added — through a *different* copy, since one it already holds is `containsItemIds`' fact. */
export interface StampConditionCollision {
  offerId: string;
  offerNo: number;
  offerLabel: string;
  platformId: string;
  platformName: string;
  state: OfferState;
  /** Which of the candidate copies this offer would duplicate. */
  itemIds: string[];
}

/** The offer states a collision is reported against (#513) — every *live* one, so a duplicate is
 * caught while both listings are still drafts rather than after one is posted. */
const COLLIDING_STATES = ["preparing", "ready", "active", "paused"] as const;

/**
 * The raw read behind every stamp × condition warning: which live offers duplicate which of
 * `itemIds`, keyed by offer id. Shared by {@link findStampConditionCollisions} and
 * {@link listComposeTargets} so the picker's note and the selection bar's chip cannot disagree.
 *
 * One membership query, narrowed by the candidates' *stamps* — the condition is matched in memory
 * by {@link collidingItemIdsByOffer}, which is where the key lives.
 */
async function collidingItemIds(
  collectionId: string,
  itemIds: string[],
  opts: { platformId?: string; excludeOfferId?: string } = {}
): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) return new Map();
  const candidates = await prisma.item.findMany({
    where: { collectionId, id: { in: itemIds } },
    select: { id: true, stampId: true, conditionId: true },
  });
  if (candidates.length === 0) return new Map();

  const memberships = await prisma.offerSetItem.findMany({
    where: {
      item: { stampId: { in: [...new Set(candidates.map((c) => c.stampId))] } },
      offerSet: {
        offer: {
          collectionId,
          state: { in: [...COLLIDING_STATES] },
          ...(opts.platformId ? { platformId: opts.platformId } : {}),
          ...(opts.excludeOfferId ? { id: { not: opts.excludeOfferId } } : {}),
        },
      },
    },
    select: {
      itemId: true,
      offerSet: { select: { offerId: true } },
      item: { select: { stampId: true, conditionId: true } },
    },
  });

  return collidingItemIdsByOffer(
    candidates.map((c) => ({ itemId: c.id, stampId: c.stampId, conditionId: c.conditionId })),
    memberships.map((m) => ({
      offerId: m.offerSet.offerId,
      itemId: m.itemId,
      stampId: m.item.stampId,
      conditionId: m.item.conditionId,
    }))
  );
}

/**
 * Live offers that would end up listing the same stamp in the same condition twice (#513) —
 * Colnect refuses a second offer for a stamp in one condition, so this is the mistake worth
 * catching *before* the copies go on. A **warning**: nothing is blocked, and a collector listing
 * deliberately on two platforms passes `platformId` to ask about only the one that matters.
 */
export async function findStampConditionCollisions(
  ownerId: string,
  collectionId: string,
  itemIds: string[],
  opts: { platformId?: string; excludeOfferId?: string } = {}
): Promise<StampConditionCollision[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const byOffer = await collidingItemIds(collectionId, itemIds, opts);
  if (byOffer.size === 0) return [];

  const rows = await prisma.offer.findMany({
    where: { id: { in: [...byOffer.keys()] } },
    select: {
      id: true,
      offerNo: true,
      name: true,
      platformId: true,
      state: true,
      platform: { select: { name: true } },
      sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
    },
  });
  const labeller = rows.some((r) => !r.name) ? await makeOfferLabeller(collectionId) : null;

  return rows
    .map((r) => ({
      offerId: r.id,
      offerNo: r.offerNo,
      offerLabel: r.name ?? labeller?.offer(r.sets) ?? "Untitled listing",
      platformId: r.platformId,
      platformName: r.platform.name,
      state: (isOfferState(r.state) ? r.state : "active") as OfferState,
      itemIds: byOffer.get(r.id) ?? [],
    }))
    .sort((a, b) => b.itemIds.length - a.itemIds.length || a.offerNo - b.offerNo);
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface OfferListItem {
  id: string;
  /** The offer's short per-collection number (#416/#432) — what the row prints and the quick-jump
   * box (#431) takes as `o 12`. */
  offerNo: number;
  /** The stored listing title (#209), or null when never generated. */
  name: string | null;
  /** Label derived from the offer's sets — the display fallback when `name` is null. */
  label: string;
  platformId: string;
  platformName: string;
  url: string | null;
  /** How this listing is sold (#449) — a quick buy at a stated price, or an auction. The row shows
   * it as a chip, because what its price *means* depends on it. */
  listingType: OfferListingType;
  /** The listing's current figure: the asking price of a quick buy, the standing bid of an auction
   * (#449). One field for both — it is the live number every list, conversion and comparison wants.
   * An auction nobody has bid on carries none: the row reads "no bids yet" rather than inventing one. */
  price: string;
  /** What an auction opened at (#449), null otherwise. The row does not print it — a list is scanned
   * for what things cost *now* — but the header form is opened from here, and a field the form
   * cannot see is a field it would silently blank on save. */
  startingPrice: string | null;
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
  /** When an auction closes (#490); null on a quick buy and where no closing time is known. */
  endsAt: Date | null;
  /** The order this listing sold on, where a connected platform has reported one and no sale has
   * been recorded for it yet (#499). Null on everything else — including a listing whose sale *is*
   * recorded, which is what clears it. */
  platformSale: UnrecordedPlatformSale | null;
  /** Derived (#490): this auction has ended with a bid on it and nothing has resolved it — the row
   * carries a flag, because only the collector can say whether it sold or has to be relisted. */
  needsResolution: boolean;
  /** The date the listing went live (#257), or null when not recorded. */
  listingDate: Date | null;
  /** Derived (#542): the offer is **up on the platform** and something about what it lists — its
   * composition, its stated price, one of its texts — has changed since it went up, with nothing
   * pushed back to the marketplace. The instant is when it started diverging, so the row can say how
   * long the live listing has been wrong; null is a listing this record believes is in step. */
  listingOutOfDate: Date | null;
  createdAt: Date;
}

const OFFER_SELECT = {
  id: true,
  offerNo: true,
  name: true,
  platformId: true,
  url: true,
  listingType: true,
  price: true,
  startingPrice: true,
  currency: true,
  state: true,
  inActiveBidding: true,
  bidderCount: true,
  endsAt: true,
  listingDate: true,
  listingContentChangedAt: true,
  createdAt: true,
  platform: { select: { name: true } },
  sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
} as const;

type OfferRow = {
  id: string;
  offerNo: number;
  name: string | null;
  platformId: string;
  url: string | null;
  listingType: string;
  price: Decimal;
  startingPrice: Decimal | null;
  currency: string;
  state: string;
  inActiveBidding: boolean;
  bidderCount: number | null;
  endsAt: Date | null;
  listingDate: Date | null;
  listingContentChangedAt: Date | null;
  createdAt: Date;
  platform: { name: string };
  sets: OfferSetRow[];
};

/**
 * Whether "in active bidding" (#215) is still true of an offer that has **sold** (#469).
 *
 * It is not: the flag says a bid has been placed and the collector is committed *before the sale is
 * recorded*, so the sale is exactly what resolves it — a sold listing showing "In bidding" reads as
 * an auction still running. `addSaleLines` clears the stored flag on the same transition, and
 * this is what an offer sold before that did says; the two agree, and no surface has to remember the
 * rule. Only `sold`: a paused or withdrawn auction may genuinely still be taking bids.
 */
function biddingLive(inActiveBidding: boolean, state: OfferState): boolean {
  return inActiveBidding && state !== "sold";
}

function toListItem(
  row: OfferRow,
  baseCurrency: string,
  labeller: OfferLabeller,
  soldCopyCount = 0,
  platformSale: UnrecordedPlatformSale | null = null
): OfferListItem {
  const state = (isOfferState(row.state) ? row.state : "active") as OfferState;
  const listingType = normalizeListingType(row.listingType);
  return {
    id: row.id,
    offerNo: row.offerNo,
    name: row.name,
    label: labeller.offer(row.sets),
    platformId: row.platformId,
    platformName: row.platform.name,
    url: row.url,
    listingType,
    price: row.price.toFixed(2),
    startingPrice: row.startingPrice?.toFixed(2) ?? null,
    currency: row.currency,
    baseCurrency,
    priceBase: null, // filled by attachBasePrices (needs the current rate)
    state,
    setCount: row.sets.length,
    itemCount: row.sets.reduce((n, s) => n + s.items.length, 0),
    needsAction: soldCopyCount > 0,
    soldCopyCount,
    inActiveBidding: biddingLive(row.inActiveBidding, state),
    endsAt: row.endsAt,
    // Read against this row's own instant rather than a clock passed down the page: the rule is a
    // comparison against "now" whichever way it is reached, and the facet count below asks the
    // database the same question with `new Date()` at the same point in the request.
    needsResolution: auctionNeedsResolution(
      {
        listingType,
        state,
        endsAt: row.endsAt,
        price: row.price.toFixed(2),
        inActiveBidding: row.inActiveBidding,
        bidderCount: row.bidderCount,
      },
      new Date()
    ),
    platformSale,
    listingDate: row.listingDate,
    // The stored instant, but only where the offer is still up (#542). Reading the state here rather
    // than clearing the column on the way out means a listing that sold or was withdrawn while
    // flagged simply stops reporting it — what a closed listing said is history, and it is one rule
    // in one place instead of a clean-up on every terminal transition.
    listingOutOfDate: isListedState(state) ? row.listingContentChangedAt : null,
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
  baseCurrency: string,
  /** Already-resolved overlays, where the caller had to resolve them to filter by one — asking for
   * the same comparison twice in one request is the whole reason this argument exists. */
  resolved: {
    counts?: Map<string, number>;
    platformSales?: Map<string, UnrecordedPlatformSale>;
  } = {}
): Promise<OfferListItem[]> {
  // Whole-collection, like the needs-action comparison below: what an order says about a listing
  // does not depend on which page that listing is on. Bounded by the live offers (#499). Resolved
  // first because the needs-action pass reads it too — the sibling cascade is computed off exactly
  // this set — and one request must not ask for the same comparison twice.
  const platformSales = resolved.platformSales ?? (await unrecordedPlatformSales(collectionId));
  const platformSoldIds = [...platformSales.keys()];

  const [counts, labeller] = await Promise.all([
    resolved.counts ??
      needsActionCounts(
        collectionId,
        rows.filter((r) => r.state === "active").map((r) => r.id),
        platformSoldIds
      ),
    makeOfferLabeller(collectionId),
  ]);
  const items = rows.map((r) =>
    toListItem(r, baseCurrency, labeller, counts.get(r.id) ?? 0, platformSales.get(r.id) ?? null)
  );
  await attachBasePrices(collectionId, baseCurrency, items);
  return items;
}

export interface OfferListFilters {
  platformId?: string;
  /** The states the list is narrowed to, OR-matched — empty or absent means every state. A
   * multi-select since #475: an offer is in exactly one state, but the question asked of the list
   * is routinely a group of them ("what is prepared but not yet live"). */
  states?: OfferState[];
  /** The derived "needs action" overlay (ADR-0013 §4): active offers holding a set whose copy sold
   * elsewhere. Takes precedence over `states`. */
  needsAction?: boolean;
  /** Only offers **in active bidding** (#215). A plain column rather than a derivation, and it
   * composes with everything else — it is what the notification centre's "bidding started" group
   * (#481) links to, so that "see all" lands on exactly the rows it was counting. */
  bidding?: boolean;
  /** Only auctions that have **ended with a bid on them** and are waiting to be resolved (#490).
   * The stored side of {@link auctionNeedsResolution} — every part of that rule is a column, so it
   * narrows, counts and paginates like any other filter rather than being resolved to ids. */
  endedAuction?: boolean;
  /** Only offers whose listing has **sold on a connected platform** with no sale recorded here yet
   * (#499). Derived like `needsAction` — what counts as recorded is a comparison between an order
   * and a sale — so it is resolved to ids rather than expressed as a `where`. */
  platformSale?: boolean;
  /** Only offers that are **up on the platform and no longer match this record** (#542): the flag
   * is set and the offer is `active` or `paused`. Two columns and no comparison, so it narrows,
   * counts and paginates like any other column-backed filter rather than resolving to ids — which
   * is exactly why the signal is a stored instant and not a recomputed diff. */
  listingOutOfDate?: boolean;
  /** Include closed (sold / withdrawn) offers. Off by default: the list hides dead listings unless
   * the user opts in (#245). Ignored when an explicit `states` filter is set. */
  includeClosed?: boolean;
  /** Free text the list is narrowed to (#465): the listing title, the derived label's inputs, the
   * offer's own number, its listing URL, or the catalog number / filing ref of a copy it holds.
   * Composes with every other filter rather than replacing them. */
  search?: string;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedOffersResult {
  items: OfferListItem[];
  nextCursor: string | null;
}

/**
 * The `where` fragment for the offers-list search box (#465). Case-insensitive substring, over the
 * things a collector knows an offer by:
 *
 * - the **stored listing title**, and — only where there is none — the inputs the shown label is
 *   derived from (#209/#379): the set titles and the stamp names behind them. An offer that *has* a
 *   title is matched on the title, because that is what the list is showing and what the collector
 *   deliberately wrote;
 * - the **offer's own number** (#416), a bare integer or behind a `#`, following `parseEntityNoSearch`
 *   (#431) — matched *in addition to* the text, never instead of it, since `200` is also a perfectly
 *   good catalog number;
 * - the **catalog numbers** of the copies in its sets, exactly as the sales list searches them;
 * - the **filing ref** of those copies (`A234`), for the same reason the inventory list searches it
 *   (#303): where a piece sits in the album is one of the few things a collector reliably knows
 *   about it, and an offer is findable by what is in it;
 * - the **listing URL**, at the address's own boundaries rather than as a bare substring — see
 *   `offer-search.ts` for why either half of that is never a plain `contains`.
 */
function offerSearchWhere(search: string): Prisma.OfferWhereInput {
  const s = search.trim();
  const text = { contains: s, mode: "insensitive" as const };
  const stampMatch: Prisma.OfferWhereInput = {
    sets: { some: { items: { some: { item: { stamp: { name: text } } } } } },
  };
  /** One of the offer's copies matching, whatever is asked of the copy. */
  const heldCopy = (item: Prisma.ItemWhereInput): Prisma.OfferWhereInput => ({
    sets: { some: { items: { some: { item } } } },
  });

  const or: Prisma.OfferWhereInput[] = [
    { name: text },
    { name: null, sets: { some: { title: text } } },
    { name: null, ...stampMatch },
    heldCopy({ stamp: { catalogNumbers: { some: { number: text } } } }),
    heldCopy({ locationRef: text }),
  ];

  const offerNo = parseEntityNoSearch(s);
  if (offerNo !== null) or.push({ offerNo });

  // A pasted link is compared as an address: the stored URL has to *end* at the same place, or
  // carry it followed by a query, a fragment or a further segment — so `…/sale/12` never matches
  // `…/sale/1234`.
  const { address, listingId } = parseOfferAddressSearch(s);
  if (address) {
    or.push(
      { url: { endsWith: address, mode: "insensitive" } },
      { url: { contains: `${address}/`, mode: "insensitive" } },
      { url: { contains: `${address}?`, mode: "insensitive" } },
      { url: { contains: `${address}#`, mode: "insensitive" } }
    );
  }
  // …and a listing number is found inside an address that shares nothing else with it, at the
  // boundaries `findCapturedLot` uses for the same job on an auction lot.
  if (listingId) {
    or.push(
      { url: { endsWith: `/${listingId}` } },
      { url: { endsWith: `-${listingId}` } },
      { url: { contains: `/${listingId}?` } },
      { url: { contains: `-${listingId}?` } },
      { url: { contains: `offerId=${listingId}` } }
    );
  }

  return { OR: or };
}

/**
 * {@link auctionNeedsResolution} restated as a `where` (#490) — an auction that has ended with a bid
 * on it and has not been resolved.
 *
 * Two statements of one rule, accepted for the reason the auction lot list accepts the same thing
 * for its outcomes: every part sits on the row, so this is a handful of indexed predicates, and the
 * alternative — resolving it to ids like the needs-action overlay — would load every auction in the
 * collection to answer a question about a column. `tests/unit/offer-rules.test.ts` pins the pure
 * rule and the integration tests pin this against it.
 *
 * Returned as an `AND` list rather than one object: the bid signals are an `OR`, and the list's
 * search is already an `OR` on the same object.
 */
function endedAuctionWhere(now: Date): Prisma.OfferWhereInput[] {
  return [
    { listingType: "auction" },
    { state: { notIn: [...CLOSED_OFFER_STATES] } },
    { endsAt: { not: null, lt: now } },
    {
      OR: [
        // An auction's price is an observation, so anything above zero is a bid actually seen.
        { price: { gt: 0 } },
        { inActiveBidding: true },
        { bidderCount: { gt: 0 } },
      ],
    },
  ];
}

/**
 * The offer list's `where`, shared by the paginated list and the summary bar (#317) so both read
 * exactly the same offer set. Pass `needsActionIds` for the derived overlay (ADR-0013 §4): it is
 * resolved to ids first and, as in the list, takes precedence over the state / show-closed choice.
 *
 * `platformSoldIds` is the reclassification in #501: for the **state chips only**, a listing the
 * marketplace has already sold counts as `sold` rather than as whatever its stored state still says.
 * So "Sold" gathers it and "Active" does not, and the chip's badge describes the rows clicking it
 * produces. The default view — no state chosen — is deliberately left alone: these are the offers
 * most in need of attention, and hiding them behind a chip is the opposite of what #499 flagged them
 * for.
 */
function offerListWhere(
  collectionId: string,
  filters: Pick<
    OfferListFilters,
    | "platformId"
    | "states"
    | "includeClosed"
    | "search"
    | "bidding"
    | "endedAuction"
    | "listingOutOfDate"
  >,
  needsActionIds?: string[],
  platformSoldIds?: string[]
): Prisma.OfferWhereInput {
  // Every narrowing goes into one `AND` list rather than onto the object as sibling keys: the
  // search is an `OR`, the ended-auction rule is an `AND`, and since #501 the state selection can be
  // either — as sibling keys the later one would silently replace the earlier instead of narrowing
  // alongside it (the `lotListWhere` rule).
  const and: Prisma.OfferWhereInput[] = [];
  if (filters.endedAuction) and.push(...endedAuctionWhere(new Date()));
  // Both halves of the flag (#542): the stamp is set *and* the offer is still up. The state half is
  // what the list item's own derivation reads, and asking it here is what stops a listing that sold
  // while flagged from being counted as work waiting to be done.
  if (filters.listingOutOfDate) and.push(LISTING_DRIFT_WHERE);
  if (filters.search?.trim()) and.push(offerSearchWhere(filters.search));
  if (needsActionIds) and.push({ id: { in: needsActionIds } });
  // An explicit state filter wins; otherwise hide closed (sold / withdrawn) offers unless the user
  // opted in (#245).
  else if (filters.states?.length) and.push(stateSelectionWhere(filters.states, platformSoldIds));
  else if (!filters.includeClosed) and.push({ state: { notIn: [...CLOSED_OFFER_STATES] } });

  return {
    collectionId,
    ...(filters.platformId ? { platformId: filters.platformId } : {}),
    ...(filters.bidding ? { inActiveBidding: true } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/**
 * The state chips' `where`, with a platform-sold listing read as `sold` (#501).
 *
 * Three shapes, because the reclassification cuts both ways: picking `sold` **adds** the flagged
 * offers to whatever the states select, picking anything else **removes** them from it, and with no
 * flagged offers at all — the ordinary case — it stays the plain `state: { in: … }` it always was.
 */
function stateSelectionWhere(
  states: readonly OfferState[],
  platformSoldIds?: string[]
): Prisma.OfferWhereInput {
  const inStates: Prisma.OfferWhereInput = { state: { in: [...states] } };
  if (!platformSoldIds?.length) return inStates;
  return states.includes("sold")
    ? { OR: [inStates, { id: { in: platformSoldIds } }] }
    : { AND: [inStates, { id: { notIn: platformSoldIds } }] };
}

/** The order the offer list is read in, shared by the paginated list and the detail screen's
 * next/previous navigation (#429) so the two can never disagree about what "the next offer" is.
 * The id is a tiebreak, not a second sort key: offers created in the same transaction share a
 * timestamp, and an unstable order would both repeat a row across pages and skip its neighbour. */
const OFFER_LIST_ORDER_BY: Prisma.OfferOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

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

  // Both overlays are comparisons across tables that no `where` can express — the needs-action flag
  // (ADR-0013 §4) and the unrecorded platform sale (#499) — so each is resolved to ids first and
  // then paginated as an ordinary `where`, which is what keeps a page costing only the offers it
  // shows. Selecting both means *both*, so the two id lists are intersected rather than being two
  // `id: { in: … }` keys that would overwrite each other.
  const overlays = await resolveOfferOverlays(collectionId, filters);
  if (overlays.ids?.length === 0) return { items: [], nextCursor: null };

  const rows = await prisma.offer.findMany({
    where: offerListWhere(collectionId, filters, overlays.ids, overlays.platformSoldIds),
    orderBy: OFFER_LIST_ORDER_BY,
    take: pageSize + 1,
    skip: offset,
    select: OFFER_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: await withNeedsAction(page, collectionId, baseCurrency, overlays.resolved),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/**
 * The derived overlays a filter selection asks for, resolved once (#499).
 *
 * `ids` is what the page is narrowed to — undefined when neither overlay is selected, an **empty
 * array** when one is selected and matches nothing, which is a real answer and not the same as "not
 * asked". `resolved` hands the maps on so the rows can be labelled and flagged without asking for
 * the same comparison a second time.
 *
 * The platform-sale set is resolved for a **state selection** too (#501), where it is not an overlay
 * at all but the reclassification the state chips are read through — see {@link stateSelectionWhere}.
 * That is why it is returned separately from `ids`: being flagged decides which chip an offer
 * answers to, and only selecting the overlay narrows the list to the flagged ones.
 */
async function resolveOfferOverlays(
  collectionId: string,
  filters: Pick<OfferListFilters, "needsAction" | "platformSale" | "states">
): Promise<{
  ids?: string[];
  /** The flagged offers, whenever anything downstream needs to tell them apart. */
  platformSoldIds?: string[];
  resolved: { counts?: Map<string, number>; platformSales?: Map<string, UnrecordedPlatformSale> };
}> {
  // The platform-sale set first, because the needs-action pass reads it as well (the sibling
  // cascade), and handing it on is what keeps one request to one comparison.
  const platformSales =
    filters.platformSale || filters.states?.length
      ? await unrecordedPlatformSales(collectionId)
      : null;
  const platformSoldIds = platformSales ? [...platformSales.keys()] : undefined;
  const counts = filters.needsAction
    ? await needsActionCounts(collectionId, undefined, platformSoldIds)
    : null;
  // **Needs action selects both problems** (#542): a live listing holding a set that sold elsewhere,
  // and a live listing whose contents no longer match the record. They are one category — a listing
  // on a marketplace that is wrong and only the collector can put right — and a second chip beside
  // the first would have split one question across two controls.
  //
  // Unioned as *ids* rather than ORed into the `where`, so everything downstream is untouched: the
  // selection still intersects with a platform-sale selection the way it always did, and an empty
  // result is still an empty result. It stays out of `needsActionCounts`, which is the *dead-copy*
  // count the rows read — drift is not a dead copy, and the row says which problem it has by which
  // badge it carries.
  const driftIds = filters.needsAction ? await listingDriftRows(collectionId) : null;
  const needsActionIds = counts
    ? [...new Set([...counts.keys(), ...(driftIds ?? []).map((r) => r.offerId)])]
    : null;
  // Only a *selected* overlay narrows the page. A state selection reads the same set, but as a
  // reclassification rather than a filter, so it must not turn into an `id: { in: … }` here.
  const lists = [
    needsActionIds,
    filters.platformSale && platformSales ? [...platformSales.keys()] : null,
  ].filter((l): l is string[] => l !== null);
  const ids =
    lists.length === 0
      ? undefined
      : lists.reduce((a, b) => {
          const keep = new Set(b);
          return a.filter((id) => keep.has(id));
        });
  return {
    ids,
    platformSoldIds,
    resolved: { counts: counts ?? undefined, platformSales: platformSales ?? undefined },
  };
}

/** Where one offer sits in the filtered list it was opened from (#429). */
export interface OfferListNeighbours {
  previousId: string | null;
  nextId: string | null;
  /** 1-based position in the filtered list, or null when the offer is not in it at all. */
  position: number | null;
  total: number;
}

/**
 * The offer before and after this one in the list's own order (#429), under the filters the
 * collector had active — so preparing a batch is a walk through the filtered list rather than a
 * return trip to it after every offer.
 *
 * Ids only, unpaginated: it is one column over the same `where` and `orderBy` the list reads, and
 * the whole point is knowing what comes after the last row loaded so far. Reading the position out
 * of it is what makes the "3 of 12" indicator free.
 *
 * An offer that is **not** in the filtered set answers `position: null` with no neighbours — a link
 * carrying someone else's filters, or an offer that has since left them. The screen asks once and
 * keeps the answer, so advancing an offer out of its own filter does not strand the walk.
 */
export async function offerListNeighbours(
  ownerId: string,
  collectionId: string,
  offerId: string,
  filters: Pick<
    OfferListFilters,
    | "platformId"
    | "states"
    | "needsAction"
    | "includeClosed"
    | "search"
    | "bidding"
    | "endedAuction"
    | "platformSale"
    | "listingOutOfDate"
  > = {}
): Promise<OfferListNeighbours> {
  await assertCollectionOwner(ownerId, collectionId);

  // The derived overlays are not columns (ADR-0013 §4, #499), so they resolve to ids first —
  // exactly as the list page and the summary bar do.
  const { ids, platformSoldIds } = await resolveOfferOverlays(collectionId, filters);
  if (ids?.length === 0) {
    return { previousId: null, nextId: null, position: null, total: 0 };
  }

  const rows = await prisma.offer.findMany({
    where: offerListWhere(collectionId, filters, ids, platformSoldIds),
    orderBy: OFFER_LIST_ORDER_BY,
    select: { id: true },
  });

  const index = rows.findIndex((r) => r.id === offerId);
  if (index === -1) {
    return { previousId: null, nextId: null, position: null, total: rows.length };
  }
  return {
    previousId: index > 0 ? rows[index - 1].id : null,
    nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    position: index + 1,
    total: rows.length,
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

// ── The offer behind a marketplace listing (#466) ────────────────────────────

/** The offer a marketplace listing turned out to be, as the Assistant names it on the page it is
 * standing on. Deliberately small: this answers "is this mine, and where is it here", and every
 * further question is the offer's own screen. */
export interface OfferListingMatch {
  /** The marketplace's own id this answers for, so a batch answer needs no positional matching. */
  platformOfferId: string;
  offerId: string;
  offerNo: number;
  /** What the offer is called — its stored title (#209), or the derived label while it has none. */
  title: string;
  state: OfferState;
  /** The offer's screen, **relative** to the instance. The caller is the extension, which holds a
   * base URL of its own — the one it authenticated against — so a path is both shorter and safer
   * than an absolute URL built from a `BETTER_AUTH_URL` this request never went through. */
  path: string;
  /** Which of the three threads found it, for the answer to be honest about how sure it is:
   * `listing` / `order` are Allegro's own synced ids (#467), `url` is the id recognised inside a
   * stored address. */
  matchedBy: "listing" | "order" | "url";
}

/** How many listings one lookup answers for. A page of the seller's own assortment asks about every
 * row it draws, and the collector can set that page to 1000 — so the cap is the endpoint's, not the
 * caller's, and what it drops is simply not annotated. */
export const OFFER_LISTING_LOOKUP_LIMIT = 200;

/**
 * The collection's own offers for a batch of marketplace listings, keyed on the marketplace's offer
 * ids. Unmatched ids are absent from the answer rather than present as nulls.
 *
 * Three threads, exact ones first. The sync (#467) records Allegro's id against the offer it
 * matched — on the seller's own listing (`AllegroListing`, one row per offer id) and on an order
 * line that sold it — and where either exists, the answer is Allegro's own rather than derived.
 * Everything published by hand has only `Offer.url` (#412), matched at the **address's own
 * boundaries** and never as a bare substring: an id is a run of digits, and `8795065609` sits inside
 * `18795065609`.
 *
 * That last thread is resolved **in memory** (`urlNamesPlatformOffer`) over the collection's stored
 * addresses rather than as an `OR` per id: a batch of 200 ids would otherwise be a thousand `LIKE`
 * arms, while the addresses themselves are two small columns and are read once however many
 * listings are asked about.
 *
 * Not scoped to the collection's Allegro platform (#355's setting): an offer's stored address names
 * the listing whether or not the collector has ever pointed a platform at the module, and a lookup
 * that answered nothing until a Settings tab was filled in would look broken rather than empty.
 */
export async function findOffersForListings(
  ownerId: string,
  collectionId: string,
  platformOfferIds: string[]
): Promise<OfferListingMatch[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const ids = [...new Set(platformOfferIds.filter((id) => /^\d+$/.test(id)))].slice(
    0,
    OFFER_LISTING_LOOKUP_LIMIT
  );
  if (ids.length === 0) return [];

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { slug: true },
  });
  if (!collection) return [];

  const [listings, orderLines, addressed] = await Promise.all([
    prisma.allegroListing.findMany({
      where: { collectionId, platformOfferId: { in: ids }, offerId: { not: null } },
      select: { platformOfferId: true, offerId: true },
    }),
    prisma.allegroOrderLine.findMany({
      where: { collectionId, platformOfferId: { in: ids }, offerId: { not: null } },
      orderBy: { boughtAt: "desc" },
      select: { platformOfferId: true, offerId: true },
    }),
    // Newest first, so a relisted piece that left an older offer carrying an address ending the same
    // way lands on the current listing.
    prisma.offer.findMany({
      where: { collectionId, url: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, url: true },
    }),
  ]);

  /** Which offer each asked-about id resolved to, and by which thread. First writer wins, so the
   *  order these are folded in is the order of preference. */
  const resolved = new Map<string, { offerId: string; matchedBy: OfferListingMatch["matchedBy"] }>();
  for (const row of listings) {
    if (row.offerId) resolved.set(row.platformOfferId, { offerId: row.offerId, matchedBy: "listing" });
  }
  for (const row of orderLines) {
    if (row.offerId && !resolved.has(row.platformOfferId)) {
      resolved.set(row.platformOfferId, { offerId: row.offerId, matchedBy: "order" });
    }
  }
  for (const id of ids) {
    if (resolved.has(id)) continue;
    const hit = addressed.find((offer) => urlNamesPlatformOffer(offer.url, id));
    if (hit) resolved.set(id, { offerId: hit.id, matchedBy: "url" });
  }
  if (resolved.size === 0) return [];

  const offers = await prisma.offer.findMany({
    where: { collectionId, id: { in: [...new Set([...resolved.values()].map((r) => r.offerId))] } },
    select: {
      id: true,
      offerNo: true,
      name: true,
      state: true,
      sets: { select: OFFER_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
    },
  });
  const byId = new Map(offers.map((offer) => [offer.id, offer]));

  // The labeller is built once for the whole batch, and only when some offer actually needs it: a
  // collection whose offers all carry a stored title (#380) pays nothing for it.
  const labeller = offers.some((offer) => offer.name === null)
    ? await makeOfferLabeller(collectionId)
    : null;

  const matches: OfferListingMatch[] = [];
  for (const [platformOfferId, { offerId, matchedBy }] of resolved) {
    const offer = byId.get(offerId);
    if (!offer) continue;
    matches.push({
      platformOfferId,
      offerId: offer.id,
      offerNo: offer.offerNo,
      title: offer.name ?? labeller?.offer(offer.sets) ?? "Untitled listing",
      state: offer.state as OfferState,
      path: `/c/${encodeURIComponent(collection.slug)}/offers/${offer.id}`,
      matchedBy,
    });
  }
  return matches;
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
    /** The platform's fallback starting price for a new auction (#362/#449), or null — what the
     *  dialog pre-fills the opening figure with. */
    defaultStartingPrice: string | null;
    /** How a new offer here is sold by default (#449), or null for "no preference" — what the new-
     *  offer dialog pre-selects, for the same reason it carries the default price. */
    defaultListingType: string | null;
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
          defaultStartingPrice: true,
          defaultListingType: true,
          platformModule: true,
        },
      },
    },
    distinct: ["platformId"],
    orderBy: { platform: { name: "asc" } },
  });
  return rows.map((r) => ({
    ...r.platform,
    defaultStartingPrice: r.platform.defaultStartingPrice?.toFixed(2) ?? null,
  }));
}

export interface OfferFilterCounts {
  /** Offers per state, within the selected platform. States with no offers are absent. */
  states: Partial<Record<OfferState, number>>;
  /** Flagged offers within the selected platform — **both** problems the chip selects (#542): a set
   * that sold elsewhere (ADR-0013 §4) and a live listing changed since it was posted. */
  needsAction: number;
  /** Ended auctions with a bid on them, waiting to be resolved (#490), within the selected
   * platform. Like `needsAction` it is an overlay rather than a state, so it ignores the state
   * chips' selection and its own. */
  endedAuction: number;
  /** Listings sold on a connected platform with no sale recorded here (#499), within the selected
   * platform. An overlay too, so counted on the same terms. */
  platformSale: number;
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
 *
 * The search box (#465) is not a facet of its own — it has no control to count — so it narrows
 * *every* count, which is what makes the badges describe the searched set rather than the whole
 * collection.
 */
export async function offerFilterCounts(
  ownerId: string,
  collectionId: string,
  filters: Pick<
    OfferListFilters,
    | "platformId"
    | "states"
    | "needsAction"
    | "includeClosed"
    | "search"
    | "bidding"
    | "endedAuction"
    | "platformSale"
  > = {}
): Promise<OfferFilterCounts> {
  await assertCollectionOwner(ownerId, collectionId);

  const searchWhere = filters.search?.trim() ? offerSearchWhere(filters.search) : null;
  // A search is the one narrowing the derived facet cannot express, `needsActionRows` reading its
  // own SQL rather than a `where` (ADR-0013 §4). So it is resolved to ids first and handed in as
  // the scope that read already takes — no search matches means an empty scope, not an open one.
  const searchIds = searchWhere
    ? (
        await prisma.offer.findMany({
          where: { collectionId, ...searchWhere },
          select: { id: true },
        })
      ).map((r) => r.id)
    : undefined;

  // The needs-action facet comes back already grouped by platform, so both the chip's own count
  // (within the selected platform) and the platform facet under a needs-action selection are read
  // off the same few flagged rows — no id list travels back into a `where`.
  const [flagged, drifted, byState, byPlatform, endedAuction, platformSales] = await Promise.all([
    needsActionRows(collectionId, searchIds),
    // The other half of what *Needs action* selects (#542). Read as its own small set rather than
    // folded into the SQL above: that query is about dead copies, and drift is not one.
    listingDriftRows(collectionId, searchIds),
    prisma.offer.groupBy({
      by: ["state"],
      where: {
        collectionId,
        ...(filters.platformId ? { platformId: filters.platformId } : {}),
        ...(searchWhere ?? {}),
      },
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
            ...(searchWhere ?? {}),
            ...(filters.states?.length
              ? { state: { in: filters.states } }
              : filters.includeClosed
                ? {}
                : { state: { notIn: [...CLOSED_OFFER_STATES] } }),
          },
          _count: { _all: true },
        }),
    // The ended-auction chip's own count (#490): its own selection ignored like every facet's, and
    // the state chips' too — it is an overlay across states, exactly as "Needs action" is.
    prisma.offer.count({
      where: {
        collectionId,
        ...(filters.platformId ? { platformId: filters.platformId } : {}),
        ...(searchWhere ?? {}),
        AND: endedAuctionWhere(new Date()),
      },
    }),
    // …and the sold-on-platform chip's (#499), which is a resolved id set rather than a `where`, so
    // it is narrowed here by the platform and the search the same way every other facet is.
    unrecordedPlatformSales(collectionId),
  ]);

  const platformSaleIds = [...platformSales.keys()];
  // Grouped rather than counted (#501): the chip's own badge is the total, and the per-state split is
  // what moves each flagged offer out of the state it is still stored in and into `sold`.
  const platformSoldByState =
    platformSaleIds.length === 0
      ? []
      : await prisma.offer.groupBy({
          by: ["state"],
          where: {
            collectionId,
            id: { in: platformSaleIds },
            ...(filters.platformId ? { platformId: filters.platformId } : {}),
            ...(searchWhere ?? {}),
          },
          _count: { _all: true },
        });
  const platformSale = platformSoldByState.reduce((n, row) => n + row._count._all, 0);

  const states: Partial<Record<OfferState, number>> = {};
  for (const row of byState) {
    if (isOfferState(row.state)) states[row.state] = row._count._all;
  }
  // A listing the marketplace has already sold is counted as **sold** (#501), whatever its stored
  // state still says — recording the sale is what moves the state, and until that happens the chips
  // would otherwise go on calling it active. `unrecordedPlatformSales` is scoped to open offers, so
  // no row is ever moved out of `sold` into itself.
  for (const row of platformSoldByState) {
    if (!isOfferState(row.state) || row.state === "sold") continue;
    states[row.state] = (states[row.state] ?? 0) - row._count._all;
    if (states[row.state] === 0) delete states[row.state];
    states.sold = (states.sold ?? 0) + row._count._all;
  }

  // What the *Needs action* chip selects, as one set (#542): a listing holding a set that sold
  // elsewhere, or a listing changed since it was posted. Deduplicated by offer, because an offer can
  // easily be both — removing the set that sold elsewhere is itself a change to a live listing — and
  // counting it twice would make the badge disagree with the list it opens.
  const needingAction = new Map<string, string>();
  for (const row of [...flagged, ...drifted]) needingAction.set(row.offerId, row.platformId);

  const platforms: Record<string, number> = {};
  let total = 0;
  if (byPlatform) {
    for (const row of byPlatform) {
      platforms[row.platformId] = row._count._all;
      total += row._count._all;
    }
  } else {
    for (const platformId of needingAction.values()) {
      platforms[platformId] = (platforms[platformId] ?? 0) + 1;
      total += 1;
    }
  }

  return {
    states,
    needsAction: filters.platformId
      ? [...needingAction.values()].filter((p) => p === filters.platformId).length
      : needingAction.size,
    endedAuction,
    platformSale,
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
  filters: Pick<
    OfferListFilters,
    | "platformId"
    | "states"
    | "needsAction"
    | "includeClosed"
    | "search"
    | "bidding"
    | "endedAuction"
    | "platformSale"
    | "listingOutOfDate"
  > = {}
): Promise<OffersSummary> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);

  // The derived overlays are not columns (ADR-0013 §4, #499), so they resolve to ids first — exactly
  // as the list page does. Nothing matching means an empty slice, not an unfiltered one.
  const { ids, resolved } = await resolveOfferOverlays(collectionId, filters);
  if (ids?.length === 0) {
    return {
      ...aggregateOfferAsking([], baseCurrency, new Map()),
      holdings: await getHoldingsValuationForItems(collectionId, []),
      platforms: [],
    };
  }

  // What has already sold on its platform (#501), so the bar can hold it out of the asking value
  // and state it on a line of its own. Reused from the overlay pass when the collector is filtering
  // by it, rather than asking for the same comparison twice.
  const platformSales = resolved.platformSales ?? (await unrecordedPlatformSales(collectionId));

  const offers = await prisma.offer.findMany({
    where: offerListWhere(collectionId, filters, ids, [...platformSales.keys()]),
    select: {
      id: true,
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
    platformSold: platformSales.has(o.id),
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
    // Over the same offers the asking value is read from, so the three figures on the bar describe
    // one set: an offer already sold on its platform is out of all of them (#501).
    {
      key: TOTAL,
      itemIds: [...new Set(rows.filter((r) => !r.platformSold).flatMap((r) => r.itemIds))],
    },
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
          // The rest of the valuation key (#616): an unknown-variant umbrella is listed under the
          // variant that is cheapest at *this* copy's condition, certificate and format.
          certificateStatusId: true,
          formatId: true,
          condition: { select: { name: true } },
          stamp: {
            select: {
              // The label select already carries the area links the grouping needs (#379).
              ...STAMP_LABEL_SELECT.stamp.select,
              issuedYear: true,
              colnectId: true,
              // Whether the stamp is an umbrella at all, which is what makes the derivation apply.
              variants: { select: VARIANT_FLAG_SELECT },
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
    usesPlatformConditions(platformModule)
      ? loadColnectConditionMap(collectionId)
      : new Map<string, string>(),
  ]);
  // …and so is the item-ID derivation (#616): one pass over every copy of the batch, rather than one
  // valuation per offer. It needs the labeller, hence the second step.
  const catalogIds = await resolveSetCatalogItemIds(
    collectionId,
    rows.flatMap((row) => row.sets),
    platformModule,
    labeller
  );
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
    blockers: listingBlockersFor(
      row.sets,
      platformModule,
      labeller,
      conditionMap,
      catalogIds,
      "ready"
    ),
  }));

  await attachBasePrices(collectionId, baseCurrency, items);
  return items;
}

/** One of the batch's sets, exactly as {@link LISTING_SETS_SELECT} returns it. */
type ListingSetRow = Prisma.OfferSetGetPayload<{ select: typeof LISTING_SETS_SELECT }>;

/**
 * Which catalogue entry each of these copies is listed under (#616) — the stamp's own item-ID where
 * it has one, and otherwise, for an unknown-variant umbrella, the **cheapest variant's**, derived by
 * the same rule that values the copy.
 *
 * Asked over as many sets as the caller holds at once, so a posting session's whole batch is one
 * derivation rather than forty; the workspace passes every offer's sets in, an offer's own screen
 * its own. It is only *derived* where the module lists against a catalogue of its own (#493) — a
 * platform filed by category has no entry for a variant to be an entry of, and the flag being false
 * is what keeps the read from happening at all.
 */
async function resolveSetCatalogItemIds(
  collectionId: string,
  sets: readonly ListingSetRow[],
  platformModule: string | null,
  labeller: OfferLabeller
): Promise<Map<string, ResolvedCatalogItemId>> {
  const catalogued = usesPlatformCatalogue(platformModule);
  return resolveListingCatalogItemIds(
    collectionId,
    sets.flatMap((set) =>
      set.items.map(({ itemId, item }) => ({
        itemId,
        stampId: item.stampId,
        conditionId: item.conditionId,
        certificateStatusId: item.certificateStatusId,
        formatId: item.formatId,
        unknownVariant: catalogued && isUnknownVariantStamp(item.stamp),
        ownCatalogItemId: item.stamp.colnectId?.trim() || null,
      }))
    ),
    labeller
  );
}

/**
 * The listing preconditions for one offer of the batch (#406), or **nothing** where the platform has
 * no Assistant module that can list (#471).
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
  /** What each copy is listed under (#616), from {@link resolveSetCatalogItemIds}. Required rather
   *  than defaulted: a caller that forgot it would report every umbrella as unmatched, which is the
   *  refusal this derivation exists to lift. */
  catalogIds: Map<string, ResolvedCatalogItemId>,
  state: OfferState,
  /** Which act is being judged (#462) — posting this offer, or re-filling the listing it is already
   *  live as. Only the leading state check differs; everything about the goods is asked either way. */
  mode: ListingMode = "create",
  listingUrl: string | null = null
): ListingBlocker[] {
  if (!hasListingModule(platformModule)) return [];
  return evaluateListingPreconditions({
    platformModule,
    state,
    mode,
    listingUrl,
    sets: sets.map((set) => ({
      setId: set.id,
      label: labeller.set(set),
      copies: orderedItems(set.items).map(({ itemId, item }) => ({
        itemId,
        label: labeller.copy(item.stamp),
        stampId: item.stampId,
        catalogItemId: catalogIds.get(itemId)?.catalogItemId ?? null,
        // Which of the two catalogue gaps left it null (#617), from the same resolution.
        catalogRollup: catalogIds.get(itemId)?.gap ?? null,
        conditionId: item.conditionId,
        conditionName: item.condition.name,
        platformCondition: conditionMap.get(item.conditionId) ?? null,
      })),
    })),
  });
}

/**
 * Everything that stands between one offer and **`ready`** — the state it is about to reach (#418),
 * never the one it is in: the Assistant's listing preconditions (#406) and its listing photos.
 *
 * The gate sits on `preparing → ready` and nowhere else in the lifecycle, because that transition is
 * what the collector means by "this listing is assembled": a fault caught here is fixed while the
 * offer is still being put together, rather than surfacing in the bulk listing workspace at the
 * moment there are thirty of them to post. Later transitions are deliberately left open — an offer
 * already live is a listing that exists, and refusing to pause or withdraw it over a mapping gap or
 * a stale collage would trap the collector.
 *
 * The preconditions are empty for a platform naming no Assistant module, exactly as
 * {@link listingBlockersFor} is: these are one module's rules, and a marketplace listed by hand has
 * nothing to fail. That is also why the condition map is not read for one. The **photo** check has no
 * such exemption — every marketplace is posted with images — but it only applies where there is
 * something to render at all; see {@link evaluatePhotoReadiness}.
 */
async function readReadyBlockers(collectionId: string, offerId: string): Promise<ReadyBlocker[]> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      platform: { select: { platformModule: true } },
      sets: { select: LISTING_SETS_SELECT, orderBy: OFFER_SETS_ORDER_BY },
    },
  });
  if (!offer) return [];
  const platformModule = offer.platform.platformModule;
  const [preconditions, photos] = await Promise.all([
    (async (): Promise<ListingBlocker[]> => {
      if (!hasListingModule(platformModule)) return [];
      const [labeller, conditionMap] = await Promise.all([
        makeOfferLabeller(collectionId),
        usesPlatformConditions(platformModule)
          ? loadColnectConditionMap(collectionId)
          : new Map<string, string>(),
      ]);
      const catalogIds = await resolveSetCatalogItemIds(
        collectionId,
        offer.sets,
        platformModule,
        labeller
      );
      return listingBlockersFor(
        offer.sets,
        platformModule,
        labeller,
        conditionMap,
        catalogIds,
        "ready"
      );
    })(),
    readOfferPhotoBlockers(offerId),
  ]);
  return [...preconditions, ...photos];
}

/** The photo half of the ready gate (#311) for one offer: the plan's state, judged by the pure
 *  rules. Empty for an offer that has vanished under the read. */
async function readOfferPhotoBlockers(offerId: string): Promise<PhotoReadinessBlocker[]> {
  const readiness = await readOfferPhotoReadiness(offerId);
  return readiness ? evaluatePhotoReadiness(readiness) : [];
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
  /** The sale it left on (#472), or null while the set is still for sale — what the sold chip links
   * to, so the transaction is one click away rather than a search of the sale list. `saleNo` is the
   * collection's own sale number (#432), the same one the sale row and the quick-jump box read. */
  sale: { id: string; saleNo: number } | null;
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
  /** How this listing is sold (#449): `fixed` — a quick buy at a stated asking price — or
   * `auction`, where the figure moves with the bidding and {@link startingPrice} says what it opened
   * at. It decides what the price field is *called* on screen, nothing about the lifecycle. */
  listingType: OfferListingType;
  /** The listing's current figure: the asking price of a quick buy, the standing bid of an auction
   * (#449). Deliberately one field for both readings — it is the live number, which is what every
   * list, conversion, comparison and sale wants. An auction nobody has bid on carries none. */
  price: string;
  /** What an auction opened at (#449) — the figure the seller states, and so what an auction needs
   * to go live, in place of the asking price a quick buy needs. Null on a quick buy. Nothing is
   * computed from it. */
  startingPrice: string | null;
  /** When an auction closes (#490); null on a quick buy and on an auction with no known closing.
   * Editable on the header form, and kept current by a connected platform's sync (#481). */
  endsAt: Date | null;
  /** When {@link price} was last confirmed against the live listing (#449) — the auction lot's
   * `checkedAt` (#351), stamped by the in-place price edit and by a connected platform's sync
   * (#481). Null on a price never re-checked, which is every quick buy. */
  priceCheckedAt: Date | null;
  /** How many bidders the connected platform reported, as of {@link priceCheckedAt} (#481). Written
   * by a sync and never by hand, so its presence is what says the figure beside it — and the
   * in-active-bidding flag — came from the marketplace rather than from the collector. Null on
   * everything no sync has read. */
  bidderCount: number | null;
  /** Set while the app's own "I marked this in active bidding" notice is still unread (#481). The
   * screen clears it on open — arriving here is the acknowledgement the notification asked for — so
   * it is only ever non-null on the first visit after a bid landed. */
  biddingNoticeAt: Date | null;
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
  /** The order this listing sold on, where a connected platform reported one and no sale has been
   * recorded for it yet (#499) — the same fact the list row carries, on the screen the collector
   * lands on from it (#505). A flag shown on the way past and then missing from the offer's own
   * page reads as having been dealt with, which is the one thing it must not say. */
  platformSale: UnrecordedPlatformSale | null;
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
  /** Derived (#542): the offer is up on the platform and something about what it lists has changed
   * since it went there, with nothing pushed back. The instant is when it started diverging; null is
   * a listing this record believes is in step. What the header's **Mark as up to date** clears. */
  listingOutOfDate: Date | null;
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
  /** Why the Assistant cannot **update** the listing this offer is already live as (#462) — the same
   * evaluation asked about the other act, and empty when it can. Anything not Active reports
   * `not-active` alone, and an Active offer with no listing URL reports `no-listing-url`: both are
   * why **⟳ Update via Assistant** is absent rather than refused. */
  listingUpdateBlockers: ListingBlocker[];
  /** Why this offer cannot be marked **Ready** (#418) — the listing preconditions judged at the state
   * it is about to reach rather than at the one it is in, plus the state of its listing photos
   * (#311): a listing whose images do not exist, or were rendered from a composition it no longer
   * has, is not assembled. Non-empty only while `preparing`, which is the one transition the gate
   * sits on; every other state reports nothing, because there is no such step to take from it. */
  readyBlockers: ReadyBlocker[];
  /** The offer's stamps as the platform's own catalogue knows them (#423), empty for a platform with
   * no module. See {@link OfferPlatformItem}. */
  platformItems: OfferPlatformItem[];
  /** The Allegro listing this offer was published as through the API (#477), where there is one, and
   * the publication state this app last knew it in. Null on every offer published by hand and on
   * every platform that is not Allegro.
   *
   * The header reads it to decide which of the two acts it offers: an offer with none is one to
   * **publish**, and a `INACTIVE` one is a draft sitting in the collector's Allegro account waiting
   * to be **activated** — the second half of the draft path, and the only reason a
   * published-but-inactive offer is not a dead end. */
  allegroPublication: { offerId: string; status: string } | null;
  /** What this offer is configured to be listed as on Allegro (#494) — the category, its parameter
   * answers and the listing profile — or null on every offer that is not on the Allegro platform.
   *
   * It lives on the offer rather than inside the publish dialog because two paths post to Allegro
   * (the API, #477; the Assistant's sale form, #493) and a value each of them worked out for itself
   * is a value the two would eventually disagree about. The offer's own screen is where it is seen
   * and corrected. */
  allegroListing: AllegroOfferListingConfig | null;
  /** Which Delcampe listing profile this offer's upload row is built from (#608), or null on every
   * offer that is not on the Delcampe platform. Its own field beside the Allegro one rather than a
   * shared "platform listing config": the two marketplaces agree on nothing but the idea of a named
   * profile, and one shape covering both could only be the union of two unrelated forms. */
  delcampeListing: DelcampeOfferListingConfig | null;
  createdAt: Date;
}

/**
 * One of an offer's stamps as the **platform's** catalogue knows it (#423) — the compact list that
 * puts the marketplace one click from the listing being priced.
 *
 * Keyed on `stamp × condition`, not on the copy: a komplet is dozens of copies over a handful of
 * stamps, and two copies of one stamp in one grade are the same catalogue page and the same market
 * search. That is also the key the platform's own vocabulary is defined on (#404/#405).
 *
 * Both URLs are null when what they need is missing — an unmatched stamp (#247), an unmapped
 * condition (#404) — and the row is still listed, because a gap the collector can go and fix is
 * exactly what a list of the offer's items should show them.
 */
export interface OfferPlatformItem {
  stampId: string;
  conditionId: string;
  /** The copy's own derived label (#379) — the catalogue number it is named by. Falls back to the
   * stamp's name, so it is what the row prints when {@link catalogNumbers} is empty. */
  label: string;
  /** Every catalogue number the stamp carries, vendor and area prefix included (`Mi·PL 865`),
   * leading vendor first. Unlike `label` this is the *whole* set and says which catalogue each
   * number belongs to: the row is read while cross-checking against the platform's own catalogue,
   * where a bare number matched to the wrong vendor is the mistake worth preventing. */
  catalogNumbers: string[];
  /** The stamp's name, where it has one; the label already carries the number. */
  stampName: string | null;
  conditionName: string;
  /** The stamp's page in the platform's catalogue (#290), null when it was never matched. */
  catalogUrl: string | null;
  /** Where to *look* for a stamp that has no page here — the platform's own catalogue search for the
   * leading catalog number. Null when the stamp is matched (its page is the better link) or carries
   * no number to search by. */
  searchUrl: string | null;
  /** What this stamp in this grade is currently being asked for (#423), null when the stamp is
   * unmatched or its condition is not mapped into the platform's vocabulary. */
  marketUrl: string | null;
  /** The **variant** the two links above resolved to (#616) — set only where this stamp is an
   * unknown-variant umbrella with no item-ID of its own, and the listing therefore stands under the
   * cheapest variant. Null for every ordinary row, including an umbrella matched by hand. */
  catalogItemVariant: string | null;
  /** The umbrella whose variant tree wants pricing (#618) — this row's own stamp, and set **only**
   * where the derivation above came back empty because a variant carries no price (#617's
   * `unpriced-variants`). Which variant is cheapest is not knowable until every one of them is
   * priced, so this is the row that has no catalogue link *and* nothing to search for; the card
   * offers the variant price grid on it, over the whole tree at once. Null on every other row,
   * including one whose cheapest variant is merely unmatched — that is a gap in matching, fixed on
   * the platform's own pages. */
  unpricedVariantStampId: string | null;
  /** How many of the offer's copies this row stands for. */
  copyCount: number;
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
      listingType: true,
      price: true,
      startingPrice: true,
      endsAt: true,
      priceCheckedAt: true,
      bidderCount: true,
      biddingNoticeAt: true,
      currency: true,
      state: true,
      inActiveBidding: true,
      listingDate: true,
      listingContentChangedAt: true,
      createdAt: true,
      // What publishing through Allegro's API left behind (#477), which is what decides whether the
      // header offers **Publish to Allegro** or **Activate on Allegro**.
      allegroOfferId: true,
      allegroPublishStatus: true,
      photoSides: true,
      photoPreferSingles: true,
      photoLabelLeftTemplate: true,
      photoLabelRightTemplate: true,
      collageGridMode: true,
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
          maxTitleLength: true,
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
                  certificateStatusId: true,
                  formatId: true,
                  condition: { select: { name: true } },
                  stamp: {
                    select: {
                      ...STAMP_LABEL_SELECT.stamp.select,
                      issuedYear: true,
                      colnectId: true,
                      variants: { select: VARIANT_FLAG_SELECT },
                    },
                  },
                },
              },
            },
          },
          // The sale this set left on, where it has gone (#472) — the set is sold indivisibly, so
          // there is at most one line and one sale to name.
          // `id` is what the shared listing-precondition helpers (#406) read off a set; the sale
          // itself is this screen's own.
          saleLines: { select: { id: true, sale: { select: { id: true, saleNo: true } } }, take: 1 },
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
    usesPlatformConditions(platformModule)
      ? loadColnectConditionMap(offer.collectionId)
      : new Map<string, string>(),
  ]);
  // What each copy is listed under (#616), resolved once for the screen and read by all four
  // surfaces below — the two blocker lists, the ready gate and the **On Colnect** card — so the page
  // cannot say a stamp is unmatched in one place and link its variant's catalogue page in another.
  const catalogIds = await resolveSetCatalogItemIds(
    offer.collectionId,
    offer.sets,
    platformModule,
    labeller
  );

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
    const sale = s.saleLines[0]?.sale ?? null;
    const sold = sale !== null;
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
      sale,
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

  // The photo half of the ready gate (#311), asked only where the step actually exists: an offer
  // past `preparing` has no **Mark ready** to disable, and this re-derives the whole photo plan.
  const readyPhotoBlockers = state === "preparing" ? await readOfferPhotoBlockers(offerId) : [];

  // The list's *Sold on Allegro* flag, on this offer's own screen (#505). Narrowed to this one
  // offer — the comparison is the same one the list makes, asked about a single listing — and read
  // through `unrecordedPlatformSales` rather than restated here, which is the rule the worklist and
  // the flag already share (#499).
  const platformSale =
    (await unrecordedPlatformSales(offer.collectionId, [offerId])).get(offerId) ?? null;

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
    listingType: normalizeListingType(offer.listingType),
    price: offer.price.toFixed(2),
    startingPrice: offer.startingPrice?.toFixed(2) ?? null,
    endsAt: offer.endsAt,
    priceCheckedAt: offer.priceCheckedAt,
    bidderCount: offer.bidderCount,
    biddingNoticeAt: offer.biddingNoticeAt,
    currency: offer.currency,
    baseCurrency,
    priceBase,
    state,
    needsAction: sets.some((s) => s.needsAction),
    inActiveBidding: biddingLive(offer.inActiveBidding, state),
    platformSale,
    suggestedPrice,
    suggestedUnpricedSets: offer.sets.length - valuedSets,
    sets,
    setsTotals,
    listingDate: offer.listingDate,
    // The same derivation the list row makes (#542): the stored instant, but only while the offer is
    // still up. One rule, read in both places, so the row and the screen it opens cannot disagree.
    listingOutOfDate: isListedState(state) ? offer.listingContentChangedAt : null,
    photoConfig: {
      photoSides: normalizePhotoSides(offer.photoSides),
      preferSingles: offer.photoPreferSingles,
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
              // Null is `fixed` (#413): the mode postdates the numbers, so an offer prepared before
              // it carries a complete collage group and no mode at all.
              collageGridMode: normalizeCollageGridMode(offer.collageGridMode),
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
      maxTitleLength: offer.platform.maxTitleLength,
      maxDescriptionLength: offer.platform.maxDescriptionLength,
      maxPrivateNoteLength: offer.platform.maxPrivateNoteLength,
    },
    platformModule,
    listingBlockers: listingBlockersFor(
      offer.sets,
      platformModule,
      labeller,
      conditionMap,
      catalogIds,
      state
    ),
    // The same evaluation asked as an **update** (#462). Its own field rather than a mode on the one
    // above, because the two answer about different acts and are read by two different controls: an
    // Active offer reports `not-ready` to the first — correctly, there is nothing to post — while the
    // second is asking whether the listing that exists can be corrected.
    listingUpdateBlockers: listingBlockersFor(
      offer.sets,
      platformModule,
      labeller,
      conditionMap,
      catalogIds,
      state,
      "update",
      offer.url
    ),
    // The same evaluation at the target state (#418), so the header can disable **Mark ready** with
    // the reasons rather than let the collector press it and be refused. The preconditions reuse this
    // screen's own sets and condition map — a second read would be the same answer at twice the cost;
    // the photo state (#311) is the one thing here that costs a read of its own.
    readyBlockers:
      state === "preparing"
        ? [
            ...listingBlockersFor(
              offer.sets,
              platformModule,
              labeller,
              conditionMap,
              catalogIds,
              "ready"
            ),
            ...readyPhotoBlockers,
          ]
        : [],
    platformItems: platformItemsFor(offer.sets, platformModule, labeller, conditionMap, catalogIds),
    allegroPublication:
      offer.allegroOfferId && offer.allegroPublishStatus
        ? { offerId: offer.allegroOfferId, status: offer.allegroPublishStatus }
        : null,
    // Null for every platform that is not Allegro, and cheap for one that is: the read is gated
    // inside `getAllegroOfferListingConfig` on the platform's own module marker, so a Colnect offer
    // pays nothing for a card it will never draw.
    allegroListing: await getAllegroOfferListingConfig(ownerId, offerId),
    // Gated the same way, on the platform's own marker, so only a Delcampe offer pays for it.
    delcampeListing: await getDelcampeOfferListingConfig(ownerId, offerId),
    createdAt: offer.createdAt,
  };
}

/**
 * The offer's stamps as the platform's catalogue knows them (#423), one row per `stamp × condition`
 * in the order the sets list them.
 *
 * Empty for a platform whose module does not list against a **catalogue of its own** (#493): every
 * URL below is Colnect's, this is one marketplace's catalogue rather than a general fact about an
 * offer, and a Delcampe listing has no such pages to link to. Naming *a* module is not enough
 * (#471), and neither is having a sale form: an Allegro listing is filed under a category (#488),
 * so there is no catalogue page for a stamp and no market page at a grade. It is deliberately
 * **not** gated on the preconditions, unlike the listing kit
 * (#405): the collector is checking what the market is asking, which is a question about an offer at
 * any stage and one an unmatched stamp does not spoil — that row simply carries no links, which is
 * how the gap gets noticed.
 *
 * Reads nothing of its own: the item-IDs come off the same set select the screen already loads, and
 * the grades off the condition map already read once for the whole offer (#404).
 */
function platformItemsFor(
  sets: readonly ListingSetRow[],
  platformModule: string | null,
  labeller: OfferLabeller,
  conditionMap: Map<string, string>,
  catalogIds: Map<string, ResolvedCatalogItemId>
): OfferPlatformItem[] {
  if (!usesPlatformCatalogue(platformModule)) return [];
  const rows = new Map<string, OfferPlatformItem>();
  for (const set of sets) {
    for (const { itemId, item } of orderedItems(set.items)) {
      const key = `${item.stampId} ${item.conditionId}`;
      const existing = rows.get(key);
      if (existing) {
        existing.copyCount += 1;
        continue;
      }
      // The derivation (#616) is per copy, since the cheapest variant is a fact about a
      // `condition × certificate × format`; a row is `stamp × condition`, so it reports the first
      // copy's answer — the same copy every other field on the row already comes from.
      const resolved = catalogIds.get(itemId);
      const colnectId = resolved?.catalogItemId ?? null;
      const grade = colnectGradeFor(conditionMap.get(item.conditionId) ?? "");
      const catalogNumbers = labeller.catalogNumbers(item.stamp);
      rows.set(key, {
        stampId: item.stampId,
        conditionId: item.conditionId,
        label: labeller.copy(item.stamp),
        catalogNumbers,
        stampName: item.stamp.name?.trim() || null,
        conditionName: item.condition.name,
        catalogUrl: colnectStampUrl(colnectId),
        // Only for a stamp with no page of its own: searching for one already matched would offer
        // the long way round to a link that is right there.
        searchUrl: colnectId
          ? null
          : colnectSearchUrl(
              catalogNumbers[0] ? catalogChipCopyValueFromLabel(catalogNumbers[0]) : null
            ),
        marketUrl: colnectMarketUrl(colnectId, grade?.marketSlug ?? null),
        catalogItemVariant: resolved?.sourceLabel ?? null,
        unpricedVariantStampId:
          resolved?.gap?.kind === "unpriced-variants" ? item.stampId : null,
        copyCount: 1,
      });
    }
  }
  return [...rows.values()];
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
    deliveryStates: ["delivered"],
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
  /** Which of the copies being added this offer would duplicate by **stamp × condition** (#513):
   * a *different* copy of the same stamp in the same condition is already listed here, which
   * Colnect refuses. A warning the picker shows — never a reason to disable the destination. */
  collidingItemIds: string[];
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
  // Which offers would list a stamp twice in one condition (#513). Read for every listed offer at
  // once rather than per row, and on the same states this query already narrowed to.
  const colliding = await collidingItemIds(collectionId, itemIds);

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
        collidingItemIds: colliding.get(r.id) ?? [],
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
  /** How the listing is sold (#449). A property of this listing, not of the platform — a marketplace
   * running both formats carries offers of either kind. Optional, defaulting to `fixed`: a caller
   * that says nothing is describing a quick buy, which is the only thing an offer could be before. */
  listingType?: OfferListingType;
  /** The listing's current figure — the asking price of a quick buy, the standing bid of an auction
   * (#449). Same column, same meaning to everything downstream: the live number. */
  price: string;
  /** First-offer fallback currency (#196): used only to set the platform's currency when it has
   * none yet. Ignored once the platform has a currency — the offer is locked to the platform's. */
  currency: string;
  /** What an auction opened at (#449), or null/absent — on a quick buy, and on an auction whose
   * opening figure was not noted. Storing it on a `fixed` listing would be a figure describing a
   * format this listing is not in, so the domain drops it there rather than keeping a contradiction. */
  startingPrice?: string | null;
  /** When an auction closes (#490), or null. Dropped on a quick buy for the same reason
   * `startingPrice` is: a fixed-price listing does not end of its own accord, and a date saying it
   * does would describe a format this listing is not in. On a connected platform the sync (#481)
   * keeps this current on its own — including through a marketplace's automatic relist. */
  endsAt?: Date | null;
  /** The date the listing went live (#257), or null when not recorded. Stored on create + edit. */
  listingDate: Date | null;
  /** The status to create the offer in (#257): `preparing` (default), or a live `ready` / `active`
   * when the offer lists something. Ignored by {@link updateOffer} — an existing offer's lifecycle is
   * driven by its dedicated controls, not the header form. */
  state: OfferState;
}

/**
 * Everything a header form says about how an offer is priced (#449), resolved in one place so the
 * create, duplicate and edit paths cannot disagree about any of it.
 *
 * Three decisions live here:
 *
 * - **The format.** Taken from the form, falling back to the platform's own default (#449, the
 *   `defaultStartingPrice` rule of #362: read at creation and then owned by the offer) and then to
 *   `fixed`. An edit passes no platform defaults — switching platforms must not re-describe a
 *   listing that already exists.
 * - **The opening figure**, on an auction: the form's, else the platform's default starting price.
 *   That default exists only on an auction platform, which is why there is no fallback of any kind
 *   for a quick buy — its price follows from the goods, and the two suggestions that describe the
 *   goods already answer it.
 * - **No live price is invented.** An auction's `price` is an *observation* of the bidding, so a
 *   listing nobody has bid on carries none — the opening figure is never copied into it. That is
 *   what {@link pricingReadyFor} exists for: going live asks an auction for its *starting* price,
 *   not for a bid nobody has placed.
 * - **The auction-only pair.** A `fixed` listing clears both — the opening figure describes a format
 *   this listing is not in, and a quick buy's price is the seller's own, so nothing moves it behind
 *   their back and there is nothing to have last checked. An auction dates its price, the figure on
 *   the form having just been read off the listing; an undated bid is what the auction lot's
 *   `checkedAt` (#351) exists to prevent.
 */
function resolveOfferPricing(
  input: Pick<OfferInput, "listingType" | "startingPrice">,
  price: string,
  platformDefaults?: { defaultListingType: string | null; defaultStartingPrice: string | null }
): {
  listingType: OfferListingType;
  price: string;
  startingPrice: string | null;
  priceCheckedAt: Date | null;
} {
  const listingType = normalizeListingType(
    input.listingType ?? platformDefaults?.defaultListingType
  );
  if (!isAuctionListing(listingType)) {
    return { listingType, price, startingPrice: null, priceCheckedAt: null };
  }
  const submitted = input.startingPrice ?? null;
  const startingPrice =
    submitted && hasPrice(submitted) ? submitted : (platformDefaults?.defaultStartingPrice ?? submitted);
  return {
    listingType,
    price,
    startingPrice,
    priceCheckedAt: hasPrice(price) ? new Date() : null,
  };
}

/** The figure a live-bound offer is missing (#336, #449), or null when its pricing is complete: the
 * asking price on a quick buy, the **starting** price on an auction — whose current price is an
 * observation of the bidding and so is never required. Returned rather than thrown, because each
 * call site says it in its own words and the collector must be sent to the field that fixes it. */
function missingPriceField(
  listingType: OfferListingType,
  to: OfferState,
  price: string,
  startingPrice: string | null
): "asking price" | "starting price" | null {
  if (pricingReadyFor(listingType, to, price, startingPrice)) return null;
  return isAuctionListing(listingType) ? "starting price" : "asking price";
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

  // Everything about how this listing is priced (#449): its format, the auction's opening figure and
  // the live price that follows from it — each falling back to the platform's own defaults (#362).
  // Those defaults are the *lowest* priority suggestion: a lot's suggested price (#190) and the
  // copies' catalog value (#230) both reach the form as a filled-in figure, so anything submitted
  // here already outranks them. Resolved before the live-status checks, so creating an auction
  // straight as `ready` on a house one always opens at the same figure is not rejected as unpriced.
  const pricing = resolveOfferPricing(input, input.price, platform);
  const price = pricing.price;

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
  //
  // On an auction the figure that has to exist is the **starting** price (#449): the current one is
  // an observation of the bidding, and a listing nobody has bid on has none to make.
  const missing = missingPriceField(pricing.listingType, targetState, price, pricing.startingPrice);
  if (missing) {
    throw new OfferActionBlockedError(
      "unpriced",
      `An offer can't start ${targetState} with no ${missing} — set a price first.`
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
    null,
    platform.platformModule
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
        // The whole pricing decision, resolved once above (#449): format, live price, and the
        // auction-only opening figure + check date.
        ...pricing,
        // An auction's closing time (#490), dropped on a quick buy exactly as the opening figure is:
        // a fixed-price listing has no ending of its own, so a date here would be about a format
        // this listing is not in.
        endsAt: isAuctionListing(pricing.listingType) ? (input.endsAt ?? null) : null,
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
  // An offer created **with** copies never passes through `addOfferSet`, so the category backfill
  // (#494) is repeated here for the same reason the texts are: the composition exists from the first
  // moment and the offer would otherwise sit with a blank Allegro card until something was added.
  await backfillAllegroCategory(ownerId, offerId);
  await backfillDelcampeCategory(offerId); // #609, the same question on the marketplace next door
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
  // Same pricing rules as a fresh creation (#336, #449): the clone is priced — and its format
  // chosen — for its own platform, so a blank price cannot start it prepared or live either, and an
  // auction still needs its opening figure.
  const pricing = resolveOfferPricing(input, input.price, platform);
  const missing = missingPriceField(
    pricing.listingType,
    targetState,
    pricing.price,
    pricing.startingPrice
  );
  if (missing) {
    throw new OfferActionBlockedError(
      "unpriced",
      `An offer can't start ${targetState} with no ${missing} — set a price first.`
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
    null, // as in `createOffer` (#415): the clone's own id exists only after the transaction.
    platform.platformModule
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
        // The clone is a listing on another platform and is described by its own form (#449): the
        // same composition routinely goes up as a quick buy in one place and an auction in another,
        // so the format comes from that form (or the new platform's default) rather than being
        // carried over from the source.
        ...pricing,
        endsAt: isAuctionListing(pricing.listingType) ? (input.endsAt ?? null) : null,
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
  await assertPlatform(ref.collectionId, input.platformId);
  // The same resolution creation uses (#449), minus the platform default: switching platforms on an
  // existing offer must not re-describe a listing that already exists. An auction with no current
  // figure falls back to its opening one here too, so an edit can *give* a live auction its price by
  // stating what it started at.
  const pricing = resolveOfferPricing(input, input.price);
  // The invariants the transition guard enforces (#336, #449): a ready or active offer always has a
  // price — and, being an auction, a starting price — so an edit cannot clear either back out from
  // under one.
  const missing = missingPriceField(
    pricing.listingType,
    ref.state,
    pricing.price,
    pricing.startingPrice
  );
  if (missing) {
    throw new OfferActionBlockedError("unpriced", `A ${ref.state} offer must keep an ${missing}.`);
  }
  // One difference from creation: a header save that leaves the price where it was is not an
  // observation, so it keeps the date the figure was actually last checked instead of pretending it
  // was looked at again.
  const priceMoved = pricing.price !== ref.price;
  // What this save changes about the *live* listing (#542). Read before the write and only while the
  // offer is actually up, so a form saved on a draft costs nothing extra. The platform and the URL
  // are not asked about: moving a listing to another marketplace or correcting its address is a
  // change to the record of where it is, not to what it says.
  const listedBefore = isListedState(ref.state);
  const before = listedBefore
    ? await prisma.offer.findUnique({
        where: { id: offerId },
        select: { startingPrice: true },
      })
    : null;
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      platformId: input.platformId,
      url: input.url,
      listingType: pricing.listingType,
      price: pricing.price,
      startingPrice: pricing.startingPrice,
      // A quick buy is left with no stamp at all — a "last checked" on a price nothing moves would
      // read as a fact about a format the listing is not in. On an auction the stamp is only renewed
      // when the figure actually moved; the rest of the form is not an observation of the bidding.
      ...(isAuctionListing(pricing.listingType)
        ? priceMoved
          ? { priceCheckedAt: pricing.priceCheckedAt }
          : {}
        : { priceCheckedAt: null }),
      endsAt: isAuctionListing(pricing.listingType) ? (input.endsAt ?? null) : null,
      // Listing date is editable on the header form (#257); the status is not — an existing offer's
      // lifecycle is driven by its dedicated controls, so `input.state` is ignored here.
      listingDate: input.listingDate,
    },
  });

  // The header form writes no texts, so the only question is the price — and on an auction, only the
  // *starting* one (#542): the current figure is where the bidding stands, and noting a bid is not a
  // change to the listing. A listing type switched between the two formats counts as well, since the
  // figure the entry states changes with it.
  if (
    listedBefore &&
    headerChangeIsDrift({
      listingType: pricing.listingType,
      priceChanged: priceMoved || pricing.listingType !== ref.listingType,
      startingPriceChanged:
        pricing.startingPrice !== (before?.startingPrice?.toFixed(2) ?? null) ||
        pricing.listingType !== ref.listingType,
      textChanged: false,
    })
  ) {
    await markListingContentChanged(offerId);
  }
}

export interface OfferPatch {
  platformId?: string;
  url?: string | null;
  price?: string;
  /** An auction's opening figure (#449); null clears it. Refused on a quick buy, which has no such
   * figure — a listing changes format on the header form, not by a field appearing beside it. */
  startingPrice?: string | null;
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
  const touchesFrozenField =
    patch.platformId !== undefined || patch.price !== undefined || patch.startingPrice !== undefined;
  if (isTerminalState(ref.state) && touchesFrozenField) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only and cannot be edited.`);
  }
  // A ready or active offer always keeps the figure its format states (#336, #449) — the asking
  // price of a quick buy, the starting price of an auction — so clearing that one in place is
  // refused for the same reason advancing without it is. An auction's *current* price is not that
  // figure: it is an observation of the bidding, and clearing it back to "no bids yet" is a
  // legitimate correction.
  if (patch.price !== undefined && !isAuctionListing(ref.listingType)) {
    if (requiresPrice(ref.state) && !hasPrice(patch.price)) {
      throw new OfferActionBlockedError("unpriced", `A ${ref.state} offer must keep an asking price.`);
    }
  }
  if (patch.startingPrice !== undefined && isAuctionListing(ref.listingType)) {
    if (requiresPrice(ref.state) && !(patch.startingPrice && hasPrice(patch.startingPrice))) {
      throw new OfferActionBlockedError(
        "unpriced",
        `A ${ref.state} auction must keep a starting price.`
      );
    }
  }
  // An opening figure only exists on an auction (#449): offering it on a quick buy would store a
  // fact about a format the listing is not in. Changing format is the header form's job.
  if (patch.startingPrice !== undefined && !isAuctionListing(ref.listingType)) {
    throw new OfferActionBlockedError(
      "bad-transition",
      "Only an auction listing has a starting price — change the listing type on the offer form first."
    );
  }
  if (patch.platformId !== undefined) {
    await assertPlatform(ref.collectionId, patch.platformId);
  }
  // Writing a *new* price onto an auction dates it (#449): the in-place edit is the bid refresh, and
  // `priceCheckedAt` is the whole answer to what an undated figure is worth (#351). Retyping the same
  // number is deliberately not an observation — the row is unchanged, so nothing was learned. A quick
  // buy never carries the stamp: its price is the seller's own and nothing moves it behind their back.
  const refreshesBid =
    patch.price !== undefined && isAuctionListing(ref.listingType) && patch.price !== ref.price;
  // What this patch changes about the *live* listing (#542). The previous values are read only while
  // the offer is up and only for the fields the patch actually touches, so the common in-place edits
  // — a URL, a description format — pay nothing for the question. `url`, `platformId` and
  // `descriptionFormat` are deliberately absent: the first two record *where* the listing is, and the
  // third is how this app reads the description it already holds, not what goes to the platform.
  const listedBefore = isListedState(ref.state);
  const touchesText =
    patch.name !== undefined || patch.description !== undefined || patch.privateNote !== undefined;
  const before =
    listedBefore && (touchesText || patch.startingPrice !== undefined)
      ? await prisma.offer.findUnique({
          where: { id: offerId },
          select: { name: true, description: true, privateNote: true, startingPrice: true },
        })
      : null;
  const textChanged =
    !!before &&
    ((patch.name !== undefined && patch.name !== before.name) ||
      (patch.description !== undefined && patch.description !== before.description) ||
      (patch.privateNote !== undefined && patch.privateNote !== before.privateNote));
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      ...(patch.platformId !== undefined ? { platformId: patch.platformId } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.startingPrice !== undefined ? { startingPrice: patch.startingPrice } : {}),
      ...(refreshesBid ? { priceCheckedAt: new Date() } : {}),
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

  if (
    listedBefore &&
    headerChangeIsDrift({
      listingType: ref.listingType,
      priceChanged: patch.price !== undefined && patch.price !== ref.price,
      startingPriceChanged:
        patch.startingPrice !== undefined &&
        patch.startingPrice !== (before?.startingPrice?.toFixed(2) ?? null),
      textChanged,
    })
  ) {
    await markListingContentChanged(offerId);
  }
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
      photoPreferSingles: config.preferSingles,
      photoLabelLeftTemplate: config.photoLabelLeftTemplate,
      photoLabelRightTemplate: config.photoLabelRightTemplate,
      collageGridMode: config.collage?.collageGridMode ?? null,
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
    offerId,
    platform.platformModule
  );
  const value = texts[field];
  // What the field said before, so a ↻ that reproduces the text already there is not reported as a
  // change to the live listing (#542) — which is exactly what it is on an unedited field following
  // the template. Read only while the offer is up.
  const before = isListedState(ref.state)
    ? await prisma.offer.findUnique({
        where: { id: offerId },
        select: { name: true, description: true, privateNote: true },
      })
    : null;
  await prisma.offer.update({
    where: { id: offerId },
    data: { [field]: value, [EDITED_FLAG[field]]: false },
  });
  if (before && before[field] !== value) {
    await markListingContentChanged(offerId);
  }
  return value;
}

/** The `Offer` column recording that a generated text was written by hand (#380). */
const EDITED_FLAG: Record<OfferTextField, "nameEdited" | "descriptionEdited" | "privateNoteEdited"> = {
  name: "nameEdited",
  description: "descriptionEdited",
  privateNote: "privateNoteEdited",
};

/**
 * Record that a **live** listing no longer says what this offer says (#542).
 *
 * Called from every mutation that changes what the platform would show — the composition mutations
 * below, the header where {@link headerChangeIsDrift} says the change counts, and a regenerated text.
 * Silently does nothing on an offer that is not up: a change to something never posted is just
 * composing, which is what `preparing` and `ready` are for.
 *
 * `updateMany` with `listingContentChangedAt: null` in the filter, so it stamps the **first** change
 * and leaves it alone thereafter. Two things follow from that, both wanted: the flag reads as
 * "diverging since…" rather than "last touched", which is the figure a collector triages by; and an
 * offer being worked on for ten minutes is one write, not ten.
 */
async function markListingContentChanged(offerId: string): Promise<void> {
  await prisma.offer.updateMany({
    where: {
      id: offerId,
      state: { in: [...LISTED_OFFER_STATES] },
      listingContentChangedAt: null,
    },
    data: { listingContentChangedAt: new Date() },
  });
}

/** The live listing is back in step (#542) — see {@link markOfferListingSynced} for what counts. */
async function clearListingContentChanged(offerId: string): Promise<void> {
  await prisma.offer.updateMany({
    // Filtered on the flag being set, so clearing an offer that carries none is a no-op rather than a
    // write — this runs on every publication, and most of those have nothing to clear.
    where: { id: offerId, listingContentChangedAt: { not: null } },
    data: { listingContentChangedAt: null },
  });
}

/**
 * The live listing has been brought back into step with this record (#542).
 *
 * Three callers, and they are the only three things that can honestly claim it: the Assistant's
 * update run reporting a saved edit (#462), the publication paths below, and the collector pressing
 * **Mark as up to date** — which exists because most platforms have no update flow at all, and a flag
 * with no way off it is a flag that stops being read.
 *
 * Deliberately *not* called by resuming a paused offer. A resume puts the same live entry back in
 * front of buyers; nothing about it says the entry was rewritten.
 */
export async function markOfferListingSynced(ownerId: string, offerId: string): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  await clearListingContentChanged(offerId);
}

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
    offerId,
    platform.platformModule
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
  // Marking it ready is also where the listing preconditions (#418) and the listing photos (#311)
  // are asked — see {@link readReadyBlockers} for why here and nowhere else in the lifecycle.
  if (to === "ready") {
    const blockers = await readReadyBlockers(ref.collectionId, offerId);
    if (blockers.length > 0) {
      throw new OfferActionBlockedError(
        "listing-preconditions",
        `This offer is not ready to be listed yet: ${blockers.map((b) => b.message).join(" ")}`
      );
    }
  }
  // The same two targets also need an asking price (#336): an offer with no price is not prepared,
  // and publishing one is never intentional. On an auction the figure that has to exist is the
  // **starting** price (#449) — the current one is an observation, and an auction that is up with
  // nobody bidding has none to make — so that is what is asked for, in the auction's own words.
  if (requiresPrice(to)) {
    const verb = to === "active" ? "activating" : "marking this offer ready";
    const row = await prisma.offer.findUnique({
      where: { id: offerId },
      select: { price: true, startingPrice: true },
    });
    const missing = row
      ? missingPriceField(
          ref.listingType,
          to,
          row.price.toFixed(2),
          row.startingPrice?.toFixed(2) ?? null
        )
      : "asking price";
    if (missing) {
      throw new OfferActionBlockedError("unpriced", `Set ${aOrAn(missing)} before ${verb}.`);
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
    data: {
      state: to,
      // When the listing closed (#512). Only `withdrawn` is reachable by hand — `sold` is the sale
      // flow's (#166) — and only the sweep that purges a closed offer's generated images reads it.
      ...(isTerminalState(to) ? { closedAt: new Date() } : {}),
      ...(publishing ? { listingDate: todayUtcDate() } : {}),
      // Publication is the live listing and the record agreeing by definition (#542), so an offer
      // goes up unflagged whatever it carried while being prepared. It is the **only** transition
      // that clears the flag: resuming a paused listing puts the same entry back in front of buyers
      // and rewrites nothing, so a change made during the pause is still a change nobody pushed.
      ...(publishing ? { listingContentChangedAt: null } : {}),
    },
  });

  // What the Allegro category register learns from is an offer **finished being prepared** (#494),
  // not one already listed.
  //
  // ADR-0026 §5 originally said "on a successful publish", and #477 read that literally. It is the
  // wrong moment for the way a collection is actually worked: offers are prepared in a run of ten or
  // twenty and published later, sometimes days later, so a register that only learns at publication
  // asks the same question twenty times and answers it the day after it stopped mattering. `ready` is
  // the point the collector has said what these stamps are, which is the only claim a lesson makes.
  //
  // It is still learning from a **decision, never from a draft**: an offer left in `preparing` teaches
  // nothing, and a category corrected on a `ready` offer is re-taught the next time it passes through
  // here — or corrected directly in Settings → Allegro, which exists so that a wrong lesson never
  // needs a wrong listing to fix it.
  //
  // Recorded on the transition rather than in each listing path for the reason that has not changed:
  // the API publish (#477), the Assistant's write-back (#412) and a URL pasted in by hand all reach
  // their state through here, and a lesson recorded per path is one a new path forgets.
  if (to === "ready") {
    await learnAllegroCategoryFromReadyOffer(offerId);
    // The same moment on Delcampe (#609), and the reasoning above applies to it with more force:
    // a Delcampe listing goes up as a CSV uploaded days after the offer was described, so a register
    // that learned at publication would answer the question long after it stopped mattering.
    await learnDelcampeCategoryFromReadyOffer(offerId);
  }
}

/** "an asking price" / "a starting price" — the article a missing-figure message needs. */
function aOrAn(field: string): string {
  return `${/^[aeiou]/i.test(field) ? "an" : "a"} ${field}`;
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
  await prisma.offer.update({
    where: { id: offerId },
    // Clearing the flag clears any unread notice with it (#481): the collector is answering the very
    // thing it was raised to tell them, and a notice outliving its subject is a row about nothing.
    // Marking it by hand raises none — it is not news to the person who just did it.
    data: { inActiveBidding: value, biddingNoticeAt: null },
  });
}

/**
 * Mark the "we flagged this for you" notice as seen (#481).
 *
 * Opening the offer *is* the acknowledgement — the notification points at exactly this screen, and
 * asking for a second click to confirm having read it would be a second click for nothing. Nothing
 * else changes: the flag, the bid and the bidder count stay exactly as the sync left them.
 */
export async function acknowledgeOfferBiddingNotice(
  ownerId: string,
  offerId: string
): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  await prisma.offer.updateMany({
    // `updateMany` so that acknowledging one that is already read is a no-op rather than a write:
    // the screen fires this on open, and two tabs open on one offer must not be two updates.
    where: { id: offerId, biddingNoticeAt: { not: null } },
    data: { biddingNoticeAt: null },
  });
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
 * never lists the same copy twice). Returns the valid, addable ids **in the order they were asked
 * for**.
 *
 * That order is load-bearing rather than incidental: `addOfferSetsPerCopy` numbers a set per copy
 * from this list, and `sortOrder` on `OfferSet` is canonical — it is what a buyer reads as "the
 * second lot" (#306). Returning the ids in the order `findMany` handed the rows back made that
 * position **whatever Postgres felt like**, so a stock of duplicates ticked in one order could be
 * listed in another, with nothing anywhere saying why. Filtering the caller's own list is also what
 * makes the answer deterministic between two runs on the same data, which is how CI found this. */
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
  // The caller's list leads, deduplicated: a copy named twice is one copy, and one named first is
  // listed first.
  return [...new Set(itemIds)].filter(
    (id) => validIds.has(id) && !soldIds.has(id) && !inOffer.has(id)
  );
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
  // A live listing now sells something its entry does not mention (#542) — this is the case #513 is
  // the trigger for, and the one the flag was added to catch.
  await markListingContentChanged(offerId);
  // …and, on an Allegro offer, work out what it is being listed as (#494). A backfill, never a
  // refresh: it writes only while the offer has no category, so a correction is never undone by
  // adding a set. It cannot fail this mutation — see `backfillAllegroCategory`.
  await backfillAllegroCategory(ownerId, offerId);
  await backfillDelcampeCategory(offerId); // #609, as above — an offer is on one platform, so one of
                                           // the two is always a no-op
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
  await markListingContentChanged(offerId); // #542, as in addOfferSet
  await backfillAllegroCategory(ownerId, offerId); // #494, as in addOfferSet
  await backfillDelcampeCategory(offerId); // #609, as in addOfferSet
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
  await markListingContentChanged(ref.offerId); // #542, as in addOfferSet
  await backfillAllegroCategory(ownerId, ref.offerId); // #494, as in addOfferSet
  await backfillDelcampeCategory(ref.offerId); // #609, as in addOfferSet
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
  // …and for the same reason it is drift (#542): the live entry enumerates the old order.
  await markListingContentChanged(offerId);
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
  await markListingContentChanged(ref.offerId); // #542, as in reorderOfferSets
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
  await markListingContentChanged(ref.offerId); // #542, as in reorderOfferSets
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
  // concerned (#380), and drift as far as the live listing is (#542).
  await syncGeneratedTexts(ownerId, ref.offerId);
  await markListingContentChanged(ref.offerId);
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
  // The listing lists one set fewer — the texts still following the template say so (#380), and the
  // live entry still offers it until somebody goes and takes it down (#542).
  await syncGeneratedTexts(ownerId, ref.offerId);
  await markListingContentChanged(ref.offerId);
}
