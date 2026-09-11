import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { countItems, listItemsPaginated } from "../../items";
import { marketKeyOf } from "../../market-value";
import { readMarketMedians } from "../../market-values";
import {
  OfferActionBlockedError,
  countOffers,
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  patchOffer,
  regenerateOfferText,
} from "../../offers";
import { OFFER_STATES, isAuctionListing, normalizeListingType } from "../../offer-rules";
import type { OfferListingType } from "../../offer-rules";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import {
  optionalBoolean,
  optionalInteger,
  optionalString,
  requiredString,
  stringList,
} from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { OFFER_TEXT_FIELDS, offerDetail, offerRow, unlistedCopy } from "../offer-reads";
import { readCollectionVocabulary } from "./vocabulary";
import { collectionPath, loadCatalogLabelling, loadCollectionHeader, loadLocationPaths } from "./reads-shared";
import type {
  AgentOfferDetail,
  AgentOfferRow,
  AgentTextField,
  AgentUnlistedCopy,
} from "../offer-reads";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Working on offers (#711) — the second agent workflow: find what is not listed, see what it is
// worth, draft a listing, price it and write its texts.
//
// ## The boundary, and why it is absence rather than a flag
//
// **The agent writes inside Stamporama and nowhere else. It never publishes to a marketplace.**
// There is no publish operation here, no state operation, and no way to reach `active` at all:
// `draft_offer` creates a `preparing` listing and nothing in this file moves it. That is not a
// switch somebody could turn on — an operation that does not exist cannot be called, and a switch
// is something that can be flipped (`agent-api.md`, *What is deliberately absent*).
//
// The asymmetry is the argument. An agent that misreads costs a minute; an agent that mispublishes
// lists a stamp at the wrong price under the collector's name, on someone else's platform, where
// undoing it is neither quick nor free. Everything here is reversible on the offer's own screen.
//
// **`tests/integration/agent-api-offers.test.ts` makes that checkable rather than asserted**: it
// enumerates `OPERATIONS` and fails on a publish-shaped name, and
// `tests/unit/agent-api-operation-boundary.test.ts` fails on any operation module reaching the
// domain functions that publish, record a listing or move a state — which is the guard that still
// works when somebody adds an operation in six months without reading this file.
//
// ## Six verbs, and what each of the issue's own bullets became
//
// | #711's bullet | here |
// | --- | --- |
// | find copies with no offer | `find_unlisted_copies` |
// | price suggestions for an offer **or a copy** | `get_offer`'s `pricing`, and every unlisted-copy row's own two figures |
// | compose a listing text through the existing machinery | `set_offer_text` with no `text` — `regenerateOfferText`, the ↻ the collector's own screen has |
// | draft an offer | `draft_offer` |
// | adjust an offer's price | `set_offer_price` |
// | edit an offer's text | `set_offer_text` with a `text` |
//
// **`list_offers` is the one verb #711 does not name, and *adjust an offer* is why.** An agent can
// only adjust a listing it can name, and `search_collection` (#710) searches stamps, issues and
// copies — nothing reaches an offer id. Without it, half of #711's verbs are callable only on an
// offer drafted in the same session.
//
// **Nothing here computes a figure or decides a rule.** Every refusal below is a domain guard's,
// every price rule is `offers.ts`'s, and every text is the template engine's. `agent-api.md` states
// it as *if you find yourself writing domain logic in an operation, stop*, and the two things this
// file did add — `countOffers` and the catalog-value band — went into `offers.ts` and `items.ts`
// beside the reads they belong with.

// ── Refusals ─────────────────────────────────────────────────────────────────

/**
 * Turn a domain refusal into one an agent can act on.
 *
 * **`invalid_request` rather than a new code.** #706's code set is closed and each code maps to a
 * status; a domain guard refusing is the request being wrong about the state of the collection,
 * which is what a 400 says, and the sentence is the domain's own — written for a person, which is
 * exactly what an agent reads best. Adding a code for it would be a decision about the shared error
 * vocabulary taken inside one issue's handlers.
 *
 * `OfferActionBlockedError.reason` is deliberately **not** relayed as a machine field. It is this
 * app's own enumeration, it is not part of the `/api/v1` contract, and publishing it would be a
 * second vocabulary an agent would start branching on and `/api/v2` would have to keep.
 */
async function refusingDomainGuards<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OfferActionBlockedError) throw invalidRequest(error.message);
    throw error;
  }
}

/**
 * The offer this call is about, proved to be in the **token's collection**.
 *
 * Scoped by collection as well as by owner, which is #710's rule and not belt-and-braces: a token
 * is pinned to one collection and a collector routinely owns several, so *the owner's offer* is the
 * wrong question. `assertOfferOwner` inside `offers.ts` asks the owner's — correctly, for a screen
 * that knows its collection from the URL — and throws a plain `Error`, which would reach an agent
 * as a bare `internal_error` saying nothing it could act on.
 */
async function assertOffer(
  context: OperationContext,
  offerId: string
): Promise<{ offerNo: number; listingType: OfferListingType }> {
  const offer = await prisma.offer.findFirst({
    where: {
      id: offerId,
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
    },
    // The two facts `OfferDetail` does not carry and every operation below wants: the listing's
    // short per-collection number (#416), which is what a collector calls an offer by, and its
    // format, which decides *which* price column the seller's figure goes in.
    select: { offerNo: true, listingType: true },
  });
  if (!offer) {
    throw notFound(
      `No offer with id "${offerId}" is in this token's collection. Use \`list_offers\` to find the right id.`
    );
  }
  return { offerNo: offer.offerNo, listingType: normalizeListingType(offer.listingType) };
}

// ── find_unlisted_copies ─────────────────────────────────────────────────────

const UNLISTED_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "platform",
    in: "query",
    type: "string",
    required: true,
    description:
      "The marketplace the copies would be listed on. Takes the platform's name from `get_collection_vocabulary` or its id. Required, because *unlisted* is a question about a particular marketplace: a copy already sold on one is routinely still worth listing on another.",
  },
  {
    name: "area",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to copies whose stamp sits in this collecting area, and in every area nested under it. Takes the area's name from `get_collection_vocabulary` or its id.",
  },
  {
    name: "year",
    in: "query",
    type: "integer",
    required: false,
    description: "Restrict to copies whose stamp was issued in this year.",
  },
  {
    name: "condition",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to copies in this grade. Takes the condition's name or abbreviation from `get_collection_vocabulary` (`MNH` works) or its id.",
  },
  {
    name: "min_catalogue_value",
    in: "query",
    type: "integer",
    required: false,
    description:
      "Restrict to copies the catalogue prices at this much or more, in the collection's base currency. A copy with no catalogue value at all is outside every band — it is not known to be worth this.",
  },
  {
    name: "max_catalogue_value",
    in: "query",
    type: "integer",
    required: false,
    description:
      "Restrict to copies the catalogue prices at this much or less, in the collection's base currency. Use it with `min_catalogue_value` to ask for a band; a copy with no catalogue value is outside it either way.",
  },
];

export interface AgentUnlistedCopiesResponse extends ListResponse<AgentUnlistedCopy> {
  /** What every `marketValue` on these rows is denominated in. The `catalogValue` states its own. */
  readonly baseCurrency: string;
}

export async function readUnlistedCopies(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentUnlistedCopiesResponse> {
  const vocabulary = await readCollectionVocabulary(context);
  const platformId = resolveVocabularyValue(requiredString(params, "platform"), vocabulary.platforms, {
    vocabulary: "platform",
    parameter: "platform",
  });
  const area = optionalString(params, "area");
  const condition = optionalString(params, "condition");
  const year = optionalInteger(params, "year");
  const min = optionalInteger(params, "min_catalogue_value");
  const max = optionalInteger(params, "max_catalogue_value");
  if (min !== null && max !== null && min > max) {
    throw invalidRequest(
      '"min_catalogue_value" is above "max_catalogue_value", so no copy could be inside the band. Swap them and retry.'
    );
  }

  const filters = {
    // #259's own worklist, whole: for sale, no non-terminal offer on this platform, nothing
    // committed by a live bid elsewhere, nothing that never arrived, and nothing the collector has
    // already ruled out for this platform (#506). Every one of those clauses is a reason a copy
    // cannot be listed here, which is exactly the question being asked.
    notOfferedPlatformId: platformId,
    // A copy that has **left** — sold on a sale line, or given away on a closed trade (#644) —
    // passes the clause above, because the offer it left on is terminal. It is not unlisted; it is
    // gone.
    excludeGone: true,
    ...(year !== null ? { year } : {}),
    ...(min !== null ? { catalogValueMin: min } : {}),
    ...(max !== null ? { catalogValueMax: max } : {}),
    ...(condition !== null
      ? {
          conditionIds: [
            resolveVocabularyValue(condition, vocabulary.conditions, {
              vocabulary: "condition",
              parameter: "condition",
            }),
          ],
        }
      : {}),
    ...(area !== null
      ? {
          areaIds: await areaSubtreeIds(
            context.collectionId,
            resolveVocabularyValue(area, vocabulary.areas, { vocabulary: "area", parameter: "area" })
          ),
        }
      : {}),
  };

  const window = parseListWindow(params);
  const [page, total, header, labelling, locations] = await Promise.all([
    listItemsPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // The match count and never `items.length` (#706) — a total derived from its own page always
    // claims to be complete.
    countItems(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
    loadCatalogLabelling(context.collectionId),
    loadLocationPaths(context.collectionId),
  ]);

  // The one figure a copy row cannot carry off its own record (#458). Read once for the page over
  // the deduplicated stamps, which is `summarizeHoldings`' own arrangement: a page routinely holds
  // several copies of one stamp, and a key with no datapoints is simply absent — *no evidence*,
  // never a zero (ADR-0022 §6).
  const medians = await readMarketMedians(context.collectionId, [
    ...new Set(page.items.map((copy) => copy.stampId)),
  ]);

  return {
    ...listResponse(
      page.items.map((copy) =>
        unlistedCopy(copy, {
          catalogNumbers: labelling.labelFor(copy.areaId, copy.issueId, copy.catalogNumbers),
          location: locations.pathFor(copy.locationId),
          marketValue:
            medians.get(
              marketKeyOf({
                stampId: copy.stampId,
                conditionId: copy.conditionId,
                certificateStatusId: copy.certificateStatusId,
                formatId: copy.formatId,
              })
            )?.toFixed(2) ?? null,
        })
      ),
      total,
      window
    ),
    baseCurrency: header.baseCurrency,
  };
}

export const findUnlistedCopiesOperation: Operation = {
  name: "find_unlisted_copies",
  method: "GET",
  path: "/copies/unlisted",
  description:
    "Copies that are for sale and not yet on a listing on this marketplace — the starting point for building one. Narrow it to an area, a year, a grade or a band of catalogue value. Every row states what the catalogue prices the copy at and what the market has actually paid for copies like it, so what to ask for is answered by the row rather than by a second call.",
  writes: false,
  parameters: UNLISTED_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The copies still to be listed on the named marketplace, oldest in the collection first. Unlisted means: for sale, in no open listing on this platform, not committed by a bid anywhere, in hand or on its way, and not one the collector has ruled out for this platform. `catalogValue` is a book's opinion and `marketValue` is evidence from auction results — they answer different questions, so both are given and neither is a recommendation; a copy with no auction result behind it carries no `marketValue` at all rather than a stand-in. A copy carrying `promisedTo` is spoken for in an agreed trade: a listing may be prepared around it, and it cannot go live while the trade stands.",
  },
  handler: async (context, params) => readUnlistedCopies(context, params),
};

// ── list_offers ──────────────────────────────────────────────────────────────

const LIST_OFFERS_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "platform",
    in: "query",
    type: "string",
    required: false,
    description:
      "Restrict to listings on this marketplace. Takes the platform's name from `get_collection_vocabulary` or its id.",
  },
  {
    name: "state",
    in: "query",
    type: "string[]",
    required: false,
    description:
      "Restrict to listings in these states. `preparing` is a draft, `ready` one assembled and waiting to be posted, `active` one that is up, `paused` one taken down temporarily, and `sold` / `withdrawn` are closed. Closed listings are left out unless asked for by name.",
    values: OFFER_STATES,
  },
  {
    name: "search",
    in: "query",
    type: "string",
    required: false,
    description:
      "Free text matched against the listing's title, the catalogue numbers and filing refs of the copies it holds, its offer number and its URL.",
  },
];

export async function readOffers(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentOfferRow>> {
  const states = stringList(params, "state");
  const platform = optionalString(params, "platform");
  const search = optionalString(params, "search");
  const vocabulary = platform !== null ? await readCollectionVocabulary(context) : null;

  const filters = {
    ...(states.length > 0 ? { states: [...states] as never } : {}),
    ...(search !== null ? { search } : {}),
    ...(platform !== null && vocabulary
      ? {
          platformId: resolveVocabularyValue(platform, vocabulary.platforms, {
            vocabulary: "platform",
            parameter: "platform",
          }),
        }
      : {}),
  };

  const window = parseListWindow(params);
  const [page, total, header] = await Promise.all([
    listOffersPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    countOffers(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
  ]);

  return listResponse(
    page.items.map((row) =>
      offerRow(row, collectionPath(header, `/offers/${encodeURIComponent(row.id)}`))
    ),
    total,
    window
  );
}

export const listOffersOperation: Operation = {
  name: "list_offers",
  method: "GET",
  path: "/offers",
  description:
    "The listings in this collection, newest first — narrowed to a marketplace, to one or more lifecycle states, or to a piece of text. This is how an offer id is found before adjusting one; `get_offer` then states any of them in full.",
  writes: false,
  parameters: LIST_OFFERS_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The listings matching the filters. `name` is the title written on the listing and `label` is the one derived from the stamps it holds — they are two names for one thing, so print the title where there is one and the label otherwise. `price` is the live figure: what a quick buy asks, or what an auction has been bid up to; it is **absent** on a listing nobody has priced and on an auction nobody has bid on, where `startingPrice` is the figure the seller stated. Closed listings are absent unless `state` names one.",
  },
  handler: async (context, params) => readOffers(context, params),
};

// ── get_offer ────────────────────────────────────────────────────────────────

const OFFER_ID_PARAMETER: ParameterSpec = {
  name: "offerId",
  in: "path",
  type: "string",
  required: true,
  description: "The listing's id, from `list_offers` or from `draft_offer`.",
};

export async function readOffer(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentOfferDetail> {
  const offerId = requiredString(params, "offerId");
  const { offerNo } = await assertOffer(context, offerId);
  const [detail, header] = await Promise.all([
    getOfferDetail(context.ownerId, offerId),
    loadCollectionHeader(context),
  ]);
  if (!detail) {
    throw notFound(
      `No offer with id "${offerId}" is in this token's collection. Use \`list_offers\` to find the right id.`
    );
  }
  return offerDetail(
    { ...detail, offerNo },
    collectionPath(header, `/offers/${encodeURIComponent(offerId)}`)
  );
}

export const getOfferOperation: Operation = {
  name: "get_offer",
  method: "GET",
  path: "/offers/{offerId}",
  description:
    "One listing in full: its texts, its sets, what it is priced at, and — in `pricing` — what it could be priced at. This is the price-suggestion call for an offer: the catalogue's figure per set, what the market has paid, what the marketplace opens auctions at and what it costs to post on, each stated separately because they are claims of different strengths.",
  writes: false,
  parameters: [OFFER_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "The listing. `pricing.suggested` is the catalogue value averaged **per set**, in the listing's own currency, because a buyer takes one set — read it against `suggestedValuedSets` and `suggestedUnpricedSets`, which partition the listing: a suggestion resting on one set of nine is not a suggestion about the listing. `pricing.marketTotal` is evidence from auction results and `pricing.catalogueTotal` a book's opinion; neither is the other's substitute. `pricing.platformOpening` outranks both **on an auction**, a lot being opened below what the goods are worth on purpose, and `pricing.platformMinimum` is only what the marketplace costs to post on. `editedTexts` names the texts that were written by hand and have therefore stopped following the listing's composition. Nothing here says how the listing would be published, because nothing on this surface publishes.",
  },
  handler: async (context, params) => readOffer(context, params),
};

// ── draft_offer ──────────────────────────────────────────────────────────────

const DRAFT_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "platform",
    in: "body",
    type: "string",
    required: true,
    description:
      "The marketplace to draft the listing for. Takes the platform's name from `get_collection_vocabulary` or its id. It decides the listing's currency, which is locked to the platform's and cannot be stated separately.",
  },
  {
    name: "copy_ids",
    in: "body",
    type: "string[]",
    required: true,
    description:
      "The copies to put on the listing, from `find_unlisted_copies`. A copy that has already sold, or that cannot be listed here, is refused by name rather than dropped quietly.",
  },
  {
    name: "one_set_per_copy",
    in: "body",
    type: "boolean",
    required: false,
    description:
      "How the copies are packaged. Left out, they become **one set** — a group sold together, which is what a series is. Set it to true for a stock of duplicates, where each copy is its own set and the listing offers the same thing several times over.",
  },
];

export async function draftOffer(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentOfferDetail> {
  const vocabulary = await readCollectionVocabulary(context);
  const platformId = resolveVocabularyValue(requiredString(params, "platform"), vocabulary.platforms, {
    vocabulary: "platform",
    parameter: "platform",
  });
  const copyIds = stringList(params, "copy_ids");
  if (copyIds.length === 0) {
    throw invalidRequest(
      '"copy_ids" is empty. A listing is drafted around the copies it offers — get some from `find_unlisted_copies` and retry.'
    );
  }

  const offerId = await refusingDomainGuards(() =>
    createOffer(
      context.ownerId,
      context.collectionId,
      {
        platformId,
        url: null,
        // No price yet, spelled the way the offer form spells one: *at creation you rarely know the
        // asking price — it follows from the copies you add*. The draft is the composition, and what
        // it should cost is a separate question the agent asks `get_offer` and answers with
        // `set_offer_price`, which is where the format's rule about *which* figure the seller states
        // lives. A platform that always opens an auction at the same figure still seeds one here
        // (#553), because the seed is the domain's and outranks a blank submission.
        price: "0.00",
        // Only ever consulted on a platform that has no currency of its own yet (#196), which is
        // the collection's base currency and the one answer that cannot be wrong.
        currency: "",
        listingDate: null,
        // **`preparing`, always, and there is no parameter for it.** `ready` and `active` are the
        // collector's to reach: `active` is a live claim on the copies and `ready` says the listing
        // is assembled and about to be posted. This is the boundary as absence rather than as a
        // flag — there is nothing here to set.
        state: "preparing",
      },
      {
        seedItemIds: [...copyIds],
        ...(optionalBoolean(params, "one_set_per_copy") === true ? { seedPerCopy: true } : {}),
      }
    )
  );

  // The draft is returned in full rather than as a bare id: its texts were generated from the
  // platform's template on the way in (#209/#266), which is the *titled* half of #711's own
  // criterion, and an agent that had to call `get_offer` to see them would be paying a round trip
  // for something already in hand.
  return readOffer(context, Object.freeze({ offerId }));
}

export const draftOfferOperation: Operation = {
  name: "draft_offer",
  method: "POST",
  path: "/offers",
  description:
    "Start a listing on a marketplace around some copies. It is created as a **draft** — nothing is posted anywhere, and this surface has no way to post it; going public stays with the collector. Its title and description are written from the marketplace's own templates on the way in, so the draft comes back already named. Price it with `set_offer_price` and reword it with `set_offer_text`.",
  writes: true,
  parameters: DRAFT_PARAMETERS,
  result: {
    kind: "object",
    description:
      "The new draft, in `get_offer`'s shape, so its `pricing` block is there to price it from immediately. Its state is `preparing` and no operation on this surface can move it. The listing's currency is the marketplace's and is not stated separately.",
  },
  handler: async (context, params) => draftOffer(context, params),
};

// ── set_offer_price ──────────────────────────────────────────────────────────

export async function setOfferPrice(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentOfferDetail> {
  const offerId = requiredString(params, "offerId");
  const { listingType } = await assertOffer(context, offerId);
  const price = requiredString(params, "price");
  if (!/^\d+(\.\d{1,2})?$/.test(price)) {
    throw invalidRequest(
      `"${price}" is not a price. Send an amount with at most two decimal places, in the listing's own currency — \`get_offer\` states which that is.`
    );
  }

  // **The figure the seller *states*, and the format decides which column that is** — the asking
  // price of a quick buy, the **starting** price of an auction. It is the app's own rule said once
  // more rather than a new one (`offers.md`, #449/#731): an auction's `price` is where the bidding
  // has got to, an observation of what buyers did, and writing a number into it would put a bid in
  // the record that nobody placed.
  await refusingDomainGuards(() =>
    patchOffer(
      context.ownerId,
      offerId,
      isAuctionListing(listingType) ? { startingPrice: price } : { price }
    )
  );
  return readOffer(context, Object.freeze({ offerId }));
}

export const setOfferPriceOperation: Operation = {
  name: "set_offer_price",
  method: "PATCH",
  path: "/offers/{offerId}/price",
  description:
    "Set what the seller is asking for a listing, in the listing's own currency. On a quick buy that is the asking price; on an auction it is the **opening** price, because the auction's live figure is what buyers have bid and is not the seller's to write. `get_offer` states what the copies are worth first.",
  writes: true,
  parameters: [
    OFFER_ID_PARAMETER,
    {
      name: "price",
      in: "body",
      type: "string",
      required: true,
      description:
        "The amount, with at most two decimal places, in the listing's own currency — which is the marketplace's and is stated by `get_offer`. Send it as text so nothing is lost rounding it.",
    },
  ],
  result: {
    kind: "object",
    description: "The listing as it now stands, in `get_offer`'s shape.",
  },
  handler: async (context, params) => setOfferPrice(context, params),
};

// ── set_offer_text ───────────────────────────────────────────────────────────

export async function setOfferText(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentOfferDetail> {
  const offerId = requiredString(params, "offerId");
  await assertOffer(context, offerId);
  const field = requiredString(params, "field") as AgentTextField;
  const column = OFFER_TEXT_FIELDS[field];
  const text = optionalString(params, "text");

  if (text === null) {
    // **No `text` hands the field back to the marketplace's template and renders it now.** This is
    // `regenerateOfferText` — the ↻ on the collector's own screen, which `offers.md` states as
    // *literally "hand this back to the template"* — and it is how a text written by hand is
    // undone. It is the same call every composition change already makes, so nothing here is a
    // second text path: #711's *compose a listing text through the existing machinery* is this
    // branch, and its *edit an offer's text* is the other one.
    //
    // **A field with no template to render from is refused rather than rendered**, and this is the
    // one guard the domain does not make for itself: `regenerateOfferText` writes what the generator
    // produced, which over no template is null, so calling it there would **empty** the field. The
    // collector's own ↻ is *disabled* in that case rather than refused — off
    // `OfferDetail.regeneratable`, which is the same answer this reads, so the two surfaces cannot
    // come to disagree about which fields are the template's (#266/#267). #273's rule on the wire:
    // a control that cannot act says why. **The listing's own template counts** (#774): a bulk lot
    // carries one where its marketplace has none, and reading the marketplace's alone refused a
    // render that would have worked (#1146).
    const before = await getOfferDetail(context.ownerId, offerId);
    if (!before) {
      throw notFound(
        `No offer with id "${offerId}" is in this token's collection. Use \`list_offers\` to find the right id.`
      );
    }
    if (!before.regeneratable[column]) {
      throw invalidRequest(
        `There is no template for the ${field.replace("_", " ")} on this listing or on ${before.platformName}, so there is nothing to render. Send the wording as "text", or ask the collector to set a template for this platform.`
      );
    }
    await refusingDomainGuards(() => regenerateOfferText(context.ownerId, offerId, column));
  } else {
    // A text sent by hand takes the field **off** the template (#380): from that moment the wording
    // is the writer's and a composition change re-renders the others around it. That is what
    // `get_offer`'s `editedTexts` reports, and it is why undoing is a call rather than a guess.
    await refusingDomainGuards(() =>
      patchOffer(context.ownerId, offerId, { [column]: text })
    );
  }
  return readOffer(context, Object.freeze({ offerId }));
}

export const setOfferTextOperation: Operation = {
  name: "set_offer_text",
  method: "PATCH",
  path: "/offers/{offerId}/text",
  description:
    "Write one of a listing's texts — its title, its public description, or the private note only the seller sees. Send `text` to write particular wording; that text then stops following the listing's composition, which is what `get_offer`'s `editedTexts` reports. Omit `text` to hand the field back to the marketplace's own template and render it from the copies the listing currently holds, which is how wording written by hand is undone.",
  writes: true,
  parameters: [
    OFFER_ID_PARAMETER,
    {
      name: "field",
      in: "body",
      type: "string",
      required: true,
      description: "Which text to set.",
      values: Object.keys(OFFER_TEXT_FIELDS),
    },
    {
      name: "text",
      in: "body",
      type: "string",
      required: false,
      description:
        "The wording to write. Leave it out to render the field from the marketplace's template instead. Nothing is ever shortened to fit — a marketplace that caps a text refuses the whole thing, and `get_collection_vocabulary` is not where those caps live; the listing's own screen counts them.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The listing as it now stands, in `get_offer`'s shape, so the text that was actually written — or rendered — can be read back rather than assumed. A field with no template to render from — neither the listing's own nor the marketplace's — renders as nothing and keeps what it had.",
  },
  handler: async (context, params) => setOfferText(context, params),
};
