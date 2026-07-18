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

## Catalog prices

Catalog prices are recorded per stamp, per **catalog edition** (a specific year of a catalog), and — because the same stamp is worth different amounts depending on its physical grade and whether it carries an expert certificate — per **condition** and **certificate status** (the two dimensions from **Settings → Conditions**).

Open a stamp's **Edit** dialog and switch to the **Prices** tab. For each catalog edition you get a small grid: **conditions are rows**, and **certificate statuses are columns** (with a **None** column for "no certificate"). Fill in a price in whichever cells you have data for — for example MNH / None and MNH / Certificate can hold different prices for the same edition. The currency is fixed by the catalog and shown next to each edition.

If the collection has no conditions yet, the Prices tab prompts you to add some first (in **Settings → Conditions**), since every price belongs to a condition.

### Which price the lists show

The item list and the issues list each show a **single price column**. Because a stamp now has many prices, a **"Price for …" selector** above the list chooses which **condition** the column reflects (certificate status = None). Your choice is remembered per collection in your browser; the default is the first condition in your list.

### The price details dialog

Next to a shown price, a small **⋯** button opens the **price details** dialog — for a single stamp, or, next to an issue total, for the whole issue's required stamps. The data is loaded on demand when you open the dialog. It has two kinds of section:

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
