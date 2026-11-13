# ADR-0082: A Sale Can Be Cancelled, and Is Kept as a Record

## Status

Accepted. Amends [ADR-0012](0012-sales-record-model.md) (the sales record model) with a status
outside its lifecycle. Decided in #2500 on 2026-11-13 with the collector (a cancelled sale is kept
with a status of its own, not deleted; the cancel dialog asks per offer — back to active or withdrawn,
active preselected; the buyer carries a count of cancelled sales and a new sale to them warns) and
built there, the issue's *to be confirmed* points as written. Refs #191 (the fulfilment status),
#700 (a sale is a composition change of its offers) and #2317 (an offer back on sale gets its
cleaned-up photos made again).

## Context

A buyer on Facebook or Colnect wins lots, a sale is recorded and its offers close — and then the
buyer never pays. The only way out was *Delete sale*: the offers went back to *active*, the copies
were free again, and the deal left **no trace**. Nothing recorded that it happened, nothing said
this buyer had failed to pay, and every offer went back to *active* even when some should not have
gone back on sale at all.

What a cancel must release is exactly what a delete releases: the copies (the no-double-sale
`UNIQUE` on `sale_line_item.itemId`), the sets (read as sold by every `saleLines: { none: {} }` in
the offers code), the offers, the packing supplies and the photo purge's hold. What it must keep is
the sale itself — who, when, on which marketplace, and what was bought.

## Decision

1. **`cancelled` is a token of `Sale.status`**, beside the lifecycle `ordered → paid → packed → sent →
   received` rather than in it (`SALE_CANCELLED`, `SaleRecordStatus` in `sale-status.ts`). It is
   reached only by cancelling a sale **not yet sent** (`canCancelSale`) — a parcel already gone is a
   return, a separate matter — and **never left**: a buyer who pays after all is a new sale. The
   status select never offers it, `setSaleStatus` refuses a cancelled sale, and a status event is
   appended for it like any other. `Sale` gains `cancelReason` (free text, the dialog prefilling
   *Not paid*) and `cancelledAt`.
2. **The sale's lines are deleted, and kept as words.** Cancelling deletes the `SaleLine`s — which is
   what frees the copies, the sets and the offers through every existing read, with no read taught a
   new rule — and writes one `SaleCancelledLine` per line: the heading and catalogue numbers the
   sale's screen gave it (`saleLineName`), its price in the sale's currency, the offer it came
   through (`SetNull`) and its number, and what the cancel did to that offer. Rejected: keeping the
   lines and filtering cancelled sales out of every reader. A sold set is read off `saleLines` in
   dozens of places — the offers list, the photo plan, Facebook posts, the specification, the lot
   builder — and `SaleLine.offerSetId` is `Restrict`, so a kept line would also stop the set it names
   from ever being deleted. A filter missed in one of those places is a set that reads as sold
   forever, and nothing would go red.
3. **Per offer, back to active or withdrawn.** Each offer the sale **closed** (left `sold`) is asked
   about; *back to active* is the default, since the listing is usually still up. Back to active is
   the delete's reopening — `closedAt` cleared, out of step with its listing (#700/#542), its
   cleaned-up generated photos queued again (#2317). Withdrawn is an ordinary withdrawal. An offer the
   sale did not close (it still had sets of its own) only gets its set back, and is marked out of
   step. A Facebook lot follows its offer, so it is open in its post again.
4. **Everything else is released as a delete releases it**: the packing-supply lines are deleted and
   their supplies settled again, so the units go back to the batches they came from; the buyer's link
   (#699) is withdrawn.
5. **A cancelled sale counts nowhere.** Not in revenue, profit, sold counts, the Overview, the profit
   and loss screen, a contact's or platform's figures, or as an observation of what the stamps sold
   for. Most of that follows from point 2 — a read of sold copies or sold sets finds none — and the
   reads over the sale header filter the status: `listSaleProfitRows` (the profit and loss screen and
   the Overview's realized figure), the Overview's sale count and `readSales` (contact and platform
   pages). Its net reads zero wherever a figure is shown for it. It stays on the Sales list with a
   *Cancelled* chip, and the status filter lists it alone or leaves it out.
6. **A cancelled sale is a record, not an editor.** Its screen is its own (`cancelled-sale-view.tsx`):
   the buyer, when and why it was cancelled, and what had been bought. Its amounts, status, lines and
   supplies refuse a change (`refuseCancelledSale`, `sale-supplies.ts`'s `assertSale`); merging and
   moving sets refuse it (`sale-merge-rules.ts`, `sale-move-rules.ts`); the *Sell* dialogs never
   offer it. Its note, files and conversation stay writable — they are what the record is for.
7. **The buyer is remembered.** The contact page shows the buyer's cancelled sales, of all time, under
   their number of sales, and a new sale to them warns with the count (`countBuyerCancelledSales`,
   `BuyerCancelledWarning`) — a heads-up, never a refusal.
8. **The agent API can cancel**: `cancel_sale` runs `cancelSaleThroughApi`, the same cancel with the
   *to review* marker (#1948) in its transaction — the one status change open to the agent. Reads
   carry the status and, on a cancelled sale, what it had sold.
9. ***Delete sale* stays**, for a sale recorded by mistake, and still leaves no trace — a cancelled
   sale included.

## Consequences

- ADR-0012 §3's sale lifecycle is unchanged; `cancelled` sits beside it, and every reader of a
  fulfilment step (`isSaleStatus`, `UNSENT_SALE_STATUSES`, the dashboard's waiting groups) already
  leaves an unknown token out.
- A cancelled sale's record is a snapshot: an offer retitled later does not rename it, unlike a live
  sale's lines (#2189). That is the point of a record.
- Deleting a cancelled sale also deletes the buyer's count of it. That is what *Delete* means.
