# ADR-0075: Proposals — an Offer Prepared for One Contact, on a Direct Platform

## Status

Accepted. Decided in #2287 on 2026-11-01, which built it; the design was settled with the collector
in the issue, and its *to be confirmed* points were implemented as written. #2288 (what the buyer is
sent) and #2289 (a proposal becomes a sale, §6 — built 2026-11-01) build on it; #2601 lets the buyer
tick the lots they want (§10); #2602 makes a Facebook post into a proposal sharing its lots (§11); #2603 sends it in the buyer's language (§12); #2641 deletes one that is not sold, and #2643 deletes a declined one with its post (§13).

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

`preparing` while lots and prices change; `sent` once it has gone to the buyer (`sentAt`) — prices
still editable as first decided, **fixed since #2307** (§9); then closed (`closedAt`) — `sold` once converted (#2289), or `declined` by hand, which
**withdraws every lot still open**, each through the offer's own transition. A closed proposal takes
no lots and changes no more. Marking it sent needs a lot. The rules are `proposal-rules.ts` (pure).

### 6. The one exception: Direct lots may join a sale on another platform

A sale is on one platform, and selling several offers together (#2050) asks them to share it. A
proposal's buyer usually first bought on Facebook, and the accepted lots belong in that sale. So
**#2289 allows Direct lots to join a sale on another platform**; nothing else did, until #2343 made
it the rule for every offer (ADR-0013 §9). This ADR records the exception; #2289 built it, on
2026-11-01, as written in its issue:

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
passes and which still refuses an offer that is not a lot of a proposal. Since #2343 the platform is
no longer what it lifts — every offer may join a sale on another platform — so what is left of it is
the rest: only a proposal's lots, in the sale's currency, sold from any open state.

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
says only that it is closed. ~~Handing any of the three out moves a Preparing proposal to Sent.~~
**Amended by #2329 (2026-11-01):** handing any of them out changes nothing — copying the message or
a photo, downloading photos, opening the document or making its link all leave a Preparing proposal
Preparing. Opening the document to check it is not sending it, and a proposal turned Sent by mistake
could only be reopened with a false *the buyer saw an earlier version*. **Only *Mark sent* marks a
proposal Sent**, a reopened one included; the buyer opening the link still shows as *last opened* and
changes no state. **Amended by #2625 (2026-11-21):** on the phone, a share through the phone's own share
menu that went through marks a Preparing proposal Sent as *Mark sent* would — the collector chose it
over the issue's *copying marks it Sent too*. Copying on the phone changes nothing, as at the desk.

### 9. A sent proposal is fixed (#2307), and New offer makes a lot (#2304)

Added by #2307 and #2304, which built them together on 2026-11-01, their *to be confirmed* points as
written. §5's *prices still editable* is replaced: **only a Preparing proposal takes lots and changes
to them** (`proposalTakesLots`). Sent, no lot is added or taken out and no lot's title, price, format
or platform changes — refused on the proposal's screen, in the agent API, and on the lot's own offer
screen (`patchOffer` / `updateOffer` ask `sentProposalLot`), each with the reason. The offers' own
states are untouched, and selling or declining a sent proposal needs no reopening. **Reopen** moves
Sent back to Preparing and keeps `sentAt`, which is how the screen knows the buyer has seen an
earlier version; sending again stamps the new time. No column was added. A reopened proposal does not
renumber its lots when one is taken out (`proposalRenumbersLots`): the buyer still holds §8's numbers.

Lots now also join through *New offer* (§2's list gains a fourth way): its **Proposal** field makes the
form's offer on Direct and the chosen proposal's next lot in one transaction (`createProposalLot`,
`writeProposalLots` as the `inTransaction` hook). It and the generator's *Into proposal* list the
Preparing proposals only and share one remembered choice per collection in the browser.

### 10. The buyer ticks the lots they want on the live page (#2601)

Added by #2601, which built it on 2026-11-21, settled with the collector that day; its *to be
confirmed* points were implemented as written. The buyer used to answer in the chat — *I'll take 2,
5 and 7* — and the collector copied that into *Convert to sale…*. Now **each lot still offered has a
tick box on §8's live link**, saved the moment it is ticked, with no submit, while the proposal is
open (Preparing or Sent). A sold or withdrawn lot has none, and a closed proposal's page still says
only that it is closed. The buyer only ticks: no note and no price.

A pick is **the lot's own** (`Offer.proposalPickedAt`), named on the page by its lot number — no id
of the collection's reaches the buyer — through a route of the token's own (`/api/p/[token]/picks`).
It is cleared when the lot is taken out of the proposal and when an offer joins one, so it never
follows an offer elsewhere; it stays when the proposal is reopened. The proposal keeps when the buyer
last ticked or unticked (`Proposal.buyerPicksChangedAt`).

The collector sees the picks **in the app only**: *Buyer picked 3 lots · 2 hours ago* above the
proposal's lots, each picked lot marked *Picked by the buyer* (*Picked, no longer available* once it
is sold elsewhere or withdrawn), the same count on the Proposals list — and *Convert to sale…* opens
with the picks still sellable ticked, every tick still the collector's to change. The agent API
reads no picks.

*Amended by #2607 (2026-11-21):* the agent API now reads them — `get_proposal` lists the lots
picked and when the buyer last changed them, `list_proposals` narrows to proposals with picks, and
`convert_proposal_to_sale` takes `picked` for the picks still sellable, as *Convert to sale…* opens
with them — with a read only token included. It still never ticks or unticks: picks are the buyer's.

### 11. A proposal made from a Facebook post shares the post's lots (#2602)

Added by #2602, which built it on 2026-11-21, settled with the collector that day; its *to be
confirmed* points were implemented as written. A regular buyer got first refusal on a post by being
sent its preview (#2212), and what they took was recorded by hand. Now **a post not yet up can be made
into a proposal** for one contact (`Proposal.facebookPostId`, `SetNull`), and **its lots are the
post's own offers** — the one kind of proposal whose lots are not on Direct (§3): they stay on Facebook
in the post's group, numbered as the post numbers them (`proposalLotNo = facebookLotNo`). So a lot the
buyer takes is sold in the post, and does not go up with it (#2560).

- **One open proposal per post**, made only before the post is up. A lot is in one proposal at a time;
  once a proposal made from the post closes, the next one takes the lots still for sale, while the lots
  sold or withdrawn through the earlier one stay its record.
- **The proposal follows the post while it is Preparing**: a lot added to the post joins it under the
  same number, a lot taken out leaves it (losing its pick, §10), and the post's order is its order,
  set on either screen. Lots join no other way — §2's four ways refuse such a proposal, and *New offer*
  and the generator do not offer it.
- **Sent, the post's lots are fixed with it** (§9): no lot added, taken out or reordered on the post,
  no title or price changed, until the proposal is reopened or closed.
- *Convert to sale…* (§6) defaults to a new sale on **Facebook** for the contact (the contact's open
  sales on any platform can still be picked) and **withdraws nothing**: the lots not taken stay in the
  post as they were. *Decline* withdraws nothing either.
- Publishing the post while the proposal is open only **warns**; the proposal stays open, and a lot
  sold on Facebook reads *No longer available* on the buyer's page (§10). A post with an open proposal
  cannot be deleted.

The message the buyer is sent is still Direct's template (§8); the post's own preview link is
unchanged.

*Amended by #2608 (2026-11-21):* the agent API makes one too — `create_proposal_from_post`, the post's
*Make a proposal…* (`createProposalFromPost`), refused with the same sentences — after reading the post
with `get_facebook_post`, whose lots each name the proposal they are in. `get_proposal` names the post a
proposal was made from, and converting one through the API sells in the post and withdraws nothing, as
above. Publishing the post stays the collector's (settled with the collector that day as part of *what
makes sense of #2602 is covered in the API too*; the issue's *to be confirmed* point implemented as
written).

*Amended by #2632 (2026-11-21):* the post's phone screen makes one too (ADR-0072), where the desk offers
it and through the same `createProposalFromPost`, asking only the contact — picked, or typed and then
found by name or made with no role — and opening the proposal's phone screen to share it (settled with
the collector that day; *only the contact is asked* implemented as written).

### 12. It is sent in the buyer's language (#2603)

Added by #2603, which built it on 2026-11-21, settled with the collector that day; its *to be
confirmed* points were implemented as written. §8's *the proposal's language* was the Direct
platform's listing language, else the collection's, whoever the buyer was. Now **a contact has a
language** (`Contact.language`, null until set, edited on the contact's page) and a proposal is in
it: **the contact's language, else Direct's listing language, else the collection's**.

- **The choice is the contact's, not the proposal's.** The proposal's card has a *Language* selector;
  choosing there writes `Contact.language`, so the next proposal for them opens in it. No column was
  added to the proposal: the message, the document and the live link read the contact's language
  live, which is how changing it **moves the link the buyer already holds**. Every other material for
  a buyer that gets a language choice follows the same rule in its own issue (#2604 order summary,
  #2605 specification, #2606 trade page).
- **The languages offered are those the collection uses** — its default language, its platforms'
  listing languages, its albums' (`languageChoices`), plus the contact's own if nothing uses it any
  more. A new language is added there first.
- **The message has one template per language** (`PlatformProposalMessage`, Direct's only;
  `Platform.proposalMessageTemplate` is gone, its text moved to Direct's listing language, else the
  collection's). The proposal takes the template for its language and **no other**: a language with
  none has no message, and the card names the language whose template is missing (#1692).
- **Each lot's title is rendered in the language** from its title template (`offerTitlesInLanguage`),
  translated names falling back name by name as an offer's specification does; a title written by hand
  (`nameEdited`) is shown as written, and the lot's stored title never changes. Where the language is
  the one the titles were written in, the stored titles are used as they are.
- The page's own words are the eighteen languages of §8's labels, English otherwise, said beside the
  selector. The photos keep the labels they were made with.

*Amended by #2609 (2026-11-21):* the agent API reads the language — `get_contact` carries the
contact's, and `get_proposal` the one its message is in with the collection's choices. The message can
be asked for in another of those languages; **that saves nothing on the contact**, unlike the card's
selector, as reading the message does not mark the proposal sent. A language asked for with no
template in it is refused with the reason rather than read as no message.

### 13. A proposal that is not sold can be deleted (#2641)

Added by #2641, built on 2026-11-21, settled with the collector that day; its *to be confirmed* points
were implemented as written. Before it a proposal went only with its contact, and *Decline* kept it on
the list for good. **Delete proposal…** (`deleteProposal`, its read `readProposalDeletion`) — on the
proposal's screen and on its row in the list — deletes it outright:

- **Any but a Sold proposal** (`proposalDeleteRefusal`): a Sold one is the record of how its sale came
  about. Asked again inside the write, so a sale made since the dialog opened still refuses.
- **Its lots go with it**, as deleting those offers would — their images' files deleted once the write
  is in — and their copies are free again. **A lot with a sold set stays** with its sale, no longer
  naming the proposal: the sale record must survive, as it does when an offer is deleted.
- **A proposal made from a post (§11) deletes no lot**: they are the post's and stay in it as they are.
  The post can then have a new proposal made from it.
- Every lot that stays loses `proposalId`, `proposalLotNo` and `proposalPickedAt` (§10's rule): the
  buyer's picks go with the proposal.
- **The live link is kept, pointing at nothing**, and says *the offer is no longer available* — a third
  standing of the shared page (`gone`), worded in §8's eighteen languages — rather than an error.
- **Numbers are not reused**: `Collection.nextProposalNo` only grows (§1).

The confirmation names the proposal and its contact, counts the lots going, any sold lot staying and a
post's lots staying, and — for a Sent proposal, or any with a link — says the buyer's link stops
working (`proposalDeletionText`). The agent API deletes proposals too (#2642): `delete_proposal` is
`deleteProposal`, refused where the app refuses, and `preview_proposal_delete` is the dialog's read.

*Amended by #2643 (2026-11-21):* **deleting a post deletes the declined proposals made from it**, in
the same confirmation (*Proposal #4 for Jan Kowalski, declined, is deleted with the post.*), since
their lots are the post's and they would be left empty. Every declined one the post has had goes; a
lot of one no longer in the post stays where it is, no longer naming it, as above. **An open proposal
still refuses the post's deletion**, and a post with a sold lot — a converted proposal's included — is
still refused for that lot.

## Consequences

- The Proposals list is under Offers in the sidebar's Selling section (`/offers/proposals`), each
  proposal's screen at `/offers/proposals/[proposalNo]`, and the contact's page lists theirs with
  *New proposal*. An offer's row and its own screen name the proposal it is a lot of.
- `MODULE_PLATFORMS` has six entries, and `modulePlatformRows` takes the collection's base currency.
- A proposal's total is its lots not withdrawn at their prices; a lot with no price is counted apart
  rather than as zero.
