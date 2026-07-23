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

- The collection name
- Navigation links for each section (Overview, Catalog, Items — more sections will be added as features are built)
- A **← All collections** link to return to the collection picker
- The running app version, shown in muted text at the bottom of the sidebar (also listed under **Settings → General**)

## Filtering the Issues, Stamps, and Copies lists

The **Issues**, **Stamps**, and **Copies** (inventory) lists share the same three-column layout:

- **Area tree** (left) — filter to an area and its sub-areas. Nodes with children can be collapsed or expanded, and the whole column can be hidden/shown with the **◂** / **▸** toggle in its header; both are remembered between visits.
- **Year filter** (middle) — the years present in the current results, each with a count of how many items fall in that year. Click a year to narrow the list to it, or click it again (or **All years**) to clear. Items with no year appear under a **No year** entry. On the issue list the year comes from the issue's year; on the stamp and copies lists it comes from each stamp's own issue year. The counts update as you change the area filter, search, or the other filters. Use the **◂** / **▸** toggle in the panel header to hide or show this column — the choice is remembered between visits.
- **List** (right) — the issues, stamps, or copies themselves, with the toolbar for search, sort, and the list-specific filters above it.

All filtering and sorting happens on the server, and the active area, year, search, and sort are kept in the page URL so a view can be bookmarked or shared. The **area** and **year** selections are also remembered per collection and shared across these three lists: pick an area and year on one list and they carry over when you switch to another, and they are restored when you come back after visiting an unrelated page. Other filters (search, catalog number, sort, and the copies-only filters) stay per list. When you add an issue while a year is selected, the new issue's year is pre-filled to match.

## Row actions

Every list row across the app — stamps, issues, inventory copies, areas, catalog vendors and names, conditions, certificate statuses, and subtypes — keeps its actions behind a single **⋮** button at the right of the row. Click it to open a menu of that row's actions (for example **Edit**, **Add copy**, **View copies**, **Show catalog prices**), with the destructive **Delete** set apart in red at the bottom. Section-level buttons such as **+ Add area** or **+ Add condition** stay in place above their lists.

## Moving an issue to another area

An issue can be moved to a different collecting area after it is created. Open the issue's **⋮** menu on the **Issues** list and choose **Move to another area…**, then pick the target area from the tree and click **Move**. The issue's whole **stamp tree moves with it** — its stamps are re-tagged to the new area (a stamp that also belongs to another issue still in the old area keeps its place there too).

Catalog numbers are never lost in a move: catalogs belong to the collection, not to a single area. If the area you pick does not list one of the catalogs the issue uses, the dialog shows a short warning naming those catalogs — the move is still allowed, and the numbers stay attached. To have the new area display them, add the missing catalog(s) to that area in **Settings → Areas**.

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
- The issue's **⋮** menu gains an **Update declared range** action that widens the range for you — one click updates every affected catalog and refreshes the list.
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

## Certificate statuses

Each collection keeps its own list of **certificate statuses** — the certificate or guarantee status used when valuing stamps (for example Certificate or Guarantee). This is an independent dimension from condition, so a stamp's grade and its certificate status are recorded separately rather than combined. Manage them in the **Certificate statuses** section of the **Settings → Conditions** tab.

- Certificate status is **optional**: leaving no status selected means the stamp has none, so there is no "None" entry to manage. New collections start with an empty list — add the statuses you use.
- **Add** a status with a full name (e.g. "Certificate") and a short abbreviation (e.g. "Cert").
- **Reorder** statuses by dragging rows; the order controls how statuses are listed elsewhere in the app.
- **Delete** a status you no longer need. A status that is already used by catalog prices cannot be deleted — remove those prices first.

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

## Stamp photos

Alongside the photos you attach to an individual owned **copy** (see [Inventory → Photos](inventory.md#photos)), you can attach photos to the **stamp itself** — a representative or reference image of the catalog stamp (or variant). Stamp photos live at the catalog level, so they are shared context for every copy of that stamp rather than a record of one physical piece.

Open a stamp's **Add** or **Edit** dialog; the photo editor sits at the bottom of the first tab. Unlike a copy — which has separate **front** and **back** slots — a stamp has a single **main** photo slot (★), plus unlimited **titled extras** that you can drag to reorder. Mark a photo as main with the **★** button on its card; only one photo can be main at a time. Drop files on the **＋ Add photos** area or click to browse; the first photo you add becomes the main one automatically. Accepted formats are **JPEG, PNG, and WebP**, up to **15 MB** each.

Saved stamp photos appear as a single thumbnail at the left of the stamp's row. When a stamp has more than one photo, a counter and **‹ / ›** controls step through them in place, and the **main** photo carries a **★** corner badge to set it apart from extras. Click the thumbnail to view it full-size.

They also show up on the **Issues** list: expand an issue to see each stamp's photos under its row, and the collapsed issue row shows the **main photos of its required-for-completeness stamps** — a quick visual summary of the issue. Where there is more than one, the counter and **‹ / ›** controls step through them. Click the thumbnail to view it full-size.

### Promoting a copy photo to its stamp

If you have already photographed one of your copies and want to reuse that image as the stamp's reference photo, you don't have to upload it again. Open the copy's **Edit** dialog, and on each saved photo use the **⬆** (promote to stamp) button. Choose where it should land on the stamp — as the **Main** photo or an **Extra** with an optional title — and confirm.

Promotion makes an **independent copy** of the photo on the stamp: the image bytes are duplicated, so the new stamp photo and the original copy photo have completely separate lives. Deleting or replacing one never affects the other. (A copy must be identified to a stamp for its photos to be promotable.)

The **first** promotion happens on its own: when a copy gets its **front** photo and its stamp has no photo yet, that front is promoted automatically as the stamp's **Main** image. So a stamp usually gets its reference picture from the first copy you photograph, and you only reach for the **⬆** button to add more or override it.

### Photo storage used

**Settings → General** shows the **total space used by all photos in the collection** — both copy photos and stamp photos, added up. Use it to keep an eye on how much storage your images are taking. The figure updates as you add and remove photos.

## Catalog prices

Catalog prices are recorded per stamp, per **catalog edition** (a specific year of a catalog), and — because the same stamp is worth different amounts depending on its physical grade and whether it carries an expert certificate — per **condition** and **certificate status** (the two dimensions from **Settings → Conditions**).

Open a stamp's **Edit** dialog and switch to the **Prices** tab. For each catalog edition you get a small grid: **conditions are rows**, and **certificate statuses are columns** (with a **None** column for "no certificate"). Fill in a price in whichever cells you have data for — for example MNH / None and MNH / Certificate can hold different prices for the same edition. The currency is fixed by the catalog and shown next to each edition.

If the collection has no conditions yet, the Prices tab prompts you to add some first (in **Settings → Conditions**), since every price belongs to a condition.

### Which price the lists show

The item list and the issues list each show a **single price column**. Because a stamp now has many prices, a **"Price for …" selector** above the list chooses which **condition** the column reflects (certificate status = None). Your choice is remembered per collection in your browser; the default is the first condition in your list.

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
