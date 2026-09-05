# Albums

Printed album pages: what a page is, and what its boxes are cut from. The design was decided in
**#755** — read that issue before anything here, it is the reasoning this file only summarises — and
is being built out in #763–#771.

The rule that runs through all of it: **an album is a durable, printed object, and the app's job is
to plan it, not to render it once.** Pages get glued into. Two things paper cannot take back:

- a page's identity must not move when the collection grows (hence a **catalog range**, `PL 303–309`,
  never a page number — a number is a position, and a position moves);
- a hawid cut to the wrong size is gone.

## Hawid stock and the box rule (#765)

`HawidStrip` is a collection-level dictionary — height, the stock length a strip is sold at, an
optional label, a drag order — shaped and placed like `StampFormat`, edited in **Settings → Albums**.
Nothing is seeded and nothing is backfilled.

`src/lib/hawid.ts` is the rule, and it is **pure**: no Prisma, no rendering. Four surfaces will draw
from it — the page plan (#767), the PDF (#768), the editor canvas (#769) and the cutting list (#770)
— and the only way four surfaces agree on a millimetre is that none of them does the arithmetic.
`src/lib/hawid-stock.ts` is the Prisma side and the rule knows nothing about it.

What the rule says, and why each half is the way it is:

- **Height comes out of the drawer.** The box takes the height of the *shortest strip in stock* that
  the stamp plus the template's vertical clearance fits into. Not the stamp's height plus a margin:
  hawid is sold as strips of a fixed height that are cut across, so a box drawn at a height no strip
  has is a page that disagrees with the piece on the desk. Ties go to the earlier strip in the
  collector's order, so two callers cannot resolve one stamp two ways.
- **Width is the cut,** and is continuous: the stamp plus the template's horizontal margin.
- **A strip must also be long enough** for the box's width. A 210 mm strip cannot yield a 240 mm
  piece however tall it is, and a cutting list must not ask for a cut nobody can make.
- **Oversize is an answer.** A stamp no strip is tall enough for gets a box of its own size plus the
  margins and **no strip** — those go in a pocket, and #770 says so rather than naming a strip that
  does not exist.
- **An empty stock makes every box oversize.** Deliberately: that is a collection which has not
  described its drawer, and it should look unplanned rather than silently take AlbumEasy's global
  4 mm — the single global adjustment this whole rule exists to replace.

Millimetres are rounded to a tenth **before** any comparison. `23.9 + 0.1` is not `24` in binary
floating point, and the strip that mismatch picks is a taller one: material spent on an arithmetic
artefact.

The clearances themselves are **not** here — they belong to the album template (#766) and are passed
in. The rule takes plain numbers on purpose; it is unit-tested on plain numbers in
`tests/unit/hawid.test.ts`.

## Stamp size (#763)

A box needs a size, and a size is a `Stamp` attribute — catalogue identity, not condition — resolved
through `src/lib/stamp-size.ts`. A stamp stating no size of its own borrows a checklist neighbour's
**at read time**, and anything drawn from a borrowed figure has to say so: a collector cutting to an
inherited number as if it had been measured is the failure this whole track is arranged against.

## Configuration is seeded, never referenced

Choosing a template on an album copies its values onto the album (#308's rule, #766). It matters
more here than anywhere: editing a template must not reach back into a page that is already in the
binder. The hawid stock is the deliberate exception and is read live — it is a statement about a
drawer, and a drawer changes; what must not change under a printed page is the album's own frozen
plan (#767).
