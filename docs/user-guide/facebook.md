# Facebook

Facebook is a platform you **auction** on, in groups: an auction there is a post in a group, buyers
bid in the comments under it, and the sale closes there. Stamporama treats Facebook as **one
platform** and keeps the groups you auction in under it, each with its own customs — how a post there
reads, what you say about shipping and payment, and what a new auction starts from.

The platform and its groups are set up under **Settings → Facebook**; an auction is an
[offer](offers.md) on the Facebook platform, prepared, posted and followed like any other.

> Recording the current bid and the result of an auction is coming in a next step.

## Which platform is Facebook

The choice at the top right of the page, beside its title. Pick the contact you use for Facebook —
it needs the **Platform** role (see [Contacts](contacts.md)) — and its currency, listing templates and
photo limits are set on the contact itself, exactly as for any other platform. Until you pick one,
the page says so, and has nowhere to put a group.

Only one platform can be Facebook at a time. Choosing another moves the setting; the groups stay with
the contact they were added to, so the page then shows the new platform's groups.

Naming it does **not** switch the [Assistant](assistant.md) on, and none of the Colnect checks is
asked of its offers.

## Groups

The page lists your groups on the left — those you use first, then any you have archived under
**Archived** — and the chosen group's settings on the right. **Add group** at the top of the page
starts a new one in the same place. A group with offers shows how many beside its name.

Each group has:

- **Name** — what you call it here, usually the group's own name. Two groups on the platform cannot
  share one.
- **Link** — the group's address on Facebook, starting with `https://`. Any address that opens the
  group will do; the ↗ beside the label opens it.
- **Post template** — the text a post in this group is prepared from. It can carry placeholders,
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
- **Shipping, payment and terms** — a standing note added under every post in this group, as written.
- **New auctions** — what a new auction in this group starts from, each optional:
  - **Starting price** — none, an amount, or a percentage of the copies' catalogue value.
  - **Bid increment** — how much a bid must beat the last one by.
  - **Days an auction runs** — between 1 and 90.
  - **Closing time** — the time of day an auction closes on its last day.
  - **Currency** — the platform's own unless you choose another for this group.

  These are starting points: each can be changed on the auction itself, and changing a group never
  changes an auction already made from it.

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

Picking a group fills in that group's defaults, each of which you can change before you save:

- the **starting price** — the group's amount, or its percentage of the copies' catalogue value
  when the form suggests one from your copies;
- the **bid increment**;
- **Closes** — the group's number of days from today, at its closing time (or at the time it is now,
  if the group names none);
- the **currency** — the group's own when it has one, otherwise the platform's. An auction in a group
  with a currency of its own is in that currency, whatever the platform's is.

Changing the group's settings later changes nothing about auctions already made from it. Only groups
in use are offered; an archived group can be kept by an auction already in it, but not chosen for a
new one.

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
- the **post text**: the group's post template filled in from the auction, with the group's note on
  shipping, payment and terms under it. **Copy** puts it on the clipboard in one click. A group with
  no template posts each lot's description;
- **↓ Photos**: the offer's photos as one download.

Once the post is up, paste its link into **Post link** and choose **Record link**. That activates the
offer, the same as publishing any other listing — so the offer has to be **Ready** first, and the card
says so until it is.

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
- **Post link**: recording it activates **every** lot, so every lot has to be Ready first. A lot's own
  photo link, if you want it, is that offer's listing URL.

Until the post's link is recorded, **Take this lot out of the post** removes a lot: the lots after it
move up, and a post left with one lot becomes an ordinary single post. Once the post is up, its lots
stay as they were posted. Deleting a lot's offer works the same way as taking it out.

A lot cannot be moved to another group while it is in a post; take it out first.
