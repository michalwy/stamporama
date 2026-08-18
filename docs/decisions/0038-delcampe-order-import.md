# ADR-0038: Importing a Delcampe order from the seller's own screens

## Status

Accepted

## Context

ADR-0037 closed the listing loop without touching Delcampe's API (#611): a batch leaves as a CSV,
comes back as one, and every live listing carries its own `id_auction` on `Offer.delcampeItemId`. It
stops one step short on purpose. A listing that drops out of the active-items file has **come down**,
and the file does not say whether it sold, ended, or was pulled. Until that question is answered the
collector records every Delcampe sale by hand: the buyer, the date, the amount, and which offers
those items were — all of it already on a screen they are looking at while they pack the parcel.

Delcampe publishes a **sold-items CSV** as well, and it was the first plan. Two things ruled it out:

1. **It carries no order id.** Rows sit one per item with no grouping, so one parcel would have to be
   inferred from a buyer plus timestamps close together — a guess, in a codebase whose rule is that a
   proposal has to be better than a guess or it is a guess with a confident label.
2. **It carries full buyer PII in bulk** — name, e-mail, street, city, post code, country — for every
   sold item, whether or not any of it is ever wanted. #467 deliberately leaves exactly these fields
   unread on Allegro's payload, and #463 fetches an order only once the collector asks for it, so no
   background job keeps personal data warm. A file removes the choice of *fetching*, and leaves only
   the choice of storing.

The seller's own **My Sold Items** screens answer both, and were verified against the live site:

- the order is a first-class thing — `…/payment-request/<orderId>`, with `…/bills/<orderId>/…`
  beside it — and its items sit inside it as `…/collect(ables|ibles)/item/<id_auction>.html`;
- order `104867762` groups exactly the three item ids the sold-items CSV left to be inferred;
- `personal_reference` is printed on each row, so an offer put up by #610 names itself there;
- the six phase screens (`list`, `to-invoice`, `invoiced`, `to-send`, `sent`, `archived`) are
  structurally identical, differing only in which `bills/<id>/status/<transition>` links they offer —
  which is a fact about the order, not about the page.

## Decision

### 1. A mark per order row: the page states which order, the instance states whether it is recorded

#466's split, applied to a sale. The page can say which order a row is about, because its own address
says so, and it cannot possibly know whether that order has been written down here. So the row is
marked with the instance's answer: **already recorded → a link to the sale**, **not yet → an
*Import* affordance**. Batched (`GET …/sales/by-delcampe-order`), session-or-token, answering a
**relative** path — all three exactly as the offer and lot lookups do, for exactly their reasons.

The mark is #466's *inline* shape rather than a corner chip, because a phase screen is a list: the
question is asked once per row and the answer belongs beside the link that already states which order
it is.

`Sale.externalRef` carries the Delcampe order id — the same column #479 puts an Allegro order number
in — so a sale recorded from here and one recorded by hand leave a worklist for the same reason, and
so "already recorded" is one query rather than a new table.

### 2. The extension reports, the instance decides

#409's contract, kept strictly, and the reason this reads a marketplace's HTML at all without that
becoming a liability. The Assistant's Delcampe module reads the block and reports what it printed —
`US$3.00`, `Sun 22 Mar 2026 at 22:25`, `± €13.95` — and decides nothing. Which currency a symbol
names, what day that was, which offer each row is, and whether the order can be recorded are settled
in `delcampe-order-rules.ts`, where they are pure functions with tests, and performed by
`delcampe-order.ts`.

The reading is anchored on **addresses**: the order off `payment-request/<id>`, the items off
`item/<id>.html`, the buyer off `user/profile/<id>-<login>`, and the grouping by containment — the
nearest ancestor of an item link that names exactly one order *is* that item's order. Delcampe's
class names are not hashed per build the way Allegro's are (#355), but an address is what a page is
about and a class is what it looked like the day the code was written. One rule then covers all six
phase screens.

Two things have no address and are read from content: an amount is a leaf whose **whole** text is a
currency figure — whole, because a stamp titled `USA $5 Liberty` contains something that looks like a
price and a title is never a leaf that is only one — and a date is a leaf that reads as one.

### 3. All lines or nothing

Allegro's flow (#463) shows the collector a dialog before it writes, and can therefore record the
lines it is sure of and report the rest. Here the click happens on Delcampe's page with nothing
reviewed in between, so a sale created without a line it should have carried would understate the
proceeds while looking exactly like a complete one. An order that cannot be recorded whole is
therefore **not recorded at all**, and every reason is named at once — #610's refused batch, from the
other direction, and for the same reason: the collector is about to go and fix these, and finding the
second one only after fixing the first is two trips through the same screens.

A row finds its offer two ways, in order: **Delcampe's own id** (`Offer.delcampeItemId`, exact, and
the reason this issue waited for #611) and then **the reference the row prints**, read back by
`offerNoFromPersonalReference` — the path decides which offer and the slug must be this collection's,
which is ADR-0037 §4's rule unchanged. Which set of the matched offer went is `mapLineToSets`,
untouched: an offer with three sets left and one bought says *that* one sold, not which, and that
refuses rather than picks.

The way through a refusal is the offer's own sell flow, and then the same button again — which is
harmless, because one order is one sale for ever: a re-import answers with the sale that claims the
order and writes nothing.

### 4. The buyer is a login and a name

Delcampe prints the shipping address on the same row and links a message relay beside it. Neither is
read, so neither can be stored: `Contact` gains no address field here, and the e-mail is left because
Delcampe serves a relay whose lifetime is unknown — personal data this app could never refresh is
worth less than none. The login leads and the printed name goes to `fullName`, which is
`buyerIdentityFor`'s rule (#463) rather than a second one.

Those three marketplace-neutral rules — `mapLineToSets`, `saleDateOf`, `buyerIdentityFor` — moved out
of `allegro-sale-rules.ts` into `order-sale-rules.ts` when this issue asked all three of them again.
None was ever Allegro's; what stayed behind is `matchShippingMethod`, and a Delcampe sold row states
no delivery method.

### 5. What the page's money means, and what it never means

The screens print an order's total **twice** — `± €13.95` converted into the display currency, then
`US$16.15` in the currency the listings were in — and each row's price in its own currency. So:

- The sale's currency is the **platform's** (#196), as every sale's is, and a row whose printed
  symbol names a different one refuses the order rather than recording a foreign amount.
- A **bare `$` is not dollars.** Delcampe writes `US$`, so a lone `$` is a currency this app has not
  met or a template that changed, and answering either with "probably dollars" is how a sale gets
  recorded in the wrong money.
- `buyerPaidTotal` (#205's anchor) is set only from a total stated **exactly**, in the sale's own
  currency, and not below what the rows add up to. The `±` figure is Delcampe's own arithmetic, and a
  sale's postage derived from it is a number nobody entered.
- A row Delcampe prices at **zero** is a cancelled item — it zeroes the order with it — and refuses.
- The sale is dated by the **latest** of its rows: Delcampe groups a buyer's purchases into one bill,
  and the order is complete on the last of them.

### 6. Delcampe's phases are not mirrored onto `Sale.status`

`sold-items/sent` says the parcel went, and it is tempting to write that here. The sale's status is
the collector's own workflow with its own transition log (#191/#492) — it is what *they* have done
about the parcel, not what Delcampe was told. An imported order starts where every sale starts, at
`ordered`. Two systems claiming one field is how they drift, and the collector's own record is the one
that has to win.

For the same reason nothing here reads the tracking number the screen also carries: what carried the
parcel is answered when the sale is marked sent (#491), by the person who took it to the counter.

## Consequences

- The Delcampe loop is closed end to end without the API: export a batch, upload it, import the
  active items, and record each sale from the screen it is packed on.
- A sale recorded this way is indistinguishable from one recorded by hand, except that it carries the
  order number — which is what makes a second import a link.
- An order with an item that was never an offer here can never be imported; it is recorded by hand,
  as it is today. That is the deliberate cost of §3.
- The extension now scripts a third marketplace declaratively, narrowed to the sold-items screens.
- The screens are read in **English**: a month name this app cannot read is no date, which refuses the
  order rather than dating a sale by guesswork.
