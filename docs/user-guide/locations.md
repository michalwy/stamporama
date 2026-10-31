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

To add one, click **+ Add location**, give it a name and a [code](#location-codes), optionally choose a **parent
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

## Location codes

Every location has a **code**, built from its place in the tree. Each location sets the code of
**its own level** only, and its **full code** is the codes of every level from the top down joined
with dots — the way its path *Cabinet › Shelf › Stockbook* is joined from their names. A cabinet
`A`, its shelf `B`, the stockbook on that shelf `C` and the stockbook's first page `1` have the full
codes `A`, `A.B`, `A.B.C` and `A.B.C.1`. The full code is shown beside the location's name on the
Locations screen and in the location picker, where you can also search by it. It stands in for the
location's whole path where the path is too long, or too private, to print.

Because it is built from the tree, the full code **follows the tree**: move a location, or change a
parent's code, and the full code of that location and of everything under it changes at once.
Renaming a location does not change its code.

A level's code can be **any text, of any length** — only a dot is not allowed, since the dot joins
the levels, and spaces around it are dropped. Whether a long code suits your printouts is up to you.
Every level has a code: a location cannot be saved without one. Two locations **under the same
parent** cannot share a code, and letter case does not matter there — `a` beside `A` is refused,
and the dialog names the location that has it. Locations under different parents can: `A.1` and
`B.1` can both exist.

When you add a location, a code is proposed from its own name: the first letter of its name's
**last word** (`Klaser A` → `A`), or the whole word when it is a number (`Szafa 1` → `1`). If a
location under the same parent already has that code, a number is added (`A2`). Type over it to
choose your own; the dialog shows the full code it makes under the chosen parent. Existing
locations were given codes by the same rule, each from its own name.

A code is only a label for the location: it is not part of a copy's **Ref** (`A147`), which is
unchanged.

The printed [packing list](sales.md#location-codes-and-the-legend) names locations by their codes,
with a legend of what they stand for printed separately.

## Editing and deleting

Every location row has a **⋮** menu with **Add sub-location**, **Edit**, **History** and **Delete**.

A location can only be deleted once it is empty: if it still has **child locations** or
**stored copies**, the delete dialog explains what to clear first. This prevents
accidentally losing track of where copies were.

A deleted location stays named in the [history](#where-copies-have-been) of the copies that were
in it, marked *(deleted)*.

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
[Two acts: Store and Move](purchases.md#two-acts-store-and-move). There the ref is filled in for
you: it is the **card that location is currently up to**, so you carry on packing the card already
on your desk, and **Next ref** starts a new one when it is full. Either way the counter belongs to
the location, so the strip of cards a box is on carries on across purchases.

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
to guess. Keep your sizes as named **ref card templates** under **Settings → Ref card templates**, and pick
one from the **Card format** control above the sheet; that page shows each template's card as it will
print ([Ref card templates](collections.md#ref-card-templates)). A template holds four measurements,
all in millimetres:

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

## Where copies have been

Every time a copy's location or ref changes, Stamporama writes it down: when, where the copy was
(location and ref), where it went — or that it was taken off its location with nowhere new — and
what moved it. The ref is part of the place, so moving a copy from card `A12` to card `A13` of the
same box is a move too. However the copy is moved, the move is recorded: from its **Edit copy**
dialog, from **Bulk edit** on the Copies list, by **Store** or **Move** on a purchase, by marking a
purchase arrived into a location, from a scan sheet, or by filing old copies on **Replacements**.

The record is never edited or deleted. If a copy was moved by mistake, move it back: both moves
stay in the record.

The history starts on the day this feature arrived. Each copy's first entry is where it was on that
day, marked **Starting point**; a copy added since starts with the entry that added it.

### On a copy

A copy's own page has a **Locations** card listing its moves, newest first: where it came from,
where it went, when, and what did it — **Copy form**, **Bulk edit**, **Purchase** (naming the
purchase, as a link), **Scan sheet**, **Replacement**, or **Other change**. Each location is a link
to that location's history.

### On a location

Click a location's name on the Locations screen — or choose **History** from its **⋮** menu — to see
every copy that came into it and every copy that left it, newest first. Each row says when, which
copy (a link to it), whether it came **In**, went **Out**, or moved **Within** the location (from one
ref to another), where it came from, where it went, and what moved it.

A location that groups others — a cabinet — shows the moves of everything under it; a copy moved
between two of its stockbooks reads as **Within**.

Narrow the list with:

- **Ref** — only moves onto or off that ref in this location (letter case does not matter), so you
  can see everything that was ever on card `A147`.
- **From** and **To** — only moves on those days, both days included. Either can be left empty.

