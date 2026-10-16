# ADR-0061: Facebook Group Auctions

## Status

Accepted. Designed with the collector on 2026-10-03 and written down by #1543, which builds the
platform and its groups (§1, §6). The offer, the post and its kit are #1544 (§2, §3, §5), the running
bid and the result #1545 (§4), the Assistant filling a post #1546 (§3), and several groups at once
#1547 (§5). §6 is amended by #1661: a group's settings follow the platform's unless set custom. §3
is amended by #1668: the post's link is recorded as the offer's own listing link, asked by *Activate*.
The whole is amended by #1671 (§8): a Facebook offer can be a quick buy as well as an auction. §6
is amended by #1689: the standing note is placed by a `{terms}` placeholder, no longer appended. §3
is amended by #1692: a post is only what its template places. §4 and §8 are amended by #1777: a
Facebook offer is sold with the ordinary *Sell* and taken down with the ordinary *Withdraw*. §6 is
amended by #1780: an offer can carry its own post template, overriding its group's. §3 is amended
by #1800: a published offer's post text is frozen as it was posted. §2 is amended by #1841: a post of
several lots can carry each lot's text in its photo's caption. §2 is amended by #1842: a post of
several lots has a number and a screen of its own. §2 is amended by #1989: every Facebook offer that
goes up is in a post — an offer posted alone is a post of one lot, made when it is published.

Facebook is the Facebook module platform since [ADR-0071](0071-platform-entity.md) (#1955), not a contact named as Facebook; its groups and settings are unchanged.

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

**Amended by #1841 (decided with the collector on 2026-10-12): a post of several lots can be laid
out with each lot's text in its photo's caption.** Some groups require single series or single
stamps offered together to go in one post of many photos, each item's price and description in its
photo's caption rather than in the post's text. The model stays — **many offers, one lot each, posted
together**; one offer holding many lots was considered and not chosen, since each lot sells on its
own and an offer per lot already carries its sale, withdrawal, *Pending* and frozen text.

- **The layout is a group setting** — in the Facebook defaults and per group, §6's rule — **and a
  post can override it** until it is up.
- **In the captioned layout each lot is exactly one photo**, its caption the lot's text, so one photo
  is one price. A lot that already is one photo uses it; a lot of several is joined into one with the
  offer's collage settings. A lot whose photos show fronts and backs puts both in that one photo: the
  fronts and the backs as two halves in the same grid, so a stamp's front and back sit in matching
  places, with a visible separator between them, **joined side by side or one above the other,
  whichever brings the result closer to the shape the offer's collage aims at** (#1699; square when it
  names none). A lot photographing fronts only has no backs half and no separator.
- **Templates**: a *caption* template per listing type and a *post text* template for the captioned
  post's shared body, all followed settings. A caption takes its type's placeholders bar `{terms}`;
  the post text takes `{offer}` — the lots' offer numbers — and `{terms}`. Both take `{post}`, the
  post's number (#1854), and `{postTitle}`, its title (#1862), which no single post's template
  offers. An offer's own template
  (§6, #1780) writes its caption.
- **The kit** shows the post text with its copy button, then the photos in post order, each with its
  caption and its own copy button; the download gives one photo per lot, named in that order (#1754).
- **Freezing at publication** (§3, #1800) covers the post text, every caption and the layout itself.

The joined photo is drawn on demand from the offer's stored images, never stored itself: it follows
the offer's photo run without a second fingerprint to keep in step.

**Amended by #1861 (decided with the collector on 2026-10-12): a lot's photo is drawn once and
stored.** Drawn on every view and every download, a post of twenty or thirty lots made its screen slow
each time it was opened.

- It is drawn **in the background**, as an offer's own images are (#311), when it is needed: after the
  offer's images are generated while it is a lot of a captioned post, when a lot joins one, and when a
  post turns captioned. The post's screen shows a lot still being drawn as such and the rest at once.
- It is **drawn again when what it is made from changes** — the offer's images or the collage shape
  it aims at — and a stale one is never served: the second fingerprint the paragraph above avoided is
  the price of that.
- It is **generated bytes**, removed with the offer's other generated images, and when the lot leaves
  the post or the post leaves the captioned layout.
- **A published post keeps the photo it went up with**, as its text is frozen (§3, #1800).
- The download of a captioned post's photos **waits until every lot's is ready**, so an incomplete
  set is never what gets posted.

**Amended by #1842 (decided with the collector on 2026-10-12): a post of several lots has a screen of
its own, and a number.** It was seen only from the Facebook card of any of its lots, each card
repeating the whole post.

- **A post has a short number**, per collection, allocated as an offer's is (#416) and never reused —
  a dissolved post retires it.
- **The post's screen** lists its lots in lot order with each one's state, price, link and sale, and
  holds the post kit and the moves the post makes as one: submit for approval, approve, reject,
  activate, withdraw a pending post — plus taking a lot out while the post is not up. Each lot's own
  actions — selling it, withdrawing one lot of a post that is up — stay the offer's, reached from the
  lot's row.
- **The offers list names the post on every lot's row** — *Post #12 · lot 3* — opening the post's
  screen, and can be narrowed to one post's lots from it.
- **A lot's Facebook card names its post** — number, lot number, where the post stands, *Open post* —
  instead of repeating it. What is the lot's own stays on it: its own template and its bidding.
- A list of all posts was not part of the decision.

**Amended by #1862 (decided with the collector on 2026-10-12): every post of several lots has a
title.** With a list of posts (#1850) and several running at once, a number alone did not say which
post was which.

- **Given when the post is made** — *Post together* asks for it and refuses a blank one — and renamed
  in place on the post's screen, never to blank. Posts made before have none until given one, are named
  by number meanwhile, and the list of posts can be narrowed to them.
- **Shown wherever the post is named**: its screen's heading (*Post #1 · Generalgouvernement
  1940–44*), the list of posts, each lot's Facebook card, and the offers list's *Post #N · lot M* chip
  on hover.
- **`{postTitle}`** fills it into the captioned post's text and captions, beside `{post}`. A post with
  none leaves it empty and its kit names the gap (#1692). Unlike the number it is content: frozen with
  the post's text when it goes up (§3, #1800), so a rename afterwards leaves the posted text as it was.

**Amended by #1870 (decided with the collector on 2026-10-12): offers can be added to a post that
exists.** Offers joined a post only when it was made, so adding one meant taking every lot out —
dissolving the post and retiring its number — and making it again.

- **Only while the post is not yet up** — being prepared or Ready. A post pending or live keeps the
  lots it went up with, as it keeps them against taking one out.
- **From the offers list** (*Add to post…*, listing the posts of the ticked offers' groups not yet up,
  newest first, by number and title) **and from the post's screen** (*Add lots…*, picking from the
  offers that could join).
- **Each offer is asked what *Post together* asks** — a Facebook offer in the post's group, in no post,
  not yet up, of the post's listing type unless its group mixes them. One that fails is turned away by
  number with its reason, and the rest are added.
- **They become the next lots**, in the order ticked or picked; the auctions among them take the post's
  shared closing time.

**Amended by #1986 (raised on 2026-10-16): a post's lots can be reordered.** The order they were
ticked or added in was final short of taking lots out and adding them again.

- **On the post's screen, only while it is not yet up** — a pending or live post's lots stay in the
  order they were posted (§3, #1800), and the server refuses a new order then.
- **By dragging a row**, with the app's shared reordering control, **or sorted whole** by catalogue
  number or by price (either way); the result is a starting point that can still be adjusted by hand.
- **The lot numbers are the order**: nothing else stores it, so the post's text, its captions and the
  photo download's order and names (`lot-NN-…`) follow at once.

**Amended by #1989 (decided with the collector on 2026-10-16): every Facebook offer that goes up is
in a post.** On Facebook what the collector puts up is always a post, with one offer in it or many.
Modelling only the many-lot case as a post left the list of posts (#1850) an overview of the albums
alone, not of what is up in the groups, and handled singles and albums through two different paths.
*Both post shapes exist* stands — the shapes are still one lot and several — but both are now a post.

- **An offer gets its post of one lot when it is published**, not when it is created: publishing a
  Facebook offer that is in no post — *Pending* or *Active*, whichever comes first, by any path —
  makes its post and puts it in as lot 1. Until then it is just an offer, so offers meant for a post
  of several never pass through a throwaway post, and post numbers go only to what went up.
- **A post of one lot is numbered and titled like any post** (#1862): *Publish…* asks for the title,
  and one left empty is flagged as missing, never filled in (#1692).
- **It reads as the single post it always was**: its text comes from the post templates, not the
  caption ones; the layout of several lots does not apply; `{lot}` stays empty; its photos are the
  offer's own download; and its screen is the post screen with one row. The offer's card keeps its
  kit and names the post with a link to it.
- **Grouping works on offers in no post**, as before (*Post together*, *Add to post*, #1870). A lot
  taken out of a post not yet up is an offer in no post again, and a post not yet up that is left
  with one lot is dissolved, its offer in no post — either gets a post of its own only if it is
  published alone. A post already up keeps its last lot as a post of one, and goes only with it.
- **State, link, publishing, approval and freezing** move with the post for every offer, as they
  already did for posts of several (#1778, #1800, #1847): a one-lot post's link is its lot's listing
  link, and a repost (#1718) records the new link there.
- **The list of posts shows every post**, and adds *Not in a post yet*: the Facebook offers being
  prepared or Ready that are in no post, so it is a complete picture of Facebook, published or not.
- **Existing data**: every Facebook offer in no post that had gone up became a post of one lot, its
  link, state and frozen text as they were, numbered in the offers' creation order and untitled.

### 3. Posting starts as a kit to paste

The app prepares the post's text from the group's template and the photos to download; the collector
posts by hand and records the post's link — as the offer's own listing link, which *Activate* asks
for as on every platform (#1668); for a post holding several lots it is given once and written into
every lot that has no link of its own. **The Assistant filling in the post comes later**, as a
step of its own (#1546), and never presses *Post* itself.

**Amended by #1692 (decided with the collector on 2026-10-09): a post is only what its template
places.** Nothing is substituted, added or fallen back to: `{description}` is the offer's description
and empty when it has none, never its title; a group with no template for an offer's type gives an
empty post, no longer the description; and the template's line breaks are kept, around empty
placeholders too. What is missing — a template, or a placeholder that comes out empty — is named on
the offer's Facebook card with a link to where it is set, and fixing it is the collector's.

**Amended by #1800 (decided with the collector on 2026-10-11): the post text follows the template
until the offer is published, and is frozen at publication.** Publication is the offer first going
up — *Pending* or *Active*, whichever comes first — and what is frozen is what the lot was written
from: its template (its own or its group's), the note, and its figures (`Offer.facebookPostSnapshot`).
Frozen are the inputs rather than the words, because the closing time is written out in the browser,
the one place the zone is known (#490). From then on no template edit and no change of the offer's
figures reaches it, with one exception the collector chose: an **approval that states a closing
time** writes it into the frozen text, since the post in the group is corrected to it. A **repost**
is a new publication and freezes the current text in place of the old; an offer back in **Ready**
follows the template again; a post of several lots freezes as one. Offers already up when this landed
were frozen at start-up with the text they showed — earlier template versions were never kept.

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

**Amended by #1777 (decided with the collector on 2026-10-11): a Facebook offer is sold with the
ordinary *Sell* and taken down with the ordinary *Withdraw*.** The card's own *Record result…* /
*Record sale…* and *No bids* did the same jobs as *Sell* and *Withdraw*, which every offer already
has, and the collector asked why Facebook was different. What Facebook's dialog added is kept, in
*Sell*:

- **On Facebook, *Sell*'s new sale names its buyer by their Facebook profile** — found by the link
  first, then by name, a name held by a contact with a different link refused as somebody else, the
  link kept on the contact — exactly the rule above.
- Otherwise *Sell* behaves as on any platform: an existing sale on the platform in the offer's
  currency, or a new one **in the offer's own currency** (so a group's currency still survives the
  platform's lock); each set at the offer's current price, adjusted on the sale's screen. The lot is no
  longer split over the sets by the dialog.
- The winning figure is recorded as on other platforms: typed as the offer's current bid before
  selling — the card keeps its bid field after the close for that — or on the sale.
- **A closed Facebook auction still asks for its result**, bid or not; *Sell* or *Withdraw* answers it.
- Sales recorded through the old dialog are untouched.

### 5. A copy is in one active Facebook auction at a time

Listing the same copies in several groups at once is a later, separate decision (#1547): what the
other auctions do when one of them ends with a winner is the whole question, and it is not answered
by allowing it first.

### 6. A group holds its customs, as defaults

Per group: the **post template** (`{token}` placeholders for the description, the catalogue numbers,
the starting price, the increment, the closing time and the lot number — `FACEBOOK_POST_PLACEHOLDERS`,
split by type and without the catalogue numbers since §8),
a **standing note** on shipping, payment and terms appended to every post (placed by `{terms}` since
#1689, below), the default **starting
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

**Amended by #1689 (decided with the collector on 2026-10-09): the standing note is placed, not
appended.** A note tacked on after the template could not sit where it belongs in a post, so both
templates take a `{terms}` placeholder and a template without it posts no note. In a post of several
lots it is filled in the last lot only, so the note is stated once, as before. Templates written
earlier were **not** given `{terms}` — a post is only what its template places (#1692) — so they
post no note until the collector places it, and a note set but used by neither template is flagged
under its field.

**Amended by #1780 (decided with the collector on 2026-10-11): an offer can carry its own post
template**, overriding its group's for that offer only — the one setting that is not read once at
creation and then owned, since the group's template is read live and an offer wanting other words had
no way to say so. It follows #1661's pattern on the offer's card: *Same as group* with the template it
follows, or *Custom for this offer*, prefilled with the group's. It is a **template**, not finished
text — the same placeholders and formatting — so the post still follows the offer's figures. It is for
the offer's current type: a change of type, or a move off Facebook, drops it after the form says so,
since it was written for that type's placeholders. In a multi-lot post it shapes its own lot only.

**Amended by #1815 (decided with the collector on 2026-10-11): the message to a buyer after a sale is
one of these settings too.** Every platform has a buyer-message template — off Facebook on its
contact — and on Facebook it is a platform setting a group follows or overrides, under #1661's rule.
It is a sale's text rather than a post's, so it is not read at an offer's creation: it is read live,
whenever the sale's screen renders it. A sale has no group, so a sale whose offers are all from one
group uses that group's (its own, or Facebook's it follows), and any other sale uses Facebook's.

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
  **Amended by #1777:** both are sold with the ordinary *Sell* (§4's amendment), each set at its
  current price.
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
