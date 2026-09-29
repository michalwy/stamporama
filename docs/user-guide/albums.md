# Albums

**Collection → Albums** is where you plan pages to print, mount and file.

An album covers one **area**, gathers that area's [checklists](collections.md#checklists) in catalog
order, and lays them onto sheets. Every slot on a checklist gets a box, whether or not you own a
copy — so a page is a want list until it is full, and the box is already the right size when the
stamp arrives.

The parts that decide how a page *looks* — page size, spacing, fonts, hawid clearances, the four
texts — are an [album template](collections.md#album-templates) in Settings, alongside your
[hawid stock](collections.md#hawid-stock). Those are set up once. This screen is the album itself.

## Making an album

**+ New album** asks for four things:

- **Name** — printed at the top of every page, and available to a footer. It is **suggested from
  the area you pick, spelled in the album's language**, and keeps following both until you type a
  name of your own; from that moment it is yours and changing the area or the language never touches
  it again. The suggestion is the area's *own* name — an area you only use for grouping is suggested
  under its own name, not its parent's, because that is the branch you chose. Where you have written
  a [title name translation](contacts.md#title-names-per-language) for the album's language, that is
  the spelling you get; where you have not, the area's plain name. The language is never added to the name — an album
  printed in Polish is called *Rzesza Niemiecka*, not *Deutsches Reich (polski)*.
- **Area** — entries are gathered from it and everything under it. Pick it from the same
  searchable, collapsible area tree the rest of the app uses; any area will do, including one
  you only use for grouping, since the album reads the whole branch below it.
- **Language** — see below; it is more than the words.
- **Template** — page size, spacing, fonts and the four texts; its values are **copied** onto the album. The album does not point back at it, so
  editing or deleting that template later never changes this album, and can never change a page you
  have already printed and glued into. Leaving it on *Default page* starts from A4 with the measured
  defaults.

The album gathers its entries straight away.

### When the area gets a name in the album's language later

An album made before its area had a name in the album's language is called by the area's plain
name, and that is what prints at the top of every page. Once you write the
[title name translation](contacts.md#title-names-per-language), the album **offers** it — on the
album screen and in the page editor: *Use the name in Polish: Polska?* It never renames itself.

- **Use …** renames the album. If cards you have already printed carry the old name at the top, you
  are told how many first, and they stay exactly as printed; *Printed cards* then says what differs.
- **Keep …** leaves the name alone and stops offering that translation. Change the area's
  translation again and the new one is offered.

Only an album still called by the area's plain name is offered anything. A name you typed yourself
is yours.

## The album's own page template

**Page template…**, at the top of an album's screen, opens every value the album took from its
template — page, frame, headings, boxes and spacing, hawid clearances, type, photos, and the four
texts, each a section of its own — with the album's own pages drawn beside them, redrawn as you type
and marking what the field under the pointer controls. It is the same form and the same preview as
a template in Settings, pointed at this album; see
[The page beside the fields](collections.md#the-page-beside-the-fields).

**What you change there applies to this album only.** The template it was made from is not touched,
no other album started from that template changes, and the album does not become linked to anything.
Nothing has to be reseeded to correct one margin.

These are layout values, not just drawing settings, so saving them **re-plans the album**: boxes can
move between rows and sheets, and the number of sheets can change. **Printed cards never change.**
They stay exactly as printed and report the difference under *Printed cards*, where you answer it
with a continuation page or a reprint as usual — or leave it.

Before anything is saved you are told **how many printed cards that match today** the change would
make stop matching, and you confirm that figure. A card that already reports something — a new
picture, say — is not in the count, because this change does not make it out of date for the first
time. If the count is zero, the values are simply saved.

*Apply a template* on the album list is still there, and is the other thing: it replaces **all** of
the album's values with a template's.

The two gaps between boxes, and whether stamp photos are printed, can also be changed from the **page
editor**, beside the sheet they are judged on — see below. They are the same values and come with the
same warning about printed cards.

### Where a page puts its content

**Content on the page**, under *Page*, decides where a sheet that is not full puts its series:

- **At the top** — the series start under the headings and whatever is left over stays at the foot.
  This is how every page was set before the option existed, and it is what a new template starts at.
- **Centred** — the series as a whole sit in the middle of the space, at their ordinary spacing.
- **Justified** — the first series at the top of the space and the last at the bottom, with what is
  left over shared equally into the gaps *between* series. No extra space above the first or below
  the last.
- **Centred and justified** — what is left over is shared equally into the gaps between series **and**
  above the first and below the last, so every one of those gaps is the same.

The **album's name at the top, the year and the footer never move** — only the series between them.
On the first sheet of a year, the space is what is left under the year. Series side by side in one
band move together, so their mounts stay lined up. With **a single series** on a sheet there is no
gap between series, so *justified* sets it at the top and *centred and justified* centres it.

Nothing about **which series lands on which sheet** changes: the sheet is filled exactly as before
and only the space left at its foot is moved. A single sheet can also choose its own placement in the
page editor — see below.

### The page frame

Under *Page*, a frame is drawn in the page margin: **no rule, one rule or two**, with the line's
**weight**, its **inset** from the edge of the paper, and for two rules the **white between them**.
A **corner ornament** can sit at each corner, at the **size** you set — its longer side, in
millimetres. It is drawn for the top-left corner and **mirrored** at the other three, so it always
faces into the page, and the rules run between the ornaments and stop where each one ends. An
ornament also works on a frame with no rules: four corners on their own.

The frame is **paint, not layout**. It never moves a series and never changes which series lands on
which sheet, so choosing one re-plans nothing. A printed card still reports a change of frame, because
the card would now look different.

Four ornaments come built in — **Rosette**, **Vine**, **Art Deco** and **Square** — drawn for
Stamporama in the spirit of a classic album frame; a new template starts with the Rosette at 25 mm on
a double rule. You can also use **your own**:

- **Upload SVG…** beside the ornament field, or under **Settings → Corner ornaments**, takes
  an SVG drawing. It lands in the field straight away and is kept in the collection for every
  template and album.
- Draw it for the **top-left corner**. The drawing's point **0,0 sits on the frame's line** — on the
  rule itself, or midway between two — and the rules run in to the **far right and bottom edges of its
  viewBox**. So a drawing whose viewBox starts at `0 0` sits entirely inside the corner, and one that
  starts at negative numbers reaches out past the line, towards the edge of the paper. Run an arm
  along each axis out to those edges and the rules meet it.
- It prints as **vectors**, sharp at any size. Solid colours only: a drawing with text, an embedded
  picture, a gradient, transparency, dashed lines, clipping or `<use>` is refused with the reason,
  rather than printed differently from how it looks in a drawing program.
- An ornament a template or an album still uses **cannot be deleted**; you are told which ones use it.
  A printed card keeps its own copy of the corners it was printed with, so deleting an ornament never
  changes a card in your binder.

The two rules used to be drawn 1.2 mm apart, and every existing album and template was given exactly
that; the preview now shows the same gap the PDF prints.

#### The album title in the frame line

**Album title** under *Page* chooses where the album's name is printed: **below the frame**, as the
first line inside the top margin — where it has always been, and still the default — or **in the
frame line**. There the top rule breaks around the name, which is centred on the page and on the line
(midway between two rules), and **Gap around the title in the line** is the white left on each side
between the letters and where the rule stops. A double rule breaks in both of its rules, and it works
the same with or without corner ornaments. 5 mm is what your own AlbumEasy cards leave.

Unlike the rest of the frame, this one is **layout**: the name no longer takes a line of its own, so
the page's content starts on the **top margin** — the room below it grows and a series can move back
onto an earlier sheet. If a large name reaches below the top margin, the content starts under it
instead, with the **space below the album title** between them; the space *above* the title is not
used, since the name sits on the line. A page with **no border** has nothing to break, and the name is
printed below as before. A printed card keeps the name where it was printed and reports the change.

#### The footer: inside, in or below the frame

**Footer** under *Frame* chooses where the footer — the page's catalog range, *PL 303-309* — is
printed. It is placed **from the frame**, on its own, so wherever it goes the series are spread over
the same space: the page less its margins.

- **Inside the frame** — at the foot of the framed area, where it has always been and still the
  default. **Footer offset from the frame** is the space from the frame's inside (the inner edge of
  the inner rule) up to the foot of the footer. An existing album was given exactly the offset that
  keeps its footer where it was printed.
- **In the frame line** — the bottom rule breaks around the footer as the top one does around the
  album title: centred on the page and on the line, with **Gap around the footer in the line** of
  white on each side. Both rules of a double one break, with or without corner ornaments.
- **Below the frame** — in the margin between the frame and the paper's edge. The offset is then the
  space from the frame's outside (the outer edge of the outer rule) down to the top of the footer.

The **margins alone decide where the series go**: the space ends on the bottom margin, so a footer
below the frame or in its line takes nothing from it, and *justified* and *centred and justified*
leave the foot of the page as even as its head. The one exception keeps a footer readable: a footer
inside the frame that reaches above the bottom margin keeps the series clear of it, and the space ends
on its top. You no longer need a bottom margin smaller than the frame to print the footer below it —
and an album that did that now spreads its series to its margin, so set the footer *below the frame*
and the margin back to what it should be. A page with **no border** prints the footer on the bottom
margin, as before, whichever you choose. A printed card keeps its footer where it was printed and
reports the change.

## The language is the album's own, and it changes the plan

An album is printed in one language. Names, checklist headings and everything else resolve to that
language wherever you have a translation and fall back to the collection's own where you do not —
the same fallback a generated listing title uses.

It changes more than the wording. Headings are longer in some languages, a longer heading wraps onto
a second line, and a wrapped heading moves where a block stops fitting — so the same album does not
break onto pages the same way in Polish and in German. That is why the language belongs to the album
rather than being chosen when you print.

Changing it re-plans the album. Pages you have already printed stay in the language they were
printed in.

A **checklist heading** prints the checklist's name. A checklist named after its issue — which is
how an issue's first checklist is named — uses the **issue's** translation, so an issue translated
for your listings is already translated here. A checklist you named yourself (*Imperforate*, *With
tabs*) has its own translations, next to its name in the checklist's **Rename** dialog. If you give a
checklist named after its issue a translation of its own, that one is used.

An album in a language you sell nothing in is still a language you are using, so it gets its own
column in every dialog that translates text — area title names, condition and certificate names,
issue, checklist and stamp names, subtypes, formats. Nothing has to be switched on for that: the languages on
offer are the ones your platforms and your albums use, minus your
[default language](collections.md#default-language). Delete the last album in a language and its
column goes away again; whatever you had typed for it stays where it was, ready if the language comes
back.

## The album's screen

An album opens across the whole window, in three layers.

**The header** names the album and holds what you do to all of it: **Page editor** (the main one),
**Download PDF** with its *print at 100 %* reminder beside it, **Mark printed…**, **Cutting list** and
**Page template…**.

**The summary strip** below it says where the album stands, and every figure on it is a way in:

- **Entries** — how many checklists, in how many chapters, over which years. Opens the Entries tab.
- **Sheets** — how many, how many are still live and how many are printed. Each opens the Sheets tab
  narrowed to those.
- **Before printing** — sizes not measured (borrowed from a neighbour, or missing altogether), boxes
  that go in a pocket, and texts that would print untranslated. These are the page editor's own
  flags, counted over every live sheet, so the strip and the editor always agree. Any of them opens
  the Sheets tab on *Needs attention*.
- **Printed cards** — how many cards in your binders no longer match the album, out of how many.
  Opens the Printed cards tab on *Out of date*.

**Three tabs** hold the rest: **Sheets** (the one the album opens on), **Entries** and **Printed
cards**. Sheets and entries are grouped into the album's **chapters** — a year each, the same
chapters the pages print — and a chapter's heading says how many it holds and how many of its sheets
need attention. Click a heading to fold the chapter away.

The tab you are on, the filter and the chapters you folded are part of the page's address, so going
into the page editor and coming back — with the browser's Back or the editor's own link to the album,
even after moving between sheets there — or bookmarking the album returns you to exactly that view.

The explanations that used to sit on this screen as paragraphs are now hints: hover the dotted text
beside the thing it explains. The one reminder that stays in plain sight is *print at 100 %*, beside
**Download PDF**, because getting that wrong ruins a card and nothing on the card shows it.

## Entries

The **Entries** tab lists the checklists in the order the album prints them. Drag a row to change that
order — across chapters too; a checklist dragged among another year's starts a chapter of its own
there, exactly as the pages would print it.

- **Gather new checklists** picks up checklists that have appeared in the area since you last looked.
  It only ever *adds*: an entry you put there by hand, or one whose issue has since moved elsewhere,
  stays where you put it. To take one out, use **Remove from album** — the checklist itself is
  untouched, you are only saying it is not in this binder.
- A checklist that **spans several issues** has no area, so it cannot be gathered. Add one of those
  from the [Checklists](collections.md#checklists-that-span-several-issues) screen: **⋮ → Add to
  album…** on its row.
- **Own order** on a row means this album prints that checklist's stamps in an order of its own
  rather than the one set on the checklist. **Follow the checklist's order** puts it back.

## Sheets

The **Sheets** tab is the plan, made from the entries. Each row shows a small **thumbnail** of the
sheet — where its text sits and where its boxes are, with any box that needs a look drawn in amber —
then its catalog range, the checklists on it, and whether it is **Live** (not on paper yet, and
re-planned every time you open the album) or **Printed** on a given date. A printed sheet whose card
no longer matches the album says **Out of date**; click it to see why.

**Click a thumbnail to open that sheet in the page editor.** A printed sheet opens there too, read-only,
as the card went onto paper and with what has changed since. The thumbnail is an ordinary link, so it
opens in a new tab as well.

The row of chips above the list narrows it: **All**, **Needs attention**, **Live**, **Printed**.

**A sheet is named by the catalog numbers on it** — `PL 303-309` — and never by a page number. That
is deliberate, and it is the whole reason the feature is shaped this way: a page number is a
*position*, so adding one stamp early in an album would change the number on every card already in
your binders. A catalog range is derived from the sheet's own contents, so an insertion disturbs the
one card it lands on.

Both ends are written out in full, the way your existing pages write them.

A chapter is a **year**, and a year starts a new sheet with its heading printed once at the top —
the shape your hand-written pages already have. Checklists stack down the sheet; one that does not
fit moves whole to the next, and only a checklist too tall for an entire page is ever split.

When one is split, every sheet after the first repeats the checklist's heading with the sheet's
number in brackets after it — `Bloki okolicznościowe [2]`, then `[3]`. The first sheet carries no
mark. That is your `(cd.)`, with the number added so four cards of one long checklist can be put back
in order on a desk. The mark is part of the heading, so it is wrapped and centred with it and never
runs into the margin.

Two short checklists can **share a band** — sit side by side — when both are narrow enough, which is
what your own pages do a few times per page. It is a ceiling set on the template, not a frame: the
page is never divided into fixed columns, nothing runs off the side of one, and a checklist that
would have to squeeze simply takes the next band on its own.

Checklists sharing a band have their stamps **lined up** for you: the boxes start under the taller of
the two headings, and a shorter box is centred on the taller one beside it — the few millimetres you
used to add by hand so that two stamps on one card sit level. The space is part of the page, so it
counts when deciding what fits. If a pair still needs nudging, *space before* a block moves just that
block.

Each live sheet also flags what needs a look before you print it:

- **N in a pocket** — no strip in your hawid stock is tall enough for those, so they are drawn at
  their own size with no mount. A block, a souvenir sheet or a cover goes in a pocket.
- **N sized from a neighbour, not measured** — those stamps state no size of their own and borrowed
  one from another stamp on the same checklist. Usually right, since a series is printed at one size,
  but it is a figure nobody measured and you are about to cut to it.
- **N with no size at all** — nothing on that checklist has been measured, so there is nothing to
  draw. Measure one stamp of the set and the rest follow.
- **N untranslated texts** — headings, labels or the footer that would print in your collection's
  default language because a translation into the album's language is missing. The page editor
  outlines them and lets you fill the gap in place.

A box is counted under one of these only, as the page editor flags it: *no size at all* before *in a
pocket*, and *in a pocket* before *sized from a neighbour*. *Needs attention* shows every sheet
carrying any of them.

If the collection has **no hawid stock** at all, the screen says so and every box is planned as a
pocket. That is honest rather than broken: describe your drawer in Settings → Hawid stock and the boxes
are cut from it.

## The page editor

**Page editor** in the album's header — or a sheet's thumbnail, or *Open in the page editor* on its
`⋮` — draws a
sheet at **1:1** and lets you overrule the layout by hand.

It is a workbench and it takes the window. **Only the sheet scrolls**: the list of sheets on the
left and the panel of numbers on the right stay where they are while you move down a page, so what
you are working on and what you are working with are never both off screen at once.

Everything you set there is a **correction**, not a position: *this box 2 mm wider*, *5 mm more
before this series*, *break here*, *a new row from this stamp*, *this series on its own line*, these stamps in this order. That distinction is the whole reason
the automatic layout goes on running underneath — add a stamp to a checklist and the page re-flows
with every one of your corrections still in place. Nothing has to be re-done after an acquisition.

**Dragging writes the number and typing moves the drawing.** Neither is the real way: drag a box's
corner and the millimetre appears in the panel; type the millimetre and the box moves. Whichever you
use, the sheet is re-planned when you let go or press Enter, so what you end up looking at is the
plan and not a sketch of it.

**The panel keeps its words short.** A setting whose reach is worth knowing says it on its heading:
*This sheet*, or *Whole album* — every sheet of this album and its PDF, for this album only, the
template it was made from untouched. Under a control there is at most one short line; where that
line is dotted, hovering it gives the longer explanation, and everything else is on this page. None of
these settings changes a printed card: it stays as printed and reports the difference, which the panel
says once, under the album-wide settings, when the album has a card in the binder. A missing
translation is listed with what it belongs to and its full text in the collection's default language,
and the field for the translation under it, as wide as the panel.

What you can set:

- **Space before and after a block.** Added to the space the layout already leaves. Negative closes
  a gap; it stops at nothing rather than printing one block over another.
- **Where a page may break above a block** — wherever it falls, start a new sheet, or keep it with
  the block above. The last is a preference: if no sheet could hold both, the layout gives up on it —
  and **says so**, on the block and in the sheet's own summary, so you never find out from a card in
  your hand.
- **A box's width and height.** Type millimetres **on the piece**, not on the box. The width is the
  cut and moves with what you type. The **height comes out of your drawer** — the box is drawn at the
  whole height of the shortest strip the piece fits into — so it moves in strip steps and may not
  move at all: two more millimetres might change nothing, or might take a box off the 24 mm packet
  and onto the 29 mm one. Raise it past your tallest strip and the box becomes a pocket, and the
  cutting list says so.
- **Where a row of boxes ends.** A checklist's boxes run left to right and wrap when the page runs
  out of width; to end a row earlier — a sub-series on a line of its own, ten stamps as five and five —
  select the box the new row should start at and tick *Start a new row at this box*, or click the small
  square on its top-left corner. A box a row starts at by hand carries a blue bracket round that
  corner. The break belongs to **that stamp**, so adding or removing other stamps in the checklist
  leaves it where you put it. It only ever **adds** a row: if what follows is still wider than the page,
  it wraps as usual. The first box of a checklist already starts a row, so it offers nothing. A
  checklist broken into short rows is also narrower, so it may now sit side by side with the next one.
- **A series on its own line instead of beside the one before it.** Two short series that fit side by
  side are put next to each other, each under its own heading. To start one below instead, select it
  by its heading and tick *Start on its own line, not beside the one before*, or click the small
  square on its heading's top-left corner; a series set this way carries a blue bracket round that
  corner. The setting belongs to **that series**, so it stays with it when the album re-flows. It only
  stops that one pairing — the series after it may still sit beside it — and it is **not a page
  break**: if the series no longer fits on the sheet once it has moved down, it goes to the next sheet
  like any other. It is offered only on a series that sits beside another, or that already has it set.
  Notes can be set the same way.
- **The spacing between boxes**, across a row and between rows. Click the paper outside any block
  and the sheet's panel has both, in millimetres. They are **this album's own values**, the same two
  that *Page template…* calls *Between boxes, across* and *Between rows*: they apply to **every sheet
  of this album** and to no other album, and the template it was made from is not touched. They are
  typed rather than dragged, and saved when you press Enter or leave the two fields. Changing a gap
  **re-plans the album** — boxes can move to another row and onto another sheet — and, like *Page
  template…*, you are first told how many printed cards that match today would stop matching. A
  printed card stays as printed and reports the difference.
- **Where this sheet puts its content.** In the same panel, *Placement* (tagged *This sheet*) follows
  the album's *Content on the page* unless you pick one of the four for **this sheet only**. The choice
  is kept with the **series (or note) that opens the sheet**, and the panel names it — a sheet has no
  identity of its own that would survive a re-flow, so if the pages re-flow the choice goes with that
  series to wherever it now opens a sheet, and a sheet it no longer opens follows the album again.
  Choose *As the album* to take it back. It is saved as you pick it, and the canvas and the PDF place
  the sheet the same way.
- **Whether stamp photos are printed.** In the same panel, *Print stamp photos in the boxes* shows or
  hides the pictures on every sheet of this album — on screen at once, and in the PDF. It is the same
  value as in *Page template…*, for this album only; how strongly the pictures print stays there. As
  with the spacing, you are first told how many printed cards that match today would stop matching,
  and a printed card stays as printed.
- **The order of the stamps in a block** — drag one box onto another. That writes this album's own
  order for the whole checklist; *Follow the checklist's order* puts it back.
- **A note of your own**, set in one of the template's five voices and **filed before or after a
  checklist** rather than dropped at a spot on a page. Reorder the album and the note goes with the
  checklist it is filed against. The side matters: a note that opens a chapter belongs *before* that
  chapter's first checklist, not after whichever one happens to precede it today — otherwise it slides
  into the middle of the previous year the first time you drag a new checklist in there. Filed
  against nothing, *before* is the head of the album and *after* is the end of it. Dragging a note's
  heading onto another block files it before that block.

**While you are dragging, the sheet says what will happen.** What you picked up goes pale with a
dashed ring round it, and where it would land is marked in the same blue: a **bar in the gap in front
of** the box or the heading it would go before. That is the rule the drop follows — the thing in your
hand takes that place and everything from there moves along one — so nothing is ever swapped. A note
is the exception, because a note is not in an order to begin with: it is **filed against** a
checklist, so dropping it shades the block it would be filed against rather than drawing it a slot.
Where you see no mark at all, dropping there does nothing — a box only reorders inside its own block,
and a checklist dropped on a note has nowhere to go.

The order the blocks themselves print in is the album's own — the **Entries** list on the album
screen. In the editor, select a checklist and **Earlier** or **Later** under *Where it prints* moves it
one step in that order, which can take it onto another sheet; dragging its heading onto another
checklist does the same.

The canvas also marks, in colour, the three things that are worth catching **before** a sheet goes
into the printer and are worth nothing after: a box **sized from a neighbour** rather than measured,
an **oversize** box that needs a pocket, and a box with **no size at all**. Beside them it lists any
word on the sheet that would print in the collection's default language because the album's own
translation is missing — click the dotted outline on the canvas, or fill it in the panel, and it
is saved on the stamp, issue, checklist or area itself straight away.

That covers every text a sheet prints: the running head, the year, checklist headings, box labels
and the footer. The running head is marked while the album is still called by its area's plain name
and the area has no name in the album's language; filling that in does not rename the album, it
offers the new name (see [above](#when-the-area-gets-a-name-in-the-albums-language-later)). Your own
notes are not marked — they print exactly what you wrote.

Above the sheets, the editor says **how many texts across the whole album** would print untranslated
and on which sheets, so a gap on a sheet you are not looking at is found before printing.

**1:1 on a screen proves nothing about the card.** A viewer applies its own zoom and the print
dialog applies another; the ruler check below is the only one that counts.

### Setting a stamp's size from the page

A box marked **sized from a neighbour** or **no size at all** can be settled without leaving the
editor. Select the box and its panel has **The stamp's size**: what the stamp states now, and two ways
to give it one.

- **Measure on a photo.** The stamp's own photos and its copies' photos are shown as small pictures;
  click one and it opens in the same viewer as on the stamp's and the copy's pages, with the same
  tools, the scale beside the reading and the two fields to correct the figures before **Set as the
  stamp's size**. A stamp with no photo — or with photos stored without the size they were taken at,
  so no scale can be known — offers no measuring, and the panel says which.
- **From a preset, or typed.** **Fill from a preset** fills the width and height, or type them, then
  **Set as the stamp's size**.

Either way the size is **the stamp's**, not this box's: it is written onto the stamp, so every album
and every other screen takes it, and the pages are re-planned straight away — the box is then drawn
from the stamp's own figure and its flag goes. It is not the same thing as *Corrected by* under it,
which is millimetres on this album's box only. If the stamp already states a different size you are
shown it and asked before it is replaced.

**For a whole series at once**, click a checklist's heading and use **Apply size to this block…**, or
**shift-click** several boxes (on a Mac, ⌘-click works too) and use **Apply size…** in the panel. Both
open the same dialog as *Apply size…* on the Issues list: a preset or typed figures, how many of the
stamps already state a size before anything is written, and **Overwrite those too** unticked every
time. Their variants and child stamps are sized with them. A block means the stamps it has **on this
sheet**. Measuring is for one stamp at a time, so a group is not offered it.

A printed card is read-only, so none of this is offered on one.

### Pages without stamps

An album is not only pages of stamps. A **title page** — a coat of arms, *Wolne Miasto Gdańsk*,
*Freie Stadt Danzig*, *1920 – 1939*, inside the album's frame — a **section divider**, a **map** or a
**page of notes** is a page without stamps, and any of them is made the same way: **Add a page without
stamps** in the sheet's panel (click the paper outside any block).

**It is filed, like a note, before or after a checklist.** Reorder the album and the page goes where
its checklist goes. Filed *before* everything it is the album's **opening page**, *after* everything its
**closing** one. A page filed before a year's first checklist comes before that year's first sheet,
and the year's heading stays on the sheet of stamps rather than being left alone on a card. Two pages
filed at the same place are put in order with **Earlier** and **Later**.

**It is a sheet of its own**, laid out on paper of its own. The album's **frame** is printed on it. The
album's name at the top, the chapter's heading and the footer are **off**, and each can be switched on
for that page under *The frame*. (The footer names the sheet's catalog range, and a page without stamps
has none, so a footer that only says that prints nothing.)

**What goes on it is placed where you put it.** *Heading*, *Text* and *Picture…* put one on the page,
selected so you can type at once:

- **A heading or a text** is set in one of **the template's own faces** — the chapter heading's, the
  checklist heading's and so on — at a **size you choose** in points, left, centred or right. A heading
  starts in the chapter heading's face and a text in the checklist heading's, but both can be set in
  any. Line breaks you type are kept, and a line too long for the width wraps.
- **A picture** is chosen from the collection's **picture library**, which is shared by every album:
  a coat of arms uploaded once can go on the title page of one album and the section pages of another.
  Upload an **SVG, PNG or JPEG** from the same dialog. An SVG made of plain shapes in solid colours
  prints **as lines**, sharp at any size. One the album's reader does not follow — a gradient,
  transparency, text in the drawing — is drawn **once, at a high resolution**, when you upload it, and
  prints as a picture; its panel says so, and why. A picture can be deleted from the library only while
  no page and no printed card uses it.

Each thing on the page has a **position** — across and down, in millimetres from the sheet's top-left
corner — and a **width**. Drag it on the sheet to move it, drag the handle on its right edge to widen
it, or type the millimetres in its panel: both write the same numbers. A text is as tall as its lines
and a picture as tall as its own proportions make it, so neither has a height to set. **Centre across**
and **Centre down** centre it in the dashed rectangle on the sheet, which is what the frame's heads
leave. **To the front** and **To the back** decide which of two things is drawn over the other.

A **PNG or a JPEG that would print below 300 dpi** at the width you placed it is outlined on the sheet
and said in the panel, with the figure — make it narrower, or upload a sharper one. It is a warning,
not a refusal, and like the other flags it never goes onto the paper.

The page prints exactly as the editor shows it: the canvas and the PDF place every picture and every
line of text in the same millimetres.

### A printed card opens read-only

The editor works on sheets that are still a plan. A card you have marked printed opens showing
**what went onto the paper** — in the faces and margins it was set in — with whatever has changed
under it listed beside. Its geometry cannot be corrected there, and that is not a missing feature: putting a
card right is a decision rather than an edit, a **continuation page** or a **reprint**, and both are
made on the album screen under *Printed cards*.

One thing you *can* still change is what a **note** on a printed card says, and the card then
reports the difference like any other — the same as renaming an issue. Taking such a note out of the
album is refused, though: the card would go on carrying words nothing in the album accounts for.

A **page without stamps** works the same way. Once it is on a printed card you can still move, retype,
restyle or take things off it, and the card reports the difference; the page itself cannot be taken
out of the album while the card is in the binder, and neither can a picture the card prints be deleted
from the library.

## Printing

**Download PDF** in the album's header composes the whole album. Each sheet's ⋮ menu also has
**Download this sheet**, which is the one you want after adding a stamp: it reprints that card and
nothing else.

### Print it at 100%, and check the first one with a ruler

This is the one thing that can go wrong after everything else has gone right.

The PDF is composed here rather than printed by your browser, so the page is exactly A4 and a box
drawn at 30 mm is 30 mm. But **printers cannot print to the edge of the paper**, so almost every
print dialog defaults to *Fit to page* — and that silently shrinks the whole sheet by a few percent
to make room. A card printed that way looks completely normal. Every box on it is a little too
small, and you will not find out until a hawid you cut to the cutting list does not fit the box you
stuck it beside.

So, in the print dialog:

- set the scale to **100%**, **Actual size**, or **None** — whichever your printer driver calls it;
- turn **Fit to page** / **Shrink oversized pages** off;
- print on A4 (or whatever page size the album's template says).

Then take a ruler to the first sheet and measure one box against what it should be. Once that comes
out right, the setting stays right and you never have to think about it again.

**Measuring it on screen proves nothing** — PDF viewers apply their own zoom, and "100%" in a viewer
is not 100% of a sheet of paper.

### What is on the page

Everything the Sheets tab describes, drawn to size: the album's name at the top if the
template prints it, the year, each checklist's heading, a box per slot with its label, and the
sheet's catalog range in the footer.

A box also prints the picture of its stamp where there is one — the stamp's own image, or failing
that a photo of your copy. It is **fitted, never cropped**: a stamp of a different shape from its
box sits inside it with white around it, because a picture stretched or trimmed to fill a
size-true box would be telling you the wrong thing about the object's proportions. The album's
template values decide whether pictures are printed at all and how strongly; whether they are
printed can also be switched from the page editor.

The fonts travel inside the file, so a Polish, Czech or German page prints identically on any
machine and on any printer, and the file you keep today prints the same in ten years.

### There is nothing to refresh

An unprinted sheet is not stored. It is planned from your current data every time you open the album,
so a stamp added to a checklist, a corrected size or a renamed series shows up on its own.

Nor does the album tell you how the plan has changed since you last looked, and that is on purpose:
an unprinted sheet reshuffling costs nothing, so there is nothing there to act on. The comparison
that matters is against **paper**, and that is the next section.

## The cutting list

**Cutting list**, in the album's header, is the sheet you take to the desk with the scissors. It
answers the two questions that come up there: *what do I cut for this card*, and *how much stock does
this album need*.

It prints from your browser, unlike the album's own pages. That is not an oversight — nobody measures
a list, so the *Fit to page* problem above simply does not apply to it, and the browser's print dialog
is the shortest path to paper.

### Sheet by sheet

Every sheet, in the album's own order, and within a sheet in the order the pieces get stuck down. Each
line is one instruction: **cut from** which strip, **to** what width, and **how many**. A card already
on paper says the minute it was printed, so you can pick out the run you have just done.

Identical cuts are one line with a count, because that is how you actually cut them — six 38 mm pieces
off the 29 mm strip is one trip to the ruler, not six. A line also says when a width came from a
checklist neighbour rather than from a measured stamp, since that is the figure you are about to cut
to.

**A box is a slot, not a stamp.** If a stamp is on two of an issue's checklists — basic and
specialized, perforated and imperforate — and the album gathers both, that is two boxes on the card,
two hawids and two cuts, and it is counted twice here on purpose.

### No hawid

Two kinds of box are listed apart, because neither has a width to cut:

- **a pocket** — no strip in your stock is tall enough, which is the ordinary answer for a block, a
  souvenir sheet or a cover, and more useful than naming a strip height you do not own;
- **no size at all** — nothing on that checklist has been measured, so there is nothing to cut to.
  Measure one stamp of the set and the rest follow.

### Stock to cut

By strip height: how many pieces, their total width, and **how many stock-length strips that needs**.

That last figure is not the total width divided by the length of a strip, and the difference matters:
a piece cannot span two strips, so four 120 mm pieces need four 210 mm strips rather than the three
that division gives. The list counts what the pieces actually need, so it never sends you back to the
shop with half an album mounted. The gap between the total width and the strips is your offcut.

**It comes in two parts, and they are deliberately not added together.** *Cards already printed*
first, because you mark a sheet printed as it comes off the printer and cut for it afterwards — so
the run you have just printed is in that figure, and it is the one you read at the desk today. *Sheets
still on screen* below it is what the album will need on top.

They are two figures rather than one because the album knows when a card was **printed** and has no
way to know when it was **mounted**. So the first figure covers every card ever printed: this
morning's run, which still needs cutting, and the ones glued in last year, which do not. Each card in
the sheet-by-sheet list below says the minute it was printed, which is how you tell them apart —
better than the album guessing.

A printed card's cuts are read from what was stored when it was printed, not from your drawer as it
stands now, so they are the sizes on that card whatever has changed since. If a strip a card was cut
from is **not in your stock any more** the line says so rather than quietly moving to the nearest
height you do own — what was cut is what was cut, and a substituted figure would be a cut nobody
made. A strip is known by its stamp height *and* its label, so one you have relabelled since the card
was printed reads as not in your stock too.

## Printed cards

When a sheet has gone onto paper and into a binder, tell the album so. **Mark printed…** in the album's
header does every sheet not yet on paper; the ⋮ menu on a sheet does that one.

**Downloading the PDF marks nothing.** A draft is generated to be looked at, and an album that froze
itself the first time you previewed it would be a trap. Saying *these went onto paper* is its own
gesture, and you make it after the printer has.

If one checklist runs across two or three sheets, they go onto paper together — the row says so
(*Sheets 4–6*) and the action marks all of them. Half a checklist on a card and half still in the
plan is not a state the album can hold.

A page without stamps is marked printed like any other sheet, and is a card of its own. The list names
it *A page without stamps*, since it has no catalog range to be named by, and it is left off the
cutting list — there is nothing on it to cut.

### What a printed card keeps

Everything that was on it: the headings and labels exactly as they read that day, every box's size in
millimetres, which strip of hawid each box was cut from, the pictures, the catalog range, the corner
ornament of its frame, and the page settings the sheet was set under. From then on the album **draws that** — so reprinting the card
in a year's time gives you the same sheet, whatever has changed in the collection since.

That is why it is stored rather than simply flagged. A flag would stop the layout being re-planned
while every heading and every measurement went on being looked up fresh, and a reprint would quietly
stop matching the card it is meant to replace.

A printed card never carries anything that depends on what you **own** — no completion count, no
valuation, no owned/wanted marker. Such a figure is out of date as the sheet leaves the printer, and
every stamp you bought afterwards would make the album report that card as needing attention. (The
flags on an *unprinted* sheet — *in a pocket*, *sized from a neighbour* — are a different thing: they
are shown on screen, before you print, and never go onto the paper.)

### What the album tells you afterwards

The **Printed cards** tab lists every card in the binder and what no longer matches it — **Out of
date** narrows it to the cards that differ:

- **Stamps** — the checklist gained or lost a slot, or would now print in a different order;
- **Size** — a box would now be cut to a different size, or from a different strip;
- **Text** — a renamed series or area, a corrected translation, a change of language, or different
  words on a page without stamps;
- **Page** — on a page without stamps, something has moved or changed width, is set in another face,
  size or alignment, has been replaced, added or taken off, or is drawn in a different order;
- **Template** — the album's page settings have moved since the card was set, or the card's content
  would now be placed differently on it (at the top, centred, justified). What is compared is how the
  card would actually be placed, so a card that keeps its own placement, or holds a single series,
  reports nothing when the album's placement changes in a way that would not move it;
- **Picture** — a stamp has a photo the card prints an empty mount for, or the picture has changed.

They are listed in that order, and **Picture** is deliberately last. It is a real difference and a
small one, and after an afternoon at the scanner it would otherwise be the only thing you could see.

The album **reports and stops there.** A card can be out of date for a perfectly good reason for
years, and nothing here is put right on its own.

### The two ways to bring a card up to date

Both are on the card's ⋮ menu, and you choose per difference — there is no setting.

**A continuation page.** The stamps that have joined since get a sheet of their own, with its own
catalog range (`PL 306`), filed straight after the card they continue. Nothing renumbers, because
nothing was ever numbered. Until you print it, the continuation sits in the Sheets tab like any
other unprinted sheet, and another stamp arriving in the meantime lands on it too.

Note that until you ask for one, a stamp added to a printed checklist appears **nowhere** in the plan.
That is deliberate: putting it on the next sheet by itself would hide the fact that the card it
belongs on is already in a binder.

**A reprint.** The card goes back into the plan and is laid out again in full, so you print a
replacement and take the old one out of the binder. The stored card stands until you mark the new
sheet printed in its turn, and the album keeps saying a superseded card is still filed — because
until you have actually mounted the new one, the old one is still what is in the binder, and that
gap is however long it takes to get to the printer. So you can change your mind (**Keep the card in
the binder**) and nothing has been lost, and a reprint you never get round to simply stays there:
nothing sweeps it and nothing nags.

If that checklist already had a continuation sheet waiting, the reprint takes it back in — the whole
checklist is laid out again, so there is one card to print rather than a card and a continuation.

**Un-printing** is neither of those. It throws the stored card away — the sizes, the strips, the texts
as they read then — and the album stops knowing about that sheet at all. It tells you exactly what
will go before it goes.
