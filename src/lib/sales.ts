import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getOrFetchRate } from "./exchange-rates";
import { type OfferState, isOfferState } from "./offer-rules";
import { deriveSetLabel, deriveOfferLabel } from "./offer-set-rules";
import { isSellableOfferState } from "./sale-rules";
import { distributeSaleShared, type SaleLineInput } from "./sale-allocation";
import { listItemsPaginated, type ItemListItem } from "./items";

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
  | "already-sold";

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

/** Short copy label from a stamp select — primary catalog number, else name. */
function copyLabel(stamp: {
  name: string | null;
  catalogNumbers: { number: string }[];
}): string {
  return stamp.catalogNumbers[0]?.number ?? stamp.name ?? "Copy";
}

const STAMP_LABEL_SELECT = {
  stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } },
} as const;

/** Item ids already retired on a sale line, from a candidate set (no-double-sale). */
async function soldItemIds(itemIds: string[]): Promise<Set<string>> {
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

const SELLABLE_OFFER_SELECT = {
  id: true,
  platformId: true,
  price: true,
  currency: true,
  state: true,
  createdAt: true,
  platform: { select: { name: true } },
  sets: {
    orderBy: { id: "asc" as const },
    select: {
      id: true,
      title: true,
      items: { select: { itemId: true, item: { select: STAMP_LABEL_SELECT } } },
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

  const offers: SellableOffer[] = [];
  for (const r of rows) {
    const sets: SaleSetOption[] = [];
    for (const s of r.sets) {
      // A set is available only when it holds ≥1 copy and none has already sold — a set is
      // atomic, so a single already-sold copy retires the whole set.
      if (s.items.length === 0 || s.items.some((li) => sold.has(li.itemId))) continue;
      const itemLabels = s.items.map((li) => copyLabel(li.item.stamp));
      sets.push({
        offerSetId: s.id,
        label: deriveSetLabel(s.title, itemLabels),
        itemIds: s.items.map((li) => li.itemId),
        itemLabels,
      });
    }
    if (sets.length === 0) continue;

    offers.push({
      offerId: r.id,
      platformId: r.platformId,
      platformName: r.platform.name,
      offerLabel: deriveOfferLabel(
        r.sets.map((s) => deriveSetLabel(s.title, s.items.map((li) => copyLabel(li.item.stamp))))
      ),
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
  soldAt: Date;
  currency: string;
  /** Buyer-paid handling (+) and platform commission (−) are known at sale time, so they live on
   * the header. My actual shipping (−) is learned later and set on the detail screen. */
  buyerHandling: string | null;
  /** The total the buyer paid, when it is the anchor instead of handling (#205). Mutually exclusive
   * with `buyerHandling` — at most one is non-null; the other is stored null. */
  buyerPaidTotal: string | null;
  commission: string | null;
}

export interface SaleLineDraft {
  offerId: string;
  /** The offer set that sold (`SaleLine.offerSetId`). */
  offerSetId: string;
  /** Line sale price in the sale's transaction currency. */
  price: string;
  /** The exact copies that left — must be the full current copy set of `offerSetId`. */
  itemIds: string[];
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
  const sale = await prisma.sale.create({
    data: {
      collectionId,
      platformId: input.platformId,
      buyerId: input.buyerId,
      externalRef: input.externalRef,
      soldAt: input.soldAt,
      currency,
      fxRateToBase,
      buyerHandling: input.buyerHandling,
      buyerPaidTotal: input.buyerPaidTotal,
      commission: input.commission,
      // Seed the transition log with the initial `ordered` event (#191), so every sale has a
      // non-empty status timeline from the moment it is recorded.
      statusEvents: { create: { status: "ordered" } },
    },
    select: { id: true },
  });
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
 * has sold sets — a sale is single-platform and its lines reference offers on that platform. My
 * shipping cost is not touched here. */
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
  await prisma.sale.update({
    where: { id: saleId },
    data: {
      platformId: input.platformId,
      buyerId: input.buyerId,
      externalRef: input.externalRef,
      soldAt: input.soldAt,
      fxRateToBase,
      buyerHandling: input.buyerHandling,
      buyerPaidTotal: input.buyerPaidTotal,
      commission: input.commission,
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

/** Set (or clear) my shipping cost in any currency (#206). Freezes the shipping currency's base
 * rate at save time — independent of the sale's transaction currency — so profit is computed in the
 * base currency. A blank amount clears all three shipping fields. */
export async function updateSaleShipping(
  ownerId: string,
  saleId: string,
  amount: string | null,
  currency: string
): Promise<void> {
  const ref = await assertSaleOwner(ownerId, saleId);
  if (amount == null) {
    await prisma.sale.update({
      where: { id: saleId },
      data: { shippingCost: null, shippingCurrency: null, shippingFxRateToBase: null },
    });
    return;
  }
  const shippingFxRateToBase = await freezeFxRate(ref.collectionId, currency, ref.baseCurrency);
  await prisma.sale.update({
    where: { id: saleId },
    data: { shippingCost: amount, shippingCurrency: currency, shippingFxRateToBase },
  });
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
            items: { create: line.itemIds.map((itemId) => ({ itemId })) },
          },
        });
      }
      // Flip an offer to `sold` only once every set has sold through it (the only stored side
      // effect; set / item sold state stays derived).
      for (const offerId of offerIds) {
        if (await isOfferFullySold(tx, offerId)) {
          await tx.offer.update({ where: { id: offerId }, data: { state: "sold" } });
        }
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new SaleActionBlockedError("already-sold", "One or more of these copies has already been sold.");
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
    }
  });
}

// ── List ──────────────────────────────────────────────────────────────────

export interface SaleListItem {
  id: string;
  platformId: string;
  platformName: string;
  /** The buyer's name, or null when unknown/anonymous. */
  buyerName: string | null;
  /** External system's transaction / order number, or null. */
  externalRef: string | null;
  /** Fulfillment status (#191): ordered | paid | packed | sent | received. */
  status: string;
  soldAt: Date;
  currency: string;
  lineCount: number;
  itemCount: number;
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
  platformId: true,
  externalRef: true,
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
  lines: { select: { price: true, _count: { select: { items: true } } } },
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
    platformId: string;
    externalRef: string | null;
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
    lines: { price: Prisma.Decimal; _count: { items: number } }[];
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
    platformId: row.platformId,
    platformName: row.platform.name,
    buyerName: row.buyer?.name ?? null,
    externalRef: row.externalRef,
    status: row.status,
    soldAt: row.soldAt,
    currency: row.currency,
    lineCount: row.lines.length,
    itemCount: row.lines.reduce((s, l) => s + l._count.items, 0),
    baseCurrency,
    grossProceeds: gross.toFixed(2),
    netProceeds: netBase.toFixed(2),
    createdAt: row.createdAt,
  };
}

export interface SaleListFilters {
  platformId?: string;
  /** Free-text search over buyer name, platform name, external reference, and the stamp name /
   * catalog numbers of the copies sold on the sale (#193). Case-insensitive substring match. */
  search?: string;
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
      ...(filters.search ? saleSearchWhere(filters.search) : {}),
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

/** Distinct platforms that currently have at least one sale, for the list-screen filter. */
export async function listSalePlatforms(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.sale.findMany({
    where: { collectionId },
    select: { platform: { select: { id: true, name: true } } },
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
  itemLabels: string[];
  /** This line's resolved net proceeds in the transaction currency (allocation engine). */
  netTx: string;
  /** …and converted to the base currency at the frozen FX rate. */
  netBase: string;
}

export interface SaleDetail {
  id: string;
  collectionId: string;
  platformId: string;
  platformName: string;
  buyerId: string | null;
  buyerName: string | null;
  externalRef: string | null;
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
  createdAt: Date;
}

/** Full sale read model for the detail view (ADR-0013). Runs the pure allocation engine
 * (`distributeSaleShared`, #163) to resolve each line's net proceeds. */
export async function getSaleDetail(ownerId: string, saleId: string): Promise<SaleDetail | null> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      collectionId: true,
      platformId: true,
      buyerId: true,
      externalRef: true,
      soldAt: true,
      currency: true,
      fxRateToBase: true,
      buyerHandling: true,
      buyerPaidTotal: true,
      shippingCost: true,
      shippingCurrency: true,
      shippingFxRateToBase: true,
      commission: true,
      status: true,
      createdAt: true,
      collection: { select: { ownerId: true, baseCurrency: true } },
      platform: { select: { name: true } },
      buyer: { select: { name: true } },
      lines: {
        select: {
          id: true,
          offerSetId: true,
          offerId: true,
          price: true,
          offerSet: {
            select: {
              title: true,
              items: { select: { item: { select: STAMP_LABEL_SELECT } } },
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

  const lines: SaleDetailLine[] = sale.lines.map((l) => {
    const setLbl = deriveSetLabel(
      l.offerSet.title,
      l.offerSet.items.map((li) => copyLabel(li.item.stamp))
    );
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
      itemLabels: l.items.map((li) => copyLabel(li.item.stamp)),
      netTx: (net?.netTx ?? Number(l.price)).toFixed(2),
      netBase: (net?.netBase ?? Number(l.price)).toFixed(2),
    };
  });

  // Net is a base-currency figure (#206): buyer-side proceeds converted to base, minus my base
  // shipping. For a single-currency collection this equals the old transaction-currency net.
  const rate = sale.fxRateToBase == null ? 1 : Number(sale.fxRateToBase);
  const buyerNetTx = gross + shared.buyerHandling - shared.commission;
  const net = buyerNetTx * rate - shippingBase;

  // "All packed" hint (#192): true only when the sale has copies and every one is packed. Never
  // changes the status — the detail view surfaces it as a prompt to advance to `packed`.
  const allCopies = sale.lines.flatMap((l) => l.items);
  const allItemsPacked = allCopies.length > 0 && allCopies.every((i) => i.packed);

  return {
    id: sale.id,
    collectionId: sale.collectionId,
    platformId: sale.platformId,
    platformName: sale.platform.name,
    buyerId: sale.buyerId,
    buyerName: sale.buyer?.name ?? null,
    externalRef: sale.externalRef,
    baseCurrency,
    soldAt: sale.soldAt,
    currency: sale.currency,
    fxRateToBase: sale.fxRateToBase == null ? null : String(sale.fxRateToBase),
    // Total-anchored: show the derived (clamped) handling; handling-anchored: the stored value.
    buyerHandling: sale.buyerPaidTotal != null ? effHandling.toFixed(2) : money(sale.buyerHandling),
    buyerPaidTotal: money(sale.buyerPaidTotal),
    totalBelowGross,
    shippingCost: money(sale.shippingCost),
    shippingCurrency: sale.shippingCurrency,
    shippingBase: sale.shippingCost == null ? null : shippingBase.toFixed(2),
    shippingRateMissing,
    commission: money(sale.commission),
    grossProceeds: gross.toFixed(2),
    netProceeds: net.toFixed(2),
    status: sale.status,
    allItemsPacked: allItemsPacked,
    lines,
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
        data: { state: "active" },
      });
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
}

/** Merge the per-copy packed flags (keyed by `itemId`, unique in `sale_line_item`) into a set of
 * enriched copies, preserving the enriched order. */
async function withPacked(items: ItemListItem[]): Promise<SaleCopyItem[]> {
  if (items.length === 0) return [];
  const rows = await prisma.saleLineItem.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    select: { itemId: true, packed: true },
  });
  const packedById = new Map(rows.map((r) => [r.itemId, r.packed]));
  return items.map((i) => ({ ...i, packed: packedById.get(i.id) ?? false }));
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
