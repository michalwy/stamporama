# Inventory

Your **inventory** is the physical copies you own. A **copy** is a single physical stamp:
each copy is its own record, so two copies of the same stamp can differ in condition,
certificate, disposition, storage, and notes. There is no "quantity" — three
copies of the same stamp are three rows.

Open the **Inventory** screen from the **Collection** section of the sidebar.

## The inventory list

Each row shows:

- The copy's **internal number** (e.g. `#00123`) — see [Internal copy number](#internal-copy-number).
- The linked stamp's **catalog number**, **name**, and **issue**.
- The **condition** and any **certificate status**.
- **Disposition** markers — *In collection*, *For sale*, *For trade* — a copy can carry
  any combination at once. Copies you intend to sell are composed into [offers](offers.md).
- The copy's **catalog value** (see [Copy value and holdings total](#copy-value-and-holdings-total)).
- Its **cost-basis** — what the copy actually cost you — when it came from a
  [purchase](purchases.md) (see [Cost-basis](#cost-basis)).
- Its **storage location** (a 📍 chip with the location path and any in-location ref),
  when the copy has been filed — see [Locations](locations.md).
- A notes indicator when the copy has notes (hover to read them).
- A **photo thumbnail** at the left of the row, when the copy has any — a single larger
  preview of the first photo. If the copy has more than one photo, a counter (e.g. **1/3**)
  appears and **‹ / ›** controls step through them in place. The **front** and **back** carry
  a corner badge (**F** / **B**) to set them apart from extra photos; click the thumbnail to
  view it full-size. See [Photos](#photos).

If a copy is linked to a base stamp whose specific variant is unknown, it is flagged
**unknown variant**. Such a copy is valued cautiously and its uncertainty stays visible;
you can pin down the exact variant later — see [Identifying a variant](#identifying-a-variant).

A stamp counts as "unknown variant" only when it actually has **variant** children
(see [Subtypes](collections.md#stamp-subtypes)). If all of its children are distinct
entries — errors, overprints and the like — the stamp is a concrete stamp in its
own right: a copy on it is valued by its own catalog price and is **not** flagged
uncertain. A stamp with a mix keeps the unknown-variant treatment over its variant
children only. This holds at **any depth**: an intermediate variant that itself has
variant children is treated as "unknown which of those" exactly like a top-level base
stamp — so a copy linked to it is flagged uncertain and valued over its own variant
children.

The list loads more rows as you scroll. Your filters, sort, and position are kept in the
page URL, so you can bookmark or share a filtered view.

### Filters and sorting

The inventory list filters the same way the [Stamps](collections.md) list does: a left
**area panel** plus a toolbar of filters, all kept in the page URL.

- **Area** — the panel on the left lists your collection's [areas](collections.md) as a
  tree. Pick one to show only copies whose linked stamp belongs to that area; selecting an
  area includes its nested sub-areas. Choose **All areas** to clear it.
- **Search** — type in the search box to match copies by the linked stamp's **name**, its
  **issue name**, a **catalog number**, or the copy's own **location ref** (case-insensitive).
  A catalog number can be typed bare (`200`) or with its full prefix and any spacing
  (`Mi PL 200`, `MiPL200`); when the text starts with a known vendor abbreviation the match is
  narrowed to that vendor. Typing a shelf reference such as `A234` finds the copies filed under
  it, so you can go from a piece in hand straight to its record. A plain number also looks up an
  **internal copy number** — `123`, `00123` and `#00123` all find copy `#00123` — alongside the
  text matches, so a number that is also a catalog number still finds both.
- **Issue** — filter to copies of stamps in a single issue. Start typing to pick one; the
  suggestions are scoped to the area selected on the left.
- **Disposition** — toggle *In collection*, *For sale*, and *For trade*. With none
  selected, all copies are shown. Selecting several narrows to copies matching every
  chosen marker.
- **No photos** — toggle to show only copies that have no [photo](#photos) attached, so
  you can quickly find the pieces still waiting to be photographed.
- **Missing catalog value** — toggle to show only copies with **no catalog value** recorded
  for their condition (those showing **—**), so you can find and fill pricing gaps in bulk.
  Pairs with the **+ catalog value** price link below. The holdings totals and year panel
  follow this filter too.
- **Not offered on…** — pick a [platform](offers.md) to show only copies **marked for sale**
  that have **no offer** on it yet — your worklist of what still needs listing there. A copy
  already listed on a *different* platform still shows up, since the same copy can be offered on
  several platforms at once. Only offers that are done (**sold** or **withdrawn**) stop counting;
  a copy sitting in a **preparing**, **ready**, **active**, or **paused** offer on that platform
  is treated as already handled. One exception to the "other platforms don't count" rule: a copy
  held by an offer that is **in active bidding** anywhere is left out entirely — a bid commits it
  to a pending sale, so listing it again would risk selling the same piece twice.
  This filter appears once you have at least one offer platform,
  and the holdings totals and year panel follow it too. Your chosen platform here is **remembered**
  for this collection, so the filter comes back the way you left it next time.
- **Include sold** — copies that have [sold](sales.md) are **hidden by default**, so the list
  shows only what you still hold. Toggle this on to bring sold copies back into view (for example
  to look up what a piece went for). The holdings totals and year panel follow this filter too.
- **Condition** — show only copies of one condition.
- **Location** — show only copies stored in a chosen [location](locations.md). Selecting a
  location includes copies in every location nested inside it, so filtering by a cabinet
  shows the copies in all of its stockbooks at once.
- **Sort** — by date added, ascending or descending.

The holdings summary totals follow whatever the filters are showing, so a filtered view
tells you the catalog value and purchase cost of just those copies.

## Copy value and holdings total

Each copy is valued from your **catalog prices** — this is independent of what you paid
for it. A copy's value is the price for its **own condition and certificate
status**, taken from the **primary catalog of the stamp's area** at that catalog's
**latest recorded edition**:

- **Identified copy** — the price of its specific variant.
- **Unknown-variant copy** — if the base stamp itself has a price, that is used;
  otherwise the **lowest** price among the base stamp's variants (compared in your base
  currency). Either way the value is an estimate: it is shown in italics with a leading
  `~`, because the exact variant isn't settled. Resolving the variant later replaces the
  estimate with that variant's own price.

The certificate status must match exactly — a copy with a certificate is only valued from
a price recorded *for that certificate status*; there is no fall-back to the no-certificate
price. A copy with no matching catalog price shows **+ catalog value** in the value column —
click it to record one without leaving the list. See
[Adding a catalog value](#adding-a-catalog-value).

Each value shows the catalog price in its **own recorded currency**, with the conversion to
your collection's **base currency** alongside it — matching how prices read on the issue
list. Totals are summed in the base currency. A price in a currency with no available
exchange rate is shown in its own currency only and left out of the total.

Above the list, the holdings summary bar sums two figures over every copy that matches your
current filters (change the filters and both totals follow):

- **Catalog value** — what your holdings are worth, as described above. It also tells you
  how much of the total is uncertain (unknown-variant estimates) and how many copies are
  unpriced or could not be converted.
- **Purchase cost** — what you actually paid, summed from the frozen
  [cost-basis](#cost-basis) of the same copies (in your base currency). It calls out copies
  whose cost is still **pending** (on an open purchase lot) or has **no cost recorded** (added
  by hand, or dropped from a lot) — those contribute nothing to the total, the same way the
  per-copy cost-basis distinguishes them.

Comparing the two lines shows paid-versus-catalog value at a glance.

## Cost-basis

Where **catalog value** is what a copy is worth, its **cost-basis** is what you actually
**paid** for it — the figure profit or loss is measured against when you sell. Cost-basis
comes from [purchases](purchases.md): the price you paid for a lot, plus its fair share of
the order's shipping, is split across the lot's copies when the lot is closed, and each
copy's share is frozen in your **base currency**.

On a copy's row the cost-basis shows as:

- **cost 12.34 EUR** — the frozen amount, once the copy's purchase lot has been closed.
- **cost pending** — the copy belongs to a purchase lot that is still **open**; its
  cost-basis is frozen only when you close the lot (see
  [Closing a lot](purchases.md#closing-a-lot)).
- *nothing* — the copy has no cost-basis: you added it by hand rather than through a
  purchase, or it was marked *not delivered* and dropped from its lot.

A frozen cost-basis is **not** recomputed automatically if you later edit catalog prices
or re-point the copy to another variant — to change it, reopen the lot, correct the copies,
and close it again.

## Viewing copies from the catalog

You don't have to open the Inventory screen to see what you own. Every row across the
app carries a single **⋮** actions button on the right; opening it reveals that row's
actions as a menu. On the **Stamps** list and the **Issues** list, that menu includes
**View copies**:

- On a **stamp** row, **View copies** opens a popup listing every copy you own of that
  stamp.
- On an **issue** row, **View copies** opens a popup listing every copy of *any* stamp in
  that issue — a quick way to see your holdings for a whole issue at once.
- Expanding an issue reveals its individual stamps, each with its own **View copies**
  action for the copies of just that stamp.

The popup shows the same copy details as the Inventory list (condition, disposition,
value, storage, and any [photos](#photos)), but is **read-only** — it's for looking, not
editing. Close it to return to the list exactly where you were; nothing navigates away.
To edit or delete existing copies, use the **Inventory** screen.

## Adding a copy from the catalog

You can record a new copy without leaving the Stamps or Issues list. Alongside
**View copies** in the same **⋮** menu is an **Add copy** action that opens the add-copy
dialog described below, already pointed at the right stamp:

- On a **stamp** row — and on each stamp inside an expanded issue — **Add copy** opens the
  dialog with that stamp pre-selected. You can still **Change** it if needed.
- On an **issue** row, **Add copy** opens the dialog and immediately pops up a stamp/variant
  tree **limited to that issue's stamps** — the same tree as the **Browse…** picker, so
  variants read the same. Pick which stamp the copy is. If you close the popup without
  picking, a **Select a stamp…** button reopens it.

Fill in the rest of the dialog as usual and save. The new copy appears on the Inventory
screen, and any open **View copies** popup for that stamp or issue reflects it.

## Adding a copy

1. Click **Add copy**.
2. **Choose the stamp or variant** in one of two ways:
   - **Type to search** in the field. Suggestions match the stamp name, its issue name,
     **catalog numbers** — including the vendor and area prefix — and the **location ref**
     of any copy you already hold, so a shelf reference such as `A234` finds the stamp filed
     there. Catalog search ignores spacing, so `Mi PL 200`, `Mi PL200`, `MiPL200`, and just
     `200` all find the same stamp. Each suggestion shows its catalog number, name, issue,
     year, and area so you can tell similar stamps apart.
   - **Browse…** opens a larger picker: pick an **area** on the left, filter its **issues**
     on the right, then expand an issue to choose a stamp or one of its variants. The picker
     remembers its area, year, and search text, so it reopens on the same filter you left it
     on — and the remembered text is **selected** when it opens, so you can just start typing
     to replace it. The filter also looks **inside** each issue: a term that matches a stamp's
     name or catalog number (but not the issue's own name) still surfaces that issue, opens it,
     and highlights the matching stamps while dimming the rest.

   Choose a specific variant if you know it, or the **base stamp** if the variant is
   unknown. The chosen stamp appears as a summary with a **Change** link to reselect.

   If the stamp isn't in your catalog yet, you can add it without leaving the browser
   (you must still pick an existing **area** first):
   - **+ New issue** (top of the issue list) adds an issue to the selected area. It then
     appears in the list, ready for you to add a stamp to it.
   - **+ New stamp** (at the bottom of an expanded issue's stamp tree) adds a stamp to that
     issue. It then appears in the issue's tree, ready for you to pick like any other stamp —
     it is not selected automatically, and the picker stays open.
   - **+ variant** (next to a base stamp) adds a variant under that stamp, which likewise
     appears in the tree ready to pick.
3. Choose the **condition** (required) and, optionally, a **certificate status**. Both
   come from your collection's configurable sets.
4. Set the **disposition** flags. New copies default to *In collection* until you've added
   one — after that, see the note below.
5. Optionally file the copy into a **storage location** and add an in-location **ref**
   (e.g. a page or pocket). Picking a location moves the cursor straight to the **Ref** field
   so you can type the ref without an extra click. Only locations that can hold copies are
   selectable — see [Locations](locations.md).
6. Optionally add free-form **notes** (e.g. postmark type or a condition detail).
7. Optionally attach **photos** — front, back, and titled extras. See [Photos](#photos).
8. Click **Add copy**. Everything is saved together in one step.

> **Remembered defaults** — your last-used **condition**, **location**, and **disposition**
> are remembered per collection and pre-filled the next time you add a copy — anywhere, whether
> from this dialog or from [lot intake](purchases.md). Adding many copies with the same settings
> (e.g. filing a whole lot into one box) then only takes a stamp pick. Override any field per
> copy; the new choices become the defaults for the next add.

> **Acquisition and cost** — supplier, date, and what you paid — are recorded on a
> [purchase](purchases.md), not on the copy: the copy form captures identity, condition,
> disposition, storage, and notes only. A copy taken in through a purchase carries a
> [cost-basis](#cost-basis); one added here by hand has none.

## Internal copy number

Every copy carries an **internal number** — a plain running number within your collection,
starting at `1` for the first copy you record. It is assigned automatically when the copy is
created and cannot be edited or reassigned: it is meant to be written on the piece itself, on a
stock card, or on a printed label, so it has to keep pointing at the same copy forever.

The number appears on every inventory row, next to the condition, and in the title of the copy's
**Edit** dialog.

It is shown zero-padded — `#00123` — so a column of numbers lines up. How many digits it pads to is
your choice, under **Settings → General → Copy number width**: pick `2` and the same copy reads
`#42`, pick `8` and it reads `#00000042`. That is a display setting only — nothing is renumbered,
and a number wider than the setting simply renders in full. Listing templates can override it per
token with `{itemNo:3}`, and can use the number at all through the
[`{itemNo}` token](contacts.md#adding-and-editing).

Two things to expect:

- **Numbers are never reused.** Deleting copy `#00123` retires that number — the next copy you add
  continues past the highest number handed out, it does not fill the gap. A number you have already
  written on a piece must never turn up on a different one.
- **Numbering is per collection.** Each collection starts again at `1`, so the numbers are yours
  rather than an artifact of the installation.

To find a copy by its number, type it into the inventory search box — `123`, `00123` and `#00123`
all work.

Copies that already existed before this feature were numbered in the order they were added, oldest
first.

## Editing a copy

Open the row's **⋮** menu and choose **Edit**. The same dialog opens with the copy's
current values. Changing the stamp to a more specific variant re-points the copy and
records the change in its refinement history.

To edit the **stamp** a copy points to — its name, catalog numbers, or catalog prices — choose
**Edit stamp** from the same **⋮** menu. It opens the shared stamp editor (the one on the Stamps
and Issues lists), so you can fix stamp-level details without navigating away from Inventory. Edits
here apply to the stamp itself, so every copy of it reflects the change.

## Pairs, blocks and other multiples

A copy has a **Format** alongside its condition and certificate: a horizontal pair, a block of
four, a strip of three, whatever your collection needs. Leave it as **Single** — the default —
for an ordinary single stamp; there is no "single" entry to pick, because a copy with no format
set *is* the single. Only multiples get a chip on the list row, so the common case stays quiet.

The format sits on the **copy**, not on the stamp. That matters when a stamp has variants: you
attach the pair to whichever level of the variant tree you have actually identified, exactly as
you would a single. A pair you have narrowed down to `309B` but no further is recorded against
`309B` with format *Horizontal pair* — you do not need a separate "pair" stamp at every level of
the tree, and you do not lose the fact that the variant is still open.

**A multiple is never split into singles.** A block of four is one copy, one row, one line in your
holdings — not four. Completeness works the same way it does for condition: just as a used copy
does not count toward a complete mint set, a block does not count toward a set of singles. You ask
separately whether you have the series in singles, in pairs, or in blocks.

**Se-tenant and gutter combinations are different.** When the catalog gives the combination its own
number — Michel `S`, `W`, `K`, `Zd` — it is a distinct catalog entry, so record it as its own stamp
with that number, not as a format of one of its parts. The test is whether the catalog numbered it
separately, not whether it holds more than one stamp.

Formats are managed in **Settings → Conditions & formats**. A format that is used by any copy or
any catalog price cannot be deleted.

**Formats in other languages.** Once a platform lists in a language other than your collection's
default, the format's **Name** and **Abbreviation** fields each grow their own 🌐 button, exactly as
[conditions](collections.md#conditions-in-other-languages) do — and they fall back independently, so
you can translate *Block of 4* as *Viererblock* while leaving `Blk4` alone. These feed the
`{format}` and `{formatAbbr}` tokens in [listing texts](contacts.md#adding-and-editing).

### What a multiple is worth

Catalog values are recorded per format, on the same grid as everything else: the stamp editor's
**Prices** tab has a row of format tabs above the condition × certificate grid, starting with
**Single**.

Most of the time you will not type these in. Catalogs publish multiples as a **multiplier** — one
Viererblock factor for a whole issue — and record an explicit price only where a multiple is out of
line. Stamporama follows that: set the multipliers once under **Settings → Conditions & formats →
Format multipliers**, and every format's price is derived from the single's. Derived values appear
in the grid as greyed, dashed placeholders — nothing is stored. Type over one where the catalog
disagrees and it becomes a real price that always wins; clear it to fall back to the derived value.

A multiplier can be pinned to an **area** (covering everything beneath it), an **issue**, and a
**condition** — used blocks are often scarcer relative to mint than a single factor can express. A
multiplier with none of these set is your collection-wide default. When several could apply, the
narrowest anchor wins, in this order: **issue** first, then the **nearest area**, then
**condition**. So a factor set on an issue beats a collection-wide factor set on "used".

You set each one where its scope lives, so you never pick the thing it applies to out of a list:

- **Collection-wide and per-area** — Settings → Conditions &amp; formats → Format multipliers.
- **One area** — also from that area's **⋮** menu under Areas, which is usually quicker.
- **One issue** — from that issue's **⋮** menu on the Issues list. Per-issue multipliers are not
  listed in Settings: you can have one for every issue and every format, so that list would be
  thousands of lines long. Each issue's own row shows just its own.

A scope's dialog lists only what is set on that area or issue itself — not what it inherits from
above. To change an inherited multiplier, go to the area it was set on.

A copy that is a multiple is **valued as that multiple**: its own recorded price if one exists,
otherwise the single's scaled by the multiplier that applies to it. If neither exists the copy
counts as unpriced — the single's own figure is never used for a block, because it is a different
thing's price.

### Filtering the list by format

Once your collection has any formats, the Copies list grows a **format** filter beside the
condition one. It works the same way: pick a format to see only those copies, or **Single** to see
only the ordinary ones. Leaving it on *All formats* shows everything.

### Seeing a format's prices on the Stamps and Issues lists

The Stamps and Issues lists show one catalog value per row, picked by the **Price for**
condition switcher. Next to it sits an **as** switcher for the format, defaulting to **Single**;
switch it to a block and every price column shows the block's value instead. Like the filter above,
it only appears once your collection has formats, and your choice is remembered per collection.

A value that had to be **derived** from the single by a multiplier is shown in grey italics with a
leading `~`, the same marking used for an estimate from an unidentified variant — hover it to see
which of the two it is. An issue's total says how many of its stamps were counted that way.

The **+ catalog value** link records against the format on screen, so a value typed while a block
column is showing is stored as the block's price, not the single's. The dialog's condition badge
names the format so there is no doubt about what is being written.

## Adding a catalog value

Click a copy's **value** in the list to price it in place — a **+ catalog value** link when the
copy is unpriced, or the value itself (click to edit) when one is already recorded. This is the
same price link used on the [purchase](purchases.md) intake screen. A dialog opens showing the
stamp, its catalog numbers, the copy's condition (and any certificate), and any prices already
recorded, with one input per catalog active on the stamp's area — the primary catalog focused
first. Enter the value(s) and save; each lands on the latest edition of its catalog for this
condition, and the copy's value updates in place.

To work through the gaps in bulk, turn on the **Missing catalog value** filter to list only the
copies that still need pricing, then click each row's **+ catalog value** in turn.

## Adding a copy to an offer

You can list a copy for sale without leaving the Inventory screen. On a copy that is
marked **For sale** and has been **delivered** (in hand), the row's **⋮** menu shows an
**Add to offer** action. It opens a picker of your [offers](offers.md):

- A **state** panel on the left filters by **Preparing / Active / Paused** (with counts) — the
  offers you're still composing come first.
- The search box matches by offer, platform, set, **catalog number**, or the **location ref** of
  a copy inside a set.
- Each offer expands to its existing sets; **Show contents** reveals the exact copies a set holds.

Choose where the copy lands: **＋ New set** on an offer (a fresh single-item set), or an
**existing set** — dropping it in turns that set into a series sold together. Confirm with
**Add to offer**. Only the offer you pick is affected.

Starting a brand-new offer from the copy is in the same picker: **＋ Create new offer** opens the
offer header form (platform, currency). When the copy has a [catalog value](#copy-value-and-holdings-total),
the **asking price** is pre-filled with it — converted into the offer's currency and fully editable,
so you can accept, adjust, or clear it. (A copy with no catalog value leaves the price blank.)
Creating the offer seeds it with this copy as a single-item set and returns you to the Inventory
list. Add more copies later from the offer's compose screen — see [Offers](offers.md).

When you already know you want a fresh offer, the **⋮** menu also has **Add to new offer** — it
skips the picker and opens that create form straight away, seeded with this copy. Cancelling it
closes the dialog. (The full **Add to offer** picker is still there when you want to add the copy
to an offer you already have.)

An offer that already lists this copy is shown but disabled — a copy is never listed twice in the
same offer. A copy that has already **sold** elsewhere can't be added at all.

To compose an offer from several copies at once, use **Add set** on the offer detail screen
instead — see [Offers](offers.md).

## Photos

Attach photos to a copy from the **Photos** section at the bottom of the add-copy and
edit-copy dialog. Because purchase-order intake uses the same dialog to identify copies into
a lot, you can photograph stamps as you receive them — see
[Purchases](purchases.md).

There are two kinds of slot:

- **Front** and **Back** are dedicated single-image slots. Drop a file on a slot or click it
  to pick one. Re-uploading **replaces** the current image; the **✕** on a slot clears it.
- **Additional photos** are unlimited extras, each with an optional **title**. Add them by
  dropping files on the **＋ Add photos** area or clicking it. Drag the **⠿** handle to
  reorder them, edit a title inline, and use **✕** to remove one.

When a copy has **no photos yet**, the **＋ Add photos** area expands to fill the whole
space reserved for photos, giving you one large, easy target to drop the first files onto.
Once at least one photo is attached, the strip of photo cards returns above a normal-sized
add-photos area.

Accepted formats are **JPEG, PNG, and WebP**, up to **15 MB** each. Each photo is
automatically downscaled for storage and given a thumbnail for the list and slot views.

Photos upload **as soon as you drop them** — each thumbnail shows its own upload progress bar,
and an overall bar above the strip tracks all in-flight uploads together — but nothing is
attached to the copy until you **Save** the dialog. The Save button waits while an upload is
still in progress. If you **Cancel** or close the dialog instead, the
staged uploads are discarded and never attached.

Saved photos appear as a single thumbnail at the left of the copy's row and in the read-only
[View copies](#viewing-copies-from-the-catalog) popup. When there is more than one photo, a
counter and **‹ / ›** controls let you step through them without leaving the list; front and
back are marked with an **F** / **B** corner badge. Click the thumbnail to view the photo
full-size.

When a copy gets its **front** photo and its linked stamp has **no photo yet**, that front is
**automatically promoted** to the stamp as its `main` reference image (an independent duplicate
— the copy keeps its own). This seeds the catalog stamp's picture from the first copy you
photograph; the next copy of the same stamp sees a picture already there and is left alone. You
can also **promote** any saved copy photo to the copy's stamp by hand. See
[Collections → Stamp photos](collections.md#stamp-photos).

Promotion also propagates **up the variant tree**: ancestors of the stamp that have no photo yet
get one too, stopping at the first ancestor that already has a picture.

The **automatic** promotion only happens for copies with **no format** set, that is single stamps.
A copy recorded as a pair, block or strip shows a multiple rather than the single catalog stamp,
so it is never chosen on its own as the stamp's reference image. Promoting **by hand** stays
available on every copy — if a block's photo is the picture you want on the stamp, use the **⬆**
button and it is used.

## Identifying a variant

When you record a copy against a **base stamp** because you don't yet know its exact
variant, the copy is flagged **unknown variant**. Once you work out which variant it
actually is, resolve it:

1. On an unknown-variant row, open the **⋮** menu and choose **Identify variant**.
2. Pick the specific variant from the list — only the variants of that copy's own stamp
   are offered, so you can only refine to a *more specific* variant, never re-point the
   copy to an unrelated stamp.
3. Optionally add a **reason** (for example, what let you tell the variants apart).
4. Click **Identify variant**. The copy is re-pointed to the chosen variant, the
   *unknown variant* flag clears, and the change is recorded in the copy's refinement
   history.

## Refinement history

Every time a copy is re-pointed to a different variant — whether through **Identify
variant** or by changing the stamp in **Edit** — the change is appended to that copy's
**refinement history**: what it was, what it became, when, and any reason you noted. Any
copy that has been refined offers a **View history** action in its **⋮** menu; choose it
to see the full trail.
The trail is never erased, so a copy's identification path stays traceable even after the
variant is settled.

## Deleting a copy

Open the row's **⋮** menu and choose **Delete**, then confirm. This permanently removes
that physical copy record, along with any photos attached to it, and cannot be undone.
