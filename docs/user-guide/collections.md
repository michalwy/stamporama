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

## Required for completeness

Each stamp carries a **Required for completeness** flag that controls whether it counts toward its issue's required-stamps total. The flag can be set when adding a stamp and changed later from the stamp's **Edit** dialog — toggle the **Required for completeness** checkbox and save.

## Stamp conditions

Each collection keeps its own list of **conditions** — the grades used when valuing stamps (for example Mint Never Hinged, Mint Hinged, Used, or Cancelled to Order). Manage them from **Settings → Conditions**.

- Every new collection starts with a default set: **MNH**, **MH**, **MNG**, **U**, **CTO**, and **FDC**. These are ordinary conditions — rename, reorder, or delete any of them.
- **Add** a condition with a full name (e.g. "Mint Never Hinged") and a short abbreviation (e.g. "MNH").
- **Reorder** conditions by dragging rows; the order controls how conditions are listed elsewhere in the app.
- **Delete** a condition you no longer need. A condition that is already used by catalog prices cannot be deleted — remove those prices first.

Certificate and guarantee status is tracked as a separate dimension, not as part of condition.

## Catalog prices and staleness warnings

Catalog prices are recorded per stamp, per **catalog edition** (a specific year of a catalog). Open a stamp's **Edit** dialog and switch to the **Prices** tab to enter a price for each edition of the catalogs assigned to that stamp's area. The currency is fixed by the catalog and shown next to each field.

Because prices are edition-specific, a recorded price becomes **stale** when a newer edition of the same catalog is added but has no price yet:

- **In the item list**, a stamp shows a small **⚠** icon next to its price when the displayed price comes from an edition that is no longer the newest for that catalog. Hover it for details.
- **In the issues list**, individual stamps show the same **⚠** icon when expanded, and the issue's required-stamps total reflects the mix of editions:
  - **all required stamps priced on the current edition** — the total uses those prices, no warning;
  - **none priced on the current edition** — the total falls back to older-edition prices and shows a **⚠** (hover: "Older-edition prices");
  - **some on the current edition, some not** — the total counts **only** current-edition prices, and a **⚠** flags that it is partial (hover shows how many stamps are priced on the current edition, priced only on an older edition, or unpriced).
- **In the Prices tab**, any priced edition that has a newer, still-unpriced edition is highlighted, with an **⚠ Update {year}** button. Clicking it copies the existing price into the newest edition's field as a starting point — adjust the value if needed and save. The older edition's price is kept as history; nothing is deleted.

The warning clears once the newest edition has its own price.

## URL structure

Collection URLs follow the pattern `/c/[slug]/...`. The slug is unique per user, so two users can independently have a collection named "Airmail" without conflict.
