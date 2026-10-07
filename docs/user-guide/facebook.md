# Facebook

Facebook is a platform you **auction** on, in groups: an auction there is a post in a group, buyers
bid in the comments under it, and the sale closes there. Stamporama treats Facebook as **one
platform** and keeps the groups you auction in under it. How a post reads, what you say about
shipping and payment, and what a new auction starts from are set **once for Facebook**, and every
group follows them — except where you set one **custom** for a particular group.

The platform and its groups are set up under **Settings → Facebook**; an auction is an
[offer](offers.md) on the Facebook platform, prepared, posted and followed like any other.

Nothing reads the bids under a post, so you follow an auction yourself: you type the highest bid
while it runs, and when it ends you record who won and for how much — which records the sale — or
that nobody bid.

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

The first row of the list, **Facebook defaults**, holds the settings every group follows:

- **Post template** — the text a post is prepared from. It can carry placeholders,
  filled in from the auction when the post is prepared:

  | Placeholder | Becomes |
  | --- | --- |
  | `{description}` | the description of what is auctioned |
  | `{catalog}` | the catalogue numbers |
  | `{startingPrice}` | the starting price |
  | `{increment}` | the bid increment |
  | `{closesAt}` | when the auction closes |
  | `{lot}` | the lot number, in a post holding several lots |

  Anything else in braces stays exactly as you typed it, and the field says so under it while you
  type — so a misspelt `{startprice}` is caught before it reaches a post.
- **Shipping, payment and terms** — a standing note added under every post, as written.
- **New auctions** — what a new auction starts from, each optional:
  - **Starting price** — none, an amount, or a percentage of the copies' catalogue value.
  - **Bid increment** — how much a bid must beat the last one by.
  - **Days an auction runs** — between 1 and 90.
  - **Closing time** — the time of day an auction closes on its last day.
  - **Currency** — shown, not set here: it is the platform's own currency, set on its contact.

  These are starting points: each can be changed on the auction itself. Changing one here changes it
  at once for every group that follows it, and never changes an auction already made.

The template here is Facebook's own, not the platform's description template: that one writes an
offer's description, which is what `{description}` puts into the post.

## Groups

The page lists your groups under **Facebook defaults** — those you use first, then any you have
archived under **Archived** — and the chosen group's settings on the right. **Add group** at the top
of the page starts a new one in the same place. A group with offers shows how many beside its name.

Each group has a **Name** — what you call it here, usually the group's own name; two groups on the
platform cannot share one — and a **Link**, the group's address on Facebook, starting with
`https://`. Any address that opens the group will do; the ↗ beside the label opens it.

Every other setting — the post template, the note on shipping, payment and terms, the starting
price, the bid increment, the days, the closing time and the currency — shows as **Same as
Facebook**, with the value it follows, until you tick **Custom for this group** beside it (**Custom**
under *New auctions*). The field then appears, starting from Facebook's value, and what you save there
is this group's alone: a later change to Facebook defaults does not reach it. Untick it to follow
Facebook again — the group's own value is dropped. A custom setting may also be empty, for a group
that wants, say, no bid increment where Facebook has one. A custom **currency** must name one.

A new group follows Facebook throughout.

Save keeps what you changed; Revert puts the group back as it was saved.

## Archiving and deleting a group

**Archive** at the top of a group's settings puts it out of use: it moves under **Archived**, is
offered to no new auction, and keeps everything — its settings and its offers. **Restore** brings it
back.

**Delete** removes a group for good, and only a group **no offer names** can be deleted. A group
with offers is where sales happened, and your sales by group need it to still be there — so the
Delete button is greyed out, and hovering it says to archive the group instead.

## Auctioning in a group

An auction in a group is an offer on the Facebook platform. Create it the usual way — **New offer**
on the Offers screen, or **Add to new offer** from your copies — and choose Facebook as the platform:
the form then asks for the **Group**, and a Facebook offer is always an auction, so it does not ask
how the listing is sold.

Picking a group fills in that group's settings — its own where it has them, Facebook's otherwise —
each of which you can change before you save:

- the **starting price** — the group's amount, or its percentage of the copies' catalogue value
  when the form suggests one from your copies;
- the **bid increment**;
- **Closes** — the group's number of days from today, at its closing time (or at the time it is now,
  if the group names none);
- the **currency** — the group's own when it has one, otherwise the platform's. An auction in a group
  with a currency of its own is in that currency, whatever the platform's is.

Changing the group's settings, or Facebook defaults, later changes nothing about auctions already
made. Only groups
in use are offered; an archived group can be kept by an auction already in it, but not chosen for a
new one.

If you leave the starting price empty, the auction still opens at the group's: its amount, or its
percentage of what one set of the offer's copies is worth in the catalogue. Copies with no
catalogue value leave it empty.

### Without the form

Every other way of making an offer asks for the group too when the platform is Facebook:

- the **Lot builder**, under *Create the offer*;
- **Quick offer mode** on your copies, in its bar beside the platform, which also covers
  **Generate offers…** — whose sets go only into auctions already in that group;
- **Series from singles**, when you compose a series into a new offer. A series added to an offer
  that already lists it keeps that offer's group.

The picker starts on the last group you used on Facebook, from any of these or from the form. Until
a group is chosen the create button stays greyed out, and the reason is shown beside it. The new
auction takes the group's settings as the form does: the starting price, worked out from the
copies' catalogue value when the group gives a percentage, the bid increment, the currency, and the
closing time. The listing's link and anything else are set on the offer itself afterwards.

An assistant drafting an offer for you on Facebook names the group as well, from the groups you have
in use. Its draft takes the group's settings in the same way, except the closing time, which it
leaves for you to set.

### A copy is in one auction at a time

A copy that is in a Facebook auction which is up — active or paused — cannot be put in another
Facebook auction, in any group. The refusal names the auction it is in, for example *offer #41 in
Znaczki — aukcje*. Closing or withdrawing that auction frees the copy. Two auctions still being
prepared may hold the same copy; the second one then cannot go up while the first is.

Listing the same copy on another platform at the same time is not affected.

## Posting

Facebook has no way for an app to post in a group, so you post by hand from the **Facebook** card on
the offer's screen, which holds everything the post needs:

- the **group**, with a link to open it;
- the **post text**: the group's post template — its own or Facebook's, as it reads now — filled in
  from the auction, with the note on shipping, payment and terms under it. **Copy** puts it on the clipboard in one click. A group with
  no template posts each lot's description;
- **↓ Photos**: the offer's photos as one download.

Once the post is up, choose **Activate** on the offer and paste the post's link as its **listing
URL** — on Facebook the listing link *is* the post's address. That activates the offer, the same as
publishing on any other platform, so the offer has to be **Ready** first; the card says so until it
is, and shows the link once the auction is up.

## A post with several lots

A post can hold several auctions as **lots** — an album, each photo a lot bid on in its own comments.
On the **Offers** screen, tick the auctions to post together and choose **Post together** in the
selection bar. They must all be Facebook auctions in the same group, not yet posted and not in another
post. They become lots 1, 2, 3… in the order you ticked them, and they share one closing time — the
first lot's — from then on: changing it on one lot changes it on all of them.

Each lot's Facebook card then shows the whole post:

- the lots, in order, each linking to its offer;
- the **post text** for the whole post — each lot's text in lot order, the standing note once under
  the last — and **↓ Photos, in lot order**, every lot's photos in one download, each file starting
  with its lot (`lot-01-…`), so the album uploads in the right order;
- the **listing link** of this lot, once the post is up.

The post goes up as one: **Activate** on any lot asks for the post's link once and activates **every**
lot, so every lot has to be Ready first. The link becomes the listing URL of every lot that has none
of its own. A lot can carry its own photo's link instead: enter it as that offer's listing URL before
activating, and it is kept.

Until the post is up, **Take this lot out of the post** removes a lot: the lots after it
move up, and a post left with one lot becomes an ordinary single post. Once the post is up, its lots
stay as they were posted. Deleting a lot's offer works the same way as taking it out.

A lot cannot be moved to another group while it is in a post; take it out first.

## While it runs

Once an auction is up, its **Facebook** card has a **Bidding** part. Type the highest bid you see
under the post and choose **Record bid**. The card shows it with when you recorded it — *recorded
3 hours ago* — and so does the offer's row on the **Offers** screen, beside the figure, so a bid you
typed days ago looks as old as it is. Recording a bid is the same as editing the offer's price in
place; it changes nothing about the post itself.

## When it ends

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
