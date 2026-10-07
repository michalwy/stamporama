# ADR-0061: Facebook Group Auctions

## Status

Accepted. Designed with the collector on 2026-10-03 and written down by #1543, which builds the
platform and its groups (§1, §6). The offer, the post and its kit are #1544 (§2, §3, §5), the running
bid and the result #1545 (§4), the Assistant filling a post #1546 (§3), and several groups at once
#1547 (§5). §6 is amended by #1661: a group's settings follow the platform's unless set custom. §3
is amended by #1668: the post's link is recorded as the offer's own listing link, asked by *Activate*.
The whole is amended by #1671 (§8): a Facebook offer can be a quick buy as well as an auction.

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
posts by hand and records the post's link — as the offer's own listing link, which *Activate* asks
for as on every platform (#1668); for a post holding several lots it is given once and written into
every lot that has no link of its own. **The Assistant filling in the post comes later**, as a
step of its own (#1546), and never presses *Post* itself.

### 4. The running bid is recorded by hand, and the result when it ends

The current highest bid can be recorded while the auction runs, and the winner and price when it
ends, which creates the sale as every other platform's result does.

**Rejected, with the collector:** recording the result only, and the Assistant reading the bids out
of the comments.

**Settled with the collector on 2026-10-03, building it (#1545):**

- The running bid is the **amount only**, no bidder — the offer's own price, dated as every typed bid
  is, and shown on the offer lists with its age.
- **Every Facebook auction past its closing time asks for its result**, bid recorded or not: nothing
  reads its bids, so a zero is no evidence that nobody bid.
- The winner is a **contact found by their profile link first, then by name**, created as a buyer
  when neither finds one. The link is **optional** and kept on the contact
  (`Contact.facebookProfileUrl`), filled in on a contact that has none.
- The lot goes into a **sale the collector chooses**: one of the winner's open Facebook sales in the
  auction's currency — several lots won by one person are one parcel — or a new one, which is in the
  auction's own currency.
- **No bids withdraws the offer**, freeing its copies; listing again is a new offer.

### 5. A copy is in one active Facebook auction at a time

Listing the same copies in several groups at once is a later, separate decision (#1547): what the
other auctions do when one of them ends with a winner is the whole question, and it is not answered
by allowing it first.

### 6. A group holds its customs, as defaults

Per group: the **post template** (`{token}` placeholders for the description, the catalogue numbers,
the starting price, the increment, the closing time and the lot number — `FACEBOOK_POST_PLACEHOLDERS`,
split by type and without the catalogue numbers since §8),
a **standing note** on shipping, payment and terms appended to every post, the default **starting
price** (an amount, or a percentage of catalogue value), the default **bid increment**, the default
**length** of an auction and its **closing time of day**, and the **currency**, which is the
platform's own unless the group names another.

Every one of them is optional and is a **default read when an offer is created** and then owned by
the offer — the rule every platform setting here follows (#308, #449) — so changing a group never
re-prices an auction already running. The pure rules are `src/lib/facebook-group-rules.ts`, the
reads and writes `src/lib/facebook-groups.ts`.

**Amended by #1661 (decided with the collector on 2026-10-06): the platform's settings are every
group's defaults, and each setting can be marked custom for a particular group.** Most groups want the
same things, and stating them once per group was stating them several times. So the Facebook platform
holds the same settings — the post template, the note, the starting price (an amount or a percentage,
as a group's), the increment, the days and the closing time — and its currency is the platform's own
(#196). A group follows each of them, read live, unless it marks that one custom; a custom setting
may be empty, and switching it back drops the group's value. A new group follows throughout, and the
existing ones were migrated so that what each posts did not change: a setting equal to the platform's
became *follows*, one that differed stayed custom.

The platform's post template is its own, **not** the contact's description template (decided with
the collector, 2026-10-06): the description template writes the offer's description, which the post
template's `{description}` places — one is inside the other. The contact's default starting price, an
amount that no Facebook auction read, moved into the platform's settings and is no longer offered on
the Facebook platform's contact.

### 7. A group with offers is archived, never deleted

A group is where sales happened, and the reports per group need it to still exist. So a group no
offer names can be deleted, one that has offers can only be **archived** (`archivedAt`) — kept, listed
apart, offered to no new auction, and brought back with one click. `Offer.facebookGroupId` is
`ON DELETE RESTRICT` as the backstop to the domain's refusal.

### 8. A Facebook offer can be a quick buy too (amendment, #1671)

**Decided with the collector on 2026-10-07.** Facebook groups carry fixed-price sales as well as
auctions — a post with a price, the first buyer to claim it taking it — so a Facebook offer is an
**Auction** or a **Quick buy**, the `listingType` every other platform's offer already has. What this
amends: the decision above was written for auctions alone, and #1544 forced every Facebook offer to
be one.

- **The listing type is a setting** of the Facebook defaults and of a group, following §6's
  default-and-custom rule; a new offer starts from its group's and can change it. The platform's
  starts as *Auction*, which every Facebook offer so far was, so the migration changed nothing.
- **There are two post templates**, one per type, each following the same rule, and a post's lot is
  built from the one matching its offer's type — never the other. A quick buy's template takes
  `{price}` where an auction's takes the starting price, increment and closing time; **both take
  `{title}`**, the offer's title.
- **`{catalog}` is dropped from the templates** — the catalogue numbers are already in an offer's title
  or description. A template still carrying it is flagged in Settings so the collector removes it, and
  until then it is still filled in, so no post loses text unannounced.
- **Settings group by type**: *New auctions* (the auction template, starting price, increment, days,
  closing time) and *Quick buys* (its template); the listing type, the currency, the note and whether a
  post may mix types apply to both.
- **A quick buy has an asking price** like any quick buy and no increment or closing time; **its sale
  is recorded as an auction's win is** (§4) — the buyer a contact found or created by profile link and
  name, the price split over the sets — except that the offer's own asking price is left as it was.
- **A post's lots share one type unless the group allows mixing** — a setting of its own, following
  the same rule, off unless set. Only a post's auctions share its closing time.
- **§5 covers quick buys too**: a copy is in one Facebook offer that is up at a time, auction or quick
  buy, since either can sell it.

## Consequences

- `Offer.facebookGroupId` exists before anything writes it: #1544 is the writer. It is null on every
  offer not on Facebook.
- A group's currency may differ from the platform's, which the platform-currency lock (#196) did not
  foresee. **Settled by #1544 with the collector on 2026-10-03:** an auction in a group with a
  currency of its own is in that currency, and the platform's lock is left untouched; a group naming
  none follows the lock.
- A post holding several lots is a `FacebookPost` row (#1544) and a single post is not: an offer
  posted alone carries its post's link as its own `url`. The lots share their group and closing time;
  the closing time is kept on each lot's `endsAt` and written to all of them together. **Amended by
  #1668:** the post's link is likewise each lot's own `url` — the post row kept it in a column of its
  own until then, which the collector saw as a second field for one address.
- Moving the Facebook marker to another contact leaves the groups with the contact that owns them,
  as Delcampe's profiles are left; the page then shows the new platform's groups, which start empty.
