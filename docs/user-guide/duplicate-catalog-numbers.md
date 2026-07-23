# Duplicate catalog numbers

Stamporama can detect when a stamp you are entering already shares a catalog number
with another stamp in the same collection, so you don't create accidental duplicates.

## What counts as a duplicate

A duplicate is the **same catalog vendor, the same area prefix, and the same number**
on more than one stamp. The area prefix comes from the stamp's primary area, so:

- `Mi·DE 200` and `Mi·DE 200` **are** duplicates.
- `Mi·DE 200` and `Mi·PL 200` are **not** duplicates — the same Michel number under a
  different country/area is a different catalog identity.
- `Mi 200` and `Sc 200` are **not** duplicates — different vendors.
- `200` and `200a` are **not** duplicates — numbers are matched exactly.

## Warn vs. block

Duplicate handling is set per collection under **Settings → Duplicates**:

- **Warn** (default) — when a catalog number already exists, a non-blocking notice
  appears listing the conflicting stamps. You can still save, because duplicates are
  sometimes intentional (catalog errors, deliberate second copies as separate stamps).
- **Block** — saving a stamp with a duplicate catalog number is prevented. The same
  notice appears, and the save button is disabled until you change the number or switch
  the collection back to warn mode.

## Where you see warnings

- **Adding or editing a stamp** — as you type a catalog number, any existing stamps with
  the same catalog identity are listed beneath the catalog-number fields, each linking to
  the matching stamp.
- **Auto-generating stamps from an issue** — when you turn on *Auto-create stamps from
  catalog number range*, the generated numbers are checked and any collisions are listed
  before you create the issue.

## The duplicate report

**Settings → Duplicates** also shows a collection-wide report grouping every catalog
identity that appears on two or more stamps. Each group lists the conflicting stamps with
links to open them in the Stamps list, so you can review and resolve them. Use **Refresh**
to re-run the report after making changes.
