# Locations

**Locations** are where your copies physically live — cabinets, stockbooks, albums,
boxes, a safe. They are separate from catalog **areas**: an area describes *what a stamp
is* (country, period), while a location is *where a copy sits*. Copies from many areas
can share one stockbook, and one area's stamps can be spread across many locations.

Open the **Locations** screen from the **Collection** section of the sidebar.

## Building your storage tree

Locations nest to any depth, so you can mirror how your storage is actually organized —
for example a cabinet holding several stockbooks:

- **Cabinet 1** *(grouping)*
  - Stockbook Poland A
  - Stockbook Poland B
- **Safe** *(grouping)*
  - Certificates envelope

To add one, click **+ Add location**, give it a name, optionally choose a **parent
location** and a **description**, and decide whether it **can hold copies**.

Any location with children shows a **caret** to its left — click it to **collapse**
that branch (hiding everything nested inside) or **expand** it again. Collapsed branches are
remembered in your browser, so the tree opens the same way next time. Deeply nested branches
start collapsed by default to keep long trees readable.

### Grouping locations vs. storage that holds copies

The **Can hold copies** checkbox is the key setting:

- Leave it **checked** (the default) for real storage — a stockbook, album, or box that
  copies actually go into.
- **Uncheck** it for a grouping-only location — a cabinet or shelf that just organizes
  the storage inside it. Grouping locations are shown with a **Grouping** badge and
  cannot themselves receive copies; only their children can.

You cannot mark a location as grouping-only while copies are still filed directly in it —
move those copies first.

## Editing and deleting

Every location row has a **⋮** menu with **Add sub-location**, **Edit**, and **Delete**.

A location can only be deleted once it is empty: if it still has **child locations** or
**stored copies**, the delete dialog explains what to clear first. This prevents
accidentally losing track of where copies were.

## Filing copies into a location

You assign a copy to a location from the **Add copy** / **Edit copy** dialog on the
[Inventory](inventory.md) screen (or the **Add copy** action on the Stamps and Issues
lists). In the **Storage** section:

- Pick a **Location**. Only locations that can hold copies are selectable; grouping
  locations appear for context but are greyed out — expand them to reach the storage
  inside.
- Optionally type a **Ref** — a free-text identifier *within* that location, such as a
  page or pocket (`p.12`), or the number written on a ref card (`A147`). The ref is
  shared by however many copies sit under it, and it does not have to be unique.

Leave the location empty to record a copy you haven't filed anywhere yet.

A whole batch is put away at once from the purchase screen — see
[Two acts: Store and Move](purchases.md#two-acts-store-and-move). There the ref is
suggested for you: it is the **next free one in that location**, so the strip of cards a box
is on carries on across purchases.

## Printing blank ref cards

If you file stock onto transport cards, each card carries one or more small index cards with a
running ref written on them — *ref cards*. They are printed **blank and ahead of time**: you
print a strip, pack the stamps onto a card, and only then record the filing — which is why
Stamporama never hands out a ref behind your back.

A location's **⋮** menu → **Print blank ref cards…** opens a printable strip. It starts at the
next free ref in that location and prints as many cards as you ask for; change the start ref
if your strip is somewhere else, and use **Print** for the browser's print dialog. Cutting
guides are dashed and the cards carry the ref and nothing else.

Cards sit **flush against each other**, so one cut separates two of them — the sheet never prints a
double line for you to cut down the middle of.

### Card formats

The size of a ref card is set by the pocket it has to fit, so it is yours to state rather than ours
to guess. Keep your sizes as named **ref card templates** under **Settings → Ref cards**, and pick
one from the **Card format** control above the sheet. A template holds four measurements, all in
millimetres:

- **Card width** and **Card height** — the card you actually cut, measured against the transport
  card it slips into.
- **Ref size** — how big the number is printed.
- **Top padding** — how far down the card the number starts. The ref sits at the **top** rather than
  in the middle, because once the stamps are packed onto the transport card the rest of the ref card
  is hidden inside the pocket.

There are no rows or columns to set: the sheet fits as many cards across the page as your paper
allows and flows the rest below, so the same template prints correctly on A4 and on Letter. How many
cards you get is the length of the strip you asked for.

The format you last printed on is remembered per collection and leads the next sheet. The sheet reads
the template as it prints and keeps no copy of it, so editing a template changes the **next** sheet —
cards already printed are paper and are unaffected. Until you add a template of your own, the sheet
prints a built-in card of 45 × 24 mm.

Nothing is reserved by printing — a ref becomes real only when copies are filed under it. Since
refs allocated in packing order land as contiguous runs, a transport card ends up covering a
range, and finding `A148` is scrolling the box to the card whose range covers it.

## Finding copies by location

Each copy on the Inventory list shows a 📍 chip with its location path (and ref, if set),
so you can see at a glance where everything lives. To narrow the list, use the
**location filter** in the Inventory toolbar — see
[Filters and sorting](inventory.md#filters-and-sorting). Selecting a location shows every
copy stored in it **and in any location nested inside it**, so filtering by a cabinet
shows the copies in all of its stockbooks at once.
