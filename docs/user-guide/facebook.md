# Facebook

Facebook is a platform you **auction** on, in groups: an auction there is a post in a group, buyers
bid in the comments under it, and the sale closes there. Stamporama treats Facebook as **one
platform** and keeps the groups you auction in under it, each with its own customs — how a post there
reads, what you say about shipping and payment, and what a new auction starts from.

Everything on this page is set up under **Settings → Facebook**.

> Preparing an auction in a group, posting it and recording its result are coming in the next steps.
> This page covers the platform and its groups, which those steps start from.

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
