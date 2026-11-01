# ADR-0075: Proposals — an Offer Prepared for One Contact, on a Direct Platform

## Status

Accepted. Decided in #2287 on 2026-11-01, which built it; the design was settled with the collector
in the issue, and its *to be confirmed* points were implemented as written. #2288 (what the buyer is
sent) and #2289 (a proposal becomes a sale, §6 — built 2026-11-01) build on it.

## Context

After a sale on Facebook a buyer often writes asking whether there are more stamps of some kind.
Answering means putting together an offer for that one person: choosing lots, pricing them, sending
photos and a list, and then selling them whichever lots they take. The app had the pieces for a
public post — a Facebook post is a workspace of lots with prices and photos (#2030–#2033), with a
preview for buyers (#2212), and several offers can be sold together (#2050) — but nothing tied to one
contact rather than a group, and no way to record which lots the buyer accepted. Such an offer lived
in Messenger and a notebook.

## Decision

### 1. A `Proposal` belongs to one contact

`Proposal` is scoped by `collectionId` and names one `Contact` (`contactId`). It is numbered per
collection from `Collection.nextProposalNo` through `allocateEntityNumber`, never reused — *Proposal
#4* on its lots and on the contact's page. It **cascades with its contact**: a proposal is one
person's, and a contact deleted takes its proposals with it; merging two contacts moves them.

### 2. It is built like a Facebook post: its lots are ordinary offers

A lot is an **ordinary `Offer`** naming the proposal (`Offer.proposalId`, `ON DELETE SET NULL`):
copies in sets, a price, a title, photos. Everything an offer can do — generating offers from ticked
copies, pricing, the lot builder, its photo rules — works on a lot unchanged, and the proposal's own
screen titles and prices its lots through the Prepare rows a post's screen uses (#2031). Lots are
listed by offer number; there is no lot number of the proposal's own (a post's exists because the
group's buyers bid on *lot 3*; #2288 numbers what the buyer is sent).

Lots join a proposal three ways: *Add offers…* on its screen takes Direct offers already made, open and
in no other proposal; the Copies list's *Generate offers* on Direct takes an open proposal to put the
offers it **creates** into (`GeneratorRequest.proposalId`, written in the pass's own transaction as
the post is, #2030). An offer that only receives sets stays where it is. And since #2299 *New lots…*
on its screen makes new Direct offers of copies picked there — an offer each or one for all — written
as the generator writes them, in the same transaction as their joining.

### 3. The lots are on a **Direct** platform

Facebook, Messenger or the phone are only how the buyer is reached, not where the stamps are sold.
So every collection gains a sixth module platform, `direct` (`DIRECT_PLATFORM_MODULE`), named
*Direct*, configured on its own Settings page like Philasearch's. Unlike the other five it starts
**switched on**, in the collection's base currency, selling at a fixed price, with no commission or
fees — a proposal has nowhere else to put its lots. The migration gives every collection one, taking
over a generic platform already called *Direct* (in any case) where there is one, as #1955 took over
the contacts that stood for a module.

A proposal's lots are on Direct whatever its switch says: `getDirectPlatform` finds it switched on or
off. Switched off, the Copies bar does not offer it, so new lots come from the proposal's own screen
alone — *Add offers…*, and *New lots…* since #2299.

### 4. A copy may be in a proposal and listed elsewhere at once

As across platforms today. When it sells in one place, the other offers are handled as any copy sold
elsewhere — nothing is special about a lot.

### 5. Its status

`preparing` while lots and prices change; `sent` once it has gone to the buyer (`sentAt`), prices still
editable; then closed (`closedAt`) — `sold` once converted (#2289), or `declined` by hand, which
**withdraws every lot still open**, each through the offer's own transition. A closed proposal takes
no lots and changes no more. Marking it sent needs a lot. The rules are `proposal-rules.ts` (pure).

### 6. The one exception: Direct lots may join a sale on another platform

A sale is on one platform, and selling several offers together (#2050) asks them to share it. A
proposal's buyer usually first bought on Facebook, and the accepted lots belong in that sale. So
**#2289 allows Direct lots to join a sale on another platform**; nothing else does. This ADR records
the exception; #2289 built it, on 2026-11-01, as written in its issue:

- *Convert to sale…* on the proposal ticks the lots the buyer took, each at its proposal price, which
  can be changed there, and sells **every set each still has** at that price — an offer's own *Sell*
  writes the same lines. Ticking nothing is not a conversion.
- They go into **a new sale on Direct** for the proposal's contact, dated today, or one of **the
  contact's sales not yet sent, on any platform**, which keeps its platform, buyer, currency and fees.
  A sale in another currency is refused, not converted.
- A lot is sold from **any open state**: a proposal's lots are never put up anywhere, so *Preparing*
  is as sellable as *Active*.
- The lots not ticked are withdrawn and the proposal closes as *Sold*, in the sale's own transaction.
  The proposal names its sale (`Proposal.saleId`, `SetNull`) and the sale lists the proposals that came
  into it.

The exception lives in one guard, `checkSaleLineDrafts`' `proposalLots`, which only the conversion
passes and which still refuses an offer that is not a lot of a proposal.

### 7. Out of scope

The agent API (no operation reads or writes a proposal), and what the buyer is sent (#2288, since built —
§8).

### 8. What the buyer is sent (#2288)

Added by #2288, which built it. A lot carries a **lot number** in its proposal (`Offer.proposalLotNo`,
unique per proposal), replacing §2's *there is no lot number of the proposal's own*: the photos, the
document and the message all number the lots the way the proposal's screen does, so the buyer's
*I'll take 2, 5 and 7* is ticked as said (#2289). A joining lot takes the next number; a lot taken out
renumbers the rest only while the proposal is Preparing, since once it is Sent the buyer holds them.

The message comes from the **Direct platform's** proposal message template
(`Platform.proposalMessageTemplate`, read on Direct only), as a post's text comes from its group's —
no template, no message (#1692). The document reads like a post's preview (#2212) and is printed or
shared by a live link (`ProposalShareToken`) that follows the prices until the proposal closes and then
says only that it is closed. Handing any of the three out moves a Preparing proposal to Sent.

## Consequences

- The Proposals list is under Offers in the sidebar's Selling section (`/offers/proposals`), each
  proposal's screen at `/offers/proposals/[proposalNo]`, and the contact's page lists theirs with
  *New proposal*. An offer's row and its own screen name the proposal it is a lot of.
- `MODULE_PLATFORMS` has six entries, and `modulePlatformRows` takes the collection's base currency.
- A proposal's total is its lots not withdrawn at their prices; a lot with no price is counted apart
  rather than as zero.
