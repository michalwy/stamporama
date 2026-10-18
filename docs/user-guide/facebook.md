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

## The Facebook platform

Every collection has one **Facebook** [platform](platforms.md), and its settings are on the
**Platform** tab of **Settings → Facebook**, beside the **Groups** tab this guide is mostly about. It
starts **switched off**: tick **Switched on** there when you start selling on Facebook, so the offer
and sale forms offer it.

The Platform tab holds only what selling on Facebook uses:

- **Platform** — **Switched on**, the **Market** results on Facebook count in, and your **Notes**.
- **Offers and sales** — the **Currency** every Facebook offer and sale is in (unless its group has
  one of its own), the **Listing language**, the **Minimum price** the *min* button beside an
  offer's price applies, and the **Shipping options** a Facebook sale picks from.
- **Listing texts** — the **Listing templates** that write each offer's title, description, private
  note and photo tile labels (a post puts the title and the description in through `{title}` and
  `{description}`), the description's format, and the **Listing text limits** an offer's texts are
  counted against.
- **Photos** — the photo limits, **covering symbols** on offer photos (on from the start, since
  Facebook's rules are why covering exists), the sides to photograph, the collage template, single
  photos while the limit allows and grouping series on their own photos.

Four settings other platforms have are **not** on it, because on Facebook they are
[Facebook defaults](#facebook-defaults) your groups follow: how a new offer starts (auction or quick
buy), what an auction opens at, when a quick buy wants refreshing, and the message to a buyer after a
sale.

Above the tabs a row of figures states how selling on Facebook goes — offers active, ready and
sold, sales and revenue, sell-through, time to sale, and any purchases made through it — each
opening the list it counts; see [The platform in figures](platforms.md#the-platform-in-figures).

It does **not** switch the [Assistant](assistant.md) on, and none of the Colnect checks is asked of
its offers.

## Facebook defaults

The first row of the list, **Facebook defaults**, holds the settings every group follows, in five
tabs — one per case, each holding everything for that case and nothing else:

| Tab | Holds |
| --- | --- |
| **General** | what a new offer starts as, the currency, whether a post may mix auctions and quick buys, and the note on shipping, payment and terms |
| **Auctions** | the auction post template, the auction caption, and what a new auction starts from — starting price, bid increment, days, closing time |
| **Quick buys** | the quick-buy post template, the quick-buy caption, and when a quick buy wants refreshing |
| **Several-lot posts** | the layout of a post of several lots, and a captioned post's own text |
| **Buyer messages** | the message to a buyer after a sale |

**Every template says under its name when it is used** — *A post of one auction, and each auction in
a post with every lot in its text* for the auction post template, *An auction lot's photo caption, in
a post with captions* for the auction caption, and so on — so the seven texts can be told apart at a
glance. Within a tab the fields take the width beside the list, two to a row on a wide window. A
group's settings are the same tabs, under its name and link, and the tab you are on stays open as you
move between Facebook defaults and the groups, so one case can be compared across them.

### General

What applies to auctions and quick buys alike:

- **A new offer starts as** — **Auction** or **Quick buy**. Each offer can still be changed on its
  own form. Until you change it, this is **Auction**, which is what every Facebook offer was before
  quick buys.
- **Currency** — shown, not set here: it is the platform's own currency, set on the Platform tab.
- **A post may mix auctions and quick buys** — off, the lots of one [post](#a-post-with-several-lots)
  are all auctions or all quick buys; on, one post may hold both.
- **Shipping, payment and terms** — a standing note on how you ship, how buyers pay and the group's
  terms, as written. A post carries it where its template has `{terms}` (below), and only there: a
  template without `{terms}` posts no note, and the field warns you when the note is set but no post
  template uses it — the auction and quick-buy templates, and a captioned post's text.

### Auctions

How an auction's post reads, and what a new auction starts from, each optional:

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
  | `{offer}` | the offer's number — `412` for offer #412; in a post holding several lots, each lot's own |
  | `{terms}` | the note on shipping, payment and terms |

- **Caption** — an auction lot's text under its photo, in a post with captions
  ([below](#a-post-with-several-lots-in-captions)).
- **Starting price** — none, an amount, or a percentage of the copies' catalogue value.
- **Bid increment** — how much a bid must beat the last one by.
- **Days an auction runs** — between 1 and 90.
- **Closing time** — the time of day an auction closes on its last day.

These are starting points: each can be changed on the auction itself. Changing one here changes it
at once for every group that follows it, and never changes an auction already made.

### Quick buys

How a quick buy's post reads:

- **Post template** — the text a quick buy's post is prepared from, with its own placeholders:

  | Placeholder | Becomes |
  | --- | --- |
  | `{title}` | the offer's title |
  | `{description}` | the description of what is offered |
  | `{price}` | the price |
  | `{lot}` | the lot number, in a post holding several lots |
  | `{offer}` | the offer's number — `412` for offer #412; in a post holding several lots, each lot's own |
  | `{terms}` | the note on shipping, payment and terms |

  A quick buy has no price default here: its price is set on each offer.

- **Caption** — a quick-buy lot's text under its photo, in a post with captions
  ([below](#a-post-with-several-lots-in-captions)).
- **Refresh quick buys after (days)** — how long a quick buy may be up before it is seen by nobody
  and wants posting again. Past it, the offer carries **Up N days · refresh** and is listed under
  **Needs refresh** (see [Refreshing a quick buy](#refreshing-a-quick-buy)). Empty means never.

**An amount in a post is written the way a person writes it**: with the currency's symbol, and a
whole amount without decimals — `15 zł`, not `15.00 PLN` — any other with both, `15.50 zł`. A symbol
goes where that currency puts it: `$10`, `£10`, `15 €`, `15 zł`. This holds for `{startingPrice}`,
`{increment}` and `{price}`, in post templates and captions alike.

**Each of them can say how the currency is written**, after a colon:

| Written | Becomes |
| --- | --- |
| `{price}` or `{price:symbol}` | `15 zł` — the symbol, the default |
| `{price:code}` | `15 PLN` — the currency's code |
| `{price:none}` | `15` — the number alone |

The same goes for `{startingPrice:code}`, `{increment:none}` and so on. A template written before
this, with a bare `{price}`, now writes the symbol; add `:code` where you want `PLN` back. A post
already up keeps the words it went up with. Anything else after the colon — `{price:cod}`, or a
colon on a placeholder that is not an amount — is not a placeholder: it stays as typed and is named
under the field. The app's own screens still show `15.00` with the code.

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

**A template can carry formatting**, written as Markdown and limited to what Facebook's group post
editor offers. Each template field lists it under the placeholders:

| Write | For |
| --- | --- |
| `**text**` | bold |
| `*text*` | italic |
| `# ` at the start of a line | a heading |
| `## ` at the start of a line | a subheading |
| `- ` at the start of each line | a bulleted list |
| `1. `, `2. `… at the start of each line | a numbered list |
| `> ` at the start of a line | a quote |

Anything else stays exactly as typed — a link, a third heading level (`###`), a line of dashes —
since Facebook's editor would not take it. A placeholder is formatted the way the template formats
it, so `**{title}**` makes the title bold, but what it puts in is always text: a title or a
description with an asterisk or a `#` in it is not formatted by it. To write a symbol that would
otherwise format, put a backslash before it — `\*` is an asterisk. A line break in the template is
a line break in the post, and a blank line starts a new paragraph; a line written straight after a
list item continues that item, so leave a blank line after a list.

The templates here are Facebook's own, not the platform's description template: that one writes an
offer's description, which is what `{description}` puts into the post.

**A post is only what its template places.** Nothing is added, swapped in or filled in for you:
`{description}` is the offer's description, and empty when the offer has none — the title is not put
in its place; a group with no template for an offer's type gives an empty post; and the line breaks
are exactly the template's, around a placeholder that comes out empty too. The offer's Facebook card
names whatever is missing (below), so you fix it where it is set.

### Several-lot posts

The **Layout** of a post holding several lots — every lot in the post's text, or each lot in its
photo's caption — and the **Captioned post text**, a captioned post's own text. Both are described
with [captioned posts](#a-post-with-several-lots-in-captions).

### Buyer messages

**Message to buyer** is the template of what you send a buyer after a sale on Facebook — what to
pay, the account, what happens next — copied from the sale with **Message to buyer** (see
[Sales](sales.md#message-to-the-buyer), which lists its placeholders). A group can follow it or
have its own, like every other setting here. A sale whose offers are all from one group uses that
group's message; a sale of offers from several groups uses this one. Leave it empty, and every
group that follows it, and every sale across groups, offers no message.

## Groups

The page lists your groups under **Facebook defaults** — those you use first, then any you have
archived under **Archived** — and the chosen group's settings on the right. **Add group** at the top
of the page starts a new one in the same place. A group with offers shows how many beside its name.

Each group has a **Name** — what you call it here, usually the group's own name; two groups on the
platform cannot share one — and a **Link**, the group's address on Facebook, starting with
`https://`. Any address that opens the group will do; the ↗ beside the label opens it.

Under them are the same five tabs as Facebook defaults. Every setting on them shows as
**Same as Facebook**, with the value it
follows, until you tick **Custom for this group** beside it (**Custom** on the smaller ones). The field then appears, starting from Facebook's value, and what you save there
is this group's alone: a later change to Facebook defaults does not reach it. Untick it to follow
Facebook again — the group's own value is dropped. A custom setting may also be empty, for a group
that wants, say, no bid increment where Facebook has one. A custom **currency** must name one.

A tab holding any of the group's own settings is marked with a dot beside its name, so a group's
customs can be found without opening every tab.

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
  catalogue value where your copies share one — always the catalogue value, not the Estimated value
  the form suggests the price from;
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
  **Generate offers…** — whose sets go only into offers already in that group, and whose new offers
  can go [straight into a new post](#a-post-with-several-lots);
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

A copy that is in a Facebook offer which is up — an auction or a quick buy, active, paused, or
pending the group's approval —
cannot be put in another Facebook offer, in any group: either one may sell it. The refusal names the
offer it is in, for example *offer #41 in Znaczki — aukcje*. Closing or withdrawing that offer frees
the copy. Two offers still being prepared may hold the same copy; the second one then cannot go up
while the first is.

Listing the same copy on another platform at the same time is not affected.

## Posting

Facebook has no way for an app to post in a group, so you post by hand from the **Facebook** card on
the offer's screen, directly under the description, which holds everything the post needs (for a post
of several lots, the same kit is on the post's own screen — see
[A post with several lots](#a-post-with-several-lots)):

- the **group**, with a link to open it;
- the **post text**: the group's post template for the offer's type — the auction or the quick-buy
  one, its own or Facebook's, as it reads now (until the offer is posted, below) — filled in from the offer, with the note on shipping,
  payment and terms where the template's `{terms}` puts it, shown formatted the way Facebook will show
  it — **Source** switches to the template's Markdown as filled in, **Rendered** back. **Copy** puts
  it on the clipboard in one click, formatted *and* as plain text: pasted into a Facebook group post
  it keeps its bold, headings, lists and quotes, and pasted into a field that takes no formatting it
  is the post's text without a Markdown symbol in it. Under the text the card names what the post is missing — *No quick-buy post template set*,
  or a placeholder that is empty, such as `{description}` when the offer has no description — with a
  link to where it is set: the template or the note in Settings → Facebook, the group's own or
  Facebook's defaults, whichever the group uses. Nothing is filled in to hide it, and **Copy** still
  copies what there is;
- the **post template** the text is written from: *Same as group*, with the group's template for the
  offer's type, or the offer's own (below);
- **↓ Photos**: the offer's photos as one download.

### Every offer that goes up is a post

On Facebook what you put up is always a post — with one offer in it or many — and Stamporama keeps it
that way. **Publish…** on a Facebook offer that is in no post makes it a **post of its own**, with a
number — **Post #12** — and asks for the post's **title** beside the link. The title is optional: left
empty, the post is listed as having no title, and nothing is filled in for it. Creating an offer makes
no post — only publishing it alone does — so an offer you mean to put in a post with others never
passes through one of its own.

A post of one offer reads exactly as a single post always did: its text comes from the auction or
quick-buy post template, the layout for posts of several lots does not apply, and **↓ Photos** is the
offer's own download. The offer's Facebook card keeps everything it showed before and adds the post's
number, title and where it stands, with **Open post** — the post's screen, with that one offer as its
only row. If the group turns the post down, the offer goes back to Ready and stays in its post;
publishing it again publishes that post.

### Once it is posted, the text stays as posted

Until the offer goes up, its post text follows the template: edit the group's template, Facebook's
defaults or the offer's own, or change the offer's price, and the card shows the new text. **The
moment the offer goes up — Pending or Active, whichever comes first — its text is frozen** as the card
showed it, and the card says *As posted on …* under it. From then on nothing changes it: not a
template edit, not the offer's own template, not a change of the offer's figures — so the text here
is always the one in the group. A post with several lots freezes as a whole, when it goes up.

Four things still move it:

- **Approving a post with a new closing time** writes that time into the frozen text too, since you
  correct the post in the group to match; nothing else in it changes.
- **Reposting** a quick buy is posting it anew: the **Repost** dialog shows the text built from the
  current template and figures, and recording the repost freezes that text in place of the old.
- **Rejected — back to Ready** puts the offer back before posting: its text follows the template
  again until it goes up once more.
- **Back to Ready…** on a post that is up does the same
  ([below](#taking-a-post-that-is-up-back-to-ready)).

Offers that were already up when this arrived were frozen with the text they showed at that moment.
Earlier versions of a template are not kept anywhere, so an older post's text cannot be recovered
if a template had already changed under it.

### Taking a post that is up back to Ready

Once a post is up, **Back to Ready…** takes it back, as if it had never been published. It is for two
situations:

- **Publish was a mistake** — the post never went up in the group, or you gave the wrong link;
- **the post is gone from the group** — the group's admin removed it, or you took it down to correct
  it — and you are going to post it again.

It is on the post's screen and on each lot's Facebook card while the post is up and at least one lot
of it is still for sale. Like every move of a post it acts on the whole post, from either place. A
post still waiting for the group's approval has **Rejected — back to Ready** instead, and a post still
being prepared, or one where every lot is sold or withdrawn, does not offer it.

A confirmation comes first. Every lot still for sale then goes back to **Ready**:

- its **listing link** is cleared — a post that never went up, or is gone, is nowhere a buyer can be
  sent;
- its **post text** follows the template again until it goes up once more;
- an auction's **recorded bid** is cleared — the confirmation names each lot that has one first;
- an auction's **closing time** stays as it was; change it as on any Ready offer;
- a quick buy's **days up** stop, and start again when it is published.

The copies stay in their offers. Publishing again is exactly a first **Publish…**, with the new link.

**When some lots are sold or withdrawn, the post is split.** Those lots stay where they are, in the
post as it went up — its number, its link and its text as posted. The lots going back move into a
**new post** in the same group, with the same title, layout and lot order, which is Ready; the
confirmation names the lots that stay, and the post's screen moves to the new post once it is done.
When every lot goes back, the post itself is Ready again and no new post is made. An offer posted
alone goes back the same way.

### An offer's own post template

Some offers need a post worded differently from the rest — an extra line, another order. Rather than
changing the group's template for every offer, tick **Custom for this offer** on the card: the
group's template opens for editing, and **Save template** makes it this offer's own. It changes this
offer's post text and no other offer's.

It is still a template, not finished text: it takes the same placeholders and formatting as the
group's, listed under the field, so the post keeps following the offer's price, closing time and
terms as they change. Saved empty, it gives an empty post, and the card says so. Untick **Custom for
this offer** to go back to the group's template.

The template is for the offer's type. Changing the offer from auction to quick buy, or back, on the
**Edit offer** form drops its own template — the form says so before you save — and the post follows
the group's template for the new type. Moving the offer off Facebook drops it too.

Once the post is up, choose **Publish…** on the offer and paste the post's link as its **listing
URL** — on Facebook the listing link *is* the post's address. That activates the offer, the same as
publishing on any other platform, so the offer has to be **Ready** first; the card says so until it
is, and shows the link once the offer is up. **Publish…** is the one way to publish on Facebook —
the button on the offer, in its **⋮** menu and on its row in **Offers** — and its dialog is where you
say whether the post is up or waiting for approval.

If the group's administrator has to approve the post first, tick **Waiting for approval** in that
dialog and paste the link to the pending post: the offer becomes **Pending**, and the card marks its
link as the pending one. Facebook's link to a post waiting for approval has `pending_posts` in it, so
pasting one ticks **Waiting for approval** for you — untick it if the post is in fact up. Once the
post is approved, choose **Approve** and give the final link; if it is rejected, **Rejected — back to
Ready** clears the pending link. A pending offer can already be sold with **Sell**, since a buyer may
claim it before the post is visible to everyone. See [Waiting for
approval](offers.md#waiting-for-approval).

**Approving an auction asks when it closes.** The closing time was worked out when the post was
written, so an approval a few days later would leave the auction shorter than the group runs them.
The **Approve** dialog shows a closing time proposed from today — the group's **days an auction
runs** and its **closing time** — and the time the post was written with. Pick **Proposed** or **As
posted**, or type another; what the field holds is the auction's closing time from then on. A
quick buy closes at no time and is not asked. A
quick buy's **refresh** count starts on the day it is approved, not the day it was sent.

## A post with several lots

A post can hold several offers as **lots** — an album, each photo a lot of its own. On the
**Offers** screen, tick the offers to post together and choose **Post together…** in the selection
bar, then give the post a **title** — *Generalgouvernement 1940–44*, say — and choose **Post together**.
Every post has one: with several posts running at once, it tells them apart. They must all be Facebook offers in the same group, not yet posted and not in another post —
and all auctions or all quick buys, unless the group's posts may mix them (**A post may mix auctions
and quick buys**, above). They become lots 1, 2, 3… in the order you ticked them — until the post is up
you can [change that order](#changing-the-order-of-the-lots) on its screen. The auctions among
them share one closing time — the first auction's — from then on: changing it on one lot changes it
on all of them. A quick buy has no closing time.

**A batch can start in its post.** On the Copies list, **Generate offers…** in the quick offer bar
has **In a new post** on Facebook while the bar's status is *Preparing* or *Ready*: tick it and give
the title, and the offers the pass creates become the lots of one new post in the bar's group, in
the order the preview lists them. An existing offer that only receives sets is not put in the post.
The message after the pass opens the post's screen ([Generating offers in
bulk](inventory.md#generating-offers-in-bulk)).

The post gets a **number** of its own — **Post #12** — counted per collection like an offer's, and
never given to another post, even after this one is gone. It is named by both wherever it is named —
**Post #12 · Generalgouvernement 1940–44** — on its screen, in the list of posts and on each lot's
Facebook card. On the **Offers** screen, every lot's row carries a chip **Post #12 · lot 3**, with the
title when you point at it: click the words to open the post's screen, or the list icon beside
them to show only that post's lots in the list (a **Post #12** filter chip appears in the toolbar;
click it to show every offer again).

**Renaming a post**: the pencil beside its heading on the post's screen. A title cannot be emptied —
every post has one. Posts made before titles have none until you give them one: they are named by
number meanwhile, their heading says *no title*, and the **No title** chip in the list of posts finds
them. Renaming a post that is already up changes how it is named here, not what was posted: its text
keeps the title it went up with, as it keeps everything else.

**The post's screen** is where the post is seen and managed as one. It is reached from that chip, from
**Open post** on each lot's Facebook card, from the message **Post together** and **Generate offers…**
show, and from the
[list of posts](#the-list-of-posts). It has:

- **The post** — where it stands (being prepared, ready to post, waiting for approval, up in the group,
  or over), the group, the post's link once it has one, and the moves the post makes as one, each
  offered only while it can be made: **Publish…** once every lot is Ready, and **Approved…**, **Rejected — back to Ready** and **Withdraw…** while the post waits for
  the group's approval, and **Back to Ready…** while it is up
  ([above](#taking-a-post-that-is-up-back-to-ready)). While some lot is not Ready yet, it says which.
- **Post kit** — the layout (laid out in its text as below, or in captions
  ([below](#a-post-with-several-lots-in-captions))), the **post text** for the whole post — each lot's
  text in lot order, each from its own type's template, or from its offer's own where it has one —
  which shapes that lot's part of the post and no other — the note on shipping, payment and terms
  once, where the last lot's `{terms}` puts it — and **↓ Photos, in lot order**, every lot's photos in
  one download, each file starting with its lot (`lot-01-…`), so the album uploads in the right order.
  The download is named by the post's number and title — `12-generalgouvernement-1940-44-photos.zip`,
  or `12-photos.zip` for a post with no title.
- **Untranslated names** — until the post is up, each lot's row names, under **Untranslated**, the
  names its part of the post prints in the collection's default language because no translation is
  entered for the group's language. Click one to type its translation beside the default text; it is
  saved on the area, issue or stamp itself — the same translation you would enter there, used
  everywhere that name appears in that language — and the post's text and captions are rewritten with
  it at once, so the name leaves every row that printed it. Above the lots one line says how many lots
  still print such a name — *3 lots have names with no Polish translation* — and its **Next lot ↓**
  takes you to the next of them in lot order, so a long post can be worked through from top to bottom.
  Only names the lots' generated titles and descriptions print are listed: a title or description you
  wrote by hand keeps your words, and is not rewritten. The post's own text prints no name of its own —
  every name in it belongs to a lot — so it is always some row that names it. Once the post is up its
  text stays as posted, so none of this is shown.
- **Regenerate lot texts…** — beside the *Lots* heading until the post is up: every lot's title and
  description written again from its templates in one go, exactly as each offer's own **Regenerate**
  does, and the post's text and captions follow at once. A lot whose title or description you wrote by
  hand is listed in the dialog and keeps your words unless you tick it; ticked, its text is replaced by
  the template's. A lot whose text reads otherwise than its templates now give — a template changed
  since, or a translation entered on the stamp's own screen — is marked **Text: Out of date** in its
  row, a line above the lots counts them, and its **Regenerate them…** offers just those. A lot written
  by hand is marked **Written by hand** instead: its words were never the template's. Once the post is
  up its text stays as posted, so the action is not offered.
- **Title template for all lots…** — beside the *Lots* heading until the post is up: one title
  template, with the same placeholders as the platform's title template in Settings, given to every lot
  of the post as that offer's own title template, and every lot's title written again from it. It opens
  on the template the lots were last given here, or else the Facebook platform's. A lot whose title you
  wrote by hand is listed and keeps your words unless you tick it. Lots added to the post later keep
  their own titles.
- **Add to titles…** / **Remove from titles…** — beside it: the same words put at the **start** or the
  **end** of every lot's title, or taken off it — titles you wrote by hand included. The dialog lists
  the titles as they will read before you save. Removing takes the words off only a title that starts
  or ends with them exactly, as whole words — removing *Rare* leaves *Rarest stamp* alone. A title
  changed this way counts as written by hand from then on, as one edited on the offer's screen does;
  the title template above writes it from the template again. Neither is offered once the post is up:
  its text stays as posted.
- **Photo settings…** — beside the *Lots* heading until the post is up: the photo settings of every
  lot in one dialog — the same settings as an offer's own [Photo settings](offers.md#photo-settings),
  such as the sides to photograph or the tile labels — instead of opening each lot's offer. A setting
  every lot shares shows its value; one where the lots differ shows **Differs by lot** and is left as
  each lot has it unless you change it. A collage that differs shows no numbers until you pick a
  template, which then gives every lot the same ones (and, as on an offer, pairs the sides of each lot
  photographing both). Saving writes only what you changed, to every lot. **Regenerate photos after
  saving** is ticked, as on an offer, and renders the photos again of every lot whose settings changed;
  a lot that cannot be rendered — no collage numbers, say — is reported in the message and the rest go
  ahead. The post keeps no settings of its own: each lot keeps its own afterwards, and a lot added later
  keeps whatever it had. Once the post is up its photos are the ones posted, so the action is not
  offered.
- **Lots** — under the post text, one row per lot, in lot order, so the screen reads in the order you
  post: the lot's **photos**, every one the post puts up for it, large enough to recognise the stamps —
  click a photo to see it enlarged, and step with ← → through every photo of the post in lot order,
  each named by its lot; to download just that one, use the small download button that appears in the
  photo's corner when you point at it, which saves it under the same name it has in the download (a lot
  with no photos to put up says so in its row) — then the lot number, the offer's number and title (linking to the
  offer), its type, its price — an auction's highest bid once one is recorded, else its starting price;
  a quick buy's price — its state, its listing link, and its sale once sold. Each row's **⋮** opens the
  offer, **Sell**s that lot, withdraws that one lot once the post is up, and — until the post is up —
  takes the lot out of the post. Until the post is up, a row's **⠿** grip drags the lot to another place
  ([Changing the order of the lots](#changing-the-order-of-the-lots)). A row wraps onto the next line on a narrow window rather than shrinking
  the photo. Everything a post needs is here — its text, its photos and, captioned, its captions — so
  posting needs no lot opened.
- **Pricing and readying the lots** — until the post is up, each row also prices its lot and says what
  still stops it from being marked ready, as the **Prepare** screen does for offers, and above the lots
  the whole post is priced and readied at once
  ([Pricing the lots and marking them ready](#pricing-the-lots-and-marking-them-ready)).

### The list of posts

**Marketplaces → Facebook** in the sidebar lists every post, newest first, headed *Facebook posts* —
posts of several lots and offers posted alone alike, so it is everything you have put up on Facebook.
Each row shows the post's number, title and group, where it stands (being prepared, ready to post,
waiting for approval, up in the group, or over), how many lots it holds and how many of them are still
for sale — neither sold nor withdrawn — and its layout (**Text** or **Captions**), or **Posted alone**
for a post of one offer; then the day it went up and its link. Click a row to open the post's screen.
Narrow the list with the **group** filter, the **stage** chips and **No title**; click a lit chip again
to show every post.

Above the posts, **Not in a post yet** lists the Facebook offers being prepared or Ready that are in no
post — each one linking to its offer — so the screen shows the whole of Facebook, posted or not. Each
gets its post when you publish it alone, or joins one with **Post together** or **Add to post…** on the
**Offers** screen. The group filter narrows it too, **Being prepared** and **Ready to post** narrow it to
offers in that state, and it is hidden under the other stages and **No title**. It starts folded to one
line — **Not in a post yet · 68** — so the posts follow straight beneath; click it to open the list and
again to fold it. The screen remembers which way you left it, in this browser.

Each lot's own Facebook card no longer repeats the post: it names it — **Post #12 · Generalgouvernement
1940–44 · lot 3 of 5** and
where the post stands — with **Open post**, and keeps what is the lot's own: its own post template and,
while an auction is up, its bidding.

The post goes up as one: **Publish…** — on the post's screen, or on any lot — asks for the post's
link once and activates **every** lot — or, with **Waiting for approval** ticked, makes every lot
Pending — so every lot has to be Ready first. The link becomes the listing URL of every lot that has
none of its own. A lot can carry its own photo's link instead: enter it as that
offer's listing URL before activating, and it is kept. A post waiting for the group's approval waits
as one too: submitting, approving, rejecting or withdrawing it — or any lot of it — does it for the
whole post, and approving writes the final link in place of the pending one and the closing time you
settle on into every auction of the post. Once the post is up, each lot is its own result again —
withdrawing one lot leaves the others.

**Adding lots to a post.** Until a post is up — while it is being prepared or Ready — more offers can
join it, as its next lots in the order you ticked or picked them; the auctions among them take the
post's closing time. On the **Offers** screen, tick them and choose **Add to post…** in the selection
bar: it lists the posts of their group not yet up, newest first, by number and title. On the post's
screen, **Add lots…** beside the *Lots* heading lists the offers that could join and adds the ones you
pick; each row says which lot it will become. An offer joins on the same conditions as for **Post
together** — a Facebook offer in the post's group, not yet posted, in no other post, and of the
post's listing type unless the group's posts may mix them. One that does not qualify is named with
the reason and the others are added; on the **Offers** screen it stays ticked. A post waiting for
approval or up in the group takes no new lots.

#### Pricing the lots and marking them ready

Until a post is up — while it is being prepared or Ready — its screen does for its lots what the
**Prepare** screen does for offers, so a post being prepared is worked through on its own screen
without opening an offer. Each lot's row carries:

- **Its title**, edited in place: click it to change it, as on the offer's own screen. Emptying it
  gives the offer back its generated title. The offer's number beside it opens the offer.
- **Its price table**, compact: *Minimum*, *Catalogue*, *Estimated*, *Market* and *Cost*, with the
  profit each would make, and the lot's own price — an auction's **Starting price**, a quick buy's
  **Your price** — typed in the last column. **Enter** saves the price and moves to the next lot's,
  so a post is priced from top to bottom with the keyboard; **Tab** or a click elsewhere saves it too,
  **Esc** puts back what was saved, and a figure in the table clicked becomes the price. The post's
  text follows the new price at once.
- **What still stops it from being marked ready**, for a lot still being prepared: no price yet, a
  title or description too long for Facebook, a copy sold elsewhere, and so on, each named — or *Can
  be marked ready*. Photos still to be checked for symbols are **Check covers (N)**, which goes through
  them there and then. Missing or out-of-date listing photos are not a reason: *Mark ready* makes them
  first (*Photos generated on Mark ready*).

Above the lots, three buttons act on **every lot of the post**:

- **Use estimated price** gives each lot that has no price yet its estimated value; lots with a price
  keep it.
- **Check covers** goes through every lot's photos not yet checked for symbols, lot after lot, in one
  walk.
- **Mark ready** marks every lot still being prepared ready. A lot whose listing photos are missing or
  out of date has them made first and turns Ready once they are done (*Generating photos — Ready when
  done*). A lot that cannot be made ready is named under the buttons by its lot number, with its
  reason, and the others are marked ready.

Once the post is up — waiting for approval or in the group — the rows show its price, state and link
as before: pricing and readying belong to before it goes up. The **Prepare** screen itself stays as it
is, for offers on every platform, these lots included.

#### Changing the order of the lots

Until a post is up — while it is being prepared or Ready — its lots can be put in another order on the
post's screen: a series in catalogue order, say, or the best lot first.

- **Drag a lot** by the **⠿** grip beside its lot number, and drop it where it should go; a line shows
  where it will land.
- **Sort the whole post** from the line under the *Lots* heading: by **catalogue number** (each lot's
  lowest number; lots with none go last), or by **price, lowest first** or **highest first** (the price
  its row shows — a quick buy's price, an auction's starting price, or its highest bid once one is
  recorded; lots with no price go last). Lots that tie keep their order, and you can still drag lots
  afterwards to adjust it.

The lot numbers follow the new order at once, and so does everything made from them: the post text,
the captions, the order and names of the photos in **↓ Photos** (`lot-01-…`). Once the post is up —
waiting for approval or in the group — its lots stay in the order they were posted, and neither the
grip nor the sorting is offered.

Until the post is up, **Take this lot out of the post** removes a lot: the lots after it
move up, and the offer taken out is in no post again — it gets a post of its own only when you publish
it alone. A post left with one lot is dissolved the same way, so that offer is in no post either; its
number is not used again. Once the post is up, its lots stay as they were posted. Deleting a lot's
offer works the same way as taking it out, except that a post already up keeps its last lot as a post
of one, and is removed only with it.

A lot cannot be moved to another group while it is in a post; take it out first. Nor can it change
from auction to quick buy, or back, while it is in a post whose lots share one type.

### A post with several lots in captions

Some groups want single series or single stamps offered together as **one post with many photos**,
each item's price and description in **its photo's caption** rather than in the post's text. A post
of several lots can be laid out that way. Each lot is still its own offer — sold, withdrawn and frozen
on its own — only the layout changes.

**Several-lot posts → Layout**, in Facebook defaults or a group's own settings, chooses between
**Every lot in the post's text** (the layout described above, and what every post starts as) and
**Each lot in its photo's caption**. A post follows its group's choice until you change it: the
**Layout** field in the post's kit, on the post's screen, sets it for that post alone, or back to
**Same as group**. Once the post is up, it stays laid out as it was posted.

A captioned post is written from its own templates, set beside the layout:

- **Several-lot posts → Captioned post text** — the post's own text, shared by its lots: a heading,
  the terms, the lots' numbers. Its placeholders:

  | Placeholder | Becomes |
  | --- | --- |
  | `{offer}` | the lots' offer numbers in lot order — `412, 413, 414`; write any `#` yourself |
  | `{post}` | the post's number — `1` for Post #1; write any `#` or *Post* yourself |
  | `{postTitle}` | the post's title — *Generalgouvernement 1940–44* |
  | `{terms}` | the note on shipping, payment and terms |

- **Auctions → Caption** and **Quick buys → Caption** — the text under each lot's photo, from the
  template of the lot's type. They take the same placeholders as that type's post template, except
  `{terms}` — the note goes in the post's text, once — and two more:

  | Placeholder | Becomes |
  | --- | --- |
  | `{post}` | the post's number — `1` for Post #1 |
  | `{postTitle}` | the post's title |

`{post}` and `{postTitle}` are offered only in these templates. An offer posted alone has no post
number or title until it is published, and its text is written from the auction and quick-buy post
templates, so those do not take them: there they stay as typed, and the field says so. A post made before titles has none until you give it one; while it has
none, `{postTitle}` is left empty and the kit says so under the post text — nothing is put in its
place.

An offer's own template (above), if it has one, writes its caption in a captioned post.

**Each lot is exactly one photo**, so one photo is one price. A lot whose photos are already one image
uses it. A lot of several is joined into one image, laid out with the offer's collage settings:
its fronts on one half and its backs on the other, **in the same grid** — so a stamp's back sits where
its front does — with a line between the halves. The two halves go **side by side or one above the
other, whichever brings the image closer to the shape the offer's collage aims at** (landscape,
portrait or square; square for a fixed grid). A lot photographed on the front only has no backs half
and no line.

The post's screen then shows the post's text with its **Copy** button, and under it each lot's row in
order: its photo, shown large — click it to see it enlarged, or download that one from the small
button in its corner — and, beside the lot's offer, price and
state, its caption with its own **Copy**. **↓ Photos,
one per lot** downloads them all in one ZIP, named `lot-01-…`, `lot-02-…` in the post's order, so the
album uploads in the right order.

Each lot's photo is made **once, in the background**, and kept — so the post's screen opens quickly
however many lots it has. A lot whose photo is still being made says **Generating the photo…** in its
place, and the photo appears as soon as it is ready; until every lot's is, **↓ Photos, one per lot**
waits (hover it to see which lots). A lot's photo is made again by itself when what it is made from
changes — the offer's photos are regenerated, or its collage settings change — and an out-of-date photo
is never shown meanwhile. Once the post is up, each lot keeps the photo it was posted with. A lot with
no photos to put up says so in its row.

What is missing — the post's text, a type's caption template, an
empty placeholder in a caption — is named under it, as for any post. When the post goes up, its text
and every caption are frozen with it.

## While an auction runs

Once an auction is up, its **Facebook** card has a **Bidding** part. Type the highest bid you see
under the post and choose **Record bid**. The card shows it with when you recorded it — *recorded
3 hours ago* — and so does the offer's row on the **Offers** screen, beside the figure, so a bid you
typed days ago looks as old as it is. Recording a bid is the same as editing the offer's price in
place; it changes nothing about the post itself.

Away from the desk, record it on the phone: the auction's offer screen there has the same
**Bidding** part — see [Stamporama on a phone](phone.md#a-facebook-group-auction). A bid recorded on
the phone is the same bid, and the desk shows it exactly as if you had typed it there.

## When an auction ends

Once an auction's closing time has passed, it asks for its result: its row on the **Offers** screen
carries the **Ended, unresolved** flag, the **Ended auctions** filter lists it, and the card says it
has closed. Unlike on other platforms, this happens whether or not you recorded a bid — on Facebook a
missing bid may only mean you did not type one.

Answer it as on any platform:

- **Sell**, in the offer's **⋮** menu, records the sale to the winner. If the winning bid is
  not the last one you recorded, type it in the card's bid field first — after the close the button
  reads **Record winning bid** — or adjust the price on the sale afterwards.
- **Withdraw** ends an auction nobody bid on: its copies are free to go into another auction. Listing
  them again is a new offer.

In a post with several lots, each lot has its own result, recorded on its own offer.

Both can be done from the phone too, on the auction's offer screen: **Sell…** to the winner, at the
winning bid, or **Withdraw…**.

## Selling a Facebook offer

A Facebook offer — an auction or a quick buy — is sold with the ordinary **Sell**, as on every
platform (see [Offers](offers.md#selling-directly-from-the-list)): add it to an open sale on Facebook
in the offer's currency — one not yet sent — or start a new one. Each set goes in at the offer's current price; change it on the sale's screen if the
buyer paid something else. The offer becomes **Sold**.

What is Facebook's own is the **buyer** of a new sale. Instead of picking a contact, you type them as
on Facebook:

- **Buyer** — the name their profile shows;
- **Buyer's Facebook profile** — the link to their profile, if you have it.

While you type, the form says who that is: a contact found by the profile link, or by name, or a new
buyer it will create. The profile link is kept on the contact (see [Contacts](contacts.md)), so the
same person is recognised next time even under another name. A contact with the same name but a
different profile link is somebody else, and the form says so — give the new buyer a name of their
own. A link nobody has yet needs a name to go with it.

The new sale is in the offer's own currency — a group's currency, where it has one — even when the
Facebook platform uses another.

A quick buy never closes by itself, so it never asks for a result: to take one down unsold, withdraw
it as any offer.

The sale's **Message to buyer** writes what the buyer owes from the group's
[message template](#buyer-messages).

## Refreshing a quick buy

A quick-buy post a few days old reaches nobody. Once one is up longer than **Refresh quick buys
after** — Facebook's, or the group's own — the offer carries **Up N days · refresh** and appears
under the offers list's **Needs refresh**.

Delete the old post in the group and post it again: choose **Repost…** on the card (for a lot of a
post with several lots, from the offer's **⋮** menu), which shows the post text as it goes up now — the
current template and figures, with **Copy** — and take **↓ Photos** from the card, or from the post's
screen, as the first time. Then paste the new post's link in the dialog; recording it freezes
the new text. The offer keeps its number — so `{offer}` and what buyers quote still match — and the
count of days starts again from today; the old link stays on the offer as an earlier post. For a
lot of a post with several lots, every quick buy of the post takes the new link at once. See
[Reposting](offers.md#reposting).

If the group holds the new post for approval too, tick **Waiting for approval** in the **Repost**
dialog (a `pending_posts` link ticks it for you) and paste the pending post's link. The offer goes
back to **Pending** until you **Approve** it with the final link, and the count of days starts again
on the day it is approved.
