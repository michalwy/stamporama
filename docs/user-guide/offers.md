# Offers

An **offer** is something you list on **one platform** — a marketplace such as Delcampe, Allegro,
or Colnect. The offer **owns what it lists**: you compose it from your inventory copies as one or
more **sets**. Nothing is shared between offers, so the *same* copy listed on two platforms is two
independent offers — each tracked, edited, and sold on its own.

Open the **Offers** screen from the **Trading** section of the sidebar.

## Sets — what an offer is made of

A **set** is one whole sellable unit inside an offer. It holds one or more copies that **sell
together and never split apart**:

- a **single stamp** → a set with one copy,
- a **series / komplet** (several different stamps sold as one) → a set with several copies,
- a **quantity** of interchangeable duplicates → **several sets** (one per copy).

There is no "unit vs quantity" choice to make — every offer is simply "a listing with one or more
sets". A plain single-stamp offer is just the one-set case.

## Creating and composing an offer

1. Click **New offer** and choose the **platform** — it comes pre-filled with the platform the list
   is currently filtered by, or, when no filter is set, the **last platform you created an offer on**
   (remembered per collection); change it freely. The **currency** comes from the platform — it
   is shown locked and applies to every offer and sale there. The first time you list or sell on a
   platform that has no currency yet, you pick one inline and it is saved to the platform. That's
   all you need — you usually don't know the asking price yet (it follows from the copies you add).
   The dialog also captures three optional fields: the **status** to create the offer in
   (**Preparing** by default, or a live **Ready** / **Active** when you list something up front), the
   **listing date** (when the listing went live — defaults to today), and the **listing URL**. The
   status and listing date are **remembered per collection** and pre-filled the next time you create
   an offer, so listing many items in a row is fast; the URL is never remembered — it's always
   specific to the individual offer. Leaving everything at its default creates a **Preparing** offer
   (still being composed, not yet live). Marking a fresh, set-less offer **Ready** or **Active** isn't
   possible — it needs at least one set first — so those statuses apply when you list a copy at
   creation (see *Sell a new item* and *Listing on another platform*). Creating the offer opens its
   detail screen.
2. On the detail screen, use **Add set** to pick copies from your inventory. When you pick more
   than one copy you choose how they go in:
   - **Each copy as its own set** — a quantity of interchangeable singles, and
   - **One set holding all of them** — a series sold together.
3. Repeat **Add set** to build up a quantity, or to add different sets to the same listing.
4. Once you know them, set the **asking price** and paste the **listing URL** **in place** on the
   offer's header — click the value to edit it (Enter or click away saves, Escape reverts). The
   asking price accepts either a comma or a period as the decimal separator (`12,50` or `12.50`). Once a
   listing URL is set, its **🔗 Listing** link opens the listing when clicked; use the **✎** pencil
   beside it to change the URL. The listing URL stays editable in **every** state — including a
   **sold** or **withdrawn** offer — so you can keep the record straight after the fact. The
   **currency** is fixed by the platform and shown read-only, and the offer's **state** actions live
   in the header's **⋮** menu. When a **listing date** was recorded it shows as a **📅** chip on the
   detail header; to change it, use **Edit offer** (the header form) — where the listing date and URL
   are both editable.
5. Once the offer is assembled, **Mark ready** to move it from **Preparing** to **Ready** — fully
   prepared, waiting to be posted. When the listing is actually up on the platform, **Activate** it to
   move **Ready** → **Active**. A **quick-advance button** beside the offer's state chip — on both the
   list row and the detail header — does this in one click: it shows **✓ Mark ready** on a Preparing
   offer and **▲ Activate** on a Ready one, so you can walk an offer forward without opening the menu.
   It appears only for that unambiguous next step; once an offer is **Active** (where the next move —
   pause, withdraw, or sell — is a choice) the button steps aside and you use the **⋮** menu. An offer
   needs at least one set before it can be marked ready or activated. You can step a **Ready** offer
   back to **Preparing** at any time (from the **⋮** menu) to keep editing.

Next to the asking price the header shows a **suggested price** — the **average catalog value per
set** (converted to the **offer's currency**), since an offer's price is per one set a buyer takes.
**Use** applies it as the asking price in one click. It's a starting point; price as you see fit.

When the offer's currency differs from your collection's base currency, the asking price also shows
a base-currency equivalent (**≈ 200 PLN**) — on both the offer list and its detail — converted at
the **current** exchange rate, so you can compare offers across platforms at a glance.

Only copies that are **For sale**, **delivered**, **unsold**, and **not already in this offer**
can be added. To list the same package on another marketplace, just create a second offer and
compose it the same way.

You can also add a single copy to an existing offer straight from the [Inventory](inventory.md)
list — the copy's **⋮** menu carries an **Add to offer** action. Its picker lists your offers (with
state filters and search), and you choose where the copy lands: as a **new set**, or dropped into
an **existing set** to build a series. That's the quick path for listing one copy; use **Add set**
here when composing several copies at once.

## Sell a new item — from nothing to a live offer

When you have a stamp in hand that isn't in Stamporama yet, **Sell a new item** (next to **New
offer**) walks the whole way in one flow — no need to create the Issue, stamp, and inventory copy
on separate screens first:

1. **Describe the item.** The add-copy form opens with its stamp picker; if the Issue or stamp
   doesn't exist yet, create it **inline** from the picker without leaving the flow. The copy starts
   **For sale** and **delivered** so it's ready to list — adjust anything as you go.
2. **List it.** On save, the same offer picker as **Add to offer** opens, seeded with the copy you
   just created: start a **new offer** (its **platform** pre-filled from the current filter or the
   last platform you used, and its asking price pre-filled from the copy's catalog value) or drop
   the copy into an **existing** offer.

If you stop after step 1, nothing is lost — the copy is a normal inventory item, and Stamporama says
so and offers to list it now or later. Steps you don't need are effortless: if the stamp already
exists, pick it in the first step and move straight on.

The offer's sets render like a [purchase order](purchases.md): each set is a **collapsible card**
showing its copies as full inventory rows. Group by **Set** or **Location**, optionally sub-group
by **Issue**, and **sort** the copies — handy for pulling pieces off the shelf as you list them.
Each copy row has a quick **+ catalog value** link (click the value to edit it) so you can fill in
missing catalog prices without leaving the offer — which also feeds the suggested price. The
**Only** filters — **Unpriced**, **No photo**, and **Unknown variant** — narrow the view to copies
that still need a catalog value, a photo, or their variant identified, so you can clear them before
listing.

### Ordering sets and copies

An offer has a **canonical order**: which set a buyer reads first, and in what order the copies
inside a set appear. It is what the generated listing texts follow, and what future offer photos
will follow too, so it is worth getting right.

- **Sets** are ordered by hand. Grab a set by its **header** — the bar with the **⠿** mark, the set
  name and the copy count — and drag; the whole card comes with you, while the copies below stay
  free. Drop anywhere in the list: the card you are dragging dims, and a coloured **line appears in
  the gap** it will land in, so you never have to aim at a thin strip. The new order saves straight
  away. New sets are added at the end.
- **Copies inside a set** start in **catalog order** — no work needed, they simply come out in the
  order their catalog numbers suggest. Drag a whole copy row to correct it, with the same line
  marking where it lands; from then on that set keeps the order you gave it, and a copy you add
  later joins at the end. A copy only ever moves within its own set — moving it between sets is
  adding and removing, not reordering.
- To go back, use **Reset to catalog order** in the set's **⋮** menu. It only appears on a set you
  actually reordered.

The **Sort copies** dropdown starts on **Set order**, which is this canonical order. Choosing any
other key (Catalog, Location ref, …) is a temporary way of looking at the copies — it changes
nothing that is stored, and dragging is switched off until you go back to **Set order**. Dragging is
also off while an **Only** filter is hiding rows, while copies are sub-grouped by **Issue**, and on
sold or withdrawn offers, which are read-only.

## Listing title

Every offer has its own **title** — shown large on the detail header and as the offer's name in the
list. It starts from the copies you list: with no template configured on the platform it is the plain
catalog/copy label (the same label the set cards use); when the platform has a **listing title
template** (see [Contacts](contacts.md#adding-and-editing)) the title is generated from that template
instead — e.g. `Mi 12 Mercury 1850 MNH` — as soon as you compose the offer.

The title is yours to change:

- **Edit it** — click the **✎** pencil beside the title on the detail header, type a new one, and
  press Enter (Escape reverts). Clearing it falls back to the derived label. The title stays editable
  in every state, including sold and withdrawn, so you can keep the record straight.
- **Regenerate it** — the header's **⋮** menu has **Regenerate title**, which rebuilds it from the
  platform's current template over whatever the offer lists now. Use it after adding or removing
  copies, or after changing the platform's template. Regenerating overwrites a title you edited by
  hand.
- **Regenerate it in another language** — once your platforms list in more than one
  [language](contacts.md#adding-and-editing), the same menu also offers **Regenerate title in …** for
  each of the others, and the same for the description and private note where the platform has a
  template for them. It is a one-off: the text is rebuilt using the text you entered for that
  language, and nothing about the choice is remembered — the platform keeps its own listing language
  for everything generated later.

The **sets** inside an offer are titled the same way: with a template configured, each set is
pre-filled from it when you add it; otherwise a set reads as its copies. You can rename any set from
its card.

## Listing text: description and private note

Under the header sits **Listing text** — the offer's long **description**, and a **private note** only
you ever see (some platforms let you attach one to a listing for your own reference; it is never shown
to a buyer). Both are generated when the offer is created, from the platform's
[description and private-note templates](contacts.md#description-and-private-note), and both are
optional: a platform with no template for a field generates nothing, and while both are empty the
whole section collapses to a single **+ Add listing text** row.

Each field carries its own two controls:

- **✎** opens it for editing — a plain text box, so line breaks are yours to place. **⌘/Ctrl + Enter**
  saves, **Esc** cancels, and saving an empty box clears the field. Editable in every state, like the
  title.
- **↻ Regenerate** rebuilds *that field only* from the platform's current template over whatever the
  offer lists now, overwriting what is there — a hand-written title is never touched by regenerating
  the description. It is greyed out when the platform has no template for that field.

Because the templates can repeat a block per set, regenerating after you add or remove a set is what
keeps an item-by-item description in step with the listing.

### Title preview when adding a set

The **Add set** dialog shows a **Title preview** of the title the copies you have ticked will be
given, so you see the result before the set exists. With several copies ticked it previews the
**one set** title; adding them as separate sets titles each one from its own copy.

Beside the preview — and only once your platforms list in more than one language — is a **Language**
selector, pre-set to the platform's own listing language. Switching it re-renders the preview and
titles the sets you are adding in that language. Like regenerating, it applies to this one add only.

Where you have not entered text for the chosen language, the title still generates from your default
text — those words are marked with a dotted underline and listed beneath the preview, so you can see
what is missing without being blocked.

### Filling a missing translation without leaving the dialog

You do not have to go hunting through Settings and the stamp and issue screens to fix those gaps.
Under the preview, **Missing … translations** lists each one — what it is (Stamp, Condition, Area, …),
the default text that was used, and a box for the language you are titling in. Type the translation
and press Enter (or click away) and it is saved **straight away**, on its own:

- It is saved on the stamp, issue, condition, certificate status or area itself — the same text the
  entity's own 🌐 button edits — so it applies everywhere that entity is used from now on, in this
  offer and every future one.
- It is **not** part of the offer: cancelling the Add set dialog keeps the translation you typed.
- The preview re-renders as soon as it saves, and the gap leaves the list.

You can also click a dotted-underlined word in the preview itself to edit just that one, in a small
popover. Clearing a box again removes the translation and the default text comes back.

An **{area}** gap is filled on the area whose title name actually appears in your titles, which is
not always the copy's own area: with title names rolled up from a parent (see
[Area names in titles](contacts.md#area-names-in-titles)), the parent is the one that needs the
translation, and that is the row the panel writes to.

The same panel appears on the offer screen, under the listing text, for the translations missing
behind the offer's generated texts in the platform's own language. Saving one there does **not**
rewrite texts you already have — they may have been edited by hand — so use each field's **↻** when
you want the new wording.

## Photo settings

Every offer carries its **own** photo configuration, seeded from its platform when the offer is
created and edited afterwards from the **⋮** menu → **Photo settings…**.

The dialog opens with a one-line reminder of what the platform accepts (how many photos, longest
edge, file size). Those are the platform's limits, not the offer's — change them on the
[platform contact](contacts.md#offer-photos). Below that sit the settings that belong to this
listing:

- **Sides to photograph** — *Front only*, *Back only*, or *Front and back*.
- **Tile label** — the `{token}` template written under each stamp on a collage. Blank leaves the
  tiles unlabelled.
- **Collage** — **Rows**, **Columns**, **Gap**, **Label strip** and **Background**. Use **Copy from
  template** to fill them from one of your
  [collage templates](collections.md#collage-templates), then adjust the numbers for this listing if
  you like; the offer does not follow the template afterwards. **Clear** empties them, leaving the
  offer with no collage.

Rows × columns is a maximum, not a frame: fewer stamps simply make a smaller image.

Because these values live on the offer, changing a platform's defaults — or editing a collage
template — never alters an offer you have already prepared. That matters most for the tile label: a
buyer referring to a label on an image you have already uploaded keeps getting the same label.

## Generating the photos

Below the sets, the **Photos** card turns the offer's copies into the images you upload to the
platform. Press **Generate** and the work happens **in the background** — you can leave the screen,
and the card shows the run's state on its own (*Queued*, *Rendering 2/4*, *Ready*, or *Failed* with
the reason). Pressing Generate while a run is already going does nothing; it will not render twice.

What gets made follows the offer, not a choice you make here:

- Each **multi-copy set** becomes its own collage. **Single-copy sets** are combined into shared
  collages, because a collage of one stamp is pointless.
- A set holding more copies than the collage fits is split across consecutive images, so nothing is
  dropped silently.
- With *Front and back*, each group gives two images — but only if **every** copy in it has that
  scan. One missing back means no back image for that group, rather than one with a hole in it.
- If the platform caps how many photos a listing takes, whole groups are dropped from the end (a
  front/back pair always goes together). The card says how many.

Generate is unavailable, with the reason on the card, when the offer has no collage numbers yet, or
when none of its copies have scans for the chosen sides.

The images are **stored**, not made again on demand: what you download tomorrow is the same file you
uploaded to the platform today.

### When the offer changes afterwards

Change the composition, reorder sets or copies, replace a scan, edit the photo settings, or change
the platform's limits, and the card marks the stored images **Out of date**. Nothing happens to them:
they stay exactly as they are and keep being served, because they may already be live in a listing
whose buyers are looking at them. It is a reminder, not an action — press **Regenerate** when you are
ready to re-upload.

Regenerating replaces the whole set of images at once. If a run fails, the previous images are still
there.

## One active offer per copy, per platform

You should keep **at most one active offer per copy, per platform** — otherwise the same stamp
could sell twice on the same marketplace. When you add a copy that another active offer on that
platform already lists, Stamporama shows a **heads-up**. It is only a warning: you can proceed,
but normally you would remove it from the other offer first. (Listing the same copy on *different*
platforms is exactly the point and is never flagged.)

## Listing the same thing on another platform

To offer the same stamps on a second marketplace, you don't re-compose them by hand. From an
offer's **⋮** menu (on the list or the detail screen), choose **List on another platform**. Pick
the new platform; the asking price **and currency** carry over from the original offer. If the new
platform uses a different currency, the price is **re-converted** at the collection's current
exchange rate — still editable, so you can round or adjust it for the new marketplace.

Stamporama then creates a **new draft offer** with the same sets and copies, and opens it so you
can review, price, and activate it. The copy is an independent snapshot: editing either offer
afterwards — renaming a set, changing the price, adding a copy — leaves the other untouched. Any
copy that has already **sold** elsewhere is left out of the clone, with a note telling you how many
were skipped. The new offer's listing URL starts blank — paste it once the listing is live.

Both offers now list the overlapping copies, which is exactly the cross-platform workflow the
[needs-action](#keeping-platforms-in-sync--needs-action) sync is built for: selling on one platform
flags the twin on the other.

## Selling directly from the list

The row's **⋮** menu carries a **Sell** action on any non-terminal offer that lists at least one
set — a shortcut into recording a [sale](sales.md) without opening the offer's compose screen
first. Choose where the sold sets go:

- **an existing sale** already recorded on this offer's platform (in the same currency), or
- **a new sale** — the header form opens pre-filled with the offer's platform (locked, since a
  sale is single-platform); fill in the buyer and date and continue.

Either way, every set the offer still has left to sell is added at its current asking price, and
you land on the sale's detail screen to review or adjust it. An offer with nothing left to sell (
every set already sold) has no **Sell** action to offer.

## In active bidding — auction platforms

On auction-style platforms (Allegro and similar), a bid commits you before the auction actually
closes — well before a sale is recorded. Mark an **active** offer **In active bidding** (from its
**⋮** menu) the moment it receives a bid: this flags every **other** active offer holding the same
copies as **Needs action**, exactly like an actual sale collision, so you know to withdraw them
from other marketplaces right away.

**In active bidding** is independent of the offer's state — it never marks the offer **Sold** by
itself. If the auction doesn't close (no bids meet the reserve, the buyer doesn't pay), **Clear
active bidding** from the same menu; the "needs action" flags on the other offers clear
immediately. When the auction does close successfully, record the sale as usual — the offer
becomes **Sold** through the normal [sale](sales.md) flow, same as any other platform.

## Keeping platforms in sync — "needs action"

Because a copy can be listed on several platforms, selling it in one place — or, on an auction
platform, just placing a bid (see [In active bidding](#in-active-bidding--auction-platforms)
above) — leaves the other listings stale. Stamporama surfaces this automatically: an **active**
offer holding a **set whose copy has sold, or is in active bidding, elsewhere** is flagged **Needs
action** — a red badge on the offer row and on the affected set, plus a **Needs action** filter in
the toolbar.

To resolve one, open the offer and:

- **Quantity still available** → **remove the affected set** (this is the decrement — the offer
  now lists one fewer), after updating the quantity on the platform itself.
- **Nothing left to sell** → **withdraw** the offer.

The offer the sale actually went through is handled for you — it becomes **Sold** once *every* set
has sold through it (a partial sale keeps it **Active** for its remaining sets). Nothing is done to
other platforms automatically — you stay in control of each marketplace. The flag is derived live
from what has sold, so it clears the moment the offer no longer holds a sold copy.

## Offer lifecycle

- **Preparing** — being put together (photos, description, price not finalised). A new offer starts
  here. **Mark ready** (in the **⋮** menu) once it is assembled.
- **Ready** — fully prepared, waiting to be posted to the platform. **Activate** it once the listing
  is live, or step it back to **Preparing** to keep editing.
- **Active** — live on the platform.
- **Paused** — temporarily suspended; the copies stay committed. Resume any time.
- **Withdrawn** — taken down for good. **Final**: to sell there again, create a new offer.
- **Sold** — set automatically when a [sale](sales.md) sells every set through the offer. You do
  not mark an offer sold by hand.

The lifecycle is linear but reversible: **Preparing → Ready → Active ↔ Paused**, with **Withdrawn**
reachable from any live state. The states are **orientational** — they help you sort and filter your
listings. They don't restrict composing: you can add sets or copies to a Preparing, Ready, Active, or
Paused offer alike; only Withdrawn and Sold offers are frozen.

Changing a platform's currency later leaves existing offers and sales untouched — each keeps the
currency it was created with as a permanent record; only new offers and sales use the new currency.

From the row's **⋮** menu you can **edit** the price / platform / URL, **mark ready** a preparing
offer, **activate** a ready one, **pause** / **resume**, **withdraw**, **sell** (see [Selling
directly from the list](#selling-directly-from-the-list)), mark or clear **in active bidding** (see
[above](#in-active-bidding--auction-platforms)), open the live listing, or **delete** the offer.
The detail header's **⋮** menu adds **Regenerate title** (see [Listing title](#listing-title)).
Deleting removes the offer and its sets; the copies stay in your inventory. An offer with a sold
set can't be deleted — withdraw it.

## Filtering

The toolbar filters offers by **platform**, by **state** (Preparing / Ready / Active / Paused / Sold /
Withdrawn), and by **Needs action** (the derived overlay above). The state filters and **Needs action** are
mutually exclusive.

Closed listings — **Sold** and **Withdrawn** offers — are **hidden by default** so the list shows
only what's still in play. Toggle **Show sold/withdrawn** to bring them back; the choice is
remembered per collection. Selecting the **Sold** or **Withdrawn** state chip always shows those
offers regardless of the toggle.

## Related

- [Inventory](inventory.md) — the copies you compose offers from.
- [Sales](sales.md) — record a sale when an offer's set sells.
- [Contacts](contacts.md) — mark a contact as a **platform** to list on it.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used later for profit/loss.
