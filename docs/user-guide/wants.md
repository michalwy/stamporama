# Want list

The **want list** records what you are *looking for*: stamps you do not own yet, and
stamps you own but want in better shape. Open it from **Want list** in the **Buying**
section of the sidebar.

It is deliberately separate from the disposition flags on a copy (**in collection**,
**for sale**, **for trade**). Those describe copies you actually hold; a want has no copy
behind it, which is exactly why it needs a record of its own.

## A want says what would satisfy it

The important part of a want is not "this stamp" — it is **what you would accept**. Each
want has three axes, and each one holds a *set* of acceptable values:

| Axis | Ticking nothing means | Example |
| --- | --- | --- |
| **Acceptable conditions** | any condition will do | tick MNG, MH and MNH for "any mint" |
| **Acceptable certificate** | certificate does not matter | tick *No certificate* for "only without one" |
| **Acceptable format** | any format will do | tick *Single* for "no blocks" |

Two things to note:

- **Nothing ticked means "anything"**, not "nothing". The form says so under each axis.
- On the certificate and format axes, **"none" is a value you can tick**. *No certificate*
  and *Single* are real answers, and they are different from leaving the axis empty.

There is deliberately no "at least this good" option. Your condition dictionary is your
own, and its order is a display order — nothing in it says that MNH is better than used,
or where CTO sits. A list of acceptable values needs no such ordering to be correct.

## Upgrades need no separate feature

Say you own a used copy and now want a mint one. Set the want's acceptable conditions to
your mint conditions. The used copy you hold does not match, so the want stays open, and
the row shows a **held** badge so you can see the copy is there. Nothing else is needed —
there is no separate "upgrade" concept to keep track of.

## What you already have of it

The popover behind the crosshair chip — on every catalogue, copy and auction list — shows
what the collection has of the wanted stamp, **split by where it is**:

- **held** — sorted and in the collection, drawn plainly: having it is the expected case;
- **to sort** — arrived, still in the parcel you are working through;
- **in transit** — on its way;
- **ordered** — paid for, not yet moving.

Each is tinted differently, so a glance separates what you have from what is merely coming.

On a copy's own row — in the Copies list or on a purchase order — the figures leave **that
copy out**. It is the one you are looking at, and a count meant to say "something else is
already coming" must not be satisfied by the thing in front of you.

The split exists for one case in particular. A want stays open until *you* close it, which
is right — you do not have the stamp yet. But with a single figure, a copy you have already
bought and are waiting for looked exactly like no copy at all, so the same stamp at the next
auction read as an untouched gap and the want quietly urged you to bid again. **Held** and
**on its way** are different answers to "should I be bidding on this", and only one of them
is yes.

### Of the stamp, or of this want

The popover shows **two** figures, ruled apart, because they answer different questions:

- **Of this stamp**, at the top — everything you have of it, whichever want it does or does
  not answer. This is the upgrade context: a mint-only want shows `1 held` here when the
  copy on your desk is a used one.
- **For this want**, inside each want's own block — only copies that would actually satisfy
  it.

Only the second is ever used to say something is already coming to you, and the difference
matters exactly when it is easy to get wrong: a **used** copy in the post satisfies a want
for "anything" and satisfies a mint-only want not at all. One line over a list of wants
would have told you to stop bidding on a mint copy because a used one was in the post.

The **want list** row shows only the per-want figure. A row is one want, so the stamp-wide
count would have said the same thing twice.

## Adding a want

Click **Add want**, then pick the stamp with the **same picker the Add copy dialog uses**
— type to search by catalog number, stamp or issue name, or the location ref of a copy you
already hold, or click **Browse…** to walk areas and issues down to a stamp or one of its
variants (creating the issue, stamp or variant on the spot if it is not in your catalog
yet). Once picked, the stamp collapses to a summary with **Change**.

Then tick what you would accept. You can also record:

- a **priority** — High, Normal or Low, picked as one of three chips in the colours the
  list row uses, for what to chase first when a dealer's list is long;
- a **note**.

### Picking the terms in one go

If the same acceptance keeps coming up — *any mint*, *anything*, *a copy for the
collection* — save it once as an
[acceptance profile](collections.md#acceptance-profiles) and pick it from the **Profile**
dropdown at the top of the terms. The three fields below fill in, and stay editable: a
profile is a starting point, not a lock.

The dropdown names the profile whose terms match what is currently ticked, so opening an
old want tells you which one it was entered on. Change one box and it reads **Custom** —
the terms are no longer that profile's.

Applying a profile **copies** its terms. Editing the profile later leaves this want, and
every other want already saved, exactly as it is. The field is absent entirely until you
have saved at least one profile.

**The last profile you saved a want on comes back next time.** Working through a dealer's
list is usually a run on one set of terms, so **Add want** opens on the profile you used
last, per collection — the same way the stamp form opens on the last subtype and the copy
form on the last condition. Save a want on terms that match no profile and the memory
clears: you have said the run moved on. Editing a want never re-applies it — an edit shows
that want's own terms — and neither does the narrow step below, which has a suggestion of
its own.

### There is no price on a want

Deliberately. A want has no date on it, so any figure you typed would be a price opinion
frozen on the day you typed it — the catalogue moves, the market moves, and the number on
the row keeps looking authoritative while quietly going wrong. Keeping a hundred of them
current by hand is not work worth doing.

What a stamp is worth is asked where the buying actually happens, against the copy in front
of you: the [bid recommendation](auctions.md#what-a-lot-is-worth-bidding) on an auction lot,
computed from your own recorded results rather than from something typed months earlier.

### Adding a whole series at once

Collecting a series means wanting every stamp on it, usually on the same terms — and typing that
in twelve times is work nobody should do. In **Browse…**, each issue row carries an *add this
whole set* button per [checklist](collections.md#checklists) the issue holds, exactly as it does
in purchase intake and auction lot composition. Pick one and the field reads
**Whole set: Basic set — 12 stamps**.

Fill in the acceptance, the priority and the note **once**; they apply to every want created.
The button then says **Add 12 wants**, so you can see what it is about to do.

Two things worth knowing:

- One want is created **per stamp**, not one want for the set. Each stamp is found, priced and
  closed on its own day, and a set-shaped want could never be half met.
- Stamps that already carry an **open** want are left alone, and the screen says how many. A
  **closed** want is not a reason to skip — if the stamp is wanted again, it is wanted again.
- Stamps you already **hold** are *not* skipped. That is deliberate: you may well want a better
  copy, and unlike the checklist-gap action below, this is you naming what you are after.

Editing a want offers no whole set — turning one want into twelve is not an edit.

## Browsing the list

Each row leads with the wanted stamp's **catalog photo** — a want is read to recognise a
stamp on a dealer's table, so the picture is the point. Click it for the full-size view;
where a stamp has several images, arrows step through them on hover. Stamps with no photo
keep the column empty so the rows still line up.

Beside the acceptance chips sits the **priority** as a chip of its own — amber for High,
blue for Normal, grey for Low.

On the right, the row shows what the catalogue says the want would cost, as a **range** in
your base currency. A want accepts a *set* of combinations — every condition, with or
without a certificate, in any format — and each has its own catalogue value, so the figure
is the cheapest and the dearest thing that would satisfy you. Narrow the want and the range
narrows with it. A single figure means only one accepted combination is priced. A leading
**≈** means at least one figure was inferred rather than read off a catalogue — a
lowest-variant estimate, or a format derived from the single by a multiplier. Hover for how
many of the accepted combinations carry a price at all; nothing shows when none do.

Down the left is the same rail every other list screen carries: the **area tree** and the
**year facets**. Your area and year selection is shared across Stamps, Issues, Inventory
and this screen, so opening the want list lands you on the scope you were last working in.
The year is the stamp's own issue year, and the counts say how many wants each year would
leave given everything else you have narrowed by.

The list **loads as you scroll**, like the Stamps and Inventory lists — a want list for a
whole collecting plan runs to thousands of rows, and every filter above narrows it on the
server rather than hiding rows already fetched.

### Reading it by series

**By issue** in the toolbar collapses the list to **one row per series**, each carrying
`open / total` — how many of that set you are still looking for, over how many wants you
ever recorded for it. A closed want stays in the total, so the fraction means the same
thing whether you are looking at Open, Closed or All. Expand a row for its wants, which
carry exactly the same actions they do in the flat list.

Useful right after adding a whole series or filling the list from a checklist, when the
flat list is twelve rows saying much the same thing. The setting is remembered per
collection.

Note this is *not* the same figure as the **Completeness** card on an issue's page: that
one counts copies you **hold**, this one counts what you are still after. Wants whose stamp
belongs to no issue collect in a **No issue** row at the bottom.

The list stays flat by default on purpose. A want is about a *stamp* — what you would
accept can differ from stamp to stamp within one series — and the job the list is opened
for most is matching a stamp in your hand against it, where one searchable row beats a
series you have to expand.

Above the rows: the list opens on **Open** wants, which is what it is for. Switch to
**Closed** or **All** to see the ones you have settled. You can also narrow by
**priority**, by **acceptable condition** — which asks "which wants would take a copy in
this condition", so a want that accepts anything matches every condition you pick — and by
free-text search over catalog numbers, stamp and issue names and notes.

Open wants come first, High priority before the rest.

Hovering a row brings up two shortcuts beside its **⋮** menu: **open the stamp's page** —
for its catalogue numbers, the prices the range came from, or the copies you hold — and
**edit the want**. Both are still in the menu; the icons are a shortcut, not a move.

### On the stamp's own page

A stamp's detail page leads its right-hand column with a **Wants** card showing what you
are looking for of it and on what terms — including wants you have already closed, faded,
since on one stamp those are the record that it was looked for and found. The card is
read-only; editing happens on the want list.

It appears **only when the stamp is on the want list**. Most stamps are not, and a card
saying so on every catalogue page would be a line you learn to skip.

## From the Stamps and Issues lists

You do not have to come here to record a want. On the **Stamps** list and inside any issue's
stamp tree:

- A stamp already on your want list carries a **crosshair chip**. Click it for a popover
  listing every open want on that stamp — the same four chips the want list draws, one row
  each. The chip's colour is the most urgent of them, and it is absent entirely when the
  stamp is wanted no more; a marker on a few rows is a signal, one on every row saying "0"
  is a column.
- **Add to want list** sits in the row's **⋮** menu and, for how often it is used, as a
  hover icon beside it. It opens the same form this screen opens with the stamp already
  picked, so you still say what would satisfy you rather than recording a bare "I want
  this".

Closed wants do not light the chip: it answers what is still being chased.

The same chip is on **auction lot lines**, on **copies** — the Copies list and a purchase
order's intake — and on grouped copy rows. Everywhere a *concrete* condition, certificate
and format is named, the chip can say more than "this stamp is wanted": when those would
satisfy one of the wants it is **ringed** and the popover marks which one. On copies you
already hold, that ring is the upgrade signal.

## Taking a copy in

The review happens when a copy reaches **your hands** — the moment it becomes **delivered**
— not when the record is first created. That is one rule covering every route in:

- a copy added by hand starts delivered, so the review comes straight away;
- a copy bought on a purchase order starts *ordered*, and gets its review when you sort it
  (**Mark sorted**) or set it to *delivered* yourself;
- a parcel won at auction and settled into a purchase arrives the same way, so it reaches
  the same question — nothing about buying at auction skips it.

Until then the want stays open and the copy shows as *ordered* or *in transit*, which is
honest: you have paid for it, you do not have it, and there is nothing yet to judge.

Then Stamporama shows you the **open wants that copy could satisfy**, and lets you decide
for each one:

- **Close want** — it is met. The want stays on the list under **Closed**, and can be
  reopened later.
- **Narrow it…** — it is only *partly* met. This is the common case: the want was
  "anything", a used copy arrived, and now you are looking for a mint one. The editor
  opens with a suggestion — everything except the condition that just arrived — and you
  adjust it before saving. The want stays open. An
  [acceptance profile](collections.md#acceptance-profiles) can be applied here too, since
  narrowing is the same question the want form asks.
- **Leave open** — nothing changes.

**Nothing is ever closed automatically.** Holding a copy is not the same as having what
you wanted, and only you can say which. Closing the dialog without choosing leaves every
want exactly as it was.

## Filling the list from a checklist

On an issue's detail page, each **Completeness** card has an **Add missing to want list**
button. It creates one open want for every stamp on that checklist you do not hold and do
not already have an open want for.

The wants it creates accept **anything** — a gap only says the stamp is absent, and it
cannot know on what terms you would buy it. Edit each one afterwards to say what you would
accept, and set a priority where one matters.

This runs **once, when you press it**. Changing the checklist afterwards does not touch
the want list, and pressing the button again adds nothing for stamps that already have an
open want.

## Closing versus deleting

**Close** a want you have satisfied — it keeps the record that you were looking for it, and
you can reopen it if the copy turns out to be wrong. **Delete** is for a want you should
never have added; it cannot be undone.
