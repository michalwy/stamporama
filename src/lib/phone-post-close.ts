import "server-only";
import { prisma } from "./db";
import { assertCollectionOwner } from "./platform-category";
import { addSaleLines, createSaleWithLines, listSellableOffers, readSaleHeadline } from "./sales";
import { resolveSaleHeader } from "./sale-header-input";
import { facebookOfferSaleCurrency } from "./facebook-sales";
import { facebookLotSalePrice } from "./facebook-post-rules";
import { planOfferSale, saleTargetOf, type SaleCandidate } from "./offer-sale-plan";
import { isTerminalState, type OfferListingType, type OfferState } from "./offer-rules";
import { setOfferState } from "./offers";
import { isPhoneClosingLot } from "./phone-post-close-rules";

/**
 * Closing a Facebook post from the phone (#2631, ADR-0072 §5): the ticked lots of one winner sold into
 * one sale, and the ticked lots left withdrawn — the desk post screen's ticks and *Sell…* (#2050), and
 * its lots' own *Withdraw*, asked of the lots by the post. Every write is the desk's: the sale through
 * the desk's sale plan (`planOfferSale`) and its line guards, the withdrawal through `setOfferState`.
 */

/** Who won the ticked lots, and where they go. */
export interface PhonePostSaleInput {
  /** The buyer's name as their Facebook profile shows it; blank is a buyer unknown, as the desk allows. */
  buyerName: string;
  /** The buyer's Facebook profile link (#1777); blank is the name alone. */
  buyerFacebookProfileUrl: string;
  /** One of the buyer's open sales to add the lots to, or null for a new sale. */
  saleId: string | null;
}

export type PhonePostSaleResult =
  | {
      ok: true;
      saleId: string;
      saleNo: number;
      buyerName: string | null;
      created: boolean;
      /** The lots that went into the sale, by number. */
      soldLotNos: number[];
      /** The ticked lots the sale could not take, with why. */
      skipped: { lotNo: number; reason: string }[];
    }
  | { ok: false; message: string };

interface PostLot extends SaleCandidate {
  lotNo: number;
  state: OfferState;
}

/** The post's lots among `offerIds`, in lot order — or the reason the ticks do not stand. */
async function readTickedLots(
  ownerId: string,
  collectionId: string,
  postId: string,
  offerIds: readonly string[]
): Promise<{ ok: true; lots: PostLot[] } | { ok: false; message: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const post = await prisma.facebookPost.findFirst({ where: { id: postId, collectionId }, select: { id: true } });
  if (!post) return { ok: false, message: "The post is not in this collection." };
  const wanted = [...new Set(offerIds)];
  if (wanted.length === 0) return { ok: false, message: "No lot is ticked." };
  const rows = await prisma.offer.findMany({
    where: { facebookPostId: postId, id: { in: wanted } },
    orderBy: { facebookLotNo: "asc" },
    select: {
      id: true,
      offerNo: true,
      facebookLotNo: true,
      state: true,
      listingType: true,
      price: true,
      startingPrice: true,
      currency: true,
      platformId: true,
      platform: { select: { name: true } },
    },
  });
  if (rows.length !== wanted.length) return { ok: false, message: "A ticked lot is no longer in this post." };
  return {
    ok: true,
    lots: rows.map((row, i) => {
      const state = row.state as OfferState;
      const price = row.price.toFixed(2);
      return {
        id: row.id,
        offerNo: row.offerNo,
        // A post of one numbers its lot 1, as its screen does.
        lotNo: row.facebookLotNo ?? i + 1,
        state,
        platformId: row.platformId,
        platformName: row.platform.name,
        currency: row.currency,
        // The lot's own price — an auction's last recorded bid (#1545) — exactly what the desk's *Sell…*
        // puts on the line.
        price: facebookLotSalePrice({
          state,
          listingType: row.listingType as OfferListingType,
          price,
          startingPrice: row.startingPrice?.toFixed(2) ?? null,
        }),
        closed: isTerminalState(state),
      };
    }),
  };
}

/**
 * Sell the ticked lots of a post to one buyer (#2631): every set each still has, at its own price, into
 * a new sale dated today — written with its lines in one transaction, as the phone's *Sell* writes one
 * (#2009) — or into one of the buyer's open sales, as the desk adds lines to one. A lot the sale cannot
 * take is left out and named, as the desk's dialog names it.
 */
export async function sellPhonePostLots(
  ownerId: string,
  collectionId: string,
  postId: string,
  offerIds: readonly string[],
  input: PhonePostSaleInput,
  today: string
): Promise<PhonePostSaleResult> {
  const read = await readTickedLots(ownerId, collectionId, postId, offerIds);
  if (!read.ok) return read;
  const target = saleTargetOf(read.lots);
  const sellable = target
    ? await listSellableOffers(ownerId, collectionId, { platformId: target.platformId })
    : [];
  const plan = planOfferSale(read.lots, target, new Map(sellable.map((o) => [o.offerId, o.sets])));
  if (!target || plan.lines.length === 0) return { ok: false, message: "None of the ticked lots can be sold." };
  const skipped = plan.skipped.map((s) => ({ lotNo: s.offer.lotNo, reason: s.reason }));
  const soldLotNos = plan.sold.map((lot) => lot.lotNo);

  if (input.saleId) {
    await addSaleLines(ownerId, input.saleId, plan.lines);
    const headline = await readSaleHeadline(ownerId, input.saleId);
    return {
      ok: true,
      saleId: input.saleId,
      saleNo: headline.saleNo,
      buyerName: headline.buyerName,
      created: false,
      soldLotNos,
      skipped,
    };
  }

  const offerCurrency = await facebookOfferSaleCurrency(ownerId, collectionId, plan.sold[0].id);
  const header = await resolveSaleHeader(collectionId, {
    platformId: target.platformId,
    platformName: target.platformName,
    buyerId: null,
    buyerName: input.buyerName || null,
    ...(offerCurrency ? { buyerFacebookProfileUrl: input.buyerFacebookProfileUrl } : {}),
    externalRef: "",
    transactionUrl: "",
    soldAt: today,
    currency: target.currency,
    handlingMode: "direct",
    buyerHandling: "",
    buyerPaidTotal: "",
    commission: "",
  });
  if (!header.ok) return { ok: false, message: header.message };

  const saleId = await createSaleWithLines(
    ownerId,
    collectionId,
    {
      platformId: header.platformId,
      buyerId: header.buyerId,
      externalRef: header.externalRef,
      transactionUrl: header.transactionUrl,
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      buyerPaidTotal: header.buyerPaidTotal,
      commission: header.commission,
      shipping: header.shipping,
    },
    plan.lines,
    offerCurrency ? { offerCurrency } : {}
  );
  const headline = await readSaleHeadline(ownerId, saleId);
  return { ok: true, saleId, saleNo: headline.saleNo, buyerName: headline.buyerName, created: true, soldLotNos, skipped };
}

/**
 * Withdraw the ticked lots of a post (#2631), each as its own *Withdraw* goes (`setOfferState`), so its
 * copies are free to be listed again; the post and its other lots stay up. A lot sold or withdrawn since
 * it was ticked is passed over. Only a lot still up is withdrawn here: a lot of a post waiting for the
 * group's approval would take the whole post with it (#1779), which is the desk's *Withdraw post…*.
 * A refusal halfway leaves the lots before it withdrawn; asking again finishes the rest.
 */
export async function withdrawPhonePostLots(
  ownerId: string,
  collectionId: string,
  postId: string,
  offerIds: readonly string[]
): Promise<{ ok: true; withdrawnLotNos: number[] } | { ok: false; message: string }> {
  const read = await readTickedLots(ownerId, collectionId, postId, offerIds);
  if (!read.ok) return read;
  const going = read.lots.filter((lot) => !lot.closed);
  const notUp = going.find((lot) => !isPhoneClosingLot(lot));
  if (notUp) return { ok: false, message: `Lot ${notUp.lotNo} is not up in the group — withdraw it at the desk.` };
  for (const lot of going) await setOfferState(ownerId, lot.id, "withdrawn");
  return { ok: true, withdrawnLotNos: going.map((lot) => lot.lotNo) };
}
