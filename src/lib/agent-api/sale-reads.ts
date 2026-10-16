// What the sale operations answer with, and the projections that build it (#1949).
//
// **Pure, and structurally typed on purpose**, the shape every `*-reads.ts` beside it has and for
// their reason (`agent-api.md`, *The module layout is the Prisma-free split*). No Prisma, no
// `server-only`, so `pnpm test:unit` holds every decision below.
//
// Three of them are worth a test:
//
//  - **A buyer is two fields and a link, never more.** The contact behind a buyer also carries an
//    email, a phone, an address and notes — a private person's details, out of this surface's reach
//    as a seller's are (#1390). The Facebook profile link is the one exception, because it is how a
//    buyer there is recognised (#1777) and the agent read it off Facebook in the first place. The
//    projections name their fields; **do not replace a mapper here with a spread**.
//  - **Money is the sale screen's.** `gross` is the lines in the sale's own currency and `net` what
//    the sale brought in, in the collection's base currency, exactly as the list and the screen state
//    them; nothing here recomputes either.
//  - **The *to review* marker travels with the sale** (#1948), on the list and on the record, so an
//    agent reading back what it recorded sees that it is still waiting for the collector.

import { SALE_STATUS_ORDER } from "../sale-status";
import { invalidRequest } from "./errors";

/** The fulfilment statuses, in lifecycle order — `list_sales`'s closed vocabulary. */
export const AGENT_SALE_STATUSES: readonly string[] = SALE_STATUS_ORDER;

/** The *to review* marker as the agent reads it, or null when nothing waits. */
export interface AgentSaleReview {
  readonly at: string;
  /** The API recorded the sale itself, rather than only adding to one. */
  readonly created: boolean;
  readonly actions: readonly string[];
}

/** One sale as `list_sales` states it. */
export interface AgentSaleRow {
  readonly id: string;
  readonly saleNo: number;
  readonly platform: string;
  readonly buyer: string | null;
  readonly status: string;
  readonly soldAt: string;
  readonly currency: string;
  readonly sets: number;
  readonly copies: number;
  readonly gross: string;
  readonly net: string;
  readonly baseCurrency: string;
  readonly externalRef: string | null;
  readonly transactionUrl: string | null;
  readonly toReview: AgentSaleReview | null;
  readonly path: string;
}

/** One sold set on a sale. */
export interface AgentSaleLine {
  readonly id: string;
  readonly offerId: string | null;
  readonly offerNo: number | null;
  readonly setId: string;
  readonly set: string;
  readonly price: string;
  readonly copies: readonly string[];
  /** The line names one of the offer's interchangeable sets, but nobody has chosen which (#697). */
  readonly setChoicePending: boolean;
}

/** One sale as `get_sale` states it. */
export interface AgentSale {
  readonly id: string;
  readonly saleNo: number;
  readonly platform: string;
  readonly buyer: { readonly id: string; readonly name: string } | null;
  readonly status: string;
  readonly soldAt: string;
  readonly currency: string;
  readonly baseCurrency: string;
  readonly externalRef: string | null;
  readonly transactionUrl: string | null;
  readonly lines: readonly AgentSaleLine[];
  readonly gross: string;
  readonly buyerHandling: string | null;
  readonly buyerPaidTotal: string | null;
  readonly commission: string | null;
  readonly shippingCost: string | null;
  readonly shippingCurrency: string | null;
  readonly net: string;
  readonly toReview: AgentSaleReview | null;
  readonly path: string;
}

/** A buyer as `find_or_create_buyer` answers. */
export interface AgentBuyer {
  readonly id: string;
  readonly name: string;
  readonly facebookProfile: string | null;
  /** How the buyer was settled on: found by their profile link, found by name, or created. */
  readonly found: "profile" | "name" | "created";
}

/** An ISO day, as every date on this surface is written. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function review(
  mark: { at: string; created: boolean; actions: readonly string[] } | null
): AgentSaleReview | null {
  return mark ? { at: mark.at, created: mark.created, actions: [...mark.actions] } : null;
}

/** The list row. Fields named, so a column added to the screen's row cannot ride along. */
export function saleRow(
  row: {
    id: string;
    saleNo: number;
    platformName: string;
    buyerName: string | null;
    status: string;
    soldAt: Date;
    currency: string;
    lineCount: number;
    itemCount: number;
    grossProceeds: string;
    netProceeds: string;
    baseCurrency: string;
    externalRef: string | null;
    transactionUrl: string | null;
    apiReview: { at: string; created: boolean; actions: readonly string[] } | null;
  },
  path: string
): AgentSaleRow {
  return {
    id: row.id,
    saleNo: row.saleNo,
    platform: row.platformName,
    buyer: row.buyerName,
    status: row.status,
    soldAt: isoDay(row.soldAt),
    currency: row.currency,
    sets: row.lineCount,
    copies: row.itemCount,
    gross: row.grossProceeds,
    net: row.netProceeds,
    baseCurrency: row.baseCurrency,
    externalRef: row.externalRef,
    transactionUrl: row.transactionUrl,
    toReview: review(row.apiReview),
    path,
  };
}

/** The record. `offerNos` maps a line's offer to the number the collector calls it by. */
export function saleRecord(
  detail: {
    id: string;
    saleNo: number;
    platformName: string;
    buyerId: string | null;
    buyerName: string | null;
    status: string;
    soldAt: Date;
    currency: string;
    baseCurrency: string;
    externalRef: string | null;
    transactionUrl: string | null;
    lines: readonly {
      id: string;
      offerId: string | null;
      offerSetId: string;
      setLabel: string;
      price: string;
      itemLabels: readonly string[];
      setChoicePending: boolean;
    }[];
    grossProceeds: string;
    buyerHandling: string | null;
    buyerPaidTotal: string | null;
    commission: string | null;
    shippingCost: string | null;
    shippingCurrency: string | null;
    netProceeds: string;
    apiReview: { at: string; created: boolean; actions: readonly string[] } | null;
  },
  offerNos: ReadonlyMap<string, number>,
  path: string
): AgentSale {
  return {
    id: detail.id,
    saleNo: detail.saleNo,
    platform: detail.platformName,
    buyer:
      detail.buyerId !== null && detail.buyerName !== null
        ? { id: detail.buyerId, name: detail.buyerName }
        : null,
    status: detail.status,
    soldAt: isoDay(detail.soldAt),
    currency: detail.currency,
    baseCurrency: detail.baseCurrency,
    externalRef: detail.externalRef,
    transactionUrl: detail.transactionUrl,
    lines: detail.lines.map((line) => ({
      id: line.id,
      offerId: line.offerId,
      offerNo: line.offerId !== null ? (offerNos.get(line.offerId) ?? null) : null,
      setId: line.offerSetId,
      set: line.setLabel,
      price: line.price,
      copies: [...line.itemLabels],
      setChoicePending: line.setChoicePending,
    })),
    gross: detail.grossProceeds,
    buyerHandling: detail.buyerHandling,
    buyerPaidTotal: detail.buyerPaidTotal,
    commission: detail.commission,
    shippingCost: detail.shippingCost,
    shippingCurrency: detail.shippingCurrency,
    net: detail.netProceeds,
    toReview: review(detail.apiReview),
    path,
  };
}

/** The buyer. Three fields and how they were found — nothing personal. */
export function buyer(
  contact: { id: string; name: string; facebookProfileUrl: string | null },
  found: AgentBuyer["found"]
): AgentBuyer {
  return {
    id: contact.id,
    name: contact.name,
    facebookProfile: contact.facebookProfileUrl,
    found,
  };
}

/**
 * A price for one sold set: digits, at most two decimals, never negative — the sale screen's own
 * precision, so a third decimal is refused rather than rounded behind the agent's back.
 */
export function parseSalePrice(value: string, parameter: string): string {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw invalidRequest(
      `"${text}" is not a price for "${parameter}". Send what one set sold for, with at most two decimal places and a period as the separator — "15.00" — in the offer's own currency.`
    );
  }
  return Number(text).toFixed(2);
}
