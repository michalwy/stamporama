# ADR-0041: Recording a Colnect transaction as a sale

## Status

Accepted

## Context

[ADR-0038](0038-delcampe-order-import.md) closed the far end of a Delcampe sale from the seller's own
screens (#612): the page states which order a row is, the instance states whether it is recorded
here, and one click writes it. The identical question is asked on Colnect fifteen times a parcel and
answered by retyping — the buyer, the date, the amount, and which of our copies goes in the envelope
— off a screen the collector is already looking at while they pack.

Colnect is not Delcampe with a different stylesheet, and every difference below is something Colnect
**states** that Delcampe did not, plus one thing Colnect does not state that Delcampe did.

The screens were verified live on transaction `hflVE` (15 listings, 2026-08-23), read-only.

`/<locale>/transaction/show/id/<id>` — the detail, and the only screen carrying a whole order:

- the **order id is in the address**; the form container also spells it as `_fn-transaction-hflVE`,
  which is not read — a class is what the page looked like the day this was written;
- `Buyer: Andrzej Palacz [jedrus67]`, the login linked as `/en/collectors/collector/jedrus67`;
- `Started: August 23, 2026 2:21 PM` — the transaction's own start, one date for the whole order;
- 15 rows, each linking `/en/market/sale/<code>` from both its picture and its title, with
  `Item count:`, `Item condition:`, `Catalog codes:`, `Sale status:` and its own price;
- totals: `Items total € 9.97`, `Shipping price € 2.40`, `Discount -€ 0.37` (the 3% bank-transfer
  discount), `Total with shipping € 12.00`. The 15 row prices sum to `9.97` exactly;
- `Shipping method: Stamps→domestic: Registered mail (Poczta Polska)` with its price ladder;
- the buyer's full postal address;
- Colnect's own status ladder (`Payment sent` / `Payment received` / `Items sent` / `Items received`)
  with its confirm buttons.

`/<locale>/transaction/list` — the list. Each row carries a *Details* link whose href is
`/transaction/show/id/hflVE`, **with no locale segment** unlike every other address on the detail
page. The list also **truncates its items** (`+ 12 more listings`), so it can never state a whole
order.

## Decision

### 1. The list marks, the detail imports

#466's split, and the truncation decides where the button goes. Both screens get the read-only half —
**recorded → a link to the sale**, **not yet → *Not recorded*** — and the ***Import*** affordance
exists only on the detail page, which is the only screen that knows all fifteen rows.

Which screen may act is a fact about the screen, so the module that read it says so:
`PlatformOrder.canImport`. The mark then draws a third state (`not-recorded`) that offers neither a
link nor the act — the alternative was a button that writes an order missing lines it should have
carried, which is exactly what §3 below refuses.

The mark sits in the transaction's **header block**, beside `Buyer: … Started: …`: the detail page
has no link to itself, so its own address is what states which order this is, and the header is where
a reader is already asking. On the list it goes beside the row's own *Details* link, which is that
row's answer to "which one is this?".

`GET …/sales/by-colnect-order` — batched, session-or-token, answering a **relative** path, matched on
`Sale.externalRef` narrowed to the Colnect platform. All four exactly as `by-delcampe-order` is, for
exactly its reasons. A **second address** rather than a field on that one, and the extension builds
both from the **module id** the page's own module reported: an order id means nothing without the
site that issued it, the two are matched against different columns, and a third marketplace then
needs nothing in the client that talks to us.

### 2. The extension reports, the instance decides

#409, kept strictly. `extension/src/platform/colnect/orders.ts` reads the block and reports what it
printed — `€ 0.46`, `Item count: 1`, `August 23, 2026 2:21 PM` — and decides nothing. The reading is
anchored on **addresses**: the order off `transaction/show/id/<id>` (accepted with and without a
locale segment, since the list's own link carries none), each item off `market/sale/<code>`, the
buyer off `collectors/collector/<login>`.

What has no address is read from its **printed label** — `Item count:`, `Started:`,
`Shipping method:` — and Colnect's own classes (`_sl-entry`, `_sl-price`, `_t-transaction-price`) are
tried first as a shortcut and never relied on: a page whose classes have changed is still read by its
labels and its addresses.

`PlatformOrderLine` gains `quantityText` and `PlatformOrder` gains `soldAtText` and
`shippingMethodText`, all as printed, because Colnect states three things Delcampe did not. The
header's figures keep **the words beside them** (`Total with shipping € 12.00`): four amounts that
differ only in meaning cannot be told apart by their size, and dropping the label would destroy the
decision rather than defer it.

`reference` is **always null** here: Colnect prints no seller reference on a transaction row, which
is why #696 exists.

Currency, dates, item counts, which offer each row is, and whether the order can be recorded are
settled in `src/lib/colnect-order-rules.ts` as pure functions with tests, and performed by
`src/lib/colnect-order.ts`.

### 3. All lines or nothing, and the only join is the sale code

ADR-0038 §3 unchanged: the click happens on Colnect's page with nothing reviewed in between, so an
order that cannot be recorded whole is not recorded at all, and **every** reason is named at once.

A row finds its offer one way — `Offer.colnectSaleId` (#696) — because Colnect prints no reference to
read back. The way through a refusal is to put the listing's address on the offer, or to record that
one from the offer's own sell flow, and then press the same button again; which is harmless, because
one transaction is one sale for ever and a re-import answers with the sale that claims it and writes
nothing.

### 4. A multi-quantity offer is picked, not guessed (#697)

`mapLineToSets` stays as it is for Delcampe. Here, a matched offer with **more available sets than
the row bought** is not a refusal: the sale is recorded with the lowest-`sortOrder` available sets and
those lines are flagged `setChoicePending` (#697), because the sets of one offer are the same thing at
the same price — that is why they are one listing — and which identical copy leaves is the seller's
own choice at the packing table rather than a fact about the order. Quantity **greater** than the
available sets still refuses: that is the order disagreeing with the inventory, and no pick fixes it.

### 5. A row with `Item count` greater than 1 refuses, for now

**Open question.** Every row on the observed transaction is `Item count: 1`, and the fifteen printed
prices sum exactly to `Items total`, which does not separate "the row's unit price" from "the row's
line total". `SaleLine.price` is per set, so the two readings write different money. Until a
multi-item row is seen on a real transaction, such a row refuses the order and says why. Answer it on
the next one and lift the refusal.

A row whose count cannot be read at all refuses for the same reason: how many copies left is the
whole question a sale line answers.

### 6. What the page's money means

- The sale's currency is the **platform's** (#196) — Colnect's currency is a seller-level setting,
  not a form field (#402), which is why a Colnect platform locks its currency here. The transaction
  page renders every figure in the **viewer's own display currency** (`Euro - €` at the top), so a
  row or total whose printed symbol names a different currency **refuses the order** rather than
  recording a foreign amount, and the refusal says to set Colnect's display currency and open the
  transaction again.
- A **bare `$` is not dollars**, ADR-0038 §5's rule kept rather than re-argued: an unrecognised symbol
  reads as no currency and refuses, and that transaction is recorded by hand until a real one says
  what Colnect prints for it.
- `buyerPaidTotal` (#205's anchor) is `Total with shipping`, chosen **by its label** and not by
  arithmetic — on a transaction with no postage `Items total` is the same number, and picking the
  larger figure would be picking the meaning by accident. Taken only when stated exactly, in the
  sale's currency, and not below what the rows add up to. The `Discount` line is thereby absorbed
  where it belongs — in what actually arrived — and `Shipping price` is *not* stored beside it: #205
  allows exactly one buyer-side anchor.
- A row Colnect prices at zero refuses.

### 7. Colnect names the shipping method, so it is read (#468)

`shippingMethodName` is written **as printed** (`Stamps→domestic: Registered mail (Poczta Polska)`) —
that is the fact, and it is a snapshot for the same reason every sale's is. `matchShippingMethod`
sets `shippingMethodId` where the printed name is one the platform's dictionary already keeps (matched
case- and space-insensitively, so a matched sale carries the dictionary row's own wording, which is
the same name); an unmatched name still records the sale, with the name alone. The FK is the
convenience, not the record.

**No cost is written**, matched or not: the dictionary states what postage *usually* costs the
collector, and nothing on Colnect's page says what this parcel cost them (#206). That is learned when
the receipt turns up.

This is the one place ADR-0038 §6's "read nothing about shipping" is departed from, and only because
Delcampe's rows genuinely stated no method.

### 8. The date is the transaction's own

`Started: August 23, 2026 2:21 PM`, through `parseSaleDate`. Colnect states one date for the whole
transaction, so ADR-0038's latest-of-the-rows rule is not needed here and is not repeated. Read in
**English** and month-first, where Delcampe led with the day: a month name this app cannot read is no
date, and refuses the order rather than dating a sale by guesswork.

### 9. The buyer is a login and a name

`buyerIdentityFor` (#463) unchanged: the login leads, the printed name goes to `fullName`. The **full
postal address printed on the same page is not read and not stored** — `Contact` gains no address
field here, exactly as ADR-0038 §4 refused Delcampe's.

### 10. Colnect's phases are not mirrored, and nothing is written to Colnect

`Sale.status` is the collector's own workflow with its own transition log (#191/#492); an imported
transaction starts at `ordered`, where every sale starts. Nothing here confirms `Items sent`, adds a
tracking number, or rates the buyer — the Assistant reads these screens and clicks none of their
buttons.

## Consequences

- The Colnect loop is closed end to end: list a copy through the Assistant (#408), keep the listing's
  own code on the offer (#696), and record the sale from the screen the parcel is packed on.
- A sale recorded this way is indistinguishable from one recorded by hand, except that it carries the
  transaction id — which is what makes a second import a link — and that a quantity line arrives
  flagged for a set choice (#697) rather than silently claiming a copy.
- A transaction holding a listing this collection has no `colnectSaleId` for can never be imported;
  it is recorded by hand, as it is today. That is the deliberate cost of §3, and the fix is one
  address pasted onto the offer.
- The orders half now serves two marketplaces, so the shell learned two things it did not need for
  one: a screen that may be read but not imported from (`canImport`), and endpoints addressed per
  module. Neither names a marketplace.
- The screens are read in **English**, like Delcampe's, and in the platform's own currency. Two
  settings on Colnect's side therefore decide whether the button works, and both refusals say so.
