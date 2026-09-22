# Quick jump

Every major record in a collection carries a small **number of its own** — a copy is `#123`, an
offer is `#42`, and so are issues, purchases, sales, auction lots and trades. The **Jump to…** box at the
top of the sidebar takes one of those numbers and goes straight there.

Type a **prefix**, then the number:

| Type this | To reach |
| --- | --- |
| `i 123` | copy (inventory item) `#123` |
| `o 42` | offer `#42` |
| `p 7` | purchase `#7` |
| `s 7` | sale `#7` |
| `iss 12` | issue `#12` |
| `lot 3` | auction lot `#3` |
| `t 7` | trade `#7` |

Then press **Enter**.

The space is optional (`o42` works), case does not matter (`ISS 12`), and a `#` in front of the
number is fine (`p #7`) — that is how the number reads on screen, so pasting it works.

Press **Ctrl+K** (**⌘K** on a Mac) from anywhere in the collection to put the cursor in the box.
**Escape** gives the keyboard back to the page.

## Recently visited

Clicking into the box — or pressing **⌘K** — also drops a **Recent** panel under it, listing the
records you were last on: copies, stamps, issues, offers, purchases, sales, auction sales and trades.
Pick one to go back to it.

The list is **grouped by kind of record** — *Offers*, *Stamps*, *Copies*, *Intake documents* and so
on, each under its own heading. **Each group keeps its own last 3 records**, so a visit only ever
pushes out an older record of the same kind: after an afternoon of offers, the stamp you were on
before them is still there, under *Stamps*. The group you visited most recently is on top, each
group lists its records most recent first, and a kind you have not visited has no group.

- **↓** and **↑** walk the whole list as one, straight across the group headings; **Enter** opens
  the highlighted row, **Escape** closes the panel.
- Typing **narrows** the list by name, while what you typed is still read as a jump — so `o 42`
  jumps to offer `#42` on Enter, and at the same time shows the recent records whose names contain
  `o 42`.
- Each record has one entry however often you return to it.
- **Clear** empties every group.

Each group is **coloured by the section of the sidebar it comes from** — its heading, and the icon
of every record under it — in the same colour that section has in the
navigation: a stamp or an issue in Catalog's slate, a copy in Collection's green, an offer or a sale
in Selling's blue, a purchase, an opening balance or an auction sale in Intake's amber, a trade in Partners' violet. So
the list can be read at a glance by where each record lives. The colours are the navigation's own,
so they always match it.

The list lives **in this browser**, per collection, alongside your other view preferences — it is a
note of where you have been, not part of the collection, so it is not shared between browsers and
never leaves your machine.

## What it is not

It is a **jump**, not a search. It answers *"take me to the thing I am holding the number of"*, and
it does nothing until you press Enter. A bare number with no prefix is not a jump — `200` is just
as likely to be a catalog number, a year or a price — so the box asks you to name the type. That is
one keystroke, and it means the box never guesses.

To search for records *by what they are* — a stamp name, a catalog number, a buyer — use the search
field on the screen itself ([Inventory](inventory.md#searching-and-filtering),
[Offers](offers.md), [Sales](sales.md)).

## Where each jump lands

- **Copy** and **issue** open their list screen, filtered to that one number. Neither has a screen
  of its own, and the filtered list shows it in the company of the rows around it.
- **Offer** opens the offer's short address (`/o/<collection>/<number>`) — the same link a
  marketplace private note carries, so following a link and jumping are the same journey.
- **Purchase**, **sale** and **trade** open their own detail screen.
- **Auction lot** opens the **sale** it belongs to, with that lot scrolled to and its card open.
  It [flashes once](auctions.md#the-lots-screen) as it arrives and leaves nothing behind — the same
  thing clicking the lot on the watchlist does.

If the collection has no such record, the box says so and keeps what you typed, because a miss is
usually a typo one character wide.

## Where the numbers come from

Each number is handed out **in order, per collection**, when the record is created. It is never
edited and **never reused** — deleting purchase `#7` retires the number rather than passing it to
the next purchase — so a number you have written down or quoted always means the same record.

Numbers are also **per collection**: two collections both start at `#1`, and a number only means
something inside the collection that handed it out.

Copies are the one type with a display width you can set — see
[Internal copy number](inventory.md#internal-copy-number). Every other number renders as-is.
