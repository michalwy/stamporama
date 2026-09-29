# ADR-0059: Settings Navigation and the Shared Page Skeleton

## Status

Accepted; the navigation, the entries, the skeleton and the addresses are implemented in #1469.
Designed in #1465 with the collector on 2026-09-29, against a wireframe. The three body shapes (§5)
are built by the pages' own issues — #1471 (list beside detail), #1474 (list beside preview) and
#1473 (grid of fields) — and the summary strip by #1475. **Reverses #691's 56rem cap** on the
Settings screen as a whole (§6).

## Context

Settings was one horizontal strip of seventeen tabs over a single 56rem column. The collector found
it hard to read on four counts (#1465): the strip itself at that length; tabs that stacked several
unrelated panels into one long scroll (*Conditions & formats* held conditions, certificate statuses,
formats, format multipliers and acceptance profiles); no obvious answer to *which tab holds this
setting*; and pages that were a narrow column running a long way down a wide screen — the state the
album screen was in before #1430.

What belongs in Settings at all is **not** reopened here: something set up once lives in Settings,
something worked in routinely has its own screen (#775, #1234). The design found no entry that fails
that rule, so nothing moved out.

## Decision

### 1. The groups mirror the sidebar's sections

*General* first, then *Catalog*, *Collection*, *Selling*, *Intake* and *Partners* — the sidebar's
sections, in their names and **their tints** (`nav-sections.ts`) — and *System* last. General and
System are no section of the app and carry no tint, as Overview and the sidebar's footer carry none.
A collector looking for a setting already knows which part of the app it serves, because that is
where they met it.

*Rejected:* a thematic grouping (Collection, Catalogue, Printing & albums, Equipment, Shipping,
Marketplaces, Assistant & API), and four broad groups.

### 2. One entry per thing

A separate dictionary or object is an entry of its own. The panels of **one** thing stay one entry
with tabs inside it, as on the album screen (#1430): *Formats* has Formats and Multipliers,
*Attributes* has Colours, Watermarks, Papers and Printing methods, and the marketplace pages gain
theirs with their own issues (#1475, #1479, #1480). The entries and their order are
`settings/settings-nav.ts`, pinned by `tests/unit/settings-nav.test.ts`.

*Rejected:* one entry per panel (about forty entries), and today's tabs with an in-page table of
contents.

### 3. The navigation is a vertical list beside the content

As in the Page template dialog (#1453). **Every group is always open**, and the list scrolls on its
own when the window is short. The sidebar's sections collapse (#762) because the sidebar is chrome
seen on every screen; this list is opened to *find* something, and a folded group hides the answer.
The running app version is a line at the foot of the list, since it is not a setting of the
collection.

*Rejected:* collapsible groups, and the entries in the app's own sidebar.

### 4. One page skeleton

Every page sits in `SettingsPageFrame`: a header naming the **group** (in its tint), the page
**title**, a **hint** (ⓘ, one line, in a tooltip) and the page's **main action**; an optional
**summary strip**; optional **tabs**; then the body. Standing explanations follow #1430 and #1460 —
at most one sentence under the title, the rest in hints beside what they explain and in the user
guide, and a sentence that prevents a costly mistake stays beside its action.

*Rejected:* a shared header only, and each page designed on its own.

### 5. Three body shapes

A page body is one of three shared shapes:

- **List beside detail** — the dictionaries: the list, and the selected row's detail edited in place.
- **List beside preview** — the templates (album, collage, ref card): the list, and a preview of the
  selected template.
- **Grid of fields** — the plain forms: the cards in a grid of two or three columns.

A page that needs a fourth shape has to say why, in its issue and in this record.

### 6. What this reverses from #691

#691 capped every Settings surface at 56rem, on the reasoning that each tab was a column of labelled
fields and a field stretched across a wide monitor reads worse. **The cap on the screen goes**: a
page takes the window's width, which is what lets a list sit beside its detail. **The reasoning is
kept as a rule the shapes carry: a single field never stretches across the window.**

Until a page's own issue lays it out, it keeps today's content at today's width under the new header
(`UNSHAPED_PAGE_WIDTH`, 56rem), so no field is stretched in the meantime. The constant goes when the
last of those issues lands.

### 7. Addresses

The `?tab=` form stays, and the chosen tab inside an entry is `&part=`. Every key of the old strip
opens the content it opened: an entry that inherited a tab kept its key (`general`, `scanning`,
`shipping`, `refcards`, `assistant`, …), and a tab that was **split** lands on its first entry
(`conditions` → Conditions, `attributes` → Attributes, `albums` → Album templates). `areas` still
redirects to the Areas screen (#775). The defaults — the Collection entry, an entry's first tab — are
left out of the address, and any other parameter on it is kept, so the Allegro sign-in callback's
outcome still reaches its page. An unknown key opens the default entry rather than failing.

## Consequences

- Every "Settings → X" reference in the app, the extension and the user guide names an entry that
  exists; a renamed or split entry renames them in the same change.
- A new entry is a line in `settings-nav.ts`, a case in the screen's body switch and a line in the
  search index `settings-search.ts` (a missing case or line does not compile), and a line in the
  navigation test.
- Search over the entries and their fields (#1470) builds on the entry list rather than on the
  rendered screen: the index names each page's fields in the page's own words, pinned to its source
  by `tests/unit/settings-search.test.ts`.
