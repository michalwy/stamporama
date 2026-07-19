# Locations

**Locations** are where your copies physically live — cabinets, stockbooks, albums,
boxes, a safe. They are separate from catalog **areas**: an area describes *what a stamp
is* (country, period), while a location is *where a copy sits*. Copies from many areas
can share one stockbook, and one area's stamps can be spread across many locations.

Open the **Locations** screen from the **Collection** section of the sidebar.

## Building your storage tree

Locations nest to any depth, so you can mirror how your storage is actually organized —
for example a cabinet holding several stockbooks:

- **Cabinet 1** *(grouping)*
  - Stockbook Poland A
  - Stockbook Poland B
- **Safe** *(grouping)*
  - Certificates envelope

To add one, click **+ Add location**, give it a name, optionally choose a **parent
location** and a **description**, and decide whether it **can hold copies**.

### Grouping locations vs. storage that holds copies

The **Can hold copies** checkbox is the key setting:

- Leave it **checked** (the default) for real storage — a stockbook, album, or box that
  copies actually go into.
- **Uncheck** it for a grouping-only location — a cabinet or shelf that just organizes
  the storage inside it. Grouping locations are shown with a **Grouping** badge and
  cannot themselves receive copies; only their children can.

You cannot mark a location as grouping-only while copies are still filed directly in it —
move those copies first.

## Editing and deleting

Every location row has a **⋮** menu with **Add sub-location**, **Edit**, and **Delete**.

A location can only be deleted once it is empty: if it still has **child locations** or
**stored copies**, the delete dialog explains what to clear first. This prevents
accidentally losing track of where copies were.

## Filing copies into a location

You assign a copy to a location from the **Add copy** / **Edit copy** dialog on the
[Inventory](inventory.md) screen (or the **Add copy** action on the Stamps and Issues
lists). In the **Storage** section:

- Pick a **Location**. Only locations that can hold copies are selectable; grouping
  locations appear for context but are greyed out — expand them to reach the storage
  inside.
- Optionally type a **Ref** — a free-text identifier *within* that location, such as a
  page or pocket (`p.12`). The ref is just a note to help you find the copy; it does not
  have to be unique.

Leave the location empty to record a copy you haven't filed anywhere yet.

## Finding copies by location

Each copy on the Inventory list shows a 📍 chip with its location path (and ref, if set),
so you can see at a glance where everything lives. To narrow the list, use the
**location filter** in the Inventory toolbar — see
[Filters and sorting](inventory.md#filters-and-sorting). Selecting a location shows every
copy stored in it **and in any location nested inside it**, so filtering by a cabinet
shows the copies in all of its stockbooks at once.
