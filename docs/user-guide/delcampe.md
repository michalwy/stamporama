# Delcampe

Delcampe is a platform you **sell** on, and Stamporama prepares its listings the way it prepares
every other platform's: the title and description come from that platform contact's
[templates](offers.md#listing-title), the price and quantity from the offer, the photos from its
photo plan. What is different is how a listing gets there — Delcampe takes an uploaded file rather
than a form filled in by the browser extension.

Everything on this page lives under **Settings → Delcampe**.

## Which platform is Delcampe

The first setting on the tab, and the one everything else hangs off. Pick the contact you use for
Delcampe — it needs the **Platform** role (see [Contacts](contacts.md)) — and its currency, listing
templates and photo limits are set on the contact itself, exactly as for any other platform.

Only one platform can be Delcampe at a time. Naming it does **not** switch the
[Assistant](assistant.md) on: there is no Delcampe form for the extension to fill, so no
⚡ *List via Assistant* button appears on those offers, and none of the Colnect checks (a catalog
item-ID on every stamp, a mapped grade) is asked of them.

## Listing profiles

An upload row states a few things no offer knows about itself:

- **the shipping model** it is sent under,
- **how long and how often** the listing renews itself,
- which of Delcampe's **paid promotions** it buys,
- the **minimum bid step** it declares.

A **listing profile** is one answer to all four at once. One profile is the platform's *default* —
what every listing goes up with — and an offer can name a different one. That is what the second
profile is for: the standard letter for most lots, something heavier and tracked for the rest.

### The shipping model is a name, and it has to be exact

Delcampe's upload file names your shipping model **by its name**, and Stamporama cannot read your
list of models from Delcampe (that needs their paid API subscription, which this app does not use).

So type it exactly as it reads on Delcampe. If you rename a model there, uploads using that profile
will be **rejected by Delcampe** until you update the name here — there is nothing Stamporama could
have warned you about beforehand, and the rejection is not a fault in the file.

### Renewal

The defaults are shop-stock behaviour: the listing runs for **28 days** and renews up to **99
times**, which in practice means it stays up until it sells. *Re-buy the paid options on every
renewal* only means anything while one of the promotions is on — each renewal is charged again.

Auction-style listings need a real end date instead, and are not configured here yet.

### Paid promotions

Bold title, background colour, border colour, promoted in lists, promoted on the home page. Each of
these **costs money on Delcampe**, and the upload file states a yes or a no for every one of them,
so they are set here rather than decided for you. All five are off unless you turn them on.

### Minimum bid step

Delcampe's listings declare a bid step that changes with the price — 0.01 on cheap items, 0.10 on
dearer ones. Where exactly it changes was never confirmed, so it is a setting rather than something
buried in the code: a **threshold price**, the step used **below** it, and the step used **at or
above** it. A listing priced exactly at the threshold takes the larger step.

The line under the fields reads the rule back to you in the form it will be applied. If you ever see
a Delcampe listing state a different step, correct the threshold here.

## Categories

Every upload row needs a **category number**, and it is not a setting: it is about the stamp.
Delcampe files a 1935 Polish used definitive somewhere quite different from a post-war one, and its
souvenir sheets somewhere else again.

So nothing is filled in up front. **Finishing an offer teaches it.** When you move an offer to
*Ready*, Stamporama remembers the category you uploaded for that stamp's area, year, condition and
subtype — and the next offer of that kind opens with the category already there.

A near miss is widened rather than refused: the same area and condition in another year first, then
another subtype, then one level up your area tree. The **condition is never widened**, because
Delcampe puts used and unused stamps in different categories by construction. Whatever it matched on
is stated on the offer, so a filled-in category is never a number you cannot account for.

The first offer of a kind has nothing to learn from, and that is the only time you pick one.

### Picking a category

The picker shows **Delcampe's own category tree** — Europe → Poland → 1944-…. Republic → 1961-70 →
Used stamps — so you can walk to where your stamps live. Opening it on an offer that already has a
category takes you straight to it.

Or search: `poland used 1961`. Every word has to appear somewhere in the category's path, in any
order, and the tree narrows around the matches rather than turning into a flat list — so you still
see where each one sits. A number typed in the same box works too.

The greyed-out rows are **places in Delcampe's tree, not categories** — `Europe`, `Poland` — and
cannot be chosen; open them and pick something underneath. A few rows are both: `Occupations` is a
category in its own right *and* has categories under it.

The list you are searching is **Delcampe's own**, read from the page Delcampe publishes it on.
Delcampe has no interface for this that Stamporama can use, so the list is fetched once a day and
kept locally. Settings → Delcampe says how many categories it holds and when it last read them, and
has a button to read them again — worth pressing when you have just set the instance up, since until
the first read there is nothing to search.

A **number you type is always accepted**, whether or not it is in that list. Delcampe's own selling
form is the authority; a category created since the last read still works.

### Correcting one

Two places, for two different mistakes.

On the offer: **Change category** picks a different one for this offer only, and **Match again**
throws that away and asks the register what it says now. Use the first when this particular lot is
the exception — a souvenir sheet among singles is exactly that.

Under Settings → Delcampe: the **Categories** panel lists what has been learned, and a row can be
pointed at a different category or forgotten. Use this when the *rule* is wrong rather than the one
offer. A re-pointed row starts its count again, since the new category is one nothing has been
uploaded into yet.

Rows already uploaded are never touched by either — Delcampe holds a listing's category from the
moment the file went up.

## Uploading a batch

Delcampe listings are created by uploading a file, and Stamporama builds it. On the
[Bulk listing](offers.md#bulk-listing--posting-a-prepared-batch) screen, with Delcampe picked as the
platform, **↓ Easy Uploader bundle** downloads one ZIP holding:

- `delcampe-upload.csv` — one row per offer shown, and
- every picture those rows name, loose in the same archive.

Unzip it, then hand Easy Uploader the CSV with the pictures beside it. Nothing has to be renamed or
rearranged: the `images` column names exactly the files that came out of the archive, in the same
order the offer's [photo plan](offers.md#generating-the-photos) puts them in.

The batch is **whatever the screen is showing** — the area and year filters on the left are how you
cut a session down, and the button exports that, not the whole platform.

Each row carries the offer's title and description, its price and quantity, the category on its
**On Delcampe** card, and the shipping model, renewal and promotion settings of the profile that
applies to it. `personal_reference` carries the offer's own [short address](offers.md#offer-number-and-short-link)
— only you can see it on Delcampe, and it is what will let Stamporama match the listing back to this
offer later.

### Nothing is exported until every row can be written

If an offer in the batch cannot be turned into a row, **no file is produced** and the screen lists
what is wrong, one line per offer, linking to it. The usual reasons: no category yet, no photos
generated, no listing profile, a title over the platform's cap, or an auction — auction uploads are
not written yet.

That is on purpose. The file goes up once, and a row quietly missing from it is a listing that never
happened, sitting among the offers waiting for the next batch, looking exactly like them. Fixing the
list and exporting again is one pass.

Nothing is ever shortened to fit, either. A title over the cap is refused, not trimmed — a shortened
title is one nobody proofread.

### The title cap

Delcampe refuses a title past a certain length. Type that length into **Max title (characters)** on
the Delcampe platform contact (see [Contacts](contacts.md#listing-text-limits)), and from then on a
counter appears wherever a title is written, and the export refuses an over-long one before building
anything.

Leave it blank if you do not know the number; nothing checks it until you do.

### How many listings you may have running

Delcampe caps how many sales you can have running at once, and the cap depends on the subscription
you hold. **Stamporama does not check it** and cannot: it never sees your Delcampe account, only the
offers here — listings end, sell and relist on Delcampe without this app hearing about it, so any
number it produced would be its own guess wearing the badge of a real limit.

Keeping a batch inside your package is yours to judge before you upload.

## On an offer

An offer on the Delcampe platform carries an **On Delcampe** card on its own screen, under the
photos. It shows two things: the **category** the row will be filed under, with where that category
came from, and which **profile** applies — the platform's default, or one this offer names — with
what that profile actually says: the shipping model, the renewal setting, the bid step, and whether
any paid promotion is bought.

Neither is a gate. Whatever the card shows is what the upload file will carry, and both are
correctable in place.

Changing the profile here affects this offer only. Editing a *profile* under Settings affects every
future upload that uses it and nothing already listed: Delcampe holds a listing's settings from the
moment the file went up.

## Deleting a profile

Nothing blocks it. Offers that named it fall back to the platform's default, and Stamporama tells
you how many did. If you delete the **default**, the platform is left without one — no other profile
is promoted in its place, because which settings your next upload carries is your decision.
