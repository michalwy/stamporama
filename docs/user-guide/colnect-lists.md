# Colnect lists

Colnect keeps lists of its own — **Collection**, **Swap**, **Wish** and **Sell** — and they are what
another collector reads before offering you anything. Keeping one in step with what you actually
hold is a loop, because Colnect offers no way to push data into it: **export the list, load the file
here, look at what differs, fix whichever side is wrong.** The **Colnect** screen in the sidebar is
where the middle two happen.

Which of your own things each list stands for, and which side wins when the two disagree, is set up
first under [Settings → Colnect → Colnect list sync](collections.md#colnect-list-sync). A list you
have not switched on does not appear here.

## Loading an export

On Colnect, open the list and press **Export list**; Colnect mails you a CSV or offers it for
download. Back here, press **Load an export** and pick the file.

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
search on its first catalog number where it is not.

The row's **⋮** menu offers two ways to put a row away, and the difference between them matters:

- **Mark done on Colnect** — *I have already fixed this over there.* Nothing here can talk to
  Colnect, so this is a claim rather than a fact, and it holds only until the next import. If the
  row comes back in the next export, it was not actually done, and the report says so.
- **Ignore** — *this difference is fine and always will be.* A judgement about your collection, so
  it survives every future import. You can add a note saying why.

Tick **Include put away** to see both again, and undo either from the same menu.

The header says which file the Colnect side came from and when Colnect made it, because a report
read against a three-week-old export is a different thing from one read against this morning's.
