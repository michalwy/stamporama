// What the offer operations answer with, and the projections that build it (#711).
//
// **Pure, and structurally typed on purpose**, exactly as `collection-reads.ts` is and for its
// reason (`agent-api.md`, *The module layout is the Prisma-free split*): `OfferDetail` carries
// something over sixty fields, and a projection naming its type would stop being readable as a
// statement of what an agent is actually told. Everything here is a function of plain rows and
// returns plain objects — no Prisma, no `server-only` — so `pnpm test:unit` holds the decisions.
//
// The decisions worth a test live here rather than in the handlers beside them: which fields
// survive, that a price that does not exist is **absent** rather than zero, that the three pricing
// suggestions are told apart rather than merged into one number, and that nothing in the offer
// projection says anything at all about a marketplace.

import { compact, catalogLabels, copyValue } from "./collection-reads";
import type { AgentCopyValue, CatalogLabelRow, CopyValueRow } from "./collection-reads";

// ── find_unlisted_copies ─────────────────────────────────────────────────────

/**
 * One copy that is not on a listing yet.
 *
 * **It is `AgentHolding` plus the two figures a pricing decision is made on**, and the addition is
 * the whole reason this is its own shape. #710's rule was that a list row is lean because every
 * field is paid for on twenty-five of them — and #711's own bullet asks for *price suggestions for
 * an offer or a copy*, which for a copy is answered by the row rather than by a verb. That is
 * #710's own move said again: a holdings row states its own `location`, so there is no *where is
 * this copy* operation; an unlisted-copy row states its own worth, so there is no *what is this
 * copy worth* operation either. A third way of asking one question is what both avoid.
 *
 * `catalogValue` is what a published catalogue lists for this exact `condition × certificate ×
 * format`, and `marketValue` is the median of what copies like it have actually fetched (#458).
 * They answer different questions and are never merged: the catalogue is a book's opinion and the
 * market is evidence, and a collector prices against both.
 */
export interface AgentUnlistedCopy {
  readonly copyId: string;
  readonly itemNo: number;
  readonly stampId: string;
  readonly stamp?: string;
  readonly catalogNumbers: string[];
  readonly issue?: string;
  readonly issueYear?: number;
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  readonly location?: string;
  readonly locationRef?: string;
  /** `delivered`, `to_sort`, `ordered` or `in_transit`. A copy still on its way is exactly what one
   *  prepares a listing for, which is why it is here and why the row says which it is. */
  readonly deliveryState: string;
  readonly catalogValue: AgentCopyValue;
  /** The market median for this copy's stamp and grade, in the collection's base currency. Absent
   *  where no auction result answers to it — which is *no evidence*, and deliberately not a
   *  catalogue-derived stand-in (ADR-0022 §6). */
  readonly marketValue?: string;
  /** The copy is promised in an agreed trade (#639), naming it. Absent on every other copy. An
   *  offer may still be *prepared* around it — a `preparing` listing competes for nothing — and
   *  going live around it is refused, so the row says so while there is still time to compose the
   *  listing differently. */
  readonly promisedTo?: string;
}

/** What an unlisted-copy row is built from. */
export interface UnlistedCopyRow {
  readonly id: string;
  readonly itemNo: number;
  readonly stampId: string;
  readonly stampName: string | null;
  readonly catalogNumbers: readonly { readonly catalogVendorId: string; readonly number: string }[];
  readonly areaId: string | null;
  readonly issueId: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly conditionName: string;
  readonly certificateStatusName: string | null;
  readonly formatName: string | null;
  readonly locationId: string | null;
  readonly locationRef: string | null;
  readonly deliveryState: string;
  readonly promisedTo: { readonly partnerName: string; readonly tradeNo: number } | null;
  readonly value: CopyValueRow;
}

export interface UnlistedCopyContext {
  readonly catalogNumbers: readonly CatalogLabelRow[];
  readonly location: string | null;
  /** The market median, or null where nothing answers for this copy's stamp and grade. */
  readonly marketValue: string | null;
}

export function unlistedCopy(
  row: UnlistedCopyRow,
  context: UnlistedCopyContext
): AgentUnlistedCopy {
  return compact({
    copyId: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    condition: row.conditionName,
    certificate: row.certificateStatusName ?? undefined,
    format: row.formatName ?? undefined,
    location: context.location ?? undefined,
    locationRef: row.locationRef ?? undefined,
    deliveryState: row.deliveryState,
    catalogValue: copyValue(row.value),
    marketValue: context.marketValue ?? undefined,
    promisedTo: row.promisedTo
      ? `${row.promisedTo.partnerName} (trade #${row.promisedTo.tradeNo})`
      : undefined,
  });
}

// ── list_offers ──────────────────────────────────────────────────────────────

/**
 * One listing, as the offers list states it.
 *
 * **`name` and `label` travel as two fields rather than one string**, which is `offers.md`'s own
 * rule (#1023/#1024): the stored listing title and the label derived from the sets are two names
 * for one thing, and a surface printing one has to choose. A reader that composes them — the title
 * leading, the derived label beneath — is the third answer, and it is the better one wherever
 * there is room. There is room here.
 *
 * **`price` is absent rather than zero on a listing that has none.** An auction nobody has bid on
 * carries no current figure at all (#449), and `0.00` would put a bid in the record that never
 * happened. `startingPrice` is what such a listing states.
 */
export interface AgentOfferRow {
  readonly offerId: string;
  readonly offerNo: number;
  readonly name?: string;
  readonly label: string;
  readonly platform: string;
  /** `preparing`, `ready`, `active`, `paused`, `sold` or `withdrawn`. Nothing on this surface moves
   *  it: going live is the collector's act and there is no operation for it (#711). */
  readonly state: string;
  /** `fixed` — a quick buy at a stated asking price — or `auction`. */
  readonly listingType: string;
  /** The live figure: the asking price of a quick buy, the standing bid of an auction. */
  readonly price?: string;
  /** What an auction opened at. Absent on a quick buy, which has no such figure. */
  readonly startingPrice?: string;
  readonly currency: string;
  readonly setCount: number;
  readonly copyCount: number;
  readonly url?: string;
  readonly path: string;
}

export interface OfferRow {
  readonly id: string;
  readonly offerNo: number;
  readonly name: string | null;
  readonly label: string;
  readonly platformName: string;
  readonly state: string;
  readonly listingType: string;
  readonly price: string;
  readonly startingPrice: string | null;
  readonly currency: string;
  readonly setCount: number;
  readonly itemCount: number;
  readonly url: string | null;
}

/** A stored money string that stands for *no figure at all*. `"0.00"` is what an unbid auction and
 *  an unpriced draft both carry, and neither is a price somebody stated. */
export function statedAmount(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return Number(value) === 0 ? undefined : value;
}

export function offerRow(row: OfferRow, path: string): AgentOfferRow {
  return compact({
    offerId: row.id,
    offerNo: row.offerNo,
    name: row.name ?? undefined,
    label: row.label,
    platform: row.platformName,
    state: row.state,
    listingType: row.listingType,
    price: statedAmount(row.price),
    startingPrice: statedAmount(row.startingPrice),
    currency: row.currency,
    setCount: row.setCount,
    copyCount: row.itemCount,
    url: row.url ?? undefined,
    path,
  });
}

// ── get_offer ────────────────────────────────────────────────────────────────

/**
 * What a listing could be priced at, stated as the several different claims it actually is.
 *
 * **They are never merged into one number, and that is the decision.** `suggested` is what the
 * copies are worth in the catalogue, averaged per set because a buyer takes one set (#190);
 * `market` is what copies like them have fetched (#458); `platformOpening` is what this house opens
 * an auction at whatever the goods are worth (#553); `platformMinimum` is only what the
 * marketplace costs to post on (#731). Collapsing four claims of different strengths into a single
 * recommendation is exactly what would make an agent price a stamp confidently and wrongly.
 *
 * **`suggestedUnpricedSets` never travels apart from `suggested`** — `valuation.md`'s standing
 * rule. A suggestion resting on one set out of nine is not a suggestion about the listing.
 */
export interface AgentOfferPricing {
  /** The catalogue-derived asking price, in the **offer's** currency. Absent when nothing under the
   *  listing is priced, or no rate reaches the offer's currency. */
  readonly suggested?: string;
  /** Sets carrying no catalogue value at all, and so behind none of `suggested`. */
  readonly suggestedUnpricedSets: number;
  /** Sets the suggestion *was* computed over. Read it against `suggestedUnpricedSets`: the two
   *  partition the listing, and a suggestion over one set of nine says so here. */
  readonly suggestedValuedSets: number;
  /** What the catalogue says the whole listing is worth, in the collection's base currency. */
  readonly catalogueTotal?: string;
  /** What the market has actually paid for copies like these, base currency, with the count of
   *  copies no auction result answers for. Evidence rather than a book's opinion, so it is stated
   *  beside `catalogueTotal` and never instead of it. */
  readonly marketTotal?: string;
  readonly marketNoEvidenceCopies: number;
  /** What the copies cost, base currency, where that is known. */
  readonly costTotal?: string;
  /** This platform's own opening figure for an auction (#553), in the platform's currency. Absent
   *  on a quick-buy house. It outranks the figures above **on an auction** — a lot is opened below
   *  what the goods are worth on purpose — and says nothing about a quick buy. */
  readonly platformOpening?: string;
  /** The cheapest listing worth posting here once the marketplace's fees are paid (#731), in the
   *  platform's currency. Advisory only: nothing applies it, clamps to it, or refuses a price under
   *  it, and dropping deliberately to the floor is the case it exists for. */
  readonly platformMinimum?: string;
}

/** One set of a listing — what a buyer actually takes. */
export interface AgentOfferSet {
  readonly setId: string;
  readonly label: string;
  readonly title?: string;
  readonly copyIds: string[];
  readonly copyLabels: string[];
  /** This set has left on a sale through this listing. */
  readonly sold?: boolean;
}

/**
 * One listing in full.
 *
 * **What it deliberately does not carry is the marketplace.** `OfferDetail` states the Allegro
 * publication, the Delcampe category, the listing blockers, the Assistant's own handoff state and
 * the photo plan; none of it is here, because none of it is anything an agent on this surface may
 * act on — going public stays in the collector's hands (#711), and a field describing how a
 * publication would go is an invitation to try.
 */
export interface AgentOfferDetail {
  readonly offerId: string;
  readonly offerNo: number;
  readonly name?: string;
  readonly label: string;
  readonly description?: string;
  readonly privateNote?: string;
  /** `plain`, `html` or `markdown` — how the description is written (#319). */
  readonly descriptionFormat: string;
  /** The texts the collector (or an agent) has written by hand, which have therefore stopped
   *  following the listing's composition (#380). Send `set_offer_text` with no `text` to hand one
   *  back to the platform's template. */
  readonly editedTexts: string[];
  /** The texts there is a template to render — the listing's own where it carries one (#774), the
   *  marketplace's otherwise — and so the ones `set_offer_text` can render with no `text` of its
   *  own. A field absent from this list has nothing to be handed back to — which is why the
   *  collector's own ↻ is disabled there rather than clearing the field, and why the operation
   *  refuses rather than writing an empty text over a listing (#266/#267). It says nothing about
   *  whether a field was written by hand: handing an edited field back to its template is exactly
   *  what this list is for, and `editedTexts` is where that question is answered (#1146). */
  readonly templatedTexts: string[];
  readonly platform: string;
  readonly state: string;
  readonly listingType: string;
  readonly price?: string;
  readonly startingPrice?: string;
  readonly currency: string;
  readonly baseCurrency: string;
  readonly pricing: AgentOfferPricing;
  readonly sets: AgentOfferSet[];
  readonly copyCount: number;
  readonly url?: string;
  readonly path: string;
}

/** The `OfferDetail` fields this projection reads, named structurally. */
export interface OfferDetailRow {
  readonly id: string;
  readonly offerNo: number;
  readonly name: string | null;
  readonly label: string;
  readonly description: string | null;
  readonly privateNote: string | null;
  readonly descriptionFormat: string;
  readonly edited: Readonly<Record<string, boolean>>;
  readonly regeneratable: Readonly<Record<string, boolean>>;
  readonly platformName: string;
  readonly state: string;
  readonly listingType: string;
  readonly price: string;
  readonly startingPrice: string | null;
  readonly currency: string;
  readonly baseCurrency: string;
  readonly suggestedPrice: string | null;
  readonly suggestedUnpricedSets: number;
  readonly platformDefaultStartingPrice: string | null;
  readonly platformMinimumPrice: string | null;
  readonly url: string | null;
  readonly setsTotals: {
    readonly catalogTotal: string | null;
    readonly catalogValuedSets: number;
    readonly costTotal: string | null;
  };
  readonly sets: readonly {
    readonly id: string;
    readonly title: string | null;
    readonly label: string;
    readonly itemIds: readonly string[];
    readonly copyLabels: readonly string[];
    readonly sold: boolean;
    readonly holdings: {
      readonly market: {
        readonly totalBaseAmount: string;
        readonly noEvidenceCount: number;
      };
    };
  }[];
}

/**
 * The three texts a listing carries, in the spelling an agent sends and the `Offer` column behind
 * each.
 *
 * **It is on the pure side because it is a vocabulary, not a database fact**, and because both
 * halves have to agree: the name an agent *sends* to `set_offer_text` is the name it *reads back*
 * in `editedTexts` and `templatedTexts`, and the way those come to disagree is by being spelled in
 * two files. `title` rather than `name` is the agent's word throughout — a listing's title is what
 * a marketplace calls it, while `name` is what this schema calls the column.
 */
export const OFFER_TEXT_FIELDS = {
  title: "name",
  description: "description",
  private_note: "privateNote",
} as const;

export type AgentTextField = keyof typeof OFFER_TEXT_FIELDS;

const AGENT_NAME_OF_COLUMN = new Map<string, string>(
  Object.entries(OFFER_TEXT_FIELDS).map(([agent, column]) => [column, agent])
);

/** The fields a `Record<column, boolean>` answers true for, in the agent's own spelling and in a
 *  fixed order, so two reads of one listing cannot come back differently. */
function namedFields(flags: Readonly<Record<string, boolean>>): string[] {
  return Object.entries(flags)
    .filter(([, set]) => set)
    .map(([column]) => AGENT_NAME_OF_COLUMN.get(column) ?? column)
    .sort();
}

export function offerDetail(row: OfferDetailRow, path: string): AgentOfferDetail {
  // The market figure is per set on the screen, because a set is what a buyer takes; an agent asked
  // *what is this listing worth* wants the listing, so the sets are summed here. They partition the
  // listing's copies — an offer never lists a copy twice (#378) — so the parts add up exactly.
  let marketTotal = 0;
  let marketNoEvidenceCopies = 0;
  for (const set of row.sets) {
    marketTotal += Number(set.holdings.market.totalBaseAmount);
    marketNoEvidenceCopies += set.holdings.market.noEvidenceCount;
  }
  return compact({
    offerId: row.id,
    offerNo: row.offerNo,
    name: row.name ?? undefined,
    label: row.label,
    description: row.description ?? undefined,
    privateNote: row.privateNote ?? undefined,
    descriptionFormat: row.descriptionFormat,
    editedTexts: namedFields(row.edited),
    templatedTexts: namedFields(row.regeneratable),
    platform: row.platformName,
    state: row.state,
    listingType: row.listingType,
    price: statedAmount(row.price),
    startingPrice: statedAmount(row.startingPrice),
    currency: row.currency,
    baseCurrency: row.baseCurrency,
    pricing: compact({
      suggested: statedAmount(row.suggestedPrice),
      suggestedUnpricedSets: row.suggestedUnpricedSets,
      suggestedValuedSets: row.setsTotals.catalogValuedSets,
      catalogueTotal: statedAmount(row.setsTotals.catalogTotal),
      marketTotal: marketTotal === 0 ? undefined : marketTotal.toFixed(2),
      marketNoEvidenceCopies,
      costTotal: statedAmount(row.setsTotals.costTotal),
      platformOpening: statedAmount(row.platformDefaultStartingPrice),
      platformMinimum: statedAmount(row.platformMinimumPrice),
    }),
    sets: row.sets.map((set) =>
      compact({
        setId: set.id,
        label: set.label,
        title: set.title ?? undefined,
        copyIds: [...set.itemIds],
        copyLabels: [...set.copyLabels],
        sold: set.sold || undefined,
      })
    ),
    copyCount: row.sets.reduce((total, set) => total + set.itemIds.length, 0),
    url: row.url ?? undefined,
    path,
  });
}
