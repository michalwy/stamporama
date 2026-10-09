# Facebook

Facebook is a platform you sell on in groups, two ways: an **auction** is a post in a group, buyers
bid in the comments under it, and the sale closes there; a **quick buy** is a post with a price, and
the first buyer to claim it takes it. Stamporama treats Facebook as **one platform** and keeps the
groups you sell in under it. Whether a new offer is an auction or a quick buy, how a post reads, what
you say about shipping and payment, and what a new auction starts from are set **once for
Facebook**, and every group follows them — except where you set one **custom** for a particular
group.

The platform and its groups are set up under **Settings → Facebook**; an offer there is an
[offer](offers.md) on the Facebook platform, prepared, posted and followed like any other.

Nothing reads the comments under a post, so you follow an offer yourself: on an auction you type the
highest bid while it runs, and when it ends you record who won and for how much — which records the
sale — or that nobody bid. On a quick buy you record who bought it and for how much.

## Which platform is Facebook

The choice at the top right of the page, beside its title. Pick the contact you use for Facebook —
it needs the **Platform** role (see [Contacts](contacts.md)) — and its currency, listing templates and
photo limits are set on the contact itself, exactly as for any other platform. Until you pick one,
the page says so, and has nowhere to put a group.

Only one platform can be Facebook at a time. Choosing another moves the setting; the groups stay with
the contact they were added to, so the page then shows the new platform's groups.

Naming it does **not** switch the [Assistant](assistant.md) on, and none of the Colnect checks is
asked of its offers.

## Facebook defaults

The first row of the list, **Facebook defaults**, holds the settings every group follows, in three
parts.

**Every offer** — what applies to auctions and quick buys alike:

- **A new offer starts as** — **Auction** or **Quick buy**. Each offer can still be changed on its
  own form. Until you change it, this is **Auction**, which is what every Facebook offer was before
  quick buys.
- **Currency** — shown, not set here: it is the platform's own currency, set on its contact.
- **A post may mix auctions and quick buys** — off, the lots of one [post](#a-post-with-several-lots)
  are all auctions or all quick buys; on, one post may hold both.
- **Shipping, payment and terms** — a standing note on how you ship, how buyers pay and the group's
  terms, as written. A post carries it where its template has `{terms}` (below), and only there: a
  template without `{terms}` posts no note, and the field warns you when the note is set but neither
  template uses it.

**New auctions** — how an auction's post reads, and what a new auction starts from, each optional:

- **Post template** — the text an auction's post is prepared from. It can carry placeholders, filled
  in from the offer when the post is prepared:

  | Placeholder | Becomes |
  | --- | --- |
  | `{title}` | the offer's title |
  | `{description}` | the description of what is auctioned |
  | `{startingPrice}` | the starting price |
  | `{increment}` | the bid increment |
  | `{closesAt}` | when the auction closes |
  | `{lot}` | the lot number, in a post holding several lots |
  | `{terms}` | the note on shipping, payment and terms |

- **Starting price** — none, an amount, or a percentage of the copies' catalogue value.
- **Bid increment** — how much a bid must beat the last one by.
- **Days an auction runs** — between 1 and 90.
- **Closing time** — the time of day an auction closes on its last day.

These are starting points: each can be changed on the auction itself. Changing one here changes it
at once for every group that follows it, and never changes an auction already made.

**Quick buys** — how a quick buy's post reads:

- **Post template** — the text a quick buy's post is prepared from, with its own placeholders:

  | Placeholder | Becomes |
  | --- | --- |
  | `{title}` | the offer's title |
  | `{description}` | the description of what is offered |
  | `{price}` | the price |
  | `{lot}` | the lot number, in a post holding several lots |
  | `{terms}` | the note on shipping, payment and terms |

  A quick buy has no price default here: its price is set on each offer.

A post is always written from the template of its own type — an auction's from the auction
template, a quick buy's from the quick-buy one, never the other. In either template, anything else
in braces stays exactly as you typed it, and the field says so under it while you type — so a
misspelt `{startprice}`, or an auction's `{closesAt}` in the quick-buy template, is caught before it
reaches a post.

**`{terms}` places the note on shipping, payment and terms** — wherever you put it, at the end of
the post or above the price. In a post holding several lots it is filled in once, in the last lot's
text; in the lots before it, it is left empty. Nothing adds the note for you: a template written
before `{terms}` existed posts no note until you place it, and the note's field says so while no
template uses it.

**`{catalog}` is no longer offered**: the catalogue numbers are already in an offer's title or
description. A template that still uses it keeps working — the numbers are still filled in — but it
is flagged until you remove it: the field says so under it, and the row in the list carries a
`{catalog}` tag.

The templates here are Facebook's own, not the platform's description template: that one writes an
offer's description, which is what `{description}` puts into the post.

## Groups

The page lists your groups under **Facebook defaults** — those you use first, then any you have
archived under **Archived** — and the chosen group's settings on the right. **Add group** at the top
of the page starts a new one in the same place. A group with offers shows how many beside its name.

Each group has a **Name** — what you call it here, usually the group's own name; two groups on the
platform cannot share one — and a **Link**, the group's address on Facebook, starting with
`https://`. Any address that opens the group will do; the ↗ beside the label opens it.

Every other setting — whether a new offer is an auction or a quick buy, the currency, whether a post
may mix the two, the note on shipping, payment and terms, both post templates, the starting price,
the bid increment, the days and the closing time — shows as **Same as Facebook**, with the value it
follows, until you tick **Custom for this group** beside it (**Custom** on the smaller ones). The field then appears, starting from Facebook's value, and what you save there
is this group's alone: a later change to Facebook defaults does not reach it. Untick it to follow
Facebook again — the group's own value is dropped. A custom setting may also be empty, for a group
that wants, say, no bid increment where Facebook has one. A custom **currency** must name one.

A new group follows Facebook throughout.

Save keeps what you changed; Revert puts the group back as it was saved.

## Archiving and deleting a group

**Archive** at the top of a group's settings puts it out of use: it moves under **Archived**, is
offered to no new offer, and keeps everything — its settings and its offers. **Restore** brings it
back.

**Delete** removes a group for good, and only a group **no offer names** can be deleted. A group
with offers is where sales happened, and your sales by group need it to still be there — so the
Delete button is greyed out, and hovering it says to archive the group instead.

## Selling in a group

An offer in a group is an offer on the Facebook platform. Create it the usual way — **New offer**
on the Offers screen, or **Add to new offer** from your copies — and choose Facebook as the platform:
the form then asks for the **Group**.

Picking a group fills in that group's settings — its own where it has them, Facebook's otherwise —
each of which you can change before you save:

- the **listing type** — **Auction** or **Quick buy**, as the group starts its offers. Change it
  here, or later on the offer's own form, like on any other platform;
- the **starting price** of an auction — the group's amount, or its percentage of the copies'
  catalogue value when the form suggests one from your copies;
- the **bid increment** of an auction;
- **Closes**, for an auction — the group's number of days from today, at its closing time (or at the
  time it is now, if the group names none);
- the **currency** — the group's own when it has one, otherwise the platform's. An offer in a group
  with a currency of its own is in that currency, whatever the platform's is.

A **quick buy** has an asking price instead, typed on the offer like on any platform; it needs one
before it can be made Ready. It has no starting price, bid increment or closing time.

Changing the group's settings, or Facebook defaults, later changes nothing about offers already
made. Only groups in use are offered; an archived group can be kept by an offer already in it, but
not chosen for a new one.

If you leave an auction's starting price empty, the auction still opens at the group's: its amount,
or its percentage of what one set of the offer's copies is worth in the catalogue. Copies with no
catalogue value leave it empty.

### Without the form

Every other way of making an offer asks for the group too when the platform is Facebook:

- the **Lot builder**, under *Create the offer*;
- **Quick offer mode** on your copies, in its bar beside the platform, which also covers
  **Generate offers…** — whose sets go only into offers already in that group;
- **Series from singles**, when you compose a series into a new offer. A series added to an offer
  that already lists it keeps that offer's group.

The picker starts on the last group you used on Facebook, from any of these or from the form — in
the Lot builder, unless the saved criteria you loaded name a group of their own. Until
a group is chosen the create button stays greyed out, and the reason is shown beside it. The new
offer takes the group's settings as the form does: an auction or a quick buy as the group says (the
Lot builder lets you choose the other), and
for an auction the starting price, worked out from the copies' catalogue value when the group gives
a percentage, the bid increment, the currency, and the closing time. A quick buy made this way has
no price yet. The listing's link and anything else are set on the offer itself afterwards.

An assistant drafting an offer for you on Facebook names the group as well, from the groups you have
in use. Its draft takes the group's settings in the same way, except an auction's closing time, which
it leaves for you to set.

### A copy is in one offer at a time

A copy that is in a Facebook offer which is up — an auction or a quick buy, active or paused —
cannot be put in another Facebook offer, in any group: either one may sell it. The refusal names the
offer it is in, for example *offer #41 in Znaczki — aukcje*. Closing or withdrawing that offer frees
the copy. Two offers still being prepared may hold the same copy; the second one then cannot go up
while the first is.

Listing the same copy on another platform at the same time is not affected.

## Posting

Facebook has no way for an app to post in a group, so you post by hand from the **Facebook** card on
the offer's screen, directly under the description, which holds everything the post needs:

- the **group**, with a link to open it;
- the **post text**: the group's post template for the offer's type — the auction or the quick-buy
  one, its own or Facebook's, as it reads now — filled in from the offer, with the note on shipping,
  payment and terms where the template's `{terms}` puts it. **Copy** puts it on the clipboard in one
  click. A group with no template for that type posts each lot's description;
- **↓ Photos**: the offer's photos as one download.

Once the post is up, choose **Activate** on the offer and paste the post's link as its **listing
URL** — on Facebook the listing link *is* the post's address. That activates the offer, the same as
publishing on any other platform, so the offer has to be **Ready** first; the card says so until it
is, and shows the link once the offer is up.

## A post with several lots

A post can hold several offers as **lots** — an album, each photo a lot of its own. On the
**Offers** screen, tick the offers to post together and choose **Post together** in the selection
bar. They must all be Facebook offers in the same group, not yet posted and not in another post —
and all auctions or all quick buys, unless the group's posts may mix them (**A post may mix auctions
and quick buys**, above). They become lots 1, 2, 3… in the order you ticked them. The auctions among
them share one closing time — the first auction's — from then on: changing it on one lot changes it
on all of them. A quick buy has no closing time.

Each lot's Facebook card then shows the whole post:

- the lots, in order, each linking to its offer;
- the **post text** for the whole post — each lot's text in lot order, each from its own type's
  template, the note on shipping, payment and terms once, where the last lot's `{terms}` puts it — and **↓ Photos, in lot order**, every lot's photos in one download, each file starting
  with its lot (`lot-01-…`), so the album uploads in the right order;
- the **listing link** of this lot, once the post is up.

The post goes up as one: **Activate** on any lot asks for the post's link once and activates **every**
lot, so every lot has to be Ready first. The link becomes the listing URL of every lot that has none
of its own. A lot can carry its own photo's link instead: enter it as that offer's listing URL before
activating, and it is kept.

Until the post is up, **Take this lot out of the post** removes a lot: the lots after it
move up, and a post left with one lot becomes an ordinary single post. Once the post is up, its lots
stay as they were posted. Deleting a lot's offer works the same way as taking it out.

A lot cannot be moved to another group while it is in a post; take it out first. Nor can it change
from auction to quick buy, or back, while it is in a post whose lots share one type.

## While an auction runs

Once an auction is up, its **Facebook** card has a **Bidding** part. Type the highest bid you see
under the post and choose **Record bid**. The card shows it with when you recorded it — *recorded
3 hours ago* — and so does the offer's row on the **Offers** screen, beside the figure, so a bid you
typed days ago looks as old as it is. Recording a bid is the same as editing the offer's price in
place; it changes nothing about the post itself.

## When an auction ends

Once an auction's closing time has passed, it asks for its result: its row on the **Offers** screen
carries the **Ended, unresolved** flag, the **Ended auctions** filter lists it, and the card says it
has closed. Unlike on other platforms, this happens whether or not you recorded a bid — on Facebook a
missing bid may only mean you did not type one.

**Record result…** asks for:

- the **winner**, by the name their profile shows, and the **profile link** if you have it;
- the **winning bid**, starting from the last bid you recorded;
- the day it **sold**, the day it closed unless you change it;
- the **sale** it goes into.

While you type, the dialog says who the winner is: a contact found by the profile link, or by name, or
a new buyer it will create. The profile link is kept on the contact (see [Contacts](contacts.md)), so
the same person is recognised next time even under another name. A contact with the same name but a
different profile link is somebody else, and the dialog says so — give the new winner a name of their
own.

Several lots won by one person are usually one parcel, so the dialog lists the winner's **open
Facebook sales** — not yet sent, in the auction's currency — and you choose to add the lot to one of
them or to start **a new sale**. Saving records the sale, in the auction's own currency, and opens it;
the offer becomes **Sold**. An auction holding several sets is still bid on as one lot, so its price is
split evenly over the sets.

**No bids** ends an auction nobody bid on: the offer is **withdrawn** and its copies are free to go
into another auction. Listing them again is a new offer.

In a post with several lots, each lot has its own result, recorded on its own offer.

## Selling a quick buy

A quick buy that is up has a **Sale** part on its **Facebook** card, showing its price. When somebody
claims it, choose **Record sale…**, which asks for the same things as an auction's result: the
**buyer**, by the name their profile shows, and their **profile link** if you have it; the **price**
it sold for, starting from its asking price; the day it **sold**, today unless you change it; and
the **sale** it goes into — one of the buyer's open Facebook sales, or a new one. The buyer is found
or created exactly as an auction's winner is.

Saving records the sale and the offer becomes **Sold**. The offer keeps its own asking price; what the
buyer paid is on the sale. A quick buy never closes by itself, so it never asks for a result: to take
one down unsold, withdraw it as any offer.
