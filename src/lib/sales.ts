import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getOrFetchRate } from "./exchange-rates";
import { type OfferState, isOfferState } from "./offer-rules";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { isSellableOfferState } from "./sale-rules";
import { distributeSaleShared, type SaleLineInput } from "./sale-allocation";
import { sortSetItems } from "./offer-set-order";
import {
  allocateEntityNumber,
  listItemsPaginated,
  valuateItemsByIds,
  type ItemListItem,
} from "./items";
import { attributeLineToPurchase } from "./purchase-return";
import { resolveShippingMethodForPlatform } from "./shipping-methods";
import { markListingContentChanged } from "./offer-listing-sync";
import { assertCarrierInCollection } from "./carriers";
import { buildTrackingUrl } from "./tracking-rules";
import { readShareAddress, type ShareAddress } from "./share-address";

// Server-side domain logic for the **sale transaction flow** (ADR-0013, supersedes ADR-0012 §5;
// §4/§6 carry over). A `Sale` records that one or more `Offer`s sold on a single platform, in a
// single currency, on one date (the FX-freeze date). Each `SaleLine` is a whole `OfferSet` that
// left — the atomic sellable unit — carrying its exact physical `Item`s via `SaleLineItem`.
//
// Only `Offer.state → sold` is a stored side effect (when every set of an offer has sold through
// it). "Item unavailable" and "set sold" are **derived** from the `sale_line_item` join, so
// recording the sale is all it takes to retire the copies. The pure allocation engine
// (`sale-allocation.ts`, #163) is fed on read by `getSaleDetail`.
//
// This module owns: the sellable-offer/set picker, create / delete a sale, and the paginated list
// + detail read models. Whole-set integrity — a series never breaks apart — is enforced by
// requiring a line's items to be the full current copy set of its set; the DB-level unique on
// `sale_line_item.itemId` is the no-double-sale backstop. All access is owner-scoped.

// ── Errors ────────────────────────────────────────────────────────────────

export type SaleBlockReason =
  | "no-platform"
  | "no-currency"
  | "currency-mismatch"
  | "empty"
  | "bad-offer"
  | "bad-set"
  | "already-sold"
  /** Choosing which set left (#697) on a line whose offer is gone — there is nothing to choose
   *  among. */
  | "no-offer";

/** Raised when a sale action is refused by a domain guard. `message` is user-facing; the server
 * action maps it to an `{ status: "error" }` response. */
export class SaleActionBlockedError extends Error {
  readonly reason: SaleBlockReason;
  constructor(reason: SaleBlockReason, message: string) {
    super(message);
    this.name = "SaleActionBlockedError";
    this.reason = reason;
  }
}

// ── Fulfillment status (#191) ────────────────────────────────────────────────
// The token set / order / validator live in the pure `./sale-status` module (no `server-only`), so
// client UI can share them; re-exported here for existing server-side importers.
export { SALE_STATUS_ORDER, isSaleStatus, type SaleStatus } from "./sale-status";
import { isSaleStatus, type SaleStatus } from "./sale-status";

// ── Ownership helpers ───────────────────────────────────────────────────────

/** Verify collection ownership and return its base currency (needed to freeze the FX rate). */
async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<{ baseCurrency: string }> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, baseCurrency: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  return { baseCurrency: col.baseCurrency };
}

async function assertPlatform(
  collectionId: string,
  platformId: string
): Promise<{ platformCurrency: string | null }> {
  const contact = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: { platformCurrency: true },
  });
  if (!contact) {
    throw new SaleActionBlockedError("no-platform", "Choose a platform this sale happened on.");
  }
  return { platformCurrency: contact.platformCurrency };
}

/**
 * The platform's fixed currency (#196): every sale routed to a platform inherits and locks it.
 * When the platform already has a currency it wins. When it has none, this is the first offer/sale
 * on the platform — `fallback` (chosen inline on the sale form) is written to the platform and
 * returned. Throws `no-currency` when unset and no fallback is given.
 */
async function resolvePlatformCurrency(
  platformId: string,
  existing: string | null,
  fallback: string | null
): Promise<string> {
  if (existing) return existing;
  const first = fallback?.trim();
  if (!first) {
    throw new SaleActionBlockedError(
      "no-currency",
      "Set this platform's currency before recording a sale on it."
    );
  }
  await prisma.contact.update({
    where: { id: platformId },
    data: { platformCurrency: first },
  });
  return first;
}

/** Verify an optional buyer contact exists in the collection and carries the `buyer` role. A
 * null buyer (unknown/anonymous) is allowed. */
async function assertBuyer(collectionId: string, buyerId: string | null): Promise<void> {
  if (!buyerId) return;
  const contact = await prisma.contact.findFirst({
    where: { id: buyerId, collectionId, buyer: true },
    select: { id: true },
  });
  if (!contact) {
    throw new SaleActionBlockedError("no-platform", "That buyer is not a contact in this collection.");
  }
}

// ── Labels ────────────────────────────────────────────────────────────────

/** An offer set's copies in effective order (#306): hand-corrected positions first, then catalog
 * order. Shared by the sellable-offer expansion and the sale detail's set labels, so a set reads
 * the same here as it does on the offer screen. */
function orderedSetItems<
  T extends { itemId: string; sortOrder: number | null; item: { stamp: { primaryCatalogSortKey: number | null } } },
>(items: readonly T[]): T[] {
  const byId = new Map(items.map((li) => [li.itemId, li]));
  return sortSetItems(
    items.map((li) => ({
      itemId: li.itemId,
      sortOrder: li.sortOrder,
      catalogSortKey: li.item.stamp.primaryCatalogSortKey,
    }))
  ).map((r) => byId.get(r.itemId)!);
}

/** Item ids already retired on a sale line, from a candidate set (no-double-sale).
 *
 *  Exported since #700, for the listing kit: "which of these copies have gone" is one question, and
 *  the kit asks it to say how many of a listing are left to buy. A second spelling of it is how the
 *  sale picker and the form the collector types into come to disagree about the same offer. */
export async function soldItemIds(itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await prisma.saleLineItem.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
}

// ── Sellable-offer picker ───────────────────────────────────────────────────

/** One whole sellable set inside an offer — it sells atomically (all its copies leave together, a
 * series never breaks apart). */
export interface SaleSetOption {
  /** The offer set id; becomes `SaleLine.offerSetId`. */
  offerSetId: string;
  label: string;
  /** Every physical copy that leaves when this set sells (whole-set integrity). */
  itemIds: string[];
  itemLabels: string[];
}

export interface SellableOffer {
  offerId: string;
  platformId: string;
  platformName: string;
  offerLabel: string;
  /** Asking price + currency, used to pre-fill line prices when the sale is in that currency. */
  price: string;
  currency: string;
  state: OfferState;
  /** The sets still available to sell (fully-sold sets are dropped). Always ≥ 1. */
  sets: SaleSetOption[];
}

/** Explicit set order (#306); `id` keeps equal positions stable. */
const OFFER_SETS_ORDER_BY: Prisma.OfferSetOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { id: "asc" },
];

const SELLABLE_OFFER_SELECT = {
  id: true,
  platformId: true,
  price: true,
  currency: true,
  state: true,
  createdAt: true,
  platform: { select: { name: true } },
  sets: {
    orderBy: OFFER_SETS_ORDER_BY,
    select: {
      id: true,
      title: true,
      items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
    },
  },
} as const;

/**
 * Offers that can be recorded as sold (ADR-0013): `active` or `paused` offers in the collection,
 * optionally on one `platformId`, each expanded into its still-available sets. A set whose copies
 * have already left on an earlier sale is dropped, and an offer with no available set is omitted
 * entirely. Newest offer first.
 */
export async function listSellableOffers(
  ownerId: string,
  collectionId: string,
  opts: { platformId?: string } = {}
): Promise<SellableOffer[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const rows = await prisma.offer.findMany({
    where: {
      collectionId,
      state: { in: [...(["active", "paused"] as const)] },
      ...(opts.platformId ? { platformId: opts.platformId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: SELLABLE_OFFER_SELECT,
  });

  // Batch the sold-copy lookup across every candidate copy in one query.
  const allItemIds = rows.flatMap((r) => r.sets.flatMap((s) => s.items.map((li) => li.itemId)));
  const sold = await soldItemIds([...new Set(allItemIds)]);

  const labeller = await makeOfferLabeller(collectionId);
  const offers: SellableOffer[] = [];
  for (const r of rows) {
    const sets: SaleSetOption[] = [];
    for (const s of r.sets) {
      // A set is available only when it holds ≥1 copy and none has already sold — a set is
      // atomic, so a single already-sold copy retires the whole set.
      if (s.items.length === 0 || s.items.some((li) => sold.has(li.itemId))) continue;
      const items = orderedSetItems(s.items);
      const itemLabels = items.map((li) => labeller.copy(li.item.stamp));
      sets.push({
        offerSetId: s.id,
        label: labeller.set(s),
        itemIds: items.map((li) => li.itemId),
        itemLabels,
      });
    }
    if (sets.length === 0) continue;

    offers.push({
      offerId: r.id,
      platformId: r.platformId,
      platformName: r.platform.name,
      offerLabel: labeller.offer(r.sets),
      price: Number(r.price).toFixed(2),
      currency: r.currency,
      state: (isOfferState(r.state) ? r.state : "active") as OfferState,
      sets,
    });
  }
  return offers;
}

/** Every enriched copy across the platform's sellable offers, for the picker's expandable set
 * details (so the collector sees exactly what each set contains). Bounded by what's listed on the
 * platform; loaded in one query and grouped by set client-side. */
export async function listSellableCopies(
  ownerId: string,
  collectionId: string,
  opts: { platformId?: string } = {}
): Promise<ItemListItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const offers = await prisma.offer.findMany({
    where: {
      collectionId,
      state: { in: [...(["active", "paused"] as const)] },
      ...(opts.platformId ? { platformId: opts.platformId } : {}),
    },
    select: { sets: { select: { items: { select: { itemId: true } } } } },
  });
  const ids = [...new Set(offers.flatMap((o) => o.sets.flatMap((s) => s.items.map((i) => i.itemId))))];
  if (ids.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, collectionId, { ids, pageSize: ids.length });
  return items;
}

// ── Header create / update ────────────────────────────────────────────────

export interface SaleHeaderInput {
  platformId: string;
  /** The buyer contact (buyer role), or null when unknown/anonymous. */
  buyerId: string | null;
  /** The external system's transaction / order number, or null. */
  externalRef: string | null;
  /** Link to the transaction/order page on the marketplace (#292), or null. Trimmed, not validated
   * — the offer link's rule (`normalizeUrl`). */
  transactionUrl: string | null;
  soldAt: Date;
  currency: string;
  /** Buyer-paid handling (+) and platform commission (−) are known at sale time, so they live on
   * the header. My actual shipping (−) is learned later and set on the detail screen. */
  buyerHandling: string | null;
  /** The total the buyer paid, when it is the anchor instead of handling (#205). Mutually exclusive
   * with `buyerHandling` — at most one is non-null; the other is stored null. */
  buyerPaidTotal: string | null;
  commission: string | null;
  /** How it was sent and what that cost (#468/#206), when the caller asked. Omitted (or null)
   * leaves a sale's existing shipping exactly as it is — which is what an edit that never showed
   * the fields must do, and the state a sale recorded by a sync (#467) starts in. */
  shipping?: SaleShippingInput | null;
}

/** The shipping side of a sale as a form submits it (#468): which method, and what it cost me.
 *
 * The two halves are independent. A method with no cost is a legitimate record — it says how the
 * parcel went even before the postage receipt turns up — and a cost with no method is exactly what
 * every sale recorded before the dictionary existed carries. */
export interface SaleShippingInput {
  /** A row from the platform's dictionary, or null for a one-off *Custom* method (or none at all). */
  methodId: string | null;
  /** The one-off method's name. Ignored when `methodId` is set: a dictionary method's snapshot is
   * taken from the row itself, so the client cannot write a name the platform never offered. */
  methodName: string | null;
  /** My postage cost. Null (a blank field) clears the money fields; the method, if any, stays. */
  cost: string | null;
  /** Currency the postage was paid in (#206) — independent of the sale's transaction currency. */
  currency: string;
}

export interface SaleLineDraft {
  offerId: string;
  /** The offer set that sold (`SaleLine.offerSetId`). */
  offerSetId: string;
  /** Line sale price in the sale's transaction currency. */
  price: string;
  /** The exact copies that left — must be the full current copy set of `offerSetId`. */
  itemIds: string[];
  /** The set above was **picked, not chosen** (#697): the line names it so every read keeps working,
   *  but nobody has said which physical copy goes. Written by an automatic pick — an imported
   *  multi-quantity order (#698), a buyer's own pick (#699) — and absent (false) everywhere a person
   *  recorded the sale, since they chose the set on the way in. */
  setChoicePending?: boolean;
}

/** Freeze the base-currency FX rate at save time (same behaviour as purchases, #119). Returns
 * null when the sale is already in the base currency or no rate is available. */
async function freezeFxRate(
  collectionId: string,
  currency: string,
  baseCurrency: string
): Promise<Prisma.Decimal | null> {
  if (currency === baseCurrency) return null;
  try {
    const { rate } = await getOrFetchRate(collectionId, currency, baseCurrency);
    return new Prisma.Decimal(rate);
  } catch {
    return null;
  }
}

/** The four shipping columns a write sets together (#468/#206). */
interface SaleShippingData {
  shippingMethodId: string | null;
  shippingMethodName: string | null;
  shippingCost: string | null;
  shippingCurrency: string | null;
  shippingFxRateToBase: Prisma.Decimal | null;
}

/**
 * Turn what a form submitted about shipping into the columns to write (#468).
 *
 * A dictionary method is re-read here rather than trusted from the client: it must belong to *this
 * sale's platform* (the price list is the platform's), and its **current** name is what gets
 * snapshotted onto the sale. A custom one-off keeps the typed name and has no row behind it.
 *
 * The cost is a separate fact from the method. A blank one clears the money fields — including the
 * frozen rate, which describes a cost that no longer exists — and leaves the method standing, since
 * how a parcel went is worth recording before the postage receipt turns up.
 */
async function resolveSaleShipping(
  collectionId: string,
  platformId: string,
  baseCurrency: string,
  input: SaleShippingInput
): Promise<SaleShippingData> {
  let methodId: string | null = null;
  let methodName: string | null = null;
  if (input.methodId) {
    const method = await resolveShippingMethodForPlatform(platformId, input.methodId);
    methodId = method.id;
    methodName = method.name;
  } else if (input.methodName?.trim()) {
    methodName = input.methodName.trim();
  }

  if (input.cost == null) {
    return {
      shippingMethodId: methodId,
      shippingMethodName: methodName,
      shippingCost: null,
      shippingCurrency: null,
      shippingFxRateToBase: null,
    };
  }
  const currency = input.currency.trim() || baseCurrency;
  return {
    shippingMethodId: methodId,
    shippingMethodName: methodName,
    shippingCost: input.cost,
    shippingCurrency: currency,
    shippingFxRateToBase: await freezeFxRate(collectionId, currency, baseCurrency),
  };
}

/** Whether every set of an offer has now sold **through this offer** — read inside the sale
 * transaction so the just-recorded lines count. Drives the offer → `sold` flip. A set that sold
 * elsewhere does not count (that leaves the offer `active` / needing action, not `sold`). */
async function isOfferFullySold(tx: Prisma.TransactionClient, offerId: string): Promise<boolean> {
  const sets = await tx.offerSet.findMany({ where: { offerId }, select: { id: true } });
  if (sets.length === 0) return false;
  const soldSets = await tx.saleLine.findMany({
    where: { offerSetId: { in: sets.map((s) => s.id) } },
    select: { offerSetId: true },
    distinct: ["offerSetId"],
  });
  return soldSets.length === sets.length;
}

interface SaleRef {
  collectionId: string;
  platformId: string;
  currency: string;
  baseCurrency: string;
}

/** Verify a sale exists and is owned by `ownerId`; returns the fields the line/shared mutations
 * need (collection, platform, currency, base currency). */
async function assertSaleOwner(ownerId: string, saleId: string): Promise<SaleRef> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      collectionId: true,
      platformId: true,
      currency: true,
      collection: { select: { ownerId: true, baseCurrency: true } },
    },
  });
  if (!sale || sale.collection.ownerId !== ownerId) {
    throw new Error("Sale not found or access denied.");
  }
  return {
    collectionId: sale.collectionId,
    platformId: sale.platformId,
    currency: sale.currency,
    baseCurrency: sale.collection.baseCurrency,
  };
}

/**
 * Create a **sale header** (ADR-0013): platform, buyer, date, currency, and the two sale-time
 * shared amounts (buyer handling + commission). Its sold sets — and my shipping cost, learned
 * later — are added on the sale's detail screen, mirroring the purchase intake flow. The FX rate
 * to base is frozen now (re-frozen if the currency later changes). Returns the new sale id.
 */
export async function createSale(
  ownerId: string,
  collectionId: string,
  input: SaleHeaderInput
): Promise<string> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const { platformCurrency } = await assertPlatform(collectionId, input.platformId);
  await assertBuyer(collectionId, input.buyerId);
  // Currency is inherited from the platform (#196): locked to the platform's, or set from the
  // form's fallback on the first offer/sale. Snapshotted onto the sale for history + FX freeze.
  const currency = await resolvePlatformCurrency(input.platformId, platformCurrency, input.currency);

  const fxRateToBase = await freezeFxRate(collectionId, currency, baseCurrency);
  // How it is being sent, when the form asked (#468). Recorded at creation because the buyer picks
  // the method *when they order* — it is known before the parcel, let alone the receipt, exists.
  const shipping = input.shipping
    ? await resolveSaleShipping(collectionId, input.platformId, baseCurrency, input.shipping)
    : null;
  // In a transaction for the number's sake (#432), as `createPurchase` is: the counter bump and the
  // row it belongs to stand or fall together.
  const sale = await prisma.$transaction(async (tx) =>
    tx.sale.create({
      data: {
        collectionId,
        saleNo: await allocateEntityNumber(tx, collectionId, "sale"),
        platformId: input.platformId,
        buyerId: input.buyerId,
        externalRef: input.externalRef,
        transactionUrl: input.transactionUrl,
        soldAt: input.soldAt,
        currency,
        fxRateToBase,
        buyerHandling: input.buyerHandling,
        buyerPaidTotal: input.buyerPaidTotal,
        commission: input.commission,
        ...shipping,
        // Seed the transition log with the initial `ordered` event (#191), so every sale has a
        // non-empty status timeline from the moment it is recorded.
        statusEvents: { create: { status: "ordered" } },
      },
      select: { id: true },
    })
  );
  return sale.id;
}

// ── Fulfillment status + packing mutations (#191/#192) ────────────────────────

/** Set a sale's fulfillment status (#191) from the inline control on the detail view. Validates
 * the token, updates `Sale.status`, and appends a `SaleStatusEvent` so the transition timeline is
 * preserved for reporting/audit. No side effects on copies or offers — status is an independent
 * axis. A no-op when the status is unchanged. */
export async function setSaleStatus(
  ownerId: string,
  saleId: string,
  status: SaleStatus
): Promise<void> {
  await assertSaleOwner(ownerId, saleId);
  if (!isSaleStatus(status)) {
    throw new Error("Unknown sale status.");
  }
  const current = await prisma.sale.findUnique({ where: { id: saleId }, select: { status: true } });
  if (current?.status === status) return;
  await prisma.$transaction([
    prisma.sale.update({ where: { id: saleId }, data: { status } }),
    prisma.saleStatusEvent.create({ data: { saleId, status } }),
  ]);
}

/** Toggle whether a single physical copy has been packed (#192). Keyed by `itemId` alone — the
 * `sale_line_item.itemId` unique constraint means a copy belongs to at most one sale line, so the
 * item identifies the row unambiguously. Independent of the sale's overall status; the UI surfaces
 * an advance-to-`packed` hint when the last copy is packed, but this never changes `Sale.status`. */
export async function setSaleLineItemPacked(
  ownerId: string,
  itemId: string,
  packed: boolean
): Promise<void> {
  const row = await prisma.saleLineItem.findUnique({
    where: { itemId },
    select: { saleLine: { select: { sale: { select: { collection: { select: { ownerId: true } } } } } } },
  });
  if (!row || row.saleLine.sale.collection.ownerId !== ownerId) {
    throw new Error("Sold copy not found or access denied.");
  }
  await prisma.saleLineItem.update({ where: { itemId }, data: { packed } });
}

/** Edit a sale header (platform / buyer / date / handling / commission). The currency is a fixed
 * snapshot (#196): inherited from the platform at creation and never rewritten by an edit, so the
 * FX rate is re-frozen against the sale's own currency. The platform cannot change once the sale
 * has sold sets — a sale is single-platform and its lines reference offers on that platform.
 *
 * Shipping (#468/#206) is rewritten only when the form submitted it; a caller that never showed the
 * fields passes `shipping: null` and the sale keeps what it had. */
export async function updateSaleHeader(
  ownerId: string,
  saleId: string,
  input: SaleHeaderInput
): Promise<void> {
  const ref = await assertSaleOwner(ownerId, saleId);
  await assertPlatform(ref.collectionId, input.platformId);
  await assertBuyer(ref.collectionId, input.buyerId);
  if (input.platformId !== ref.platformId) {
    const lineCount = await prisma.saleLine.count({ where: { saleId } });
    if (lineCount > 0) {
      throw new SaleActionBlockedError(
        "bad-offer",
        "Remove the sold sets before changing the platform — a sale stays on one platform."
      );
    }
  }
  const fxRateToBase = await freezeFxRate(ref.collectionId, ref.currency, ref.baseCurrency);
  // Resolved against the platform the sale is *moving to*, so a method can never outlive the
  // platform whose price list it came from.
  const shipping = input.shipping
    ? await resolveSaleShipping(ref.collectionId, input.platformId, ref.baseCurrency, input.shipping)
    : null;
  await prisma.sale.update({
    where: { id: saleId },
    data: {
      platformId: input.platformId,
      buyerId: input.buyerId,
      externalRef: input.externalRef,
      transactionUrl: input.transactionUrl,
      soldAt: input.soldAt,
      fxRateToBase,
      buyerHandling: input.buyerHandling,
      buyerPaidTotal: input.buyerPaidTotal,
      commission: input.commission,
      ...(shipping ?? {}),
      // A method belongs to a platform's price list, so moving the sale to another platform drops
      // it — the *name* stays, because that is a snapshot of how the parcel actually went and no
      // change of platform makes it untrue. Only when the form did not submit shipping itself; when
      // it did, the resolver above already validated the method against the new platform.
      ...(shipping == null && input.platformId !== ref.platformId
        ? { shippingMethodId: null }
        : {}),
    },
  });
}

/** The single-currency shared-amount fields editable in place on the detail screen. `buyerPaidTotal`
 * is the alternate anchor for the buyer side (#205) — setting it clears `buyerHandling` and
 * vice-versa. Shipping is multi-currency (#206) and goes through `updateSaleShipping` instead. */
export type SaleAmountField = "buyerHandling" | "buyerPaidTotal" | "commission";

/** Set one of a sale's shared amounts in place. Null when cleared. Feeds the allocation engine on
 * read (`getSaleDetail`). Buyer handling and buyer-paid total are mutually exclusive anchors, so
 * writing one clears the other. */
export async function updateSaleAmount(
  ownerId: string,
  saleId: string,
  field: SaleAmountField,
  value: string | null
): Promise<void> {
  await assertSaleOwner(ownerId, saleId);
  const data: Prisma.SaleUpdateInput = { [field]: value };
  if (field === "buyerHandling") data.buyerPaidTotal = null;
  else if (field === "buyerPaidTotal") data.buyerHandling = null;
  await prisma.sale.update({ where: { id: saleId }, data });
}

/** Set (or clear) the link to the transaction on the marketplace (#292). Editable whatever the
 * fulfillment status is — a link is record-keeping, and the order page is often the thing you go
 * back to *after* the sale completed (the offer link's rule, #213). Null when cleared. */
export async function updateSaleTransactionUrl(
  ownerId: string,
  saleId: string,
  url: string | null
): Promise<void> {
  await assertSaleOwner(ownerId, saleId);
  await prisma.sale.update({ where: { id: saleId }, data: { transactionUrl: url } });
}

/** What the collector says about the parcel itself (#491): who carried it and its tracking number. */
export interface SaleShipmentInput {
  /** The carrier that actually took it, or null to fall back on the shipping method's default. */
  carrierId: string | null;
  /** Free text — every carrier numbers its consignments its own way. Null when cleared. */
  trackingCode: string | null;
}

/** Record who carried the parcel and under what number (#491), from the prompt shown while a sale
 * is marked **Sent** or the same dialog reopened from the detail header.
 *
 * The two are written together because they are one act: the courier is chosen and the receipt with
 * the number on it is handed over at the same counter. Editable in any status, like the transaction
 * link — a number turns up late as often as not, and a wrong one has to be correctable afterwards.
 *
 * The carrier is checked against the sale's own collection (the dictionary is the collection's).
 * Nothing but these two columns is written: the tracking *address* is built on read from the
 * carrier's template. */
export async function updateSaleShipment(
  ownerId: string,
  saleId: string,
  input: SaleShipmentInput
): Promise<void> {
  const ref = await assertSaleOwner(ownerId, saleId);
  if (input.carrierId) await assertCarrierInCollection(ref.collectionId, input.carrierId);
  await prisma.sale.update({
    where: { id: saleId },
    data: { carrierId: input.carrierId, trackingCode: input.trackingCode },
  });
}

/** Set (or clear) how a sale was shipped and what it cost me (#206/#468), from the detail screen's
 * shipping row. Freezes the shipping currency's base rate at save time — independent of the sale's
 * transaction currency — so profit is computed in the base currency. The method is resolved against
 * the sale's own platform; a blank amount clears the cost, its currency and the frozen rate. */
export async function updateSaleShipping(
  ownerId: string,
  saleId: string,
  input: SaleShippingInput
): Promise<void> {
  const ref = await assertSaleOwner(ownerId, saleId);
  const data = await resolveSaleShipping(ref.collectionId, ref.platformId, ref.baseCurrency, input);
  await prisma.sale.update({ where: { id: saleId }, data });
}

/** Resolve the effective buyer handling (the number fed to net + allocation) from a sale's two
 * mutually-exclusive anchors and its gross (#205). Total-anchored handling is derived as
 * `total − gross` and clamped at 0 — the allocation engine requires non-negative shared amounts, and
 * a total below the offer prices is an error state surfaced separately (`totalBelowGross`). */
function resolveBuyerHandling(
  buyerHandling: Prisma.Decimal | null,
  buyerPaidTotal: Prisma.Decimal | null,
  gross: number
): { handling: number; totalBelowGross: boolean } {
  if (buyerPaidTotal == null) return { handling: num(buyerHandling), totalBelowGross: false };
  const derived = Number(buyerPaidTotal) - gross;
  return { handling: Math.max(0, derived), totalBelowGross: derived < 0 };
}

/**
 * Add one or more sold sets to a sale (ADR-0013). Each draft is a whole `OfferSet`, priced in the
 * sale currency, carrying the set's full copy set. Every offer must be on the sale's platform (a
 * sale is single-platform) and still sellable. After writing the lines, each offer whose every set
 * is now sold flips to `sold`; a partial sale leaves the offer live for its remaining sets.
 *
 * Whole-set integrity: a draft's `itemIds` must be exactly the full current copy set of its set
 * (`offerSetId`), which must belong to the draft's offer. The DB-level unique on
 * `sale_line_item.itemId` backstops the no-double-sale rule.
 */
export async function addSaleLines(
  ownerId: string,
  saleId: string,
  drafts: SaleLineDraft[]
): Promise<void> {
  const ref = await assertSaleOwner(ownerId, saleId);
  if (drafts.length === 0) {
    throw new SaleActionBlockedError("empty", "Choose at least one set to add.");
  }

  const offerIds = [...new Set(drafts.map((d) => d.offerId))];
  const offers = await prisma.offer.findMany({
    where: { id: { in: offerIds }, collectionId: ref.collectionId },
    select: { id: true, platformId: true, currency: true, state: true, sets: { select: { id: true } } },
  });
  const offerById = new Map(offers.map((o) => [o.id, o]));

  for (const line of drafts) {
    const offer = offerById.get(line.offerId);
    if (!offer) {
      throw new SaleActionBlockedError("bad-offer", "One of the offers is no longer available.");
    }
    if (offer.platformId !== ref.platformId) {
      throw new SaleActionBlockedError("bad-offer", "That offer is on a different platform than this sale.");
    }
    // A sale is single-currency (#196/#197): every offer it pulls in must match the sale's currency.
    // An offer left on an old currency after the platform's currency changed is excluded — re-list
    // it in the platform's current currency first.
    if (offer.currency !== ref.currency) {
      throw new SaleActionBlockedError(
        "currency-mismatch",
        `This offer is in ${offer.currency}, but the sale is in ${ref.currency}. Re-list it in the platform's current currency first.`
      );
    }
    const state = (isOfferState(offer.state) ? offer.state : "active") as OfferState;
    if (!isSellableOfferState(state)) {
      throw new SaleActionBlockedError("bad-offer", "One of the offers is already sold or withdrawn.");
    }

    // The set must belong to the offer it was recorded against.
    if (!offer.sets.some((s) => s.id === line.offerSetId)) {
      throw new SaleActionBlockedError(
        "bad-set",
        "A sold set does not belong to the offer it was recorded against."
      );
    }

    // Whole-set integrity: the draft's copies must be exactly the set's full current copy set.
    const actual = await prisma.offerSetItem.findMany({
      where: { offerSetId: line.offerSetId },
      select: { itemId: true },
    });
    const actualIds = new Set(actual.map((r) => r.itemId));
    const givenIds = new Set(line.itemIds);
    if (
      actualIds.size === 0 ||
      actualIds.size !== givenIds.size ||
      [...givenIds].some((id) => !actualIds.has(id))
    ) {
      throw new SaleActionBlockedError(
        "bad-set",
        "A sold set must include exactly the copies it holds — a series cannot be split."
      );
    }

    // None of the copies may have already left on a prior sale line.
    const already = await soldItemIds(line.itemIds);
    if (already.size > 0) {
      throw new SaleActionBlockedError("already-sold", "One or more of these copies has already been sold.");
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of drafts) {
        await tx.saleLine.create({
          data: {
            saleId,
            offerId: line.offerId,
            offerSetId: line.offerSetId,
            price: line.price,
            setChoicePending: line.setChoicePending ?? false,
            items: { create: line.itemIds.map((itemId) => ({ itemId })) },
          },
        });
      }
      // Flip an offer to `sold` only once every set has sold through it (the only stored side
      // effect; set / item sold state stays derived).
      //
      // The sale also **resolves the bidding** (#215, #469): "in active bidding" says a bid has been
      // placed and the collector is committed *before the sale is recorded*, so recording it is
      // exactly what ends that state. Left standing, a sold listing would keep an "In bidding" chip
      // that reads as an auction still running.
      for (const offerId of offerIds) {
        if (await isOfferFullySold(tx, offerId)) {
          await tx.offer.update({
            where: { id: offerId },
            // `closedAt` (#512) is stamped with the state, as it is on a withdrawal: it is what the
            // generated-photo purge measures the grace period from.
            data: { state: "sold", inActiveBidding: false, closedAt: new Date() },
          });
        }
      }
      // A sale is a **composition change** (#700), and the strongest of them: the sets that sold
      // leave what the listing has to offer, and #315 drops them from its photo plan. So a listing
      // still up after a partial sale is out of step exactly as one whose sets were edited is —
      // it advertises a quantity it no longer has and pictures a copy that has gone — and it is
      // flagged by the same rule, cleared by the same three things (#542: the Assistant's update,
      // a republication, *Mark as up to date*).
      //
      // **After** the flip above, deliberately: an offer that just sold out is `sold`, which the
      // rule excludes, so the sale that closes a listing does not ask anyone to go and fix it. Only
      // the one that leaves something behind does.
      await markListingContentChanged(offerIds, tx);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new SaleActionBlockedError("already-sold", "One or more of these copies has already been sold.");
    }
    throw e;
  }
}

/** Override a sold unit's line sale price in place (#258): the actual amount this set sold for, which
 * can differ from the offer's asking price (e.g. a discount given to the buyer). The override lives
 * only on this sale line — the originating offer's own asking price is never touched. Gross, net, and
 * any total-anchored buyer handling (#205) recompute from the line prices on the next read, so the
 * math stays consistent. */
export async function updateSaleLinePrice(
  ownerId: string,
  lineId: string,
  price: string
): Promise<void> {
  const line = await prisma.saleLine.findUnique({
    where: { id: lineId },
    select: { sale: { select: { collection: { select: { ownerId: true } } } } },
  });
  if (!line || line.sale.collection.ownerId !== ownerId) {
    throw new Error("Sale line not found or access denied.");
  }
  await prisma.saleLine.update({ where: { id: lineId }, data: { price } });
}

// ── Which set left (#697) ───────────────────────────────────────────────────
//
// **Which set went is not a fact about the order.** An offer listed at quantity 3 has three sets,
// and a buyer who takes one has said *one of these*, not *this one*: the sets of one offer are the
// same thing at the same price, which is why they are one listing. So the copy that leaves is the
// seller's own fulfilment choice, made at the packing table — and it can change after the fact, when
// a copy turns out to have a thin.
//
// Before this, `removeSaleLine` + `addSaleLines` was the only way to change it, and that path throws
// away the line's price and its per-copy `packed` marks on the way. Both survive here: the price is
// what the buyer paid, and swapping which copy goes does not change it.

/** One of a line's swap candidates, and which of them the line names now. */
export interface SaleLineSetChoice {
  lineId: string;
  /** The offer the line sold through — the whole choice is inside it. */
  offerId: string;
  offerLabel: string;
  /** The set the line names today, always present among `sets` so confirming it is one click. */
  currentSetId: string;
  /** True while nobody has chosen (#697) — what the picker's own wording turns on. */
  setChoicePending: boolean;
  /** The offer's sets that are still free to take, this line's own included, in the offer's explicit
   *  order (#306). Never empty: the current set is always among them. */
  sets: SaleSetOption[];
  /** Every copy across those sets, enriched as the Copies list draws them — **with their scans**.
   *  Choosing between interchangeable sets is choosing between physical pieces, and the difference
   *  between two copies of one stamp is a thin, a corner, a cancel: things one can only see. A list
   *  of catalogue labels would name three identical-looking rows and leave the actual comparison to
   *  a second screen. Loaded here rather than through a second endpoint because the picker's whole
   *  subject is one offer, which is a handful of copies. */
  copies: ItemListItem[];
}

/**
 * The sets this line could have gone out as (#697) — every set of its **own offer** whose copies are
 * still free, plus the one it already names.
 *
 * Deliberately `SaleSetOption`'s shape, the one {@link listSellableOffers} serves the sale-creation
 * flow: the collector is choosing from the same list in the same words, and a second vocabulary for
 * one question is how two screens come to disagree about what a set is called.
 *
 * The offer's own **state** is not asked about, unlike the sellable picker's: an offer every set of
 * which has sold is `sold` (ADR-0013 §4) and is exactly the offer a quantity sale is being
 * re-allocated inside. What decides a set here is whether its copies have left, not whether the
 * listing is still up.
 *
 * Null when the line does not exist or is not the caller's; the caller's 404.
 */
export async function listSaleLineSetOptions(
  ownerId: string,
  lineId: string,
  // The copy rows are the collector's own — copy numbers, shelves, cost basis — and the buyer's page
  // (#699) offers the same sets without them, so it says so here rather than fetching them to throw
  // away. The default is the collector's picker, which is what this read exists for.
  options: { withCopies?: boolean } = {}
): Promise<SaleLineSetChoice | null> {
  const line = await prisma.saleLine.findUnique({
    where: { id: lineId },
    select: {
      offerId: true,
      offerSetId: true,
      setChoicePending: true,
      sale: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
      offer: {
        select: {
          id: true,
          sets: {
            orderBy: OFFER_SETS_ORDER_BY,
            select: {
              id: true,
              title: true,
              items: {
                select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } },
              },
            },
          },
        },
      },
    },
  });
  if (!line || line.sale.collection.ownerId !== ownerId) return null;
  // A line whose offer was deleted has no choice to offer: the sets it could swap among went with
  // it, and the copies it holds are all the record still knows about.
  if (!line.offerId || !line.offer) return null;

  const allItemIds = line.offer.sets.flatMap((s) => s.items.map((li) => li.itemId));
  // Every copy of this offer that has already left, and on which line — so this line's own copies
  // are not read as an obstacle to itself.
  const taken = await prisma.saleLineItem.findMany({
    where: { itemId: { in: [...new Set(allItemIds)] } },
    select: { itemId: true, saleLineId: true },
  });
  const takenElsewhere = new Set(
    taken.filter((r) => r.saleLineId !== lineId).map((r) => r.itemId)
  );

  const labeller = await makeOfferLabeller(line.sale.collectionId);
  const sets: SaleSetOption[] = [];
  for (const set of line.offer.sets) {
    // A set is atomic, so one copy gone elsewhere retires the whole set — the sellable picker's rule.
    if (set.items.length === 0) continue;
    if (set.id !== line.offerSetId && set.items.some((li) => takenElsewhere.has(li.itemId))) continue;
    const items = orderedSetItems(set.items);
    sets.push({
      offerSetId: set.id,
      label: labeller.set(set),
      itemIds: items.map((li) => li.itemId),
      itemLabels: items.map((li) => labeller.copy(li.item.stamp)),
    });
  }

  const copyIds = [...new Set(sets.flatMap((s) => s.itemIds))];
  const copies =
    options.withCopies !== false && copyIds.length
      ? (await listItemsPaginated(ownerId, line.sale.collectionId, {
          ids: copyIds,
          pageSize: copyIds.length,
        })).items
      : [];

  return {
    lineId,
    offerId: line.offerId,
    offerLabel: labeller.offer(line.offer.sets),
    currentSetId: line.offerSetId,
    setChoicePending: line.setChoicePending,
    sets,
    copies,
  };
}

/**
 * Say which set actually left on this line (#697).
 *
 * The line's copies are rewritten to the target set's **full current copy set** — whole-set
 * integrity is unchanged, a series still never breaks apart — and:
 *
 *   • the **price is untouched**. It is what the buyer paid, and swapping which copy goes does not
 *     change that. This is the whole reason the swap exists rather than a remove-and-re-add.
 *   • `packed` marks are **dropped with the copies they were about**: a different copy has not been
 *     packed, and a mark carried across would say it had.
 *   • `setChoicePending` is cleared — a person has now said which one.
 *
 * Choosing the set the line **already names** is *confirming* it: the flag clears and nothing else
 * moves, so a line whose copies are already in the parcel keeps its packing.
 *
 * **Who chose is recorded, in one column and one write.** `byBuyer` stamps `setChosenByBuyerAt` on
 * a pick that came through the sale's share link (#699); every other call clears it, because a
 * seller correcting the record afterwards has overridden the buyer's answer and the line is no
 * longer that answer. The same write does both, so the two can never come to disagree.
 *
 * The target must belong to the **same offer**. A set of another offer is a different listing that a
 * different buyer is looking at, and moving a line onto it would be recording a sale that did not
 * happen; a set holding a copy that left on another sale is refused for the plainer reason, with the
 * `sale_line_item.itemId` unique as the backstop.
 *
 * The offer's own `sold` state is deliberately not recomputed: a swap inside one offer leaves the
 * number of its sets that have sold exactly where it was.
 */
export async function swapSaleLineSet(
  ownerId: string,
  lineId: string,
  offerSetId: string,
  options: { byBuyer?: boolean } = {}
): Promise<void> {
  const setChosenByBuyerAt = options.byBuyer ? new Date() : null;
  const line = await prisma.saleLine.findUnique({
    where: { id: lineId },
    select: {
      offerId: true,
      offerSetId: true,
      sale: { select: { collection: { select: { ownerId: true } } } },
    },
  });
  if (!line || line.sale.collection.ownerId !== ownerId) {
    throw new Error("Sale line not found or access denied.");
  }
  if (!line.offerId) {
    throw new SaleActionBlockedError(
      "no-offer",
      "This line's offer is gone, so there are no other sets to choose from."
    );
  }

  // Confirming the set the line already names: nothing about the copies changes, so nothing about
  // their packing does either.
  if (offerSetId === line.offerSetId) {
    await prisma.saleLine.update({
      where: { id: lineId },
      data: { setChoicePending: false, setChosenByBuyerAt },
    });
    return;
  }

  const target = await prisma.offerSet.findUnique({
    where: { id: offerSetId },
    select: { offerId: true, items: { select: { itemId: true } } },
  });
  if (!target || target.offerId !== line.offerId) {
    throw new SaleActionBlockedError(
      "bad-set",
      "That set belongs to a different offer — a sale line can only move among the sets of the listing it sold through."
    );
  }
  if (target.items.length === 0) {
    throw new SaleActionBlockedError("bad-set", "That set holds no copies.");
  }
  const itemIds = target.items.map((r) => r.itemId);
  const already = await soldItemIds(itemIds);
  if (already.size > 0) {
    throw new SaleActionBlockedError(
      "already-sold",
      "One or more copies of that set have already sold — choose a set that is still available."
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      // The old copies go, and their `packed` marks go with them: a different copy has not been
      // packed.
      await tx.saleLineItem.deleteMany({ where: { saleLineId: lineId } });
      await tx.saleLine.update({
        where: { id: lineId },
        data: {
          offerSetId,
          setChoicePending: false,
          setChosenByBuyerAt,
          items: { create: itemIds.map((itemId) => ({ itemId })) },
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new SaleActionBlockedError(
        "already-sold",
        "One or more copies of that set have already sold — choose a set that is still available."
      );
    }
    throw e;
  }
}

/** Remove a sold set from a sale (ADR-0013). Its copies become available again (their sold state
 * is derived), and if the line's offer had been flipped to `sold` but is no longer fully sold, the
 * offer reverts to `active`. */
export async function removeSaleLine(ownerId: string, lineId: string): Promise<void> {
  const line = await prisma.saleLine.findUnique({
    where: { id: lineId },
    select: {
      offerId: true,
      sale: { select: { collection: { select: { ownerId: true } } } },
    },
  });
  if (!line || line.sale.collection.ownerId !== ownerId) {
    throw new Error("Sale line not found or access denied.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.saleLine.delete({ where: { id: lineId } });
    if (line.offerId) {
      const offer = await tx.offer.findUnique({
        where: { id: line.offerId },
        select: { state: true },
      });
      if (offer && offer.state === "sold" && !(await isOfferFullySold(tx, line.offerId))) {
        await tx.offer.update({ where: { id: line.offerId }, data: { state: "active" } });
      }
      // The set is back in what this offer sells, which is the same composition change in reverse
      // (#700/#542): a live listing now understates what is there.
      await markListingContentChanged(line.offerId, tx);
    }
  });
}

// ── List ──────────────────────────────────────────────────────────────────

export interface SaleListItem {
  id: string;
  /** The short per-collection sale number (#432) — what the quick-jump box takes after `s`. */
  saleNo: number;
  platformId: string;
  platformName: string;
  /** The buyer's name, or null when unknown/anonymous. */
  buyerName: string | null;
  /** External system's transaction / order number, or null. */
  externalRef: string | null;
  /** Link to the transaction on the marketplace (#292), or null. */
  transactionUrl: string | null;
  /** Fulfillment status (#191): ordered | paid | packed | sent | received. */
  status: string;
  soldAt: Date;
  currency: string;
  lineCount: number;
  itemCount: number;
  /** How many of this sale's lines still name a set nobody has chosen (#697). A **flag shown on a
   *  list is shown on the thing's own screen too**, and it is read off the very column the detail's
   *  own per-line flag is, so the two can never disagree. Zero on every hand-recorded sale. */
  pendingSetChoiceCount: number;
  /** The collection base currency — `netProceeds` is expressed in it (#206). */
  baseCurrency: string;
  /** Sum of line sale prices (transaction currency). */
  grossProceeds: string;
  /** Base-currency net (#206): (gross + buyer handling − commission) converted to base, minus my
   * shipping (already in base). For a single-currency collection this equals the old transaction-
   * currency net. */
  netProceeds: string;
  createdAt: Date;
}

const SALE_LIST_SELECT = {
  id: true,
  saleNo: true,
  platformId: true,
  externalRef: true,
  transactionUrl: true,
  status: true,
  soldAt: true,
  currency: true,
  fxRateToBase: true,
  buyerHandling: true,
  buyerPaidTotal: true,
  shippingCost: true,
  shippingCurrency: true,
  shippingFxRateToBase: true,
  commission: true,
  createdAt: true,
  platform: { select: { name: true } },
  buyer: { select: { name: true } },
  lines: {
    select: { price: true, setChoicePending: true, _count: { select: { items: true } } },
  },
} as const;

function num(v: Prisma.Decimal | null): number {
  return v == null ? 0 : Number(v);
}

/** A money value as a fixed 2-dp string (or null), so every UI display and edit prefill is
 * consistently formatted (Prisma `Decimal` drops trailing zeros in `toString`). */
function money(v: Prisma.Decimal | null): string | null {
  return v == null ? null : Number(v).toFixed(2);
}

/** Convert a sale's shipping cost (entered in its own currency, #206) to the base currency. Identity
 * when the shipping currency is the base or unset; uses the frozen shipping rate otherwise. A null
 * rate on a foreign shipping currency means no rate is known — treated as 0 here and surfaced by the
 * sale's own "no FX rate" state, so an unconvertible cost never silently distorts a base figure. */
function shippingToBase(
  shippingCost: Prisma.Decimal | null,
  shippingCurrency: string | null,
  shippingFxRateToBase: Prisma.Decimal | null,
  baseCurrency: string
): number {
  if (shippingCost == null) return 0;
  if (shippingCurrency == null || shippingCurrency === baseCurrency) return Number(shippingCost);
  if (shippingFxRateToBase == null) return 0;
  return Number(shippingCost) * Number(shippingFxRateToBase);
}

function toSaleListItem(
  row: {
    id: string;
    saleNo: number;
    platformId: string;
    externalRef: string | null;
    transactionUrl: string | null;
    status: string;
    soldAt: Date;
    currency: string;
    fxRateToBase: Prisma.Decimal | null;
    buyerHandling: Prisma.Decimal | null;
    buyerPaidTotal: Prisma.Decimal | null;
    shippingCost: Prisma.Decimal | null;
    shippingCurrency: string | null;
    shippingFxRateToBase: Prisma.Decimal | null;
    commission: Prisma.Decimal | null;
    createdAt: Date;
    platform: { name: string };
    buyer: { name: string } | null;
    lines: { price: Prisma.Decimal; setChoicePending: boolean; _count: { items: number } }[];
  },
  baseCurrency: string
): SaleListItem {
  const gross = row.lines.reduce((s, l) => s + Number(l.price), 0);
  const { handling } = resolveBuyerHandling(row.buyerHandling, row.buyerPaidTotal, gross);
  // Buyer-side net (transaction ccy) → base, then my shipping (already base). Rate defaults to 1
  // (base == transaction, or the rare unknown-rate window the detail flags separately).
  const buyerNetTx = gross + handling - num(row.commission);
  const rate = row.fxRateToBase == null ? 1 : Number(row.fxRateToBase);
  const shippingBase = shippingToBase(
    row.shippingCost,
    row.shippingCurrency,
    row.shippingFxRateToBase,
    baseCurrency
  );
  const netBase = buyerNetTx * rate - shippingBase;
  return {
    id: row.id,
    saleNo: row.saleNo,
    platformId: row.platformId,
    platformName: row.platform.name,
    buyerName: row.buyer?.name ?? null,
    externalRef: row.externalRef,
    transactionUrl: row.transactionUrl,
    status: row.status,
    soldAt: row.soldAt,
    currency: row.currency,
    lineCount: row.lines.length,
    itemCount: row.lines.reduce((s, l) => s + l._count.items, 0),
    pendingSetChoiceCount: row.lines.filter((l) => l.setChoicePending).length,
    baseCurrency,
    grossProceeds: gross.toFixed(2),
    netProceeds: netBase.toFixed(2),
    createdAt: row.createdAt,
  };
}

export interface SaleListFilters {
  platformId?: string;
  /** Fulfillment statuses (#191) to narrow to, for the list's status chips (#392). OR-matched and
   * multi-select (#475); empty or absent means every status. */
  statuses?: SaleStatus[];
  /** Free-text search over buyer name, platform name, external reference, and the stamp name /
   * catalog numbers of the copies sold on the sale (#193). Case-insensitive substring match. */
  search?: string;
  /** Narrow to sales holding at least one line whose set nobody has chosen yet (#697). A **boolean
   * rather than a chip among the statuses**: it is not a place in the fulfilment lifecycle but a
   * decision outstanding *inside* a sale, and a sale can be waiting on it in any status. Absent is
   * every sale, chosen or not — this never narrows the default view. */
  setChoicePending?: boolean;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedSalesResult {
  items: SaleListItem[];
  nextCursor: string | null;
}

/** The `where` fragment for the sales-list free-text search (#193): buyer name, platform name, the
 * external reference, or any sold copy's stamp name / catalog number. Case-insensitive substring. */
function saleSearchWhere(search: string): Prisma.SaleWhereInput {
  const s = search.trim();
  const stampMatch = {
    OR: [
      { name: { contains: s, mode: "insensitive" as const } },
      { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" as const } } } },
    ],
  };
  return {
    OR: [
      { externalRef: { contains: s, mode: "insensitive" } },
      { platform: { name: { contains: s, mode: "insensitive" } } },
      { buyer: { name: { contains: s, mode: "insensitive" } } },
      { lines: { some: { items: { some: { item: { stamp: stampMatch } } } } } },
    ],
  };
}

/** Paginated sales list for the Sales screen (ADR-0013). Newest sale first; filters by platform.
 * Offset-paginated to feed the shared infinite scroll. */
export async function listSalesPaginated(
  ownerId: string,
  collectionId: string,
  filters: SaleListFilters = {}
): Promise<PaginatedSalesResult> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await prisma.sale.findMany({
    where: {
      collectionId,
      ...(filters.platformId ? { platformId: filters.platformId } : {}),
      ...(filters.statuses?.length ? { status: { in: filters.statuses } } : {}),
      ...(filters.search ? saleSearchWhere(filters.search) : {}),
      // One line is enough to put the sale on the list (#697): the collector is looking for parcels
      // that cannot be packed yet, and one undecided line stops the parcel.
      ...(filters.setChoicePending ? { lines: { some: { setChoicePending: true } } } : {}),
    },
    orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
    take: pageSize + 1,
    skip: offset,
    select: SALE_LIST_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: page.map((row) => toSaleListItem(row, baseCurrency)),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/** Distinct platforms that currently have at least one sale, for the list-screen filter. Carries
 * each platform's locked currency (#196) as the offers list's own platform read does: the Record a
 * Sale dialog seeds its platform from the active filter (#464), and a pre-filled platform whose
 * currency is unknown falls back to an editable picker defaulting to the base currency. */
export async function listSalePlatforms(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string; platformCurrency: string | null }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.sale.findMany({
    where: { collectionId },
    select: { platform: { select: { id: true, name: true, platformCurrency: true } } },
    distinct: ["platformId"],
    orderBy: { platform: { name: "asc" } },
  });
  return rows.map((r) => r.platform);
}

// ── Detail ──────────────────────────────────────────────────────────────────

export interface SaleDetailLine {
  id: string;
  offerSetId: string;
  setLabel: string;
  offerId: string | null;
  price: string;
  /** The line sale price converted to the base currency at the frozen rate (#208), or null when the
   * sale is already in base or no rate is known. */
  priceBase: string | null;
  /** How many physical copies left on this line (its copies load lazily on the detail screen). */
  copyCount: number;
  /** The line names a set nobody has chosen yet (#697) — an automatic pick took one of the offer's
   *  interchangeable sets, and *Choose set* is what settles it. */
  setChoicePending: boolean;
  /** When the **buyer** chose this set through the sale's share link (#699), else null. The seller
   *  reads it to know the pick is not their own — and it is cleared the moment they override it. */
  setChosenByBuyerAt: string | null;
  itemLabels: string[];
  /** This line's resolved net proceeds in the transaction currency (allocation engine). */
  netTx: string;
  /** …and converted to the base currency at the frozen FX rate. */
  netBase: string;
}

/** What the sale screen knows about its buyer link (#699) without asking `sale-share.ts` for it.
 *  The address included (#681): the link is a fact about this sale, and the screen that says one is
 *  out there is the screen that should be able to say **which**. */
export interface SaleShareState {
  address: ShareAddress;
  expiresAt: string | null;
  createdAt: string;
  /** When the buyer last opened it, or null. The only sign the question reached anybody. */
  lastUsedAt: string | null;
}

export interface SaleDetail {
  id: string;
  /** Short per-collection sale number (#432) — the collection's own name for this transaction, as
   * opposed to `externalRef`, which is the marketplace's. Printed on the packing list (#474). */
  saleNo: number;
  collectionId: string;
  platformId: string;
  platformName: string;
  buyerId: string | null;
  buyerName: string | null;
  externalRef: string | null;
  /** Link to the transaction on the marketplace (#292), or null. Editable in place in any status. */
  transactionUrl: string | null;
  baseCurrency: string;
  soldAt: Date;
  currency: string;
  fxRateToBase: string | null;
  /** The effective buyer handling shown in the breakdown — the stored value when handling-anchored,
   * or the derived `total − gross` when total-anchored (#205). */
  buyerHandling: string | null;
  /** The stored buyer-paid total when it is the anchor, else null. When non-null, handling is
   * derived and read-only in the UI. */
  buyerPaidTotal: string | null;
  /** True when total-anchored and the total is below the offer prices — handling would be negative,
   * so it is clamped to 0 and this flags the error state. */
  totalBelowGross: boolean;
  /** The dictionary method this sale was sent by (#468), or null for a one-off / none. */
  shippingMethodId: string | null;
  /** What the method was called at sale time — the snapshot, so a renamed or deleted dictionary
   * row never rewrites what this sale says. Null when no method was recorded. */
  shippingMethodName: string | null;
  /** My shipping cost as originally entered, in `shippingCurrency` (#206). */
  shippingCost: string | null;
  /** Currency the shipping cost was paid in; defaults to the sale currency for new entries. Null
   * when no shipping is recorded. */
  shippingCurrency: string | null;
  /** The shipping cost converted to the base currency (#206), or null when none is recorded. */
  shippingBase: string | null;
  /** True when shipping is in a foreign currency but no FX rate to base is known — the cost can't
   * be converted, so it is excluded from the base net until a rate exists. */
  shippingRateMissing: boolean;
  /** The shipment's tracking number (#491), or null. Editable in place in any status. */
  trackingCode: string | null;
  /** The carrier in force for this parcel: the one the sale recorded, else the **default** named on
   * its shipping method. Null when neither says. The distinction is deliberate — the buyer picks a
   * service, the courier is chosen at the counter — but everything downstream wants the effective
   * answer, so the fallback is resolved here rather than in three screens. */
  carrierId: string | null;
  /** {@link carrierId}'s name — what the tracking chip is attributed to. */
  carrierName: string | null;
  /** The tracking number's own link, built from the carrier's template (#491). Null when there is
   * nothing to link to — no number yet, or no carrier with a tracking page. The number is still
   * shown; only the link is missing. */
  trackingUrl: string | null;
  commission: string | null;
  grossProceeds: string;
  /** Base-currency net (#206): buyer-side proceeds converted to base, minus shipping (base). */
  netProceeds: string;
  /** Fulfillment status (#191): ordered | paid | packed | sent | received. */
  status: string;
  /** True when the sale has at least one copy and every copy is packed (#192) — drives the
   * "mark sale packed?" hint. Never auto-advances the status. */
  allItemsPacked: boolean;
  lines: SaleDetailLine[];
  /** The buyer's link for choosing their own copy (#699), or null when the sale has none. Here
   *  rather than behind a second fetch, so the header can say a question is out there — and whether
   *  it has been opened — without the seller opening a dialog to find out. */
  share: SaleShareState | null;
  createdAt: Date;
}

/** Full sale read model for the detail view (ADR-0013). Runs the pure allocation engine
 * (`distributeSaleShared`, #163) to resolve each line's net proceeds. */
export async function getSaleDetail(ownerId: string, saleId: string): Promise<SaleDetail | null> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      saleNo: true,
      collectionId: true,
      platformId: true,
      buyerId: true,
      externalRef: true,
      transactionUrl: true,
      soldAt: true,
      currency: true,
      fxRateToBase: true,
      buyerHandling: true,
      buyerPaidTotal: true,
      shippingMethodId: true,
      shippingMethodName: true,
      shippingCost: true,
      shippingCurrency: true,
      shippingFxRateToBase: true,
      trackingCode: true,
      // The sale's own carrier, and the method's as the fallback default (#491). Only the *link* is
      // derived from either — it is a way of looking the parcel up, not a fact the sale freezes, so
      // a carrier that moves its tracking site is corrected once and every sale it carried follows.
      carrier: { select: { id: true, name: true, trackingUrlTemplate: true } },
      shippingMethod: {
        select: { carrier: { select: { id: true, name: true, trackingUrlTemplate: true } } },
      },
      commission: true,
      status: true,
      createdAt: true,
      collection: { select: { ownerId: true, baseCurrency: true } },
      platform: { select: { name: true } },
      buyer: { select: { name: true } },
      // The buyer's link (#699). Metadata only — the address is sealed, and `readShareAddress` says
      // why it cannot be opened where it cannot.
      shareToken: {
        select: { tokenSealed: true, expiresAt: true, createdAt: true, lastUsedAt: true },
      },
      lines: {
        select: {
          id: true,
          offerSetId: true,
          offerId: true,
          price: true,
          setChoicePending: true,
          setChosenByBuyerAt: true,
          offerSet: {
            select: {
              title: true,
              items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
            },
          },
          items: { select: { packed: true, item: { select: STAMP_LABEL_SELECT } } },
        },
      },
    },
  });
  if (!sale || sale.collection.ownerId !== ownerId) return null;

  const gross = sale.lines.reduce((s, l) => s + Number(l.price), 0);
  // Resolve the buyer-side anchor first: total-anchored handling is derived from gross (#205).
  const { handling: effHandling, totalBelowGross } = resolveBuyerHandling(
    sale.buyerHandling,
    sale.buyerPaidTotal,
    gross
  );
  const baseCurrency = sale.collection.baseCurrency;
  // Shipping is my cost in my own currency, converted straight to base (#206).
  const shippingBase = shippingToBase(
    sale.shippingCost,
    sale.shippingCurrency,
    sale.shippingFxRateToBase,
    baseCurrency
  );
  const shippingRateMissing =
    sale.shippingCost != null &&
    sale.shippingCurrency != null &&
    sale.shippingCurrency !== baseCurrency &&
    sale.shippingFxRateToBase == null;
  const shared = {
    buyerHandling: effHandling,
    shippingBase,
    commission: num(sale.commission),
    fxRateToBase: sale.fxRateToBase == null ? null : Number(sale.fxRateToBase),
  };
  const lineInputs: SaleLineInput[] = sale.lines.map((l) => ({ id: l.id, price: Number(l.price) }));
  // The shared amounts are distributed proportionally to line price, so there must be at least
  // one positive-priced line to distribute across. A sale still being built (no lines yet, or
  // only zero-priced lines) can't be allocated — show each line's own price as its net until it can.
  const canDistribute = lineInputs.reduce((s, l) => s + l.price, 0) > 0;
  const nets = canDistribute ? distributeSaleShared(shared, lineInputs) : [];
  const netById = new Map(nets.map((n) => [n.id, n]));

  const labeller = await makeOfferLabeller(sale.collectionId);
  const lines: SaleDetailLine[] = sale.lines.map((l) => {
    const setLbl = labeller.set(l.offerSet);
    const net = netById.get(l.id);
    return {
      id: l.id,
      offerSetId: l.offerSetId,
      setLabel: setLbl,
      offerId: l.offerId,
      price: Number(l.price).toFixed(2),
      priceBase:
        sale.currency === baseCurrency || sale.fxRateToBase == null
          ? null
          : (Number(l.price) * Number(sale.fxRateToBase)).toFixed(2),
      copyCount: l.items.length,
      setChoicePending: l.setChoicePending,
      setChosenByBuyerAt: l.setChosenByBuyerAt?.toISOString() ?? null,
      itemLabels: l.items.map((li) => labeller.copy(li.item.stamp)),
      netTx: (net?.netTx ?? Number(l.price)).toFixed(2),
      netBase: (net?.netBase ?? Number(l.price)).toFixed(2),
    };
  });

  // Net is a base-currency figure (#206): buyer-side proceeds converted to base, minus my base
  // shipping. For a single-currency collection this equals the old transaction-currency net.
  const rate = sale.fxRateToBase == null ? 1 : Number(sale.fxRateToBase);
  const buyerNetTx = gross + shared.buyerHandling - shared.commission;
  const net = buyerNetTx * rate - shippingBase;

  // What the sale said, else the default its shipping method carries (#491).
  const carrier = sale.carrier ?? sale.shippingMethod?.carrier ?? null;

  // "All packed" hint (#192): true only when the sale has copies and every one is packed. Never
  // changes the status — the detail view surfaces it as a prompt to advance to `packed`.
  const allCopies = sale.lines.flatMap((l) => l.items);
  const allItemsPacked = allCopies.length > 0 && allCopies.every((i) => i.packed);

  return {
    id: sale.id,
    saleNo: sale.saleNo,
    collectionId: sale.collectionId,
    platformId: sale.platformId,
    platformName: sale.platform.name,
    buyerId: sale.buyerId,
    buyerName: sale.buyer?.name ?? null,
    externalRef: sale.externalRef,
    transactionUrl: sale.transactionUrl,
    baseCurrency,
    soldAt: sale.soldAt,
    currency: sale.currency,
    fxRateToBase: sale.fxRateToBase == null ? null : String(sale.fxRateToBase),
    // Total-anchored: show the derived (clamped) handling; handling-anchored: the stored value.
    buyerHandling: sale.buyerPaidTotal != null ? effHandling.toFixed(2) : money(sale.buyerHandling),
    buyerPaidTotal: money(sale.buyerPaidTotal),
    totalBelowGross,
    shippingMethodId: sale.shippingMethodId,
    shippingMethodName: sale.shippingMethodName,
    shippingCost: money(sale.shippingCost),
    shippingCurrency: sale.shippingCurrency,
    shippingBase: sale.shippingCost == null ? null : shippingBase.toFixed(2),
    shippingRateMissing,
    trackingCode: sale.trackingCode,
    carrierId: carrier?.id ?? null,
    carrierName: carrier?.name ?? null,
    trackingUrl: buildTrackingUrl(carrier?.trackingUrlTemplate, sale.trackingCode),
    commission: money(sale.commission),
    grossProceeds: gross.toFixed(2),
    netProceeds: net.toFixed(2),
    status: sale.status,
    allItemsPacked: allItemsPacked,
    lines,
    share: sale.shareToken
      ? {
          address: readShareAddress(sale.shareToken.tokenSealed),
          expiresAt: sale.shareToken.expiresAt?.toISOString() ?? null,
          createdAt: sale.shareToken.createdAt.toISOString(),
          lastUsedAt: sale.shareToken.lastUsedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: sale.createdAt,
  };
}

// ── Delete ──────────────────────────────────────────────────────────────────

/** Delete a sale (ADR-0013). Cascades its lines + line items, so the copies become available
 * again (their sold state is derived). Offers the sale marked `sold` revert to `active`. */
export async function deleteSale(ownerId: string, saleId: string): Promise<void> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      collection: { select: { ownerId: true } },
      lines: { select: { offerId: true } },
    },
  });
  if (!sale || sale.collection.ownerId !== ownerId) {
    throw new Error("Sale not found or access denied.");
  }
  const offerIds = [...new Set(sale.lines.map((l) => l.offerId).filter((id): id is string => !!id))];

  await prisma.$transaction(async (tx) => {
    await tx.sale.delete({ where: { id: saleId } });
    if (offerIds.length > 0) {
      await tx.offer.updateMany({
        where: { id: { in: offerIds }, state: "sold" },
        // The listing is open again, so it is no longer closed: clearing `closedAt` (#512) takes it
        // back out of the generated-photo purge's reach.
        data: { state: "active", closedAt: null },
      });
      // As in `removeSaleLine`: every set the sale held is sellable again, so a listing still up is
      // out of step with it (#700/#542). After the reopen above, so an offer this call just took
      // back out of `sold` is stamped as well.
      await markListingContentChanged(offerIds, tx);
    }
  });
}

// ── Sold-set copies (packing view) ────────────────────────────────────────────

/** Distinct issue ids across every copy sold on a sale, for the detail screen's issue-group
 * headers (loaded once, cheaply). */
export async function getSaleIssueIds(saleId: string): Promise<string[]> {
  const rows = await prisma.issueMember.findMany({
    where: {
      stamp: { items: { some: { saleLineItems: { some: { saleLine: { saleId } } } } } },
    },
    select: { issueId: true },
    distinct: ["issueId"],
  });
  return rows.map((r) => r.issueId);
}

/** An enriched sold copy plus its per-copy packed flag (#192), for the packing view. */
export interface SaleCopyItem extends ItemListItem {
  /** Whether this individual copy has been packed (#192). */
  packed: boolean;
  /** The number (#416) of the offer this copy left through, or null — a line keeps its sale when the
   * offer is later deleted (`SetNull`), and a historical sale then has no listing to name. Printed
   * on the packing list (#474) as the reference the marketplace correspondence is about. */
  offerNo: number | null;
}

/** Merge the per-copy packed flags (keyed by `itemId`, unique in `sale_line_item`) and the offer
 * number behind each copy's line into a set of enriched copies, preserving the enriched order. */
async function withPacked(items: ItemListItem[]): Promise<SaleCopyItem[]> {
  if (items.length === 0) return [];
  const rows = await prisma.saleLineItem.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    select: { itemId: true, packed: true, saleLine: { select: { offer: { select: { offerNo: true } } } } },
  });
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  return items.map((i) => {
    const row = byId.get(i.id);
    return { ...i, packed: row?.packed ?? false, offerNo: row?.saleLine.offer?.offerNo ?? null };
  });
}

/** The physical copies that left on one sale line, as fully-enriched copies with their packed flag.
 * Loaded lazily per sold set on the detail screen so a large sale never enriches every copy up
 * front. */
export async function listSaleLineCopies(
  ownerId: string,
  lineId: string
): Promise<SaleCopyItem[]> {
  const line = await prisma.saleLine.findUnique({
    where: { id: lineId },
    select: {
      sale: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
      items: { select: { itemId: true } },
    },
  });
  if (!line || line.sale.collection.ownerId !== ownerId) {
    throw new Error("Sale line not found or access denied.");
  }
  const ids = line.items.map((i) => i.itemId);
  if (ids.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, line.sale.collectionId, {
    ids,
    pageSize: ids.length,
  });
  return withPacked(items);
}

/** Every physical copy across a whole sale, enriched (with packed flag) for the packing view's
 * flat / by-issue stream. A sale is one buyer's order, so its copy count is inherently bounded. */
export async function listSaleCopies(
  ownerId: string,
  saleId: string
): Promise<SaleCopyItem[]> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      collectionId: true,
      collection: { select: { ownerId: true } },
      lines: { select: { items: { select: { itemId: true } } } },
    },
  });
  if (!sale || sale.collection.ownerId !== ownerId) {
    throw new Error("Sale not found or access denied.");
  }
  const ids = sale.lines.flatMap((l) => l.items.map((i) => i.itemId));
  if (ids.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, sale.collectionId, {
    ids,
    pageSize: ids.length,
  });
  return withPacked(items);
}

// ── Realized proceeds, per copy ───────────────────────────────────────────────

/** What a set of copies has fetched, net, in the base currency (#559). */
export interface RealizedProceeds {
  /** Σ base-currency net proceeds attributed to the asked-about copies, 2 dp. May be negative — a
   * sale whose fees exceeded its price. */
  total: number;
  /** The asked-about copies that have sold and whose proceeds are inside {@link total}. It is a
   * figure over the group, not per copy: a line carried whole (see below) never says what each of
   * its copies fetched, and inventing a per-copy share would be a number nothing computed. */
  resolved: Set<string>;
  /** Copies that have sold but whose share of a mixed sale line could not be resolved (ADR-0012
   * §6.3 blocked the split). They sold; what they fetched is unknown, which is not zero. */
  unresolved: Set<string>;
}

/**
 * Net proceeds attributed to specific copies, across every sale they left on (#559).
 *
 * The allocation is the sale's own (`distributeSaleShared` → `allocateSaleLine`, ADR-0012 §6), run
 * over the **whole** sale rather than the asked-about copies: the shared amounts are distributed
 * across every line by price, so a figure derived from a subset of a sale's lines would not be the
 * one the sale screen shows. A line whose copies are *all* in the asked-about set takes its net
 * whole, without a per-copy split — see `attributeLineToPurchase`, which owns that rule.
 *
 * Ownership is the caller's to assert: this is a read model over ids it is handed.
 */
export async function realizedProceedsForItems(
  collectionId: string,
  itemIds: string[]
): Promise<RealizedProceeds> {
  const byGroup = await realizedProceedsByGroup(
    collectionId,
    new Map(itemIds.map((id) => [id, ""]))
  );
  return byGroup.get("") ?? { total: 0, resolved: new Set(), unresolved: new Set() };
}

/**
 * {@link realizedProceedsForItems} attributed per group, in **one** allocation pass (#650): the
 * Overview's purchase-ROI tile asks the question of every purchase at once, and running the
 * per-items read per purchase would load every touched sale once per purchase — the N+1 the tile
 * rules forbid. `groupOf` maps each asked-about copy to its group key (the purchase id, for that
 * tile); the whole-line shortcut is judged **per group**, so a line made entirely of one group's
 * copies is carried whole exactly as the single-group read carries it, and a line mixing groups is
 * split by the same catalogue weights for each.
 *
 * Every group key in `groupOf` gets an entry, an untouched one the empty figure — a purchase
 * nothing has sold from is a zero, not an absence. Ownership is the caller's to assert.
 */
export async function realizedProceedsByGroup(
  collectionId: string,
  groupOf: Map<string, string>
): Promise<Map<string, RealizedProceeds>> {
  const result = new Map<string, RealizedProceeds>();
  const totalsCents = new Map<string, number>();
  for (const group of groupOf.values()) {
    if (!result.has(group)) {
      result.set(group, { total: 0, resolved: new Set(), unresolved: new Set() });
      totalsCents.set(group, 0);
    }
  }
  const itemIds = [...groupOf.keys()];
  if (itemIds.length === 0) return result;

  const sales = await prisma.sale.findMany({
    where: { collectionId, lines: { some: { items: { some: { itemId: { in: itemIds } } } } } },
    select: {
      currency: true,
      fxRateToBase: true,
      buyerHandling: true,
      buyerPaidTotal: true,
      commission: true,
      shippingCost: true,
      shippingCurrency: true,
      shippingFxRateToBase: true,
      collection: { select: { baseCurrency: true } },
      lines: { select: { id: true, price: true, items: { select: { itemId: true } } } },
    },
  });
  if (sales.length === 0) return result;

  // Only a mixed line needs catalogue weights, but resolving them once for every copy on every
  // touched sale is one query against N — the weights are the same rule the sale screen uses.
  const valuations = await valuateItemsByIds(
    collectionId,
    [...new Set(sales.flatMap((s) => s.lines.flatMap((l) => l.items.map((i) => i.itemId))))]
  );

  // Accumulated in whole cents: a sum of 2-dp shares is exact there and drifts in floats.
  for (const sale of sales) {
    const gross = sale.lines.reduce((sum, l) => sum + Number(l.price), 0);
    const { handling } = resolveBuyerHandling(sale.buyerHandling, sale.buyerPaidTotal, gross);
    const shippingBase = shippingToBase(
      sale.shippingCost,
      sale.shippingCurrency,
      sale.shippingFxRateToBase,
      sale.collection.baseCurrency
    );
    const lineInputs: SaleLineInput[] = sale.lines.map((l) => ({
      id: l.id,
      price: Number(l.price),
    }));
    // Same guard the detail screen applies (#163): the shared amounts are distributed by line
    // price, so a sale with nothing but zero-priced lines cannot be allocated and each line stands
    // at its own price — which is zero, and brings the order nothing until it is priced.
    const canDistribute = gross > 0;
    const nets = canDistribute ? distributeSaleShared({
      buyerHandling: handling,
      shippingBase,
      commission: num(sale.commission),
      fxRateToBase: sale.fxRateToBase == null ? null : Number(sale.fxRateToBase),
    }, lineInputs) : [];
    const netById = new Map(nets.map((n) => [n.id, n.netBase]));

    for (const line of sale.lines) {
      const lineItems = line.items.map((i) => ({
        id: i.itemId,
        catalogPrice: valuations.get(i.itemId)?.baseAmount ?? null,
      }));
      // The groups this line touches — each gets its own attribution over the same line, so the
      // carried-whole rule is judged against that group's copies alone.
      const groups = new Set<string>();
      for (const i of line.items) {
        const group = groupOf.get(i.itemId);
        if (group !== undefined) groups.add(group);
      }
      for (const group of groups) {
        const attributed = attributeLineToPurchase(
          netById.get(line.id) ?? Number(line.price),
          lineItems,
          (itemId) => groupOf.get(itemId) === group
        );
        const entry = result.get(group)!;
        for (const id of attributed.unresolvedItemIds) entry.unresolved.add(id);
        for (const id of attributed.resolvedItemIds) entry.resolved.add(id);
        totalsCents.set(group, totalsCents.get(group)! + Math.round(attributed.proceeds * 100));
      }
    }
  }
  for (const [group, cents] of totalsCents) result.get(group)!.total = cents / 100;
  return result;
}

/** How one copy left the collection — the sale it went out on, from the copy's own side (#517). */
export interface ItemSaleRecord {
  saleId: string;
  saleNo: number;
  soldAt: Date;
  status: string;
  currency: string;
  platformName: string;
  buyerName: string | null;
  /** The sale line's price, in the sale's transaction currency. A line can carry several copies,
   *  so this is the *line's* price and never "what this copy fetched" — there is no such figure. */
  linePrice: string;
  /** How many copies left on that same line, so the price above can be read for what it is. */
  lineItemCount: number;
  /** Whether this individual copy has been packed (#192). */
  packed: boolean;
  /** The number of the offer the copy left through, or null when the offer is since deleted. */
  offerNo: number | null;
  offerId: string | null;
}

/**
 * The sale a copy left on, or null while it is still held. `SaleLineItem` is `@@unique([itemId])`
 * — the no-double-sale invariant (ADR-0012) — so there is at most one, which is what lets the copy
 * detail screen (#517) show a *Sale* card rather than a list.
 */
export async function getItemSaleRecord(
  ownerId: string,
  itemId: string
): Promise<ItemSaleRecord | null> {
  const row = await prisma.saleLineItem.findUnique({
    where: { itemId },
    select: {
      packed: true,
      saleLine: {
        select: {
          price: true,
          offerId: true,
          offer: { select: { offerNo: true } },
          _count: { select: { items: true } },
          sale: {
            select: {
              id: true,
              saleNo: true,
              soldAt: true,
              status: true,
              currency: true,
              collection: { select: { ownerId: true } },
              platform: { select: { name: true } },
              buyer: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  const sale = row.saleLine.sale;
  if (sale.collection.ownerId !== ownerId) {
    throw new Error("Copy not found or access denied.");
  }
  return {
    saleId: sale.id,
    saleNo: sale.saleNo,
    soldAt: sale.soldAt,
    status: sale.status,
    currency: sale.currency,
    platformName: sale.platform.name,
    buyerName: sale.buyer?.name ?? null,
    linePrice: row.saleLine.price.toFixed(2),
    lineItemCount: row.saleLine._count.items,
    packed: row.packed,
    offerNo: row.saleLine.offer?.offerNo ?? null,
    offerId: row.saleLine.offerId,
  };
}
