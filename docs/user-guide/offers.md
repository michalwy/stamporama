# Offers

An **offer** is something you list on **one platform** — a marketplace such as Delcampe, Allegro,
or Colnect. The offer **owns what it lists**: you compose it from your inventory copies as one or
more **sets**. Nothing is shared between offers, so the *same* copy listed on two platforms is two
independent offers — each tracked, edited, and sold on its own.

Open the **Offers** screen from the **Selling** section of the sidebar. When a batch of offers is
prepared and ready to go live, [**Bulk listing**](#bulk-listing--posting-a-prepared-batch) on its
toolbar is where you post them.

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
   If the platform carries a [default offer price](contacts.md), the new offer starts at it, so a
   platform you list at one flat price needs no price typed at all; anything that suggests a price
   from the goods themselves — a lot's suggested price, or the copies' catalog value — wins over it,
   and the price is editable on the offer either way.
   The dialog also captures three optional fields: the **status** to create the offer in
   (**Preparing** by default, or a live **Ready** / **Active** when you list something up front), the
   **listing date** (when the listing went live — defaults to today), and the **listing URL**. The
   status and listing date are **remembered per collection** and pre-filled the next time you create
   an offer, so listing many items in a row is fast; the URL is never remembered — it's always
   specific to the individual offer. Leaving everything at its default creates a **Preparing** offer
   (still being composed, not yet live). Marking a fresh, set-less offer **Ready** or **Active** isn't
   possible — it needs at least one set *and* an asking price first — so those statuses apply when you
   list a copy at creation with its price (see *Sell a new item* and *Listing on another platform*).
   Creating the offer opens its detail screen.
2. On the detail screen, use **Add set** to pick copies from your inventory. The picker's filter
   box matches a copy by stamp name, issue name, **catalog number**, or its **location ref** — so
   with a piece in hand you can type the shelf reference it is filed under (e.g. `A234`) and add
   exactly that copy. When you pick more than one copy you choose how they go in:
   - **Each copy as its own set** — a quantity of interchangeable singles, and
   - **One set holding all of them** — a series sold together.
3. Repeat **Add set** to build up a quantity, or to add different sets to the same listing.
4. Once you know them, set the **asking price** and paste the **listing URL** **in place** on the
   offer's header — click the value to edit it (Enter or click away saves, Escape reverts). The
   asking price accepts either a comma or a period as the decimal separator (`12,50` or `12.50`), and
   opens with its current value **selected**, so typing a new one replaces it rather than running into
   it. Once a listing URL is set, its **🔗 Listing** link opens the listing when clicked; use the **✎**
   pencil beside it to change the URL. The listing URL stays editable in **every** state — including a
   **sold** or **withdrawn** offer — so you can keep the record straight after the fact. The
   **currency** is fixed by the platform and shown read-only, and the offer's **state** actions live
   in the header's **⋮** menu. When a **listing date** was recorded it shows as a **📅** chip on the
   detail header; to change it, use **Edit offer** (the header form) — where the listing date and URL
   are both editable. You rarely need to: moving an offer from **Ready** to **Active** stamps the
   listing date with **today** by itself (see below), since that is the moment it goes live.
5. Once the offer is assembled, **Mark ready** to move it from **Preparing** to **Ready** — fully
   prepared, waiting to be posted. When the listing is actually up on the platform, **Activate** it to
   move **Ready** → **Active**. A **quick-advance button** beside the offer's state chip — on both the
   list row and the detail header — does this in one click: it shows **✓ Mark ready** on a Preparing
   offer and **▲ Activate** on a Ready one, so you can walk an offer forward without opening the menu.
   It appears only for that unambiguous next step; once an offer is **Active** (where the next move —
   pause, withdraw, or sell — is a choice) the button steps aside and you use the **⋮** menu. An offer
   needs at least one set **and an asking price** before it can be marked ready or activated — an
   unpriced offer shows *Set a price to…* beside its price, and the quick-advance button waits until
   you set one. For the same reason you cannot clear the price of an offer that is already **Ready**
   or **Active**; step it back to **Preparing** first. You can step a **Ready** offer back to
   **Preparing** at any time (from the **⋮** menu) to keep editing.

Next to the asking price the header shows a **suggested price** — the **average catalog value per
set** (converted to the **offer's currency**), since an offer's price is per one set a buyer takes.
**Use** applies it as the asking price in one click. It's a starting point; price as you see fit.

When the offer's currency differs from your collection's base currency, the asking price also shows
a base-currency equivalent (**≈ 200 PLN**) — on both the offer list and its detail — converted at
the **current** exchange rate, so you can compare offers across platforms at a glance.

Only copies that are **For sale**, **delivered**, **unsold**, and **not already in this offer**
can be added. To list the same package on another marketplace, just create a second offer and
compose it the same way.

You can also add copies to an existing offer straight from the [Inventory](inventory.md) list — the
copy's **⋮** menu carries an **Add to offer** action, and the row checkboxes send a whole
[selection](inventory.md#adding-several-copies-to-an-offer-at-once) in one step. Its picker lists
your offers (with state filters and search), and you choose where the copies land: as a **new set**,
or dropped into an **existing set** to build a series. With several picked, an **Add as** control
chooses between one set each and one set holding all — the same choice **Add set** offers here.

For a stock of duplicates there is a faster route still: turn on
[**Group duplicates**](inventory.md#grouping-duplicates) on the Copies list and use a group's
**List all as one offer** — one offer with one single-copy set per copy, which is the quantity
listing platforms like Colnect expect.

Going the other way, the same **⋮** menu has **View offers** — a read-only popup of every offer
that already references that copy, across all platforms and states. The **Stamps** and **Issues**
lists carry it too, scoped to a stamp or to a whole issue. See
[Inventory](inventory.md#seeing-which-offers-something-is-in).

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
instead — e.g. `Mi 12 Mercury 1850 MNH` — as soon as you compose the offer. Starting an offer empty
and adding lots afterwards works the same way: the title is generated the moment the offer first
lists something, so it is there for copying and for the
[bulk listing workspace](#bulk-listing--posting-a-prepared-batch) too, not only on the detail header.

The title is yours to change:

- **Copy it** — the **⧉** button beside the title puts it on the clipboard, ready to paste into the
  platform's own listing form; the icon turns into a **✓** for a moment to confirm. It copies the
  title that is actually stored, so on an offer still showing its derived label there is nothing to
  copy and the button stays greyed out — generate or type a title first.
- **Edit it** — click the **✎** pencil beside the title on the detail header, type a new one, and
  press Enter (Escape reverts). Editing starts from the title you can see, the derived label
  included, so you amend it rather than retype it; leaving it untouched changes nothing. Clearing it
  falls back to the derived label. The title stays editable in every state, including sold and
  withdrawn, so you can keep the record straight.
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

Each field carries its own three controls:

- **⧉** copies the field to the clipboard — the routine act here, since these texts exist to be
  pasted into the platform's listing form. The icon flashes **✓** on success; it is greyed out while
  the field is empty. On a description that is not plain text it copies the **formatted** version and
  grows a **▾** for the choice (see below).
- **✎** opens it for editing — a plain text box, so line breaks are yours to place. **⌘/Ctrl + Enter**
  saves, **Esc** cancels, and saving an empty box clears the field. Editable in every state, like the
  title.
- **↻ Regenerate** rebuilds *that field only* from the platform's current template over whatever the
  offer lists now, overwriting what is there — a hand-written title is never touched by regenerating
  the description. It is greyed out when the platform has no template for that field.

Because the templates can repeat a block per set, regenerating after you add or remove a set is what
keeps an item-by-item description in step with the listing.

### Description format

The description carries a **format** — plain text, HTML or Markdown — copied from the platform when
the offer was created (see [Description format](contacts.md#description-format)). The selector at the
left of the description's own row of buttons changes it for **this listing alone**: use it for the
offer that turns out to be an exception, not to reconfigure the platform.

With HTML or Markdown chosen:

- the description is shown **rendered**, the way the platform will show it, and a **Source** button
  switches to what is actually stored (shown in a monospace font). Editing always edits the source —
  the box is the plain text box it has always been.
- **⧉** copies the **formatted** description: the rendered version goes onto the clipboard as rich
  text, so a platform's rich-text editor keeps the formatting when you paste. The **▾** beside it
  offers the choice explicitly — **Copy formatted**, or **Copy source** for a field that wants the
  raw tags (or the Markdown) typed in.

Plain text keeps a single **⧉** and no switches: there is nothing to render and only one thing to
copy. The private note has no format either way.

> Copying rich text needs `navigator.clipboard`, which browsers only expose over HTTPS (or on
> `localhost`). On a plain-HTTP instance the button reports a **✕** — reach the app over HTTPS, or use
> **Source** and copy the text by hand.

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
created and edited afterwards from the **⚙** button in the [Photos](#generating-the-photos) card's
button row — beside **Generate**, where its effect is.

The dialog opens with a one-line reminder of what the platform accepts (how many photos, longest
edge, file size). Those are the platform's limits, not the offer's — change them on the
[platform contact](contacts.md#offer-photos). Below that sit the settings that belong to this
listing:

- **Sides to photograph** — *Front only*, *Back only*, or *Front and back*.
- **Tile label (left)** and **Tile label (right)** — two `{token}` templates written under each
  stamp, one flush left and one flush right at the same size. Each is resolved **per stamp**, so
  `{ref}` writes that copy's own location ref (`A234`) under it and a buyer asking for "the one
  labelled A234" names exactly one copy; put something descriptive like `{catalog}` on the other
  side. Fill only one and it is centred instead. A copy with nothing to write for a side — no ref,
  say — simply leaves that side blank, and both blank leaves the stamp unlabelled. The text is drawn
  at the size the **Label strip (%)** below sets and at no other: a long label is cut with an
  ellipsis rather than shrunk. If yours come out cut, lower the strip percentage or write shorter
  templates.
- **Collage** — **Rows**, **Columns**, **Gap (%)**, **Label strip (%)** and **Background**. Both
  percentages are shares rather than pixels, so one setting reads the same whatever resolution you
  scan at: the gap is a share of the stamp's height, the label strip a share of the finished image
  (in tenths of a percent — 1–2% is the usual range),
  which is what makes captions come out the same size on every photo of the listing — the eight-stamp
  collage, the single stamp and the close-up alike (see
  [collage templates](collections.md#collage-templates)). Use **Copy from
  template** to fill them from one of your
  [collage templates](collections.md#collage-templates), then adjust the numbers for this listing if
  you like; the offer does not follow the template afterwards. **Clear** empties them, leaving the
  offer with no collage.

Rows × columns is a maximum, not a frame: fewer stamps simply make a smaller image.

Changing any of these puts images you have already generated **out of date**, so the dialog's footer
carries **Regenerate photos after saving**, ticked by default — saving then queues the run for you
and the Save button reads **Save & regenerate**. Untick it when the settings should change but the
files should not: the stored images stay exactly as they are, flagged *Out of date*, until you press
**Regenerate** yourself. Nothing is regenerated when the settings leave the offer with no collage to
render.

Because these values live on the offer, changing a platform's defaults — or editing a collage
template — never alters an offer you have already prepared. That matters most for the tile labels: a
buyer referring to a label on an image you have already uploaded keeps getting the same label.

## Generating the photos

Under the listing texts, the **Photos** card turns the offer's copies into the images you upload to the
platform. Press **Generate** and the work happens **in the background** — you can leave the screen,
and the card shows the run's state on its own (*Queued*, *Rendering 2/4*, *Ready*, or *Failed* with
the reason). Pressing Generate while a run is already going does nothing; it will not render twice.

The card starts **collapsed** — click its heading to open it. Generate, Download all and the **⚙**
[photo settings](#photo-settings) sit in the header and work either way, and anything you would want to notice while it is shut (the run's state,
*Out of date*, a side that could not be rendered) stays there as a chip.

What gets made follows the offer, not a choice you make here:

- Each **multi-copy set** becomes its own collage. **Single-copy sets** are combined into shared
  collages, because a collage of one stamp is pointless.
- A set holding more copies than the collage fits is split across consecutive images, so nothing is
  dropped silently.
- With *Front and back*, each group gives two images — but only if **every** copy in it has that
  scan. One missing back means no back image for that group, rather than one with a hole in it. The
  card says so out loud, naming the copies to scan — a set of eight quietly losing its back image
  over one missing reverse is easy to miss.
- Everything the plan lists is generated, including anything you
  [attached by hand](#attaching-your-own-images) and anything past the platform's photo limit — see
  [holding a photo back](#holding-a-photo-back) for what that limit does instead.

Generate is unavailable, with the reason on the card, when the offer has no collage numbers yet, or
when there is nothing to render — no copy with a scan for the chosen sides and no attachment either.
The collage numbers are needed even for a lone attachment: they decide the gap, the label strip and
the background every image is drawn with.

The images are **stored**, not made again on demand: what you download tomorrow is the same file you
uploaded to the platform today.

### When the offer changes afterwards

Change the composition, reorder sets or copies, replace a scan, edit the photo settings, change a
copy's location ref (the labels are drawn into the images), add an attachment, or change the
platform's limits, and the card marks the stored images **Out of date**. (Reordering the plan and
holding a photo back do not: neither changes an image, so both are applied to the stored files as
they are.) Nothing happens to them:
they stay exactly as they are and keep being served, because they may already be live in a listing
whose buyers are looking at them. It is a reminder, not an action — press **Regenerate** when you are
ready to re-upload.

Regenerating replaces the whole set of images at once. If a run fails, the previous images are still
there.

### When a set sells

A set that has gone leaves the plan by itself. That covers all three ways it happens: it sold through
this offer (a multi-set offer stays live for the sets it still has), a copy of it sold through
another listing, or a copy of it sits in an offer that is [in active
bidding](#in-active-bidding--auction-platforms). Whole sets leave, never single copies — a set sells
indivisibly, so a series missing one stamp is not something a buyer can have.

The card says which sets left and why, and marks the stored images **Out of date**: they still show
the sold set until you press **Regenerate**, because they may be live in a listing right now. A
regeneration rebuilds the collages from the sets that are still for sale and **keeps your
attachments** exactly as they are — they are yours, not something a rule could make again. Labels do
not change either: each one comes from its own copy, so a buyer quoting a label off an image you
already uploaded still lands on the right stamp.

Afterwards the card keeps listing the sets that went — that is why the offer makes fewer collages
than it holds sets — but as a plain note rather than a warning: once the stored images no longer show
them, there is nothing left to do.

If every set in the offer has gone, there is nothing left to render and Generate says so.

### Attaching your own images

Not everything a listing needs comes out of the composition. Expand the card and press **+ Add
attachments** to put images of your own into the plan. There are two places to pick from:

- **Photos of copies** — pick any photos of copies in this offer: fronts, backs, or extras. Use them
  to show single details on their own — a perforation, a flaw, a cancel. Each gets the same label as
  that copy's tile in a collage, so a buyer quoting the label still lands on the right stamp. Pick as
  many as you like in one go; a ✓ marks each selected photo.
- **Upload images** — drop in any pictures, several at once if you like. They belong to the offer,
  not to a copy, so the parts of the label template that read inventory data come out empty; any
  plain text you wrote into the template still shows. Nothing goes up unlabelled either way: an
  attachment is rendered like every other image, with the same strip below it.

You can add a caption; it is shown in the plan to help you recognise the entry and is never drawn on
the image. With several picked at once, it applies to all of them.

#### Building a collage by hand

Normally each photo you pick becomes its own image. Tick **Combine everything picked into one
collage** and they become a single image instead — the grouping the automatic rules cannot make,
because those follow the offer's sets.

While it is ticked, the two tabs are one selection: a hand-built collage can mix a copy's scan with
a picture you are uploading. Choose how many **columns** to lay it out in; the number of rows follows
from that and the number of photos, and both are shown as you pick. The strip of numbered thumbnails
below is the order the tiles go in — copy photos in the order you picked them, then your uploads.
Everything else about the image — the gap, the background, the label strip — comes from this offer's
own collage settings, so a collage you built sits among the generated ones instead of standing out.

The result is one attachment: it takes one place in the plan, carries one caption, is removed in one
click, and a regeneration leaves it alone like every other attachment. To change what it shows,
remove it and build it again.

Remove an attachment with the **✕** beside it in the plan; an image you uploaded is deleted with it,
a copy's own photo is left alone — including the uploads and the borrowed scans inside a collage you
built.

Adding or removing an attachment changes the **plan**, never the images already generated — the card
simply marks them out of date until you regenerate.

### Ordering the plan

The plan is the order your photos go up in, and it is yours to arrange. Drag any entry by its ⠿ grip
— a generated collage or an attachment alike — to put the whole sequence in the order you want. You
can drag from either list: the **Plan** and the **Stored files** show one and the same order, so a
drag in one is a drag in the other.

Reordering does **not** make anything out of date and never needs a regeneration. The images do not
change — only their order does — so the stored files are simply renumbered on the spot, which is also
what renames them (`wegry-1950-01.jpg`, `wegry-1950-02.jpg`…) and what the ZIP follows.

Your order survives the offer [changing underneath it](#when-the-offer-changes-afterwards). Add a set
and its new collage slots in where it naturally falls; a collage whose copies are gone simply drops
away, and everything else keeps the order you gave it.

The order is also a **priority** order — see the photo limit below.

### Holding a photo back

Two things can keep a generated image out of the upload without deleting it. Either way it is still
rendered, still stored, and still downloadable on its own; it just takes no upload number and is not
in the ZIP.

- **Do not publish** — press the 👁 on a collage in the plan to set it aside; press 🚫 to bring it
  back. This is how you drop a collage you do not want to list, since (unlike an attachment) there is
  nothing to remove. A held-back image also frees its slot under the platform's photo limit, so
  hiding one can bring another image back under it.
- **Over the limit** — if the platform caps how many photos a listing takes, everything past that
  count *in your order* is marked **Over limit**. It is still generated so you can look at it and
  change your mind: drag it higher in the plan and it swaps in, pushing whatever now sits past the
  cap out instead. Nothing is protected from the cap — not a front/back pair, not an attachment —
  because your order is what says which photos matter most.

Held-back rows are dimmed in both lists, and their downloads are named `…-unpublished-01.jpg` /
`…-over-limit-01.jpg` so a number never suggests a slot in the listing that the image does not have.

### Reviewing and downloading them

Expand the card and it shows two lists. **Plan** is what pressing Generate would produce right now,
in upload order, with your attachments in their places. **Stored files** is what has actually been
rendered: every image with its number, its side, and the copies it was made from. Click a thumbnail
there to see it full size. Both lists carry the same order and both can be dragged.

Once an entry has been generated, the plan previews it with **that image**. A dashed thumbnail means
the opposite: nothing has been rendered for that entry yet, so what you see is one of the stamps it
will be made from.

Getting the files to the marketplace is a manual upload — Stamporama's job is handing you the right
files in the right order:

- **Download all** gives you the images that are actually going up as a ZIP, named
  `wegry-1950-01.jpg`, `wegry-1950-02.jpg` and so on in upload order. Unpack it and select the lot in
  your platform's bulk upload; they go up in order. Anything [held back](#holding-a-photo-back) is
  left out, which is what keeps the numbering a gapless run.
- Each image also has its own **↓** link in the preview, under the same name, when you only need to
  replace one. It saves the file rather than opening it — click the thumbnail beside it when you want
  a look instead.

Every file is prefixed with the **offer's own title**, shortened into something a file system is
happy with, because these files leave Stamporama: unpacked into a downloads folder beside another
listing's photos, a bare `01.jpg` says nothing about which offer it belongs to. An offer with no
title yet falls back to a short piece of its id, so two untitled offers still do not collide.

The numbering is Stamporama's own. On the platform, an image sits wherever it was uploaded, and that
is fine: nothing depends on the numbers matching afterwards.

## Bulk listing — posting a prepared batch

Once you have several offers marked **Ready**, posting them is the same handful of motions over and
over: open the platform's listing form, paste the title, paste the description, type the price, upload
the photos, mark the offer live. The **Bulk listing** screen — the button on the Offers toolbar — is
that session in one place. It shows nothing you cannot reach elsewhere; it just stops you from opening
forty offer screens to do it.

It is scoped to **one platform** and to **Ready** offers only. Both are deliberate: a batch spanning
platforms would mix listings whose titles, description formats and photo limits differ, and an offer
that is not Ready is not prepared to be posted. The platform comes across from whatever the Offers
list was filtered to, and the dropdown at the top changes it.

### Grouped by area and year

Offers are grouped under **area · year** headers, in the order the area tree runs and then
chronologically — the order a posting session tends to go in, a run of one area's 1960s, then the
next.

An offer is filed under a pair only when **every copy it holds** shares it. One that spans areas or
years has no single pair to sit under, so it goes to **Mixed**, the last group. The area/year rail on
the left narrows the session; **Mixed** is an entry in that rail, so a narrowed session can still get
to those offers.

The rail's filter is stricter than the grouping, on purpose: an offer matches an area only when
*every* copy is inside it (or inside one of its sub-areas), so a filtered session never hands you a
listing half of which came from somewhere else. That is why an offer holding 1960 and 1961 stamps of
one area is grouped as **Mixed** and yet still appears when you filter by that area — it *is* an
offer for that area, it just has no one year. Year counts in the rail follow the same rule, so a count
never promises more than clicking it delivers.

Your area and year selection is the same one the Issues, Stamps and Inventory lists use, so it
carries between them.

### The posting kit

Each offer is one line: its title, how many sets, how many photos are stored, the asking price, and
**Publish**. Expand it and you get everything the platform's form wants, each with its own copy
button:

- **Title** — the [generated listing title](#listing-title).
- **Price** — the asking price, with the suggested price beside it for reference.
- **Description** — shown the way the platform will read it, in [its
  format](#description-format); the copy control offers formatted or source, as on the offer screen.
- **Private note** — only when the offer has one.
- **Photos** — the generated images in upload order, numbered as their files are named. Click a
  thumbnail for a full-size look, **↓** under it to save that one file, or **↓ ZIP** for the whole
  upload set at once. Images [held back](#holding-a-photo-back) or past the platform's limit are shown
  faded and left out of the ZIP, exactly as on the offer screen. An **Out of date** chip means the
  offer changed after these images were rendered — regenerate them from **Open offer ↗** before
  posting.

One offer is expanded at a time, which is also how the work goes. The **first offer of the batch opens
by itself**, so a session starts on the listing you are about to post rather than on a wall of shut
cards. Closing it leaves everything shut — the screen won't argue with you — and changing the platform
or the area/year filter opens the first offer of the new batch.

The kit is loaded when you expand it, so a big batch opens instantly.

From the card's **⋮** menu you can **open the offer** — for anything the kit doesn't cover: editing a
text, regenerating photos, changing the composition — or send it **back to preparing**.

### Batch photo actions

The toolbar carries two actions that work on **exactly the offers currently shown** — so narrowing the
session with the area/year rail narrows what they touch:

- **↻ Regenerate photos** queues a re-render for every shown offer, after a confirmation. Use it when
  a batch has gone [out of date](#when-the-offer-changes-afterwards) — sets sold from under it, a template changed — and you
  would otherwise open thirty offer screens to press Generate thirty times. Nothing happens
  immediately: the runs are queued and rendered in the background, the cards say *Photos rendering…*
  and turn back into a photo count as each finishes. The images already stored keep being served
  throughout, so anything already uploaded to a live listing is untouched until its run completes.
  Offers with nothing to render — no collage numbers, or every set sold — are skipped, and the line
  under the toolbar says how many.
- **↓ ZIP all shown** downloads every shown offer's upload set as a **single archive with one folder
  per offer**, named after the offer exactly as its own ZIP is. Offers with nothing to upload are left
  out, and the line under the toolbar says how many were. As with the per-offer ZIP, images held back
  or past the platform's limit are not in it. A very large batch is refused with a message asking you
  to narrow it first — the archive is built in one go.

### When something turns out to be missing

If you get into a listing and find the description is wrong, a scan is missing, or the price needs
another look, **⋮ → Back to preparing** takes the offer out of the batch. It disappears from the
workspace, because it is no longer ready to post. Nothing else changes: fix it on the offer screen and
mark it ready again, and it is back in the next session. Marking ready is
[reversible](#offer-lifecycle) from the Offers list too.

If an offer has no images yet, the card says so rather than quietly offering an empty upload. Generate
them from the offer screen — see [Generating the photos](#generating-the-photos).

### Publishing

**Publish** on any card moves the offer **Ready → Active** and asks for the **listing URL** the
platform gave back. The URL is optional: some platforms only mint one once the listing is approved,
and the offer's **Edit offer** form takes it later. Publishing stamps the listing date to today, the
same as activating from anywhere else — correct it from **Edit offer** if you posted it on a different
day.

A published offer leaves the batch immediately: it is Active now, and the workspace lists what is
still waiting. **The next offer opens by itself**, so your hands go straight back to copying instead of
hunting for where you were. Publish the last one of a group and the first of what remains opens
instead.

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
- **Ready** — fully prepared, waiting to be posted to the platform: it lists at least one set and
  carries an asking price. **Activate** it once the listing
  is live, or step it back to **Preparing** to keep editing. Activating a **Ready** offer sets its
  **listing date to today**, since that is the moment it goes live — from the quick-advance button or
  the **⋮** menu alike. It is a starting value, not a lock: correct it from **Edit offer** whenever
  you posted the listing on a different day. Nothing else touches the date — resuming a **Paused**
  offer leaves it alone, and an offer *created* directly as **Active** keeps the date you typed in
  the creation dialog.
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

Your selection is **remembered per collection**, so coming back to the offer list picks up where you
left it rather than at "all offers". A link that names a filter still wins over the remembered one,
so a URL you share or bookmark keeps meaning exactly what it says. A remembered platform that has
since stopped being a platform is ignored, so the list can never quietly narrow to nothing.

Closed listings — **Sold** and **Withdrawn** offers — are **hidden by default** so the list shows
only what's still in play. Toggle **Show sold/withdrawn** to bring them back; the choice is
remembered per collection. Selecting the **Sold** or **Withdrawn** state chip always shows those
offers regardless of the toggle.

### Counts on the filters

Every state chip, the **Needs action** chip, and each option in the platform dropdown carries the
**number of offers you would see by picking it**. The counts are *faceted*: a count ignores its own
filter but respects the others, so with a platform selected the state chips count only that
platform's offers, and each platform option counts only offers in the state (or **Needs action**,
or **Show sold/withdrawn**) you currently have chosen. The **All platforms** option shows the total
under that same choice.

The **Needs action** chip turns **red** as soon as its count is above zero, so a stale listing is
visible from the toolbar without clicking anything. The **Show sold/withdrawn** toggle carries no
count — it widens the list rather than selecting a slice of it.

## The summary bar

Above the toolbar, a summary bar sums the offers you are currently looking at — it follows the
platform, state, **Needs action** and **Show sold/withdrawn** filters, so narrowing the list
narrows the totals with it. It covers the **whole filtered set**, not just the rows loaded so far,
so the figures do not creep upward as you scroll.

Collapsed, it shows one line:

- **Asking value** — what these offers would bring in at their listed prices, summed in your
  collection's **base currency**. Beside it: how many offers, sets and copies that is, how many
  offers are **not priced yet** (a `preparing` listing usually has no price), and how many are
  priced in a currency with **no available exchange rate** — those are counted but not summed,
  the same way the per-row conversion behaves.

Click **More** to expand it (the choice is remembered per collection). That adds:

- **Catalog value** and **Purchase cost** of the copies these offers hold — the same pair the
  [holdings summary](inventory.md) shows, with the same notes about uncertain, unpriced and
  pending figures. Reading the three lines together answers whether you are asking above or below
  catalogue, and what the stock cost you. A copy listed on **two** platforms is valued **once**
  here — it is one piece of stock — even though the copy count on the asking line counts it per
  offer, because each of those offers is separately sellable.
- A **per-platform breakdown** — the same three figures again, one row per platform, largest
  asking value first, with the offer / set / copy counts beside them. The amount columns sit
  right next to the platform name so a wide screen doesn't make you read across empty space,
  and the asking column lines up under the total above it.

The platform rows are each **complete in themselves** rather than a partition of the total: a copy
listed on two marketplaces is counted in both rows' catalog and cost figures, because each row
answers "what is on this platform". They will therefore not always add up to the total line, which
counts that copy once.

## Related

- [Inventory](inventory.md) — the copies you compose offers from.
- [Sales](sales.md) — record a sale when an offer's set sells.
- [Contacts](contacts.md) — mark a contact as a **platform** to list on it.
- [Purchases](purchases.md) — where a copy's cost-basis comes from, used later for profit/loss.
