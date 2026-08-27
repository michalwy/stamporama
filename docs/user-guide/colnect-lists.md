# Colnect lists

Colnect keeps lists of its own — **Collection**, **Swap**, **Wish** and **Sell** — and they are what
another collector reads before offering you anything. Keeping one in step with what you actually
hold is a loop, because Colnect offers no way to push data into it: **export the list, load the file
here, look at what differs, fix whichever side is wrong.** The **Colnect** screen in the sidebar is
where the middle two happen — and with the [Assistant](assistant.md) running, the export can be
fetched for you as well.

Which of your own things each list stands for, and which side wins when the two disagree, is set up
first under [Settings → Colnect → Colnect list sync](collections.md#colnect-list-sync). A list you
have not switched on does not appear here.

## Loading an export

On Colnect, open the list and press **Export list**; Colnect mails you a CSV or offers it for
download. Back here, press **Load an export** and pick the file.

### Without the download

Where the [Assistant](assistant.md) is installed and connected to this collection, **Refresh from
Colnect** in the header does the whole of that for you: it asks Colnect for this list's export in
this browser, signed in as you, and loads the file here as soon as it comes back. It is the same
request pressing **Export list** makes and the same file — you simply never see it.

Colnect takes its time building a long list, so a Wish refresh is a minute or two. If anything goes
wrong — Colnect refuses, the file cannot be read, your session has lapsed — **nothing is replaced**:
the export you already had is left exactly as it was, and the report goes on comparing against it.
And because nobody is watching to say *yes, that is the right list*, a file that comes back naming a
**different** list is refused rather than loaded.

**Load an export** stays where it is. It is the way through the day Colnect changes that request,
and it is the only way at all in a browser without the Assistant.

### What the dialog asks

The file says which list it is, so you usually have nothing to answer: every row of an export names
the lists that stamp sits on, and the one the most rows name is the list you exported. Where that
name matches a list you have set up, the picker opens on it. Where it does not — a custom list, or
one you renamed on Colnect — you say which it is.

Before anything is written the dialog shows what it read:

- when Colnect made the file, off its own first line;
- how many rows it holds, against the number the file's header claims. A mismatch is **reported and
  never refused**: a file you opened in a spreadsheet is still a list, and turning it away over a
  stale header would turn away the wrong thing;
- how many rows carry no Colnect link. Those cannot be compared to anything — the item ID lives in
  that link and nowhere else in the file — so they are counted rather than loaded.

Where the file's stamps sit on more than one of your lists, a second picker asks **which list's
columns to read**. Each row carries its own quantity and grade *per list* — the same stamp can be
wanted mint on one list and offered used on another — so this decides which pair is loaded.

**Loading replaces.** A list holds one import: the report is always about the list as it stands, and
an old export beside a new one would be a second answer to "what is on Colnect". Replacing also
clears everything you marked **done on Colnect** against the old file, which is the point — see
below.

## The five buckets

The comparison is worked out fresh every time you open the screen: the file is one side, your
collection *as it is right now* is the other. So clearing a copy's *for trade* flag drops its row
immediately, and only a change on Colnect's side needs a fresh export.

| Bucket | What it means |
| --- | --- |
| **Missing on Colnect** | you hold it, the list does not name it |
| **Extra on Colnect** | the list names it, you no longer hold it. What to do about it follows the list's **source of truth**: remove it there, or adopt it here |
| **Quantity** | on both sides, but the number differs |
| **Grade** | on both sides, but the grade differs |
| **Not comparable** | your stamp has no [Colnect ID](collections.md#colnect-id), so nothing was checked |

Two silences are deliberate.

**Grade is only reported where your copies agree on one.** Colnect holds a single grade per list
entry; you may hold three copies of the stamp, two mint and one used. There is no honest single
answer to compare, so the row says nothing rather than picking one. The same reading applies to the
Wish list: a want that accepts three conditions states no grade, and one that names exactly one
does.

**Not comparable is not "missing".** A stamp with no Colnect ID was never checked against anything —
filing it under *missing on Colnect* would claim something the report never verified. Filling those
IDs in is the [Assistant](assistant.md)'s job.

A row differing in **both** quantity and grade is filed under **Quantity**, and both sides' numbers
and grades are printed on it either way, so nothing is hidden. Fix the quantity, load a fresh export,
and the row comes back under **Grade** — because it still disagrees.

## Working through it

Filter by bucket and by country; each bucket chip carries how many rows it holds under whatever else
you have filtered by. Every row links out to Colnect — the item's own page where the ID is known, a
search on its first catalog number where it is not. Where the [Assistant](assistant.md) is running,
**Link** sits beside that search: it opens the search and matches the stamp for you, and the Colnect
ID lands back on the report on its own — which moves the row out of *Not comparable* on the next
read.

A row names its stamp the way the rest of the app does: catalog numbers, then the stamp's name. A
stamp with no name of its own is named by **the issue it is filed under and that issue's year**,
which is what most of a Colnect list looks like. The country is the stamp's **whole area path** —
`Poland › People's Republic`, not the leaf on its own — and the country filter lists the same paths.
Rows that exist only on Colnect keep the export's own country, untranslated: no mapping is invented
between Colnect's country names and your area names.

The row's **⋮** menu offers two ways to put a row away, and the difference between them matters:

- **Mark done on Colnect** — *I have already fixed this over there.* Stamporama itself never talks
  to Colnect — only the Assistant does, in your browser — so this is a claim rather than a fact, and
  it holds only until the next import. If the
  row comes back in the next export, it was not actually done, and the report says so.
- **Ignore** — *this difference is fine and always will be.* A judgement about your collection, so
  it survives every future import. You can add a note saying why.

Tick **Include put away** to see both again, and undo either from the same menu.

The header says which file the Colnect side came from and when Colnect made it, because a report
read against a three-week-old export is a different thing from one read against this morning's.

## Fixing your side

Half of what a report finds is your own list being out of date, not Colnect's — a copy still flagged
*for trade* after it went out, a want left open after you found the stamp. The row's **⋮** menu
offers those corrections where they apply, so you fix them without leaving your place in a list of
thousands.

Which correction a row offers depends on the bucket and on what the list stands for:

| Row | What you are offered |
| --- | --- |
| **Missing on Colnect** | *Stop offering these copies for trade* (or for sale, or take them out of the collection) — and on the Wish list, *Close the wants for this stamp* |
| **Extra on Colnect**, on a list where **Colnect** is the source of truth | *Offer these copies for trade* — but only if you already hold a copy. Nothing here ever invents a copy out of a list entry |
| **Grade**, on the Wish list | *Accept only MNH* — narrowing every open want for that stamp to the grade Colnect states |
| **Quantity** | nothing. A quantity is a count of copies, and you change it by adding or removing copies on the inventory screen |
| **Grade**, on a copy list | nothing. Your copy's condition is a judgement about the piece in your hand, and a line on a Colnect list is no evidence about it |

**Every correction names what it will touch before it takes it.** You may hold four copies of a
stamp, and *stop offering this for trade* meaning *four copies* without saying so is how a report
stops being worth trusting. So the dialog lists them by copy number, with the grade and the place
each one is filed, and only then offers the button.

Only copies **still in hand** are touched — delivered, not disposed of — which is the same set the
report counted in the first place. A copy you sold last month keeps whatever flags it had.

A correction writes nothing else: no *done* mark, no accepted difference. The row simply leaves the
report the next time you look at it, because the comparison is worked out fresh and the thing it was
comparing has changed.

## Adopting the wish list

The Wish list is the one where Colnect is right and Stamporama has to catch up — years of clicking
*I want this* over there against far fewer wants here. **Adopt into wants** in the header does that
in bulk.

It works a **pass at a time** — five hundred rows per press — because a first sweep is tens of
thousands of rows and neither you nor your server wants that as one action. Each pass shows you what
it would do before it does anything:

- how many rows become wants;
- how many **match no stamp here**, which on a list this size will be most of them;
- how many are already on your want list.

A row becomes a want only where it resolves to a stamp you already have in the catalogue: first by
its [Colnect ID](collections.md#colnect-id), and failing that through the same matcher the
[Assistant](assistant.md) uses, run **dry**. Nothing writes a Colnect ID onto a stamp — learning an
ID is something you do deliberately, against a page you are looking at, and a bulk import is not
that. A row matching nothing is reported and stays on the report; filling those IDs in is the
Assistant's job.

The new want takes the stamp and, where the row states a grade your
[condition mapping](collections.md#colnect-condition-mapping) can read, that one condition. Where the row
states no grade — or where two of your conditions both mean the same Colnect grade — the want accepts
anything rather than a guess. Priority is the default.

Run it again for the next pass; each one starts where the last stopped, and the bucket count falls
as you go. A single row can also be adopted on its own, from its **⋮** menu.

## Applying a difference on Colnect

Everything above fixes *your* side. **Apply on Colnect** is the other direction, and it is a bigger
thing: the [Assistant](assistant.md) ticks and unticks the list boxes on Colnect for you, in this
browser, signed in as you.

The button appears only when the Assistant is installed and connected to this collection. Pressing
it shows what will be sent before anything is:

- how many items go **onto** the list and how many come **off** it;
- that an item it **adds** lands with your count and your grades, while anything already on the list
  keeps its own — and that no note is ever written;
- roughly how long it will take.

It is slow on purpose. Colnect starts refusing requests above about four a second, and comfortably
tolerates one every other second, so that is the pace: a first Swap pass is an hour or so. Leave it
running and carry on working — rows tick off the report as each one lands. If it is interrupted, or
if Colnect asks for a slower pace, nothing is lost: the run remembers where it was and carries on
from there.

**Removals need a fresh export.** Adding something is safe whatever the file's age — you hold it
right now, so the list should say so. Removing is different: the report only knows Colnect has an
item *because the file said so*, and if that file is a fortnight old you may well have added the
item over there on purpose since. So a run against an export more than a week old sends its
additions and leaves its removals out, and says so. Load a fresh export and run it again.

### What an addition lands as

Colnect keeps a **row per grade** on a list entry, so a stamp you hold as two mint and one used goes
on as two rows — `2 MNH` and `1 U` — not as one row with a guess in it. That is read from your own
copies through your [condition mapping](collections.md#colnect-condition-mapping), so what appears
over there is what the report says you hold.

Where a copy is in a condition you have **not** mapped to a Colnect grade, it is simply left out of
what is written rather than guessed at, and the confirmation tells you how many additions that
affects before the run starts. Map the condition under Settings → Colnect if you want those copies
counted.

On the **Wish** list a want that accepts several conditions states no single grade, so only the count
is written and whatever grade Colnect chose is left alone.

**Items already on the list are not touched.** If the report shows one with the wrong count or the
wrong grade — the **Quantity** and **Grade** buckets — the run leaves it exactly as it is, and you
correct it on Colnect yourself. That is not caution for its own sake: there is no way to ask Colnect
what an entry currently holds without overwriting it, so a run that tried would be guessing at the
one thing it must not guess about.

Before this, an addition landed at whatever the list's own defaults are — usually `1` and `MNH` —
whatever the report said. That was the bug, and it is why an entry the Assistant creates is now
corrected while one it finds is left alone: on a new entry there is nothing to preserve, so saying
nothing is not the same as leaving it be.

Two things this cannot do, and does not pretend to:

- **Colnect does not document any of this.** The Assistant is doing exactly what your click on the
  list checkbox does, but Colnect never promised those requests would keep working. If they change,
  the run stops and tells you — it never guesses — and everything else here carries on unaffected.
  You can always fix a row by hand from the report, which is what the whole screen did before.
- It changes no note, and it changes nothing at all about an entry that was already on the list.
  Those stay yours.
