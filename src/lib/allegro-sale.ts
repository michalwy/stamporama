import "server-only";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import { getAllegroAccessToken } from "./allegro-connection";
import { getAllegroOrder, type AllegroOrder as AllegroApiOrder } from "./allegro-api";
import { allegroOrderPageUrl } from "./allegro-oauth";
import { getShippingMethods } from "./shipping-methods";
import { listSellableOffers, createSale, addSaleLines, setSaleStatus } from "./sales";
import type { AllegroPaymentStatus } from "./allegro-sync-rules";
import { matchShippingMethod, type ShippingPrefill } from "./allegro-sale-rules";
// The three an order-shaped sale needs whatever marketplace it came from (#612 moved them out of
// the Allegro-named module): which sets a line stands for, what day it is dated, who the buyer is.
import {
  buyerIdentityFor,
  mapLineToSets,
  saleDateOf,
  type LineSkipReason,
} from "./order-sale-rules";
import type { ResolvedSaleHeader } from "./sale-header-input";

/**
 * An Allegro order becoming a `Sale` (#463) — the write half of the worklist (#467).
 *
 * Two calls, and the gap between them is the whole point:
 *
 *  • {@link getAllegroOrderSalePrefill} reads. It works out what the sale *would* be — the buyer,
 *    the amounts, the order number, the delivery method, and which of the collector's offer sets
 *    each ordered line stands for — and writes nothing at all.
 *  • {@link recordAllegroOrderSale} writes, and only ever from a header the collector has looked at
 *    and saved. **A financial record is never created because a sync ran.** That is the rule the
 *    whole Allegro cluster is built around, and this module is where it would be broken if it were
 *    going to be.
 *
 * The prefill reads the order **again**, live, rather than using the columns the sync stored. The
 * delivery method and the buyer's email are the sale's and were deliberately never stored (ADR-0024)
 * — and a fresh read is also the last chance to notice that Allegro now says something different
 * from what the worklist is showing. When that read fails the prefill still comes back, built from
 * the stored row and saying which parts are missing: degrading to manual entry is the required
 * behaviour, and a dialog that refused to open because Allegro was briefly unreachable would be a
 * worse one.
 */

// ---------------------------------------------------------------------------
// Reading: what the sale would be
// ---------------------------------------------------------------------------

/** One offer set the flow proposes to record as sold, priced from the order. */
export interface AllegroSaleSetPrefill {
  offerSetId: string;
  label: string;
  itemIds: string[];
  /** What the buyer paid for one unit of the line, which is what one set went for. */
  price: string;
}

export interface AllegroSaleLinePrefill {
  /** The `AllegroOrderLine` row, so the dialog can key on something stable. */
  lineId: string;
  platformOfferId: string;
  title: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  offer: { id: string; offerNo: number; label: string } | null;
  sets: AllegroSaleSetPrefill[];
  /** Why this line contributes nothing, when it does not. Null on a line that will be recorded. */
  skipped: LineSkipReason | null;
}

/** Who the sale went to, and how much of that is already known here. */
export interface AllegroSaleBuyerPrefill {
  login: string | null;
  /** The name the sale opens with — the buyer's Allegro login, which is what a buyer is filed under
   *  here. Null leaves the sale anonymous. */
  name: string | null;
  /** The name on the order, where that is not the name above. Written to the contact's `fullName`
   *  only where it has none. */
  fullName: string | null;
  email: string | null;
  /** An existing contact of this collection that is this buyer, where there is one. Null means the
   *  form will offer to create it — which the collector then confirms by saving. */
  contactId: string | null;
  /** How that contact was recognised, so the review can say which — a contact found under the legal
   *  name is worth pointing out, since it is *not* how this flow would file them. */
  matchedBy: "login" | "full-name" | null;
}

export interface AllegroSalePrefill {
  orderId: string;
  /** The order on Allegro, for `Sale.transactionUrl`. */
  orderUrl: string;
  boughtAt: string;
  /** `YYYY-MM-DD`, as the sale form's date input takes it. */
  soldAt: string;
  paymentStatus: AllegroPaymentStatus;
  /** Allegro's own status verbatim, for the one line that reports a cancelled order. */
  orderStatus: string;
  currency: string;
  /** What the buyer paid in total, delivery included — `Sale.buyerPaidTotal`'s anchor (#205), from
   *  which handling is derived. Blank where Allegro stated no summary. */
  totalPaid: string;
  platform: { id: string; name: string; platformCurrency: string | null } | null;
  buyer: AllegroSaleBuyerPrefill;
  /** Null where the order carries no delivery, or where the live read did not happen. */
  shipping: ShippingPrefill | null;
  lines: AllegroSaleLinePrefill[];
  /** The sale already claiming this order. Non-null exactly in the partially recorded case: the
   *  worklist keeps such an order visible, and the flow adds the remaining lines to *this* sale
   *  rather than starting a second one. */
  existingSale: { id: string; saleNo: number } | null;
  /** Why the live read of the order did not happen, when it did not. The prefill is still usable —
   *  it simply carries no delivery method and no email. */
  liveReadError: string | null;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** Raised for the ways recording is refused, so the caller can say which. Mirrors
 *  `AllegroLinkError`: "this order is already sale #12" is an answer, and "failed" is not. */
export class AllegroSaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllegroSaleError";
  }
}

/** The live read, or the reason there wasn't one. Never throws: every failure here is something the
 *  collector can work around by typing, and none of them is worth refusing to open a dialog over. */
async function readOrderLive(
  ownerId: string,
  collectionId: string,
  orderId: string
): Promise<{ order: AllegroApiOrder | null; sandbox: boolean; error: string | null }> {
  try {
    const token = await getAllegroAccessToken(ownerId, collectionId);
    const order = await getAllegroOrder({ ...token, orderId });
    return {
      order,
      sandbox: token.sandbox,
      error: order ? null : "Allegro no longer has this order.",
    };
  } catch (err) {
    // The order link is still worth offering, and which host it points at is a property of the
    // *connection* rather than of the call that just failed — so it is read from the row rather
    // than guessed at. Production for a collection that has no connection at all, which is the only
    // honest default left.
    const connection = await prisma.allegroConnection.findUnique({
      where: { collectionId },
      select: { sandbox: true },
    });
    return {
      order: null,
      sandbox: connection?.sandbox ?? false,
      error: err instanceof Error ? err.message : "Allegro could not be reached.",
    };
  }
}

export async function getAllegroOrderSalePrefill(
  ownerId: string,
  collectionId: string,
  orderId: string
): Promise<AllegroSalePrefill> {
  await assertCollectionOwner(ownerId, collectionId);

  const order = await prisma.allegroOrder.findUnique({
    where: { collectionId_orderId: { collectionId, orderId } },
    select: {
      orderId: true,
      status: true,
      paymentStatus: true,
      boughtAt: true,
      buyerLogin: true,
      buyerName: true,
      totalPaid: true,
      currency: true,
      lines: {
        orderBy: { boughtAt: "asc" },
        select: {
          id: true,
          platformOfferId: true,
          title: true,
          quantity: true,
          unitPrice: true,
          currency: true,
          offerId: true,
          offer: { select: { id: true, offerNo: true, name: true } },
        },
      },
    },
  });
  if (!order) throw new AllegroSaleError("That Allegro order is not in this collection.");

  const [modulePlatform, live] = await Promise.all([
    getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE),
    readOrderLive(ownerId, collectionId, orderId),
  ]);
  // The platform's fixed currency (#196) comes with it: the sale form locks its currency field from
  // it, and a pre-filled platform whose currency was unknown would fall back to an editable picker
  // defaulting to the base currency — on a sale whose currency the order already states.
  const platform = modulePlatform
    ? {
        ...modulePlatform,
        platformCurrency:
          (
            await prisma.contact.findUnique({
              where: { id: modulePlatform.id },
              select: { platformCurrency: true },
            })
          )?.platformCurrency ?? null,
      }
    : null;

  // The sale the order may already partly be. Its lines are what tells the flow which of the
  // order's lines are done — matched on the offer, which is the only thing the two sides share.
  const claimed = await prisma.sale.findFirst({
    where: { collectionId, externalRef: orderId },
    select: { id: true, saleNo: true, lines: { select: { offerId: true } } },
  });
  const recordedOfferIds = new Set(
    (claimed?.lines ?? []).flatMap((line) => (line.offerId ? [line.offerId] : []))
  );

  // The sets still sellable, per offer. Read once for the whole platform rather than per line: a
  // multi-item order is several offers, and the picker's own reader already answers this exactly.
  const sellable = platform
    ? await listSellableOffers(ownerId, collectionId, { platformId: platform.id })
    : [];
  const sellableByOffer = new Map(sellable.map((offer) => [offer.offerId, offer]));

  const lines: AllegroSaleLinePrefill[] = order.lines.map((line) => {
    const unitPrice = line.unitPrice.toFixed(2);
    const base = {
      lineId: line.id,
      platformOfferId: line.platformOfferId,
      title: line.title,
      quantity: line.quantity,
      unitPrice,
      currency: line.currency,
    };
    if (!line.offer) {
      return { ...base, offer: null, sets: [], skipped: "unmatched" as const };
    }
    const offer = {
      id: line.offer.id,
      offerNo: line.offer.offerNo,
      label: line.offer.name ?? `Offer #${line.offer.offerNo}`,
    };
    if (recordedOfferIds.has(line.offer.id)) {
      return { ...base, offer, sets: [], skipped: "recorded" as const };
    }
    const mapping = mapLineToSets(line.quantity, sellableByOffer.get(line.offer.id)?.sets ?? []);
    return {
      ...base,
      offer,
      sets: mapping.sets.map((set) => ({
        offerSetId: set.offerSetId,
        label: set.label,
        itemIds: set.itemIds,
        price: unitPrice,
      })),
      skipped: mapping.skipped,
    };
  });

  // How it is being sent, matched against the platform's own price list (#468). Only from the live
  // read: the sync never stored a delivery method, so a failed read means there is nothing to match
  // and the field opens empty rather than opening on a guess.
  const shipping =
    platform && live.order?.delivery
      ? matchShippingMethod(
          await getShippingMethods(ownerId, platform.id),
          live.order.delivery.methodName
        )
      : null;

  const identity = buyerIdentityFor({
    buyerName: live.order?.buyerName ?? order.buyerName,
    buyerLogin: live.order?.buyerLogin ?? order.buyerLogin,
  });
  const buyer = await findBuyerContact(collectionId, identity);

  return {
    orderId: order.orderId,
    orderUrl: allegroOrderPageUrl(live.sandbox, order.orderId),
    boughtAt: order.boughtAt.toISOString(),
    soldAt: saleDateOf(order.boughtAt),
    paymentStatus: order.paymentStatus as AllegroPaymentStatus,
    orderStatus: order.status,
    currency: order.currency ?? order.lines[0]?.currency ?? "",
    totalPaid: live.order?.totalPaid ?? order.totalPaid?.toFixed(2) ?? "",
    platform,
    buyer: {
      login: live.order?.buyerLogin ?? order.buyerLogin,
      name: identity.name,
      fullName: identity.fullName,
      email: live.order?.buyerEmail ?? null,
      contactId: buyer.contactId,
      matchedBy: buyer.matchedBy,
    },
    shipping,
    lines,
    existingSale: claimed ? { id: claimed.id, saleNo: claimed.saleNo } : null,
    liveReadError: live.error,
  };
}

/**
 * The contact this buyer already is, if any.
 *
 * Looked for **two ways**, because a buyer may have been written down either way before this flow
 * existed: under their login — which is how this flow files them and the first thing tried — and
 * under the legal name, which is where an address book kept by hand often has them. Case-insensitive
 * throughout, the same test `resolvePurchaseContact` applies when the form is saved, so what the
 * dialog shows and what the save does cannot disagree.
 *
 * Deliberately **not** narrowed to the `buyer` role: a contact who has so far only been a seller is
 * still the same person, and a second row for them is exactly the silent duplication this exists to
 * prevent.
 */
async function findBuyerContact(
  collectionId: string,
  identity: { name: string | null; fullName: string | null }
): Promise<{ contactId: string | null; matchedBy: "login" | "full-name" | null }> {
  if (identity.name) {
    const byName = await prisma.contact.findFirst({
      where: { collectionId, name: { equals: identity.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (byName) return { contactId: byName.id, matchedBy: "login" };
  }
  if (identity.fullName) {
    // Either a contact named with the legal name, or one already carrying it beside their login.
    const byFullName = await prisma.contact.findFirst({
      where: {
        collectionId,
        OR: [
          { name: { equals: identity.fullName, mode: "insensitive" } },
          { fullName: { equals: identity.fullName, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (byFullName) return { contactId: byFullName.id, matchedBy: "full-name" };
  }
  return { contactId: null, matchedBy: null };
}

// ---------------------------------------------------------------------------
// Writing: the sale the collector confirmed
// ---------------------------------------------------------------------------

/** One set the collector confirmed as sold, exactly as `addSaleLines` takes it. */
export interface AllegroSaleLineInput {
  offerId: string;
  offerSetId: string;
  price: string;
  itemIds: string[];
}

export interface RecordAllegroSaleResult {
  saleId: string;
  saleNo: number;
  /** Whether a sale was created, or lines were added to the one that already claimed this order. */
  created: boolean;
  /** The sale exists, but its lines did not go on. Reported rather than thrown, because the header
   *  is real and the collector should land on it and finish by hand. */
  linesError: string | null;
}

/**
 * Record the sale the collector has just reviewed.
 *
 * **One order is one sale, for ever.** Where a sale already carries this order number it is added
 * to rather than duplicated — which is what makes the partially recorded case work, and what makes a
 * double confirmation harmless: the second one contributes the lines the first did not, and
 * `sale_line_item`'s unique on `itemId` refuses any copy that has already gone.
 */
export async function recordAllegroOrderSale(
  ownerId: string,
  collectionId: string,
  orderId: string,
  header: ResolvedSaleHeader,
  lines: AllegroSaleLineInput[]
): Promise<RecordAllegroSaleResult> {
  await assertCollectionOwner(ownerId, collectionId);

  const order = await prisma.allegroOrder.findUnique({
    where: { collectionId_orderId: { collectionId, orderId } },
    select: { paymentStatus: true, supersededByOrderId: true },
  });
  if (!order) throw new AllegroSaleError("That Allegro order is not in this collection.");
  // The order was merged into another one while this screen was open (#495). Recording it would put
  // a sale against a checkout form Allegro has abandoned, and the same purchases are still offered —
  // on the order that took them over.
  if (order.supersededByOrderId) {
    throw new AllegroSaleError(
      `Allegro merged this order into order ${order.supersededByOrderId}. Record that one instead.`
    );
  }
  if (lines.length === 0) {
    throw new AllegroSaleError(
      "Nothing on this order can be recorded automatically. Record it from the offer's own screen."
    );
  }

  const existing = await prisma.sale.findFirst({
    where: { collectionId, externalRef: orderId },
    select: { id: true, saleNo: true },
  });

  if (existing) {
    // Adding to the sale that already claims this order. Its header is the collector's own record
    // and is left exactly as it stands — this is the remainder of an order, not a correction of a
    // sale.
    await addSaleLines(ownerId, existing.id, lines);
    return { saleId: existing.id, saleNo: existing.saleNo, created: false, linesError: null };
  }

  const saleId = await createSale(ownerId, collectionId, {
    platformId: header.platformId,
    buyerId: header.buyerId,
    // The order number is this flow's own, never the form's: it is the key the worklist drops the
    // order on, and a sale created here that carried a different one would leave the order waiting
    // for ever.
    externalRef: orderId,
    transactionUrl: header.transactionUrl,
    soldAt: header.soldAt,
    currency: header.currency,
    buyerHandling: header.buyerHandling,
    buyerPaidTotal: header.buyerPaidTotal,
    commission: header.commission,
    shipping: header.shipping,
  });

  let linesError: string | null = null;
  try {
    await addSaleLines(ownerId, saleId, lines);
  } catch (err) {
    // The header exists even though the sets did not go on — the same outcome the quick-sell flow
    // accepts (#225). Reported, so the collector lands on a real sale and finishes it there.
    linesError = err instanceof Error ? err.message : "The sold sets could not be added.";
  }

  // Allegro's payment status is the `ordered → paid` step of the fulfillment lifecycle (#191), and
  // it is a fact about this order rather than an inference. Only ever forward, and only on a sale
  // this call created: a sale the collector has already moved along is not walked back.
  if (order.paymentStatus === "paid") {
    try {
      await setSaleStatus(ownerId, saleId, "paid");
    } catch {
      // A status that would not advance is not worth failing a recorded sale over; the sale is
      // there, at `ordered`, and the status is one click on its own screen.
    }
  }

  const created = await prisma.sale.findUnique({ where: { id: saleId }, select: { saleNo: true } });
  return { saleId, saleNo: created?.saleNo ?? 0, created: true, linesError };
}

/**
 * Fill in what the order knows about the buyer — their email and the name on the paperwork —
 * **only where the contact has neither**.
 *
 * The only thing this flow adds to a contact, and the narrowest form of it: an empty field gains
 * what Allegro says, and a field the collector filled in is never overwritten by a marketplace.
 * `fullName` matters because a buyer is filed under their login here: without it the legal name the
 * parcel has to carry lives nowhere but the order.
 *
 * Runs after the sale is recorded, so nothing here can cost the collector the sale.
 */
export async function fillBuyerDetailsFromOrder(
  ownerId: string,
  collectionId: string,
  buyerId: string,
  details: { email: string | null; fullName: string | null }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const contact = await prisma.contact.findFirst({
    where: { id: buyerId, collectionId },
    select: { id: true, email: true, fullName: true },
  });
  if (!contact) return;
  const data: { email?: string; fullName?: string } = {};
  if (details.email && !contact.email) data.email = details.email;
  if (details.fullName && !contact.fullName) data.fullName = details.fullName;
  if (Object.keys(data).length === 0) return;
  await prisma.contact.update({ where: { id: contact.id }, data });
}
