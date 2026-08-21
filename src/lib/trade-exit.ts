import type { Prisma } from "@/generated/prisma/client";
import { COMMITTING_FULFILLMENTS } from "./trade-realisation-rules";

// **A copy that went to a partner has left the collection, and nothing is written down to say so**
// (#644; ADR-0039 §12).
//
// The record of the exit is the **give line of a closed trade** — a third path beside `SaleLineItem`
// and `disposedAt`, each with its own meaning and none impersonating another. A trade is not a sale
// (there is no buyer, no amount and no proceeds) and not a disposal (nothing was lost or spoiled),
// so borrowing either would put a figure or a reason on the record that nobody ever said.
//
// This module is the one place that spelling lives, for `disposal.ts`'s reason a level up: soldness
// already has one established mechanism at every reader (`saleLineItems: { none: {} }`), and this is
// its twin — one fragment, used wherever that one is, so the copies list, the counts, the wants, the
// completeness reads and every picker cannot come to disagree about whether a copy is still held.
//
// The judgement itself — *which* lines have taken their copy away — is the pure
// `hasLeftInTrade`; what is here is only how to ask a database the same question.

/** The give lines that have taken their copy out of the collection: a **closed** trade, and a
 *  verdict that still commits the copy. The relation on `Item` is give-side by construction (a
 *  receive line carries no `itemId`), so nothing here has to say so twice. */
export const TRADED_AWAY_LINE: Prisma.TradeLineWhereInput = {
  trade: { status: "closed" },
  fulfillment: { in: [...COMMITTING_FULFILLMENTS] },
};

/** `Item` fragment: this copy has **not** gone to a partner. Spread beside the sold guard. */
export const NOT_TRADED_AWAY: Prisma.ItemWhereInput = {
  tradeLines: { none: TRADED_AWAY_LINE },
};

/** `Item` fragment: this copy **has**. The reverse, for the reads that are about what left. */
export const TRADED_AWAY: Prisma.ItemWhereInput = {
  tradeLines: { some: TRADED_AWAY_LINE },
};
