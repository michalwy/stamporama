# ADR-0024: Allegro Sold-Listing Sync and the Worklist It Fills

## Status

Accepted

## Context

An offer that sells on Allegro leaves no trace in Stamporama until the collector types the sale in
by hand. With hundreds of listings, reconciling Allegro's notifications against the offers list by
eye is what does not scale — and the thing that does not scale is the *searching*, not the typing.

#476 (ADR-0023) connected the instance to Allegro's REST API and stopped at *connected*. This ADR
settles what reading through it produces: a worklist that empties, and the shape of the record
behind it. #463 consumes that record to create the `Sale`.

The rule the whole cluster is built around: **nothing financial is written by a sync.** A pass
records what it observed and what to do about it. Creating a sale stays an explicit act.

## Decision

### 1. Observations get their own rows, not a state on `Offer`

An order line is not one-to-one with an offer. A listing with stock above one sells a copy and stays
`ACTIVE`; one Allegro order can carry several of the collector's offers; and a line matching no local
offer has to live somewhere or the collector never learns that a listing was posted outside
Stamporama. A column on `Offer` can hold none of that.

So: `AllegroOrder` and `AllegroOrderLine`, keyed on Allegro's own ids
(`@@unique([collectionId, orderId])` and `@@unique([allegroOrderId, lineItemId])`) — which is what
makes a second sight of an order an update rather than a second worklist entry.

An **order header of its own**, rather than order columns repeated on each line: the status, the
buyer and the total are facts about the order, and one order routinely carries several listings.
The worklist is also read at that level — a card is an order — so grouping lines back into orders on
every read would be reconstructing something the marketplace already stated.

`Offer` gains nothing. A sold-on-platform offer that is still `active` here is a genuinely new state,
and the decision is that it is a *derivation* over these rows rather than a fact stored twice.

### 2. Publication status is read as an **absence** from a sweep of active listings

The obvious reading — page `/sale/offers?publication.status=ENDED` — is unbounded: it answers with
every listing the account has ever ended, most of them years resolved. The sweep therefore reads the
**active** ones, `AllegroListing` is its snapshot, and a row the newest sweep did not see is marked
`ENDED` rather than deleted.

That absence *is* the signal. Keeping the row is what lets it be shown with the date the listing was
last seen up — which is the only date this app has for it, Allegro never having been asked. The row's
`observedAt` is deliberately not restamped on that transition for the same reason.

The derived reading is only ever computed off a sweep that finished (`listingsSweptAt`), because a
half-finished sweep would report every listing it had not reached yet as ended.

### 3a. The sold list filters on two axes, client-side

*Paid / Not paid* and *Matched / Unmatched* are **two independent multi-selects**, OR within an axis
and AND across them, exactly as the offers list's state chips work (#475). One flat row of chips
would imply they were alternatives, and "paid but unmatched" is a real and interesting session.

They are applied at the levels the facts live at: payment narrows **orders**, matching narrows
**lines**, and an order left with no line falls out. Filtering whole orders on "does any line match"
would show a mixed order's matched lines under *Unmatched*. The counts are over the whole batch, not
over what the chips currently leave — a count that moved as you filtered would say nothing about
what is there to filter to.

Client-side, like the bulk listing workspace's facets (#322): the worklist is one unpaginated batch,
so there is no page boundary in the way and an instant facet beats a round trip.

### 3. Ended-unsold sits **beside** the sold worklist, not in it

Both are things the sync noticed; they ask for different actions. A sold row is a sale to record; an
ended-unsold row is an offer whose state here is now wrong. One list carrying both would need a chip
per row explaining what it wants, and would stop being a list that empties.

An unmatched **ended** listing is not reported at all: the action it would ask for is "correct an
offer", and there is no offer to point at. An unmatched **sold** line very much is reported — there
the missing match is itself the news.

### 4. Cursor over the event stream, with a dated read as the fallback

Every pass follows `/order/events` from a stored event id. A dated read cannot see an order whose
only change was a payment landing, which is exactly the transition the worklist cares about.

With no usable cursor — a first sync, or one Allegro no longer accepts because the stream reaches
back only so far — the pass reads `/order/checkout-forms` over the last **30 days** and mints a fresh
cursor from `/order/event-stats` *before* that read, so an order landing during the import is picked
up by the next pass rather than falling between the two.

The fallback is safe precisely because every write is an upsert on Allegro's own ids. A cursor
Allegro rejects is therefore not an error state at all: it is the stream having moved past us.

### 5. Matching is external id, then URL at the address's own boundaries — and ambiguity refuses

A listing published through the API carries the Stamporama offer number as its external id, which is
an exact statement of identity. Everything posted by hand is matched on Allegro's offer id inside the
stored `Offer.url`, at `/<id>`, `-<id>` or `offerId=<id>` and **never** as a bare substring —
`8795065609` sits inside `18795065609`, and a substring match would record the wrong offer as sold.

That rule already existed for the Assistant's lot capture (#355). It is now one shared module,
`src/lib/platform-offer-url.ts`, in two readings — a Prisma `OR` arm and an in-memory predicate —
because the sync holds its candidate offers already and should not go back to the database per id.

Two offers claiming one listing is a **refusal**, not a coin toss: picking one would put a sale
against a listing nobody checked. The line is shown unmatched, which is a state the screen already
has a shape for.

**Every pass re-matches the rows that matched nothing**, against the offers as they are then. A match
is otherwise worked out only when a row is written, and a pass following the event stream rewrites
only orders that have *changed* — so an order imported before its offer had a URL stayed unmatched
for ever, however carefully the field was then filled in, and the only way out was to clear the
cursor and re-import a month of orders to recompute one column. It costs one query and no request to
Allegro, the candidate offers being loaded once per pass already.

Only the unmatched ones. A match already made is a fact the collector may have acted on, and
re-deciding it every quarter of an hour would let an edited URL silently move an observation from
one offer to another. Correcting a *wrong* match is a different act, and the sync does not claim it.

### 6. A cancelled order appears in neither section

It is reported nowhere because there is nothing waiting. Offering to record a sale for an order the
buyer withdrew is the app making a financial suggestion on the strength of a transaction that did
not happen. Whether a cancellation should reach back into a `Sale` already recorded is #463's open
question, deliberately not answered here.

### 7. Every failure is visible where the list is read

A stale worklist that looks current is the failure mode this feature is designed against. So the
screen's header states, in plain words and each fixed somewhere different: not connected, needs
reconnecting, no platform marked as Allegro, the last pass failed (with Allegro's own message), and
nothing synced for over an hour.

A 401 does not land in `lastError`: it latches `AllegroConnection.needsReconnect`, which is ADR-0023's
single convergence point for every unusable grant. Being *not connected* is likewise not a failed
sync — the pass reports `skipped`, and the settings panel already says what to do.

### 8. Background poll every 15 minutes, plus **Sync now**

In the existing in-process periodic-job pattern (`src/instrumentation-node.ts`, beside the photo GC
sweep and the render worker; ADR-0018) rather than a new service. A pass claims its collection
(`running` + `startedAt`) so the poll and a button press cannot read one stream twice, and the claim
times out — a lock nothing can release would end the sync permanently, while a duplicated pass over
idempotent writes costs a few requests.

### 9. The buyer is read down to *who*, never *how to reach them*

A worklist row has to say who bought and for how much — that is how a collector recognises the order
they are about to record, and a card that named only an order id would send them back to Allegro to
find out. So `AllegroOrder` carries the buyer's **login**, their **name or company**, and
`totalToPay` as `totalPaid` + `currency`.

It carries none of the rest. The order also states an email, a phone number and a delivery address,
and those are deliberately left unread: they are what the *sale* needs, and #463 fetches the order
by id at the moment the collector confirms it — one call, at confirmation time, rather than a
background job keeping a table of personal data fresh for a feature that may never be used on that
order.

The total is **stored, not summed from the lines**. `totalToPay` includes delivery, so it is what
actually changed hands — `Sale.buyerPaidTotal`'s own anchor (#205) — while a sum of line prices is a
different number that would quietly disagree with the sale about the same order.

## Consequences

- The worklist is a derivation, so a sale recorded by any route — this screen, the offer's own
  screen, the sales list — removes its row, matched on `Sale.externalRef` (which the schema already
  defines as the marketplace's order number). One order can never produce two sales.
- Deleting a local offer leaves its observations behind as unmatched rows (`SetNull`), which is
  truthful: the marketplace's order did not stop existing.
- Ended rows are pruned after 90 days. This is a worklist, not an archive.
- One pass is bounded (`SYNC_MAX_ORDERS_PER_PASS`); the cursor means the next one carries straight
  on, so a long-idle install catches up over several polls instead of one long request.
- A collection with no platform marked as Allegro still syncs, and every line comes back unmatched.
  That is the honest answer, and the screen names the setting that fixes it.
