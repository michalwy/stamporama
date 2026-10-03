# ADR-0061: Facebook Group Auctions

## Status

Accepted. Designed with the collector on 2026-10-03 and written down by #1543, which builds the
platform and its groups (§1, §6). The offer, the post and its kit are #1544 (§2, §3, §5), the running
bid and the result #1545 (§4), the Assistant filling a post #1546 (§3), and several groups at once
#1547 (§5).

## Context

The collector wants to sell by auction in Facebook groups. That works differently from Allegro or
Delcampe: Facebook is the platform, but an auction is a **post in a group**, buyers bid in the
comments under it and the sale closes there, and there are many groups, each with its own customs —
how a post is laid out, the shipping and payment terms stated under it, how much a bid must beat the
last by, when the auctions close.

Facebook offers no API for posting in groups, and reading bids out of comments is neither offered
nor wanted.

## Decision

### 1. Facebook is one platform, and its groups sit under it

One `Contact` is named as Facebook on **Settings → Facebook**, through the same `platformModule`
marker Allegro, Delcampe and Philasearch use (`FACEBOOK_PLATFORM_MODULE`, exclusive through
`setModulePlatform`). Its groups are `FacebookGroup` rows owned by that contact: a name, a link and
the group's own settings (§6). An offer is on Facebook and names its group (`Offer.facebookGroupId`),
so sales reports see Facebook as a whole and per group.

The marker switches nothing on by itself — no listing half, no capture, no close
(`platform-modules.ts`) — because nothing here posts to Facebook yet (§3).

**Rejected: each group as a platform of its own.** The reports are to see Facebook as a whole first
and per group second; with a platform per group, the whole would have to be added back up from parts,
and the platform's listing templates and photo limits would be typed once per group.

### 2. Both post shapes exist

One post per auction, and one post holding several lots — an album, each photo a lot bid on in its
own comments. Which one depends on the group and the occasion, so neither is the model and the other
an exception.

### 3. Posting starts as a kit to paste

The app prepares the post's text from the group's template and the photos to download; the collector
posts by hand and records the post's link. **The Assistant filling in the post comes later**, as a
step of its own (#1546), and never presses *Post* itself.

### 4. The running bid is recorded by hand, and the result when it ends

The current highest bid can be recorded while the auction runs, and the winner and price when it
ends, which creates the sale as every other platform's result does.

**Rejected, with the collector:** recording the result only, and the Assistant reading the bids out
of the comments.

### 5. A copy is in one active Facebook auction at a time

Listing the same copies in several groups at once is a later, separate decision (#1547): what the
other auctions do when one of them ends with a winner is the whole question, and it is not answered
by allowing it first.

### 6. A group holds its customs, as defaults

Per group: the **post template** (`{token}` placeholders for the description, the catalogue numbers,
the starting price, the increment, the closing time and the lot number — `FACEBOOK_POST_PLACEHOLDERS`),
a **standing note** on shipping, payment and terms appended to every post, the default **starting
price** (an amount, or a percentage of catalogue value), the default **bid increment**, the default
**length** of an auction and its **closing time of day**, and the **currency**, which is the
platform's own unless the group names another.

Every one of them is optional and is a **default read when an offer is created** and then owned by
the offer — the rule every platform setting here follows (#308, #449) — so changing a group never
re-prices an auction already running. The pure rules are `src/lib/facebook-group-rules.ts`, the
reads and writes `src/lib/facebook-groups.ts`.

### 7. A group with offers is archived, never deleted

A group is where sales happened, and the reports per group need it to still exist. So a group no
offer names can be deleted, one that has offers can only be **archived** (`archivedAt`) — kept, listed
apart, offered to no new auction, and brought back with one click. `Offer.facebookGroupId` is
`ON DELETE RESTRICT` as the backstop to the domain's refusal.

## Consequences

- `Offer.facebookGroupId` exists before anything writes it: #1544 is the writer. It is null on every
  offer not on Facebook.
- A group's currency may differ from the platform's, which the platform-currency lock (#196) did not
  foresee; how an offer in such a group takes its currency is #1544's to settle.
- Moving the Facebook marker to another contact leaves the groups with the contact that owns them,
  as Delcampe's profiles are left; the page then shows the new platform's groups, which start empty.
