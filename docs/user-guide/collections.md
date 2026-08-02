# Collections

A **collection** is the top-level organizing unit in Stamporama. All your stamps, catalog entries, and related data live inside a collection. You can own multiple collections — one for each theme, country, or whatever grouping makes sense for you.

## Creating a collection

1. Sign in and open the **Your Collections** page at `/collections`.
2. Click **New collection**.
3. Enter a name (up to 100 characters).
4. Select a **base currency** (EUR, USD, GBP, PLN, CHF, CZK, DKK, SEK, or NOK). This is the currency used for all reports, valuations, and price summaries. It cannot be changed after creation.
5. Click **Create collection**.

Stamporama generates a URL-friendly slug from the name automatically (e.g. "Polish Definitive Stamps" becomes `polish-definitive-stamps`). If you already have a collection with the same slug, a numeric suffix is added (`-2`, `-3`, …).

After creation, you are taken directly to the new collection.

## Viewing your collections

The **Your Collections** page lists all collections you own, sorted by creation date. Click any collection name to open it.

## Navigating inside a collection

Once inside a collection at `/c/[slug]`, the left sidebar shows:

- The collection name, at the top, with the [Action items](action-items.md) bell beside it
- Navigation links for each section (Overview, Catalog, Items — more sections will be added as features are built)
- An **All collections** link in the footer, to return to the collection picker. There is no
  quick-switch dropdown: changing collection is a rare enough act that it does not need a permanent
  control in the sidebar's most prominent row
- The running app version, shown in muted text at the bottom of the sidebar (also listed under **Settings → General**)

## Filtering the Issues, Stamps, and Copies lists

The **Issues**, **Stamps**, and **Copies** (inventory) lists share the same three-column layout:

- **Area tree** (left) — filter to an area and its sub-areas. Nodes with children can be collapsed or expanded, and the whole column can be hidden/shown with the **◂** / **▸** toggle in its header; both are remembered between visits.
- **Year filter** (middle) — the years present in the current results, each with a count of how many items fall in that year. Click a year to narrow the list to it, or click it again (or **All years**) to clear. Items with no year appear under a **No year** entry. On the issue list the year comes from the issue's year; on the stamp and copies lists it comes from each stamp's own issue year. The counts update as you change the area filter, search, or the other filters. Use the **◂** / **▸** toggle in the panel header to hide or show this column — the choice is remembered between visits.
- **List** (right) — the issues, stamps, or copies themselves, with the toolbar for search, sort, and the list-specific filters above it.

Each issue also carries its own **number** (`#12`), shown at the start of its chip row. It is the
collection's own sequential number for the issue — never reused — and typing `iss 12` in the
sidebar's **Jump to…** box goes straight to it ([Quick jump](quick-jump.md)).

On the **Issues** list, the toolbar's search box matches the issue's own number (`12` or `#12`), the issue name, the name of any stamp in it, and catalog numbers — both the issue's own range numbers and its stamps'. Catalog numbers may be typed the way they are printed, with the catalog abbreviation and country prefix and in any spacing: `Mi PL 200`, `MiPL200`, `PL200`, and `200` all find the same issue, and `Fi BL31` finds a Fischer block. Leading a search with a catalog abbreviation narrows the catalog-number part of the match to that catalog. This is the same reading of a catalog number as the dedicated **catalog number** filter next to it, which searches catalog numbers only.

All filtering and sorting happens on the server, and the active area, year, search, and sort are kept in the page URL so a view can be bookmarked or shared. Whatever sort you pick (name, year, issue date, …), items that share the same sort value are then ordered by their **primary catalog number**, so a run of same-year issues still reads in catalog order rather than an arbitrary one. The **area** and **year** selections are also remembered per collection and shared across these three lists: pick an area and year on one list and they carry over when you switch to another, and they are restored when you come back after visiting an unrelated page. The **catalog** chosen in the catalog-number filter is likewise remembered per collection and shared between the Issues and Stamps lists, so your preferred catalog stays selected across reloads. Other filters (search, catalog number, sort, and the copies-only filters) stay per list. When you add an issue while a year is selected, the new issue's year is pre-filled to match.

## Copies held, on the catalog lists

Wherever a stamp is listed — the **Issues** list stamp tree, the **Stamps** list, and the stamp
pickers — a green **“2 copies”** badge sits beside its catalog numbers when you hold copies of it,
so you can see what you already own without opening anything. Hover it for the breakdown:
*2 copies held · 1 in collection · 1 for sale*. The disposition figures are markers, not slices —
one copy can be both in the collection and for sale — so they are listed rather than added up.

Three rules worth knowing:

- **A stamp you own none of shows no badge.** Most of a catalog is stamps you do not have yet, so a
  “0” on every row would be pure noise. The badge only ever means *you have some*.
- **The count is that stamp's own copies.** A copy filed under a variant belongs to the variant's
  badge, not its parent's — in the issue tree the child's badge is right underneath, so counting it
  twice would be misleading.
- **Sold copies are not counted**, matching the **View copies** popup the badge sits beside: what
  the badge says and what the popup lists are always the same set. Neither are copies you no longer
  hold — marked [no longer held](inventory.md#copies-you-no-longer-hold), or *Not delivered /
  missing* or *Damaged* — since the badge answers *how many of this do I have*. Copies still on
  their way to you *are* counted — they are bought and yours; see
  [Delivery state](inventory.md#delivery-state).

To see the copies themselves, use **View copies** in the row's **⋮** menu.

## Row actions

Every list row across the app — stamps, issues, inventory copies, areas, catalog vendors and names, conditions, certificate statuses, and subtypes — keeps its actions behind a single **⋮** button at the right of the row. Click it to open a menu of that row's actions (for example **Edit**, **Add copy**, **View copies**, **Show catalog prices**), with the destructive **Delete** set apart in red at the bottom. Section-level buttons such as **+ Add area** or **+ Add condition** stay in place above their lists.

A few of the most-repeated actions are also reachable **without opening the menu**: small icon buttons sit just left of the **⋮**, dimmed until you hover the row, which brings them up to full strength. They are always there — so you can aim straight at the one you want — and they are shortcuts only — every one of them is still in the menu, which stays the complete list of what the row can do. On the **Issues** list these are:

- an issue row — **✎** Edit, **＋** Add stamp, **⧉** Add copy
- a stamp row inside the tree — **✎** Edit, **＋** Add child stamp, **⧉** Add copy

Hovering tells you what each one is. They are skipped by **Tab**, which keeps one keyboard stop per row: the **⋮** menu, where the same actions live.

## Default language

**Settings → General** carries a **Default language** — the language the names and title names you
type into Stamporama are written in. It starts as **English** and only matters once you list on
platforms writing in another language: a platform set to your default language needs no translations
at all, so it never adds fields anywhere. See
[Contacts → Listing language](contacts.md#adding-and-editing) for how translations work.

Changing it later does not rewrite anything — your existing text stays exactly as typed; you are only
telling Stamporama what language that text is in.

## Organizing collecting areas

Areas are managed in **Settings → Areas**, where they form a tree: an area can have sub-areas nested underneath it. Two options control how that tree behaves.

### Grouping-only areas

Some areas exist only to organize the ones inside them — for example a **Europe** node that groups individual countries but never holds issues of its own. In the **Add area** / **Edit area** dialog, the **Can hold issues** checkbox controls this:

- **Leave it checked** (the default) for a normal area that holds issues and stamps.
- **Uncheck** it for a grouping-only area. Grouping-only areas are shown with a **Grouping** badge in the area list, and they cannot be picked as the area for an issue — in the **Add issue** and **Move to another area** dialogs they appear for context but are not selectable; you choose one of the real areas nested inside them instead. Catalog settings (primary catalog, number prefixes) still pass down to their children as before.

You cannot mark an area as grouping-only while issues or stamps are still assigned directly to it — move those into a child area first.

### Custom order

Within each level of the tree, areas can be arranged in whatever order you like instead of alphabetically. Grab the **⠿** handle at the left of an area row and drag it up or down to reposition it among its siblings; the new order is saved immediately and is used everywhere the area tree appears (filters, pickers, and the management list). Reordering only moves an area among the siblings under the same parent — to move it under a different parent, use **Edit** and change its parent area. New areas are added at the end of their group.

## Moving an issue to another area

An issue can be moved to a different collecting area after it is created. Open the issue's **⋮** menu on the **Issues** list and choose **Move to another area…**, then pick the target area from the tree and click **Move**. The issue's whole **stamp tree moves with it** — its stamps are re-tagged to the new area (a stamp that also belongs to another issue still in the old area keeps its place there too). Grouping-only areas are shown but can't be chosen as the destination.

Catalog numbers are never lost in a move: catalogs belong to the collection, not to a single area. If the area you pick does not list one of the catalogs the issue uses, the dialog shows a short warning naming those catalogs — the move is still allowed, and the numbers stay attached. To have the new area display them, add the missing catalog(s) to that area in **Settings → Areas**.

## Overriding an issue's catalog prefix

Catalog numbers are stored bare (`200`) and shown with the prefix your **area** sets for that catalog (`Mi·PL 200`), inherited down the area tree from **Settings → Areas**. Some issues legitimately number under a different prefix than the area they sit in — a special or commemorative sub-catalog that does not follow the country's ordinary numbering.

The **Add issue** and **Edit issue** dialogs therefore give every catalog a small **prefix** box, in front of its **First** / **Last** range — which is exactly where the prefix appears when the number is printed. Its placeholder shows the prefix the area supplies, so leaving it **blank means "use the area's"**, which is what every ordinary issue does. Type something into it and that issue's stamps carry it instead, for that one catalog: enter `SP` on the Michel row and its stamps read `Mi·SP 200` while the rest of the area keeps `Mi·PL`. Each catalog is overridden separately; the ones you leave blank are unaffected.

The override is the number's real identity, not a display trick, so it follows everywhere the number goes: the catalog chips on the **Issues**, **Stamps** and **Copies** lists, the stamp picker (including its search — `Mi SP 200`, `SP200` and `200` all find the stamp), generated listing titles and descriptions, derived offer-set and auction-lot names, the packing list, [duplicate detection](duplicate-catalog-numbers.md), and Colnect matching. Two stamps numbered `200` under different prefixes are two different catalog numbers, so they no longer collide.

Clearing the box hands the issue back to its area's prefix. Moving an issue to another area **keeps** its override — an explicit choice is not undone by a move.

## Generating an issue's stamps from its catalog range

Most issues are a run of consecutively numbered stamps, so the **Add issue** dialog can create them for you from the numbers you type. Each catalog row under **Catalog numbers** has one field for them and its own **Assign to stamps** box, and a ticked box means "generate this issue's stamps from this catalog's numbers". There is no separate switch to turn the feature on: the ticks *are* the decision, and nothing ticked means the issue is created empty, ready for stamps added by hand.

### Writing the numbers

Type the numbers the way the catalog prints them: a range with a dash, several ranges separated by commas.

| You type | Stamps created | Series range recorded |
| --- | --- | --- |
| `2820-2822` | `2820`, `2821`, `2822` | 2820–2822 |
| `2823a, 2823b` | `2823a`, `2823b` | 2823 |
| `2895A-2897A, 2895B-2897B` | `2895A`, `2896A`, `2897A`, `2895B`, `2896B`, `2897B` | 2895–2897 |
| `3025-3027, BL48` | `3025`, `3026`, `3027`, `BL48` | 3025–3027 |

The third row is the case a single range cannot express: one series printed in two variants, six stamps in all. The fourth is a series issued with a souvenir block. Stamps are created **in the order you typed them**.

The **series range** the issue records is worked out for you, and is deliberately not the same thing as the stamps: **suffixes are dropped and the prefix is kept**, from the lowest number to the highest. That is the range you see on the issue row and search by, while the stamps keep their full numbers. A line under the field shows both, so you can check what you are about to create before you save.

A range can only ever be *one* numbering, so when you mix them — an ordinary run plus a block — the range follows the **ordinary numbering** and the block still becomes a stamp; it just doesn't stretch the range. It is the same rule the app uses when it [notices an issue's stamps have outgrown its range](#keeping-an-issues-catalog-range-in-step-with-its-stamps). A catalog whose numbers are *only* blocks records a block range (`BL48-BL50`).

Each range may be plain numbers, share a prefix, use a letter or roman suffix sequence, or be Roman numerals in its own right (`100`, `BL120-BL123`, `423a-423c`, `12I-12II`, `I-VIII`). No number may appear twice, and at most 50 stamps can be created at once.

### The ticks

The boxes tick themselves as you type, so ordinarily you only read them:

- The **primary** catalog's box ticks as soon as what you have entered can generate stamps at all — a single number (`200`) counts. It unticks again if you clear or break what you typed, or go past the 50-stamp limit.
- Every **other** catalog ticks once the primary is ticked and its own numbers come to the same count, since stamps are matched across catalogs by position. A catalog whose numbering doesn't line up one-to-one stays unticked and simply contributes no numbers; fill those in later on the stamps themselves.

Tick or untick a box yourself and that catalog is left alone from then on — further typing will not tick it back. Use it to leave a catalog out of an otherwise matching set, or to create the issue with no stamps at all despite a complete set of numbers.

If a generated number would duplicate one already in the collection, a warning appears in that catalog's field — see [Duplicate catalog numbers](duplicate-catalog-numbers.md). You can also [add more numbers later](#adding-a-stamp-range-to-an-existing-issue).

## Auto-filling a secondary catalog's range when creating an issue

When the primary catalog spans a run of stamps — say Fischer `100-103` — entering just a **single number** for another catalog completes it to the same span when you leave the field: type Michel `200` and it becomes `200-203`, four stamps matching Fischer. It only ever fires on a lone number, so a list of ranges you composed yourself is never rewritten, and you can overwrite the result whenever a catalog's numbering doesn't line up one-to-one.

## Adding a stamp range to an existing issue

You can bulk-add stamps to an issue after it was created, the same way they are generated when you first create one. Open the issue's **⋮** menu on the **Issues** list and choose **Add stamp range…**. Tick the catalog(s) you want and enter the numbers for each in [the same notation](#writing-the-numbers) the create dialog uses (`100-105`, or `2895A-2897A, 2895B-2897B`); the dialog shows how many stamps will be created, with a short preview. Entering a lone number for a secondary catalog completes it to the primary's span, exactly as on the create form. When more than one catalog is selected, each must come to the same number of stamps, since they are matched by position. Click **Add stamps** and the new stamps join the issue as additional root nodes, alongside anything already there.

If a generated catalog number would duplicate one already in the collection, the dialog surfaces a warning naming the collisions. In a collection set to **block** duplicates (see [Duplicate catalog numbers](duplicate-catalog-numbers.md)) this prevents the add until you resolve it; in a collection set to **warn**, it is advisory and you can add anyway.

If the added stamps fall **outside the issue's declared catalog range**, a follow-up prompt appears right away showing the proposed widened range (for example, `Mi 100–105 → 100–110`) and asks you to choose **Widen range** or **Keep as-is** — the same decision offered when adding a single stamp. Keeping it as-is leaves the range warning on the issue row, which you can act on later.

To add a **single** stamp instead, expand an issue row on the **Issues** list (the **▶** toggle) and click the **+ Add stamp** button pinned at the bottom of its stamp tree — the same action as **Add stamp** in the issue's **⋮** menu, opening the Add stamp dialog with the issue already filled in. (An empty issue shows an **Add one** link in the same place.)

To nest a stamp **under an existing one**, use **Add child stamp** in that stamp's **⋮** menu. The dialog starts from the parent: its catalog numbers are copied in as a starting point, and the **Year** is pre-filled from the **parent stamp's own year** rather than the issue's — a variant or reprint is usually dated from the node it hangs under. (A root-level stamp still starts from the issue's year.) After you save, the parent node **opens by itself** so the new child is visible instead of hiding behind a collapsed arrow.

### Issue and stamp names in other languages

The **Add issue** / **Edit issue** and **Add stamp** / **Edit stamp** dialogs each grow a 🌐 button beside their **Name** field, on the same terms as everything else translatable: only once a platform lists in a language other than your collection's [default language](#default-language), one entry per language, blanks falling back to the name you typed, and everything written when you save the issue or stamp itself. They feed the `{issueName}` and `{name}` tokens in [listing titles](contacts.md#adding-and-editing).

Stamp names are the largest set of text to translate and every entry is typed by hand, so treat it as something you fill in for the stamps you actually list, not a job to finish up front — an untranslated stamp simply lists under its default name.

### Colnect ID

The **Add stamp** and **Edit stamp** dialogs include a **Colnect** field in the catalog-numbers section, filled in like any other number. It holds the stamp's [Colnect](https://colnect.com) Marketplace **item-ID** — the number in a catalog page's address (`…/stamps/stamp/123456-…`). It is an external reference, not a catalog number, so it has no vendor prefix and is not checked for duplicates; leave it blank if you don't use Colnect. When a stamp has one, a small dashed **Colnect** tag, with an open-in-new-tab icon, appears next to the stamp's catalog numbers — on the **Stamps** list, on the stamps inside an issue on the **Issues** list, on the copy rows in **Inventory**, and on the lines of an auction sale's lots. Click it to open that stamp's page on colnect.com in a new tab; hover it to see the recorded item-ID. The ID itself is not printed on the row, so it doesn't crowd out the catalog numbers.

When a stamp has **no** item-ID yet, the same tag appears with a **magnifying-glass** icon instead of the open-in-new-tab arrow: there is no page to open, so it runs a **search** on colnect.com for the stamp's catalog number instead. What it searches for is exactly what [clicking the catalog chip copies](inventory.md#copying-a-catalog-number) — the area prefix and the number, without your catalog's abbreviation (`PL 3690`), since Colnect knows country codes but not your abbreviations. Hover it to see the query. It is the quickest way to find the item and record its ID, after which the tag turns back into the ordinary catalog link. A stamp with no catalog number at all has nothing to search by, so no tag appears.

## Colnect platform

**Settings → Colnect** starts by asking which of your [platforms](contacts.md) *is* Colnect. Pick it
from the list — every contact carrying the **Platform** role is offered — and the choice saves on the
spot. Only one platform can be Colnect, so picking a different one moves the marker rather than
adding a second.

Naming it is what turns on the [listing checks](offers.md#what-the-assistant-cant-post) in the bulk
listing workspace: offers headed for that platform are tested against what Colnect's sale form needs
— an item-ID on every stamp, a grade for every condition, and sets that are interchangeable — before
you hand one to the Assistant. Leave it **— not set —** and nothing is checked anywhere; every
platform is listed by hand, exactly as before. It changes nothing else: templates, limits, photos,
pricing and publishing all work the same either way.

The two mappings below only ever matter for that platform, which is why they sit under it.

## Colnect catalog mapping

Colnect catalog pages list numbers under Colnect's own catalog abbreviations (`Mi`, `Sn`, `Yt`, `Sg`, `AFA`, `Pol`…), which don't all match yours — notably Colnect's `Pol` is **Fischer**, which you may abbreviate `Fi`. **Settings → Colnect** lets you record, per collection, which local catalog each Colnect abbreviation means.

You only need a row where the abbreviations **differ**. Any Colnect abbreviation without a row automatically maps to a local catalog whose abbreviation is spelled the **same** (case-insensitive) — so `Mi` → your Michel needs no row. Anything still unmatched is simply **ignored**, never an error. Each row is a Colnect abbreviation plus the local catalog it points to; an abbreviation can be mapped only once per collection. (This mapping is preparation for future Colnect number-matching; on its own it changes nothing about your stamps.)

## Colnect condition mapping

Your [conditions](#stamp-conditions) are your own — the names, abbreviations and order you chose. Colnect's sale form instead offers a **fixed list of five grades**, the same under every item. Listing a copy there means translating between the two, so the same **Settings → Colnect** tab records it once, below the catalog mapping.

Every one of your conditions gets a row, with a picker holding Colnect's five grades:

| Colnect grade |
| --- |
| MNH - Mint Never Hinged |
| MH - Mint Hinged |
| MNG - Mint No Gum |
| U - Used |
| CTO - Cancelled To Order |

Pick the one each condition means; each change saves on the spot, so there is nothing to submit. Leave a condition on **— not mapped —** when you never list it on Colnect — a First Day Cover has no grade there, and that is a legitimate blank rather than a mistake. Unlike the catalog mapping there is **no automatic fallback**: nothing is guessed from a name or an abbreviation, because a wrong grade on a listing you publish is worse than one you fill in yourself. A copy whose condition is unmapped simply cannot be listed on Colnect, and the [bulk listing workspace says so](offers.md#what-the-assistant-cant-post) before you start filling a form.

## Connecting the browser extension

The **Stamporama Assistant** browser extension matches marketplace catalog pages against your stamps. **Settings → Assistant** connects it, and there is nothing to type: click **Connect Stamporama Assistant**, then — with that page still in front — click the Assistant icon in your browser toolbar. The page hands the extension this instance's address, this collection, and a one-time code; the extension trades the code for its own access token and reports back on the page. Because the page is served *by* the instance, the address is always right, which is also how your test server and your everyday one stay apart without you having to remember which is which.

The one-time code lives for about five minutes and works once. If you wait too long, or want a fresh one, click **Start again**. Connecting the same instance and collection again refreshes that extension profile in place with a new token — that is how you recover from a token you revoked or lost, and it keeps whatever you named the profile.

### Assistant tokens

### Filling in catalog numbers from Colnect

A Colnect page usually lists more catalogs than you keep numbers for. When an item is matched to one of your stamps, the Assistant can **fill in the catalogs your stamp has no number for** — the **Fill missing catalog numbers** switch in the Assistant window (and in its Options), on by default.

- Only **missing** catalogs are filled. A number you already have is **never** overwritten or changed.
- Where Colnect prints a **different** number for a catalog you already have, it is only **reported** — shown against the stamp, never written.
- The **country prefix is stripped** on the way in, because your area already supplies it: Colnect's `Mi: PL 3690` is stored as `3690` under an area whose Michel prefix is `PL`. When the prefix Colnect prints is **not** the one your area sets — or your area sets none for that catalog — the number is **skipped and reported** rather than stored with a country code inside it. Numbers with no prefix at all (`BL132`, `3706-3711`, `ATM2.2x`) are stored exactly as printed.
- A fill that would create a [duplicate catalog number](duplicate-catalog-numbers.md) follows your collection's setting: **blocked** and reported under *Block*, added with a warning naming the other stamp under *Warn*.

Everything is shown before anything is written: proposed additions appear as dashed `+ Sn·PL 3382` chips under the stamp, and anything deliberately not added is listed with its reason. Nothing is written until you press **Write** (or **Use this** on a stamp you picked). Stamps that were **already linked** to that Colnect item are filled too, so revisiting a page you matched months ago picks up catalogs Colnect has added since.

### Assistant tokens

The same screen lists every connection as a **token**, whether it came from registering or was generated by hand. Revoking one stops that extension immediately. You only need **Generate token by hand** for something that cannot register itself — a script, or a browser without the extension — in which case copy the **Collection ID** shown above the list and the token into the extension's options; the token is shown **only once**, so if you lose it, revoke it and generate a new one. In the extension, a token belongs to a **profile**: one Stamporama instance plus one collection. If you run more than one instance, or match against more than one collection, connect once per combination and switch between them — the extension only ever talks to the **active** profile, and names it, in its own colour, above every match it is about to write. A token grants write access to this collection's Colnect matching, so treat it like a password; revoke any you no longer use.

## Merging two issues

Two issues in the same area can be merged into one — useful when the same set was entered twice or a split turned out to be unnecessary. Open the **⋮** menu of the issue you want to **remove** and choose **Merge into another issue…**, then pick the target issue to keep. The dialog reports how many stamps will move and warns if any catalog number appears in both issues (advisory only — the merge is still allowed).

On **Merge**, every stamp under the source issue — including its nested children, whose tree structure is preserved — is reassigned to the target as root nodes, and the now-empty source issue is deleted. Inventory copies are unaffected: they reference the stamp, which now belongs to the target. **This cannot be undone**, so the confirmation names the source issue that will be deleted.

If the merged-in stamps push the target issue's **declared catalog range** beyond its bounds, the same **Widen range / Keep as-is** prompt appears immediately after the merge, so you can decide whether to extend the target's declared range to cover them.

## Duplicate issue names

When you type a name in the **Add issue** dialog, Stamporama checks whether an issue with that same name already exists **in the selected area** (the check ignores case and surrounding spaces). If one does, a small **⚠ warning icon** appears inside the name field; hover it to see a tooltip naming the existing issue(s) and their year. The warning never blocks you — the same name can legitimately repeat, so you can create the issue anyway if the duplicate is intentional. The check is per area only: the same name in a different area (for example, the same series name across two countries) is not flagged.

## Keeping an issue's catalog range in step with its stamps

An issue can declare a **catalog number range** per catalog (a **First** and optional **Last**, e.g. `100`–`105`). Stamporama checks whether the issue's **required-for-completeness** stamps still fit inside that declared range and flags it when one **extends beyond** it. Only required stamps count — optional extras such as blocks or varieties never widen the range.

**When you add a stamp** that is required for completeness and whose catalog number falls outside the issue's declared range, the **Add stamp** dialog shows the proposed widened range (for example, `Mi 100–105 → 100–106`) and asks you to choose before saving:

- **Widen the issue's declared range to cover this stamp** — the range is updated as part of adding the stamp.
- **Keep this stamp outside the declared range** — the stamp is added and the range is left as-is.

You cannot save the stamp until you pick one, so the decision is never made for you.

**On an existing issue**, the same situation is surfaced after the fact:

- The affected **catalog-number chip** on the **Issues** list turns to a warning colour. Hover it to see the widened range being proposed.
- The issue's **⋮** menu always offers **Recompute declared range…**, which re-runs the check against every stamp currently attached to the issue. The dialog lists each affected catalog as *current → proposed* and lets you **edit the proposed First/Last by hand** before committing; nothing is written until you press **Apply range**. When every declared range already covers its required stamps, the dialog says so and there is nothing to apply.
- You can also do it from the **Edit issue** dialog: the same suggestion appears under **Catalog numbers** with an **Apply** button that fills in the widened First/Last; save the issue to keep it.

The check only ever suggests **widening** a range, never narrowing it — a range that is broader than the required stamps you have entered so far is normal while an issue is still being filled in, so it is never flagged. Comparison stays within the **same numbering family** as the range: for a plain numeric range like `100–105`, a block (`BL12`) or sheetlet (`Ark. 103`) that belongs to the same issue is a different family and is left alone, whereas a range written as `BL17–BL18` **is** extended by `BL19`.

The **basic numbering takes precedence**. If a range was declared in a special numbering — for example a block range `BL1–BL3` — and a required stamp with the basic numbering (a plain number like `200`) is added, the series **adopts the basic numbering**: the proposal replaces the block range with the basic one (`BL1–BL3 → 200`) rather than extending it.

## Required for completeness

Each stamp carries a **Required for completeness** flag that controls whether it counts toward its issue's required-stamps total. The flag can be set when adding a stamp and changed later from the stamp's **Edit** dialog — toggle the **Required for completeness** checkbox and save.

## Stamp conditions

Each collection keeps its own list of **conditions** — the grades used when valuing stamps (for example Mint Never Hinged, Mint Hinged, Used, or Cancelled to Order). Manage them from **Settings → Conditions**.

- Every new collection starts with a default set: **MNH**, **MH**, **MNG**, **U**, **CTO**, and **FDC**. These are ordinary conditions — rename, reorder, or delete any of them.
- **Add** a condition with a full name (e.g. "Mint Never Hinged") and a short abbreviation (e.g. "MNH").
- **Reorder** conditions by dragging rows; the order controls how conditions are listed elsewhere in the app.
- **Delete** a condition you no longer need. A condition that is already used by catalog prices cannot be deleted — remove those prices first.

Certificate and guarantee status is tracked as a separate dimension, not as part of condition — see below. Both lists live on the same **Settings → Conditions** tab.

### Conditions in other languages

Once a platform lists in a language other than your collection's [default language](#default-language), the **Name** and **Abbreviation** fields each grow their own 🌐 button, and both are labelled with your default language (e.g. *Name — English (en)*). Click one to enter that **single** field per language — the two are kept apart on purpose, since abbreviations like `MNH` are often left exactly as they are while the full name is translated. Each button's small number counts the languages still missing **that** field, and a blank entry always falls back to the default text, so a title never ends up with a gap. The entries save together with the condition, so cancelling the condition dialog discards them too.

These feed the `{condition}` and `{conditionAbbr}` tokens in [listing titles](contacts.md#adding-and-editing).

## Certificate statuses

Each collection keeps its own list of **certificate statuses** — the certificate or guarantee status used when valuing stamps (for example Certificate or Guarantee). This is an independent dimension from condition, so a stamp's grade and its certificate status are recorded separately rather than combined. Manage them in the **Certificate statuses** section of the **Settings → Conditions** tab.

- Certificate status is **optional**: leaving no status selected means the stamp has none, so there is no "None" entry to manage. New collections start with an empty list — add the statuses you use.
- **Add** a status with a full name (e.g. "Certificate") and a short abbreviation (e.g. "Cert").
- **Reorder** statuses by dragging rows; the order controls how statuses are listed elsewhere in the app.
- **Delete** a status you no longer need. A status that is already used by catalog prices cannot be deleted — remove those prices first.

Certificate statuses translate exactly like [conditions](#conditions-in-other-languages) — a 🌐 button on each of **Name** and **Abbreviation**, feeding the `{certificate}` and `{certificateAbbr}` title tokens.

## Stamp subtypes

Stamps can be nested: a base stamp (for example catalog number **2**) can have child stamps under it. Those children come in two philatelic flavours, and the difference matters for how the base stamp is valued and counted:

- **Variants** — colour, perforation, paper or watermark differences (**2a**, **2b**). Here the base **2** legitimately stands for "I own this stamp but don't know which variant", so owning it without a precise variant is meaningful.
- **Distinct entries** — errors, plate flaws or overprints (**2 B1**). These are their own fully-identified collectibles, nested under **2** only for catalog adjacency; the base **2** stays a concrete stamp in its own right.

Each collection keeps its own list of **subtypes** that records this distinction. Manage them from **Settings → Subtypes**. Each subtype carries an **Acts as variant** switch — turn it **on** for variant-like categories and **off** for distinct entries.

- Every new collection starts with a default set: **Variant**, **Colour variety**, **Perforation variety**, **Paper variety**, **Watermark variety** and **Print variety** (acts as variant), plus **Error**, **Plate flaw** and **Overprint** (distinct entries). These are ordinary rows — rename, reorder, or delete any of them.
- **Add** a subtype with a name (e.g. "Colour variety") and choose whether it acts as a variant.
- **Select the default** with the radio button on the left of each row. Exactly one subtype is always the default; it is the one assigned to newly created child stamps. Choosing a new default clears the old one.
- **Toggle Acts as variant** directly on a row at any time.
- **Reorder** subtypes by dragging rows.
- **Delete** a subtype you no longer need. The current default cannot be deleted — pick another default first — and a subtype already assigned to stamps cannot be deleted either.

### Assigning a subtype to a child stamp

Subtypes attach to **child** stamps only (a stamp nested under a parent); top-level stamps are never classified. When you add or edit a child stamp, the form shows two extra fields:

- **Subtype** — which category this child is. New children start on the collection's default subtype; change it here.
- **Acts as variant** — a per-stamp override with three choices:
  - **Use subtype setting** (default) — follow whatever the chosen subtype says.
  - **Acts as variant** — force this child to count as a variant, whatever its subtype.
  - **Not a variant** — force this child to be a distinct entry, whatever its subtype.

Use the override for the odd child that does not follow its category — for example a single colour-variety row you want treated as a distinct entry. Left on **Use subtype setting**, the child simply inherits its subtype.

The **Subtype** dropdown remembers the last subtype you saved in this collection and starts there next time, so entering a run of plate flaws or colour varieties means picking the category once. If that subtype is later deleted, the dropdown falls back to the collection default.

### Where subtypes are shown

A stamp's subtype appears as a small grey tag beside its catalog numbers on the **Issues** list, the **Stamps** list, the **Copies** list, and in the stamp pickers — so you can tell an **Error** from an **Overprint** without opening either.

**The collection's default subtype is never shown.** Most child stamps are ordinary variants, and tagging every one of them "Variant" would be a column of noise. Only the non-default subtypes get a tag. If you would rather see a particular subtype called out everywhere, make a *different* subtype the default — whichever one carries the radio button is the one that stays silent.

### Subtypes in other languages

Subtypes translate exactly like [conditions](#conditions-in-other-languages) — a 🌐 button beside **Name**, filled in per listing language and saved together with the subtype. These feed the `{subtype}` token in listing titles, descriptions, and private notes, so a Polish listing reads "Nadruk" where an English one reads "Overprint". Leave a language blank to fall back to the name above.

The token follows the same rule as the tag: a stamp on the collection's **default** subtype renders `{subtype}` as empty, so ordinary variants do not pick up a redundant word in their listing title.

## Collage templates

Offer photos put several stamps on one image. How many fit sensibly is a property of **stamp size**, not of the platform: many small definitives sit comfortably where only a few large commemoratives do. Rather than setting those numbers by hand on every offer, keep them as named, reusable **collage templates** under **Settings → Collage templates**.

A template holds:

- **Grid** — how the two numbers below are read. **Fixed grid** fills every row to the number of columns you typed and leaves the last row as short as it needs to be. **Automatic** treats them as limits only and arranges each collage from however many stamps it actually holds: under a 3 × 3 template, four stamps come out 2 × 2 and five come out 3 + 2, instead of a full row with one stamp trailing under it. Pick automatic when your offers vary in size, which is most of them — it is what saves editing the template between listings. Templates you made before this existed are on the fixed grid.
- **Rows** and **Columns** (**Max rows** / **Max columns** on the automatic grid) — the collage's capacity. Their product is how many stamps go on one image in either grid.
- **Gap (% of stamp)** — the spacing between stamps, used between columns and rows alike and around the whole collage.
- **Label strip (% of image)** — the height of the strip drawn below each stamp for its labels, and with it the size of the label text. Takes tenths (`1.5`, or `1,5`), because the difference between a readable caption and one shouting over the stamps is well under a whole percent; **1–2%** is the usual range. Set it to **0** for no strip.
- **Background** — the canvas colour behind the stamps, which is also what the label strip is drawn on. A new template starts on **black**: a scan carries its own pale margins, so on a white canvas the stamps' edges dissolve into the background and the collage reads as stamps floating in nothing. Pick any colour you like — the label text flips between white and black on its own so the captions stay readable — and a template you already made keeps the colour it was made with.

Five things are worth knowing:

- **Both sizes are shares, not pixels.** You cannot know in advance how many pixels a scan will
  have, nor how far a platform's size limit will shrink the finished image — so a strip measured in
  pixels comes out unreadable on one listing and enormous on the next.
- **They are shares of different things, and deliberately so.** The gap is a share of the *stamp's*
  height, because spacing between stamps belongs to the stamps. The label strip is a share of the
  *finished image's* longest edge, because every photo of a listing is scaled to the same platform
  limit before it goes up — so a 1.5% strip writes a label of the same size on a full page of stamps,
  on a single stamp, and on a close-up of one perforation. Measured against the stamp instead, the
  close-up would carry a caption a third of the size of the one beside it.
- **The strip alone decides how big the label text is.** It is never sized to the words, so a stamp
  with a long catalog number does not get a smaller caption than the one next to it. Text with
  nowhere left to go is cut with an ellipsis, so if your labels come out shortened, lower the strip
  percentage: a smaller strip means smaller text, and smaller text means more of it fits under the
  stamp.
- **Rows × columns is a maximum, not a frame.** A set of four copies under a 5 × 4 template produces a one-row image sized to its contents, not a padded 5 × 4 canvas.
- **Choosing a template on an offer copies its values onto that offer.** The offer does not follow the template afterwards, so editing or deleting a template never changes the look of offers you have already prepared — exactly like the description template on a platform.

A template says nothing about what a platform will accept (how many photos, how large a file); those limits belong to the [platform itself](contacts.md#offer-photos).

Set one of these as a platform's **collage template** and every new offer on that platform starts with its numbers already filled in; you can still adjust them per offer with the **⚙** button in the offer's Photos card ([Offers → Photo settings](offers.md#photo-settings)).

New collections start with no templates — add the ones that match the material you actually sell.

## Stamp photos

Alongside the photos you attach to an individual owned **copy** (see [Inventory → Photos](inventory.md#photos)), you can attach photos to the **stamp itself** — a representative or reference image of the catalog stamp (or variant). Stamp photos live at the catalog level, so they are shared context for every copy of that stamp rather than a record of one physical piece.

Open a stamp's **Add** or **Edit** dialog; the photo editor sits at the bottom of the first tab. Unlike a copy — which has separate **front** and **back** slots — a stamp has a single **main** photo slot (★), plus unlimited **titled extras** that you can drag to reorder. Mark a photo as main with the **★** button on its card; only one photo can be main at a time. Drop files on the **＋ Add photos** area or click to browse; the first photo you add becomes the main one automatically. Accepted formats are **JPEG, PNG, and WebP**, up to **60 MB** each.

Saved stamp photos appear as a single thumbnail at the left of the stamp's row. When a stamp has more than one photo, a counter and **‹ / ›** controls step through them in place, and the **main** photo carries a **★** corner badge to set it apart from extras. Click the thumbnail to view it full-size.

They also show up on the **Issues** list: expand an issue to see each stamp's photos under its row, and the collapsed issue row shows the **main photos of its required-for-completeness stamps** — a quick visual summary of the issue. Where there is more than one, the counter and **‹ / ›** controls step through them. Click the thumbnail to view it full-size.

### Promoting a copy photo to its stamp

If you have already photographed one of your copies and want to reuse that image as the stamp's reference photo, you don't have to upload it again. Open the copy's **Edit** dialog, and on each saved photo use the **⬆** (promote to stamp) button. Choose where it should land on the stamp — as the **Main** photo or an **Extra** with an optional title — and confirm.

Promotion makes an **independent copy** of the photo on the stamp: the image bytes are duplicated, so the new stamp photo and the original copy photo have completely separate lives. Deleting or replacing one never affects the other. (A copy must be identified to a stamp for its photos to be promotable.)

If the stamp is a **variant** with a parent above it, promotion also walks **up the tree**: every ancestor that has no photo at all gets its own independent copy, in the same slot you picked. Photographing a copy of `3a` therefore also gives `3` — and its parent, and so on — a picture, which is usually what you want while the tree is still empty. The walk stops at the first ancestor that already has a photo: an existing picture is never replaced, and nothing above it is touched either.

Only stamps whose **subtype acts as a variant** carry the photo upwards. A colour, perforation, paper or watermark variant is the same stamp pictured, so its photo speaks for the parent; an error, plate flaw or overprint is a picture of *that* peculiarity, so it stays on its own stamp. The walk ends at the first such node — the ancestors above it are reached through it, so they are no better represented. (Whether a subtype counts as a variant is set in **Settings → Subtypes**, and a single stamp can override it in its own form.)

The **first** promotion happens on its own: when a copy gets its **front** photo and its stamp has no photo yet, that front is promoted automatically as the stamp's **Main** image. This only applies to copies with **no physical format** — a pair or a block pictures a multiple, not the single catalog stamp, so it is never picked automatically (you can still promote it by hand). So a stamp usually gets its reference picture from the first copy you photograph, and you only reach for the **⬆** button to add more or override it.

### Photo storage used

**Settings → General** shows the **total space used by all photos in the collection** — copy photos, stamp photos and the listing images generated for offers, added up. Use it to keep an eye on how much storage your images are taking. The figure updates as you add and remove photos.

## Catalog prices

Catalog prices are recorded per stamp, per **catalog edition** (a specific year of a catalog), and — because the same stamp is worth different amounts depending on its physical grade and whether it carries an expert certificate — per **condition** and **certificate status** (the two dimensions from **Settings → Conditions**).

Open a stamp's **Edit** dialog and switch to the **Prices** tab. For each catalog edition you get a small grid: **conditions are rows**, and **certificate statuses are columns** (with a **None** column for "no certificate"). Fill in a price in whichever cells you have data for — for example MNH / None and MNH / Certificate can hold different prices for the same edition. The currency is fixed by the catalog and shown next to each edition. **Tab** moves down the current certificate column through every condition, then jumps to the top of the next column, so you can key in a whole column of prices without reaching for the mouse (**Shift+Tab** goes back).

If the collection has no conditions yet, the Prices tab prompts you to add some first (in **Settings → Conditions**), since every price belongs to a condition.

### Which price the lists show

The item list and the issues list each show a **single price column**. Because a stamp now has many prices, a **"Price for …" selector** above the list chooses which **condition** the column reflects (certificate status = None). Your choice is remembered per collection in your browser; the default is the first condition in your list. On the issues list the selector also drives the prices shown for each stamp when you **expand an issue** — switching the condition updates both the issue totals and the individual member-stamp prices.

**Unknown-variant stamps roll their price up from their variants.** A stamp that has variant children (an "unknown variant" umbrella — see [Inventory → unknown variant](inventory.md)) but no price of its own borrows the **lowest** price among its variant children (compared in the collection currency), exactly like a copy's catalog value does. Such a rolled-up price is shown as an estimate — prefixed with **~** and set in muted italics — because it is inferred rather than recorded. This applies at any depth of the variant tree. The estimate also feeds the **issue total**: when the total includes one or more rolled-up members it carries a **~** marker (hover it to see how many stamps were estimated). A stamp that has its own recorded price always uses that price and is never an estimate.

### Adding a missing catalog value from the issues list

Expand an issue and a member stamp that has **no price for the condition the list is currently showing** gets a **+ catalog value** link where its price would be — the same affordance an unpriced copy has on the [Inventory list](inventory.md#adding-a-catalog-value). It opens the same dialog — the stamp, its catalog numbers, its issue and area, any prices already recorded, and one input per catalog active on the stamp's area with the primary catalog focused — but pre-set to the condition in the **"Price for …"** selector (certificate status = None), so what you type is exactly what the row then shows. Switch the selector first if you want to price a different condition. Save and the list refreshes: the price replaces the link, and the issue total takes it in.

### The price details dialog

Each stamp and issue row's **⋮** actions menu has a **Show catalog prices** action that opens the **price details** dialog — for a single stamp, or, on an issue row, for the whole issue's required stamps. The data is loaded on demand when you open the dialog. It has two kinds of section:

- **Average across all catalogs** (open by default) — a grid with **conditions as rows and certificate statuses as columns** (plus a **No cert.** column for prices recorded without a certificate). For a stamp, each cell is the mean price for that condition/certificate, taking each catalog's newest edition and converting to the collection currency. For an issue, each cell is the average of the catalogs' required-stamps totals for that condition/certificate. Only catalogs that price **every** required stamp (for that cell) are averaged; a catalog that prices some but not all is excluded — hover the **⚠** to see which catalogs and how many they price. If no catalog prices all required stamps for a cell, it reads **incomplete** (hover for details). Averages are always shown in the **collection currency**.
- **Catalog breakdown** (collapsed by default, one expandable section each) — for a stamp, one section per **catalog edition**; for an issue, one section per catalog. Each shows the same conditions × certificate-status grid: the recorded price for a stamp, or the required-stamps total for an issue (with a **⚠** when the catalog does not price every required stamp).

Certificate columns are shared across all the grids, so a certificate that appears in even one catalog gets a column everywhere and the columns line up.

The dialog opens at a fixed size: the toolbar stays pinned at the top and the sections scroll beneath it, so expanding or collapsing a section never resizes the window.

Two toggles control the catalog sections (they never change the averages):

- **Editions** — *Latest only* (default) shows just each catalog's newest edition; *All editions* shows every recorded edition.
- **Currency** — *Catalog* (default) shows prices in each catalog's own currency; *Collection* converts them to the collection currency.

## Staleness warnings

Because prices are edition-specific, a recorded price becomes **stale** when a newer edition of the same catalog is added but has no price yet:

Because prices are edition-specific, a recorded price becomes **stale** when a newer edition of the same catalog is added but has no price yet:

- **In the item list**, a stamp shows a small **⚠** icon next to its price when the displayed price comes from an edition that is no longer the newest for that catalog. Hover it for details.
- **In the issues list**, individual stamps show the same **⚠** icon when expanded, and the issue's required-stamps total reflects the mix of editions:
  - **all required stamps priced on the current edition** — the total uses those prices, no warning;
  - **none priced on the current edition** — the total falls back to older-edition prices and shows a **⚠** (hover: "Older-edition prices");
  - **some on the current edition, some not** — the total counts **only** current-edition prices, and a **⚠** flags that it is partial (hover shows how many stamps are priced on the current edition, priced only on an older edition, or unpriced).
- **In the Prices tab**, a price cell on an older edition is highlighted with a small **⚠** button when the same condition/certificate cell on the newest edition is still empty. Clicking it copies the price into the newest edition's matching cell as a starting point — adjust the value if needed and save. The older edition's price is kept as history; nothing is deleted.

The warning clears once the newest edition has its own price.

## URL structure

Collection URLs follow the pattern `/c/[slug]/...`. The slug is unique per user, so two users can independently have a collection named "Airmail" without conflict.
