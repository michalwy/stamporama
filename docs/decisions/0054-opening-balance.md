# ADR-0054: The Opening Balance, a Purchase-Order Type

## Status

Accepted and implemented in #1323; §7 by #1324; §8 by #1326; the summary panel (Consequences) by
#1325. Designed in #1321 with the collector on 2026-09-15 and
2026-09-16; the children that complete it are #1324 (profit and loss, never spend), #1325 (the
summary panel) and #1326 (retiring Card scans). **Replaces #725's decision that identification
without a purchase creates no cost basis** (ADR-0033, *What #725 added*), for opening balances.

## Context

Stamps the collector already owns — a shelf being catalogued, a gift, an inheritance — come in today
through Card scans (#725, ADR-0033). There, identified copies are **delivered at once** and are for
sale while they are still lying on the scanning cards; the collector works around that with a
virtual *Scan Pages* location, then filters the Copies list by it and moves them. A purchase order
already has the state that workaround imitates — *to sort*, then **Store** — and every tool around
it: grouping, filtering, sorting, scans, identification, the want review, lots and closing. Two flows
one step apart are also two paths to keep in step; #1262, where one offered to close wants and the
other did not, is what that costs.

#725 had refused a `Purchase` for such material, because a fictional order would sit in the list and
in every ROI figure that reads one. That refusal was about pretending something was bought. A
document that says plainly that nothing was is a different thing.

## Decision

### 1. A type of purchase order, not a second screen

`Purchase.kind` is `purchase` or `opening_balance`. An opening balance is the purchase document with
none of a purchase's own fields, and everything else — the order screen, scans, identification, the
want review, *to sort*, Store and Move, lots, allocation, closing — is the purchase's, unchanged.
The precedents are #644's trade order and ADR-0021's auction settlement, both purchases for the same
reason: the intake apparatus should answer for the material without a second implementation of any
of it.

*Rejected:* a basket on the Card scans screen (rebuilding the order's tooling on a second screen is
duplication), and a table of its own (every reader of a lot, a pool or a scan owner would grow a
second branch).

The vocabulary is closed in the application (`src/lib/purchase-kind.ts`), as `scan_sheet.kind` is,
and the kind is fixed when the document is created.

### 2. The header is a required free title, a date and a currency

A purchase is named by its supplier and date; an opening balance has no supplier, so its **title**
(*Klaser Polska 1*, *Inheritance*) is the only name it has — on the list, in the quick jump, on a
copy's *Go to purchase*. It is therefore **required** (the collector's call, 2026-09-16), refused when
blank or over the ceiling rather than truncated.

It has **no supplier, platform, shipping or trade, and no delivery status**: its copies are in hand
from the start. The status is **stored as `arrived` and never shown**, because that is the fact every
reader already asks — intake lands copies `to_sort` on an arrived order (#121, #564) — so copies land
*to sort*, never *ordered*, with no branch added to `intakeStamps`. Setting a status and marking one
arrived are refused. A CHECK (`purchase_kind_shape`) states the shape once: an opening balance has a
title and no supplier, platform, shipping or trade, and is `arrived`; a purchase has no title.

*Rejected:* linking the document to an area or a location (copies carry their own), and a
document-level close (lots close, the document does not).

### 3. Lots as on a purchase, each with an optional opening value — and none is never zero

Any number of lots, each with a title and an **optional opening value** in the document's currency.
`PurchaseLot.price` became **nullable**, and null means *no opening value*. A zero is a value — it
says the material was worth nothing — and #1184 rules out showing an absence as one, so no value is
never written as `0`. A purchase lot still always has a price; that rule crosses tables and lives in
`src/lib/lots.ts`.

*Rejected:* one hidden lot per document, lots without values under a document-level value, and a
separate *has value* flag beside a price of `0` (every sum over lot prices would read the zero
literally, which is exactly the hazard).

### 4. Allocation and closing always as on a purchase

A lot **with** an opening value is split across its copies by primary-catalogue price and frozen at
close, exactly as a purchase lot. A lot **without** one still closes, and **still refuses while a copy
lacks a primary-catalogue price** — cataloguing discipline was preferred over an exemption. It freezes
nothing: the engine runs over a zero pool for its refusals, and no snapshot is written.

The cost of a copy on an unvalued lot is **not applicable** whether the lot is open or closed —
never `0` and never *pending*. `resolveCostBasis` gained `lotValued` (read through `lotCostInputs`,
`lot.price != null`), and every reader of a copy's cost states it the same way. A copy on a valued
lot is *pending* until its lot closes, as on a purchase.

*Rejected:* an equal split, and unvalued lots that never close.

### 5. Currency as on a purchase

A document currency defaulting to the collection's base one; another currency freezes the rate as of
the document's date. *Rejected:* base currency only.

### 6. Listed among purchases, with a type filter; the section becomes Intake

Opening balances are listed with purchases and the orders trades create, filtered by type. The
collector asked for **three** values — *Purchases*, *Trades*, *Opening balances* — over the two-value
column: a trade order is a purchase with `tradeId` set. The delivery-status filter is a purchase's
alone and never returns an opening balance. The sidebar section **Buying** became **Intake** and its
list **Intake documents**; the section key (`buying`) and the route (`/purchases`) stay, since a
stored collapse state is keyed on the first and nobody reads either.

*Rejected:* a separate navigation entry, and keeping the names.

### 7. An opening value counts towards profit and loss, never as money spent (#1324)

The opening value frozen onto a copy is a cost basis like any other, so a sale is measured against
it, a write-off loses it, and the Overview's realized figure includes it. It is **never** money
spent and **never** a price paid:

- A holdings summary states it on a line of its own, **Opening value**, beside **Purchase cost**,
  which covers purchases alone. The collector chose that over leaving it out of the holdings
  entirely or relabelling the one total as *cost basis* (2026-09-16). The value-over-time chart's
  cost line is purchases only; the Overview's surplus is measured against both, being a result.
- The Overview's purchase-ROI tally counts purchases only, and the Valuation dialog's *What I paid*
  leaves opening-balance copies out rather than counting them as uncosted.
- An opening balance's own return rows run the purchase's arithmetic against the opening value and
  say so.
- A copy from a lot without a value has no profit figure, and the reason is stated as *no opening
  value* rather than *no cost recorded* — `CostBasisState` `none` carries the reason.

### 8. Card scans is retired onto an opening balance (#1326)

With opening balances in place, Card scans (#725) was a second path one step apart from the first.
The collector retired it and carried its work over (2026-09-16):

- The screen, its sidebar entry and the *Scan a card* button are gone. Stamps already owned are
  scanned on an opening balance.
- Migration `20260916160000_retire_card_scans` gives each collection that had purchase-less cards
  **one** opening balance titled *Card scans*, dated by the oldest card, in the base currency, with
  **one lot and no opening value** — a tile identifies into a copy on a lot, and one lot is the case
  that asks nothing. Every sheet, tile (in every state, notes and shortlists included) and in-flight
  upload moves onto it with its **batch number unchanged**; the document's batch counter continues
  past the highest.
- **Copies already created from Card scans stay as they are**: delivered, on no lot, cost not
  applicable, not attached to the document.
- A card always belongs to a document again: `purchaseId` is NOT NULL on `scan_sheet`, `scan_tile`
  and `scan_upload`, and `collection.nextScanBatchNo` is dropped.

*Rejected:* keeping Card scans beside opening balances, and retiring it without migrating.

## Consequences

- **Money spent** was #1324's, and is §7. One path still carries an opening value into a purchase
  cost: a trade order prices its lots at the cost basis of the copies given away (#644), opening
  values included.
- **The summary panel leads with the opening value (#1325).** An opening balance passes no order
  total to the holdings bar, so no price or shipping row appears; its lead line is the sum of its
  lots' opening values in both currencies, *no opening value* when no lot has one (never `0.00`),
  and a count of the lots without one when only some have it. A cost that cannot apply — every copy
  behind it from an unvalued lot — reads *not applicable* rather than *not worked out yet*.
- **Card scans is retired (#1326)** — see §8.
- The quick jump's `p` sequence is shared: an opening balance takes the next purchase number.
