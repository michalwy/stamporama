# Variant prices

A stamp whose specific variant you have not identified is valued at the **lowest** catalog
price among its variants, and — when you list it — offered under that same variant. That
answer is only as good as the prices behind it: a tree with three of eight variants priced
answers a question about three variants while looking like an answer about the stamp.

The **variant price grid** is where those prices are filled in — a whole tree in one pass,
laid out the way a printed catalogue lays it out.

## The grid

Rows are the stamp tree, indented exactly as the Issues list draws it. Columns are your
conditions. Cells are the prices.

Above the grid you choose three things once, for the whole grid:

| Control | What it fixes |
| --- | --- |
| **Catalog edition** | which catalogue and which year — and with it the currency |
| **Certificate** | *None* by default, which is what a printed catalogue quotes |
| **Format tabs** | *Single*, or one of your formats (pair, block of four…) |

Typing:

- The **first cell takes the cursor** as soon as the grid appears, so you can start typing
  without reaching for the mouse.
- **Tab** moves down a condition column, and on to the top of the next column at the end of
  one — the way a column of variants is filled in from a catalogue that lists them down the
  page, and the same movement the stamp editor's price grid uses. **Shift+Tab** goes back.
- **Enter** saves the cell and closes the grid. It is the way out of a grid you opened to
  fill one gap. If the figure is refused, the grid stays open with the message on the cell.
- There is **no Save**. Each figure is written when you leave the cell.
- **Clearing a cell removes the price.** An empty cell records nothing — it is not a zero.

On a format tab, a greyed, dashed cell shows what that format would be worth from the
single's price and this issue's multiplier. Nothing is stored until you type over it;
clearing it again goes back to the derived figure.

### Umbrella rows

A row marked *umbrella* has variants of its own, so its value **is** the lowest of theirs.
Its cells are read-only and show that figure with a `≈` — computed, not recorded — taken
over the edition you have chosen above the grid. Tab skips them.

You may still price an umbrella directly, and such a price overrides the rolled-up one. Use
the padlock on the row to turn its cells back into inputs; the cell then prints the recorded
figure plainly, with no `≈`. Locking the row again changes nothing that is stored — it just
puts the rolled-up figure back on screen.

## Where to open it

- **An issue** — its `⋮` menu on the Issues list → **Price variants…**, beside the format
  multipliers. The whole issue's tree, in one grid.
- **A stamp** — the **Price variants** button on the worklist below, on an offer's *On
  Colnect* card, or on a listing blocker naming an unpriced variant. Opening it over any
  stamp of a tree shows the **whole tree**, since that is what the value is read from.

Opened **from an offer** — the *On Colnect* card or a listing blocker — the grid is narrowed
to the copy being listed: its condition alone, at its certificate and its format. Those two
controls are gone, and a line above the grid names what it is scoped to; the catalog edition
is still yours to choose. It is one cell per row, because that is the one cell the listing is
blocked on. The rest of the tree's prices are filled in from the Issues list or from the
worklist below, where the whole grid is drawn.

## The worklist

**Variant prices** in the **Catalog** section of the sidebar lists every stamp whose
variants are not fully priced, widest gap first. Each row says how many of its variants
have no price and how many cells that comes to, and opens the grid over that tree.

A variant counts as unpriced only at the conditions **your collection actually holds or
lists at** — those are named above the list. A collection that has never owned a used copy
is not missing a used price.

Two more things the list deliberately does *not* count:

- An **intermediate** node — one with variants of its own — is an umbrella too, so an empty
  one is not a gap.
- A variant priced only in an **older edition** still counts as priced. It has a figure;
  asking for it again on every new edition would leave every tree incomplete for ever.

## Why a listing needs the whole tree

A catalogue value may be an estimate and is marked as one. A sale may not: it attaches to
one specific catalogue entry, and while any variant is unpriced there is nothing to say
which one is cheapest. So an offer holding such a copy is refused with its own reason,
naming the variants that want a price and linking straight into this grid.
