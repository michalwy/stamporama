# ADR-0056: The Collection Structure Screen

## Status

Accepted and implemented in #1401. Designed in #1399 with the collector on 2026-09-26; one question
the design left open was settled on 2026-09-27 (§5). The value measures — catalogue value, market
value and cost per segment — follow in #1402 on the same screen. **Amends #397's decision** that the
Overview is one screen with no reports area (§1).

## Context

The Overview answers a few fixed questions, and since #1398 its holdings tile says how many copies
the collection holds, is for sale, for trade and on the way in. The collector wants the **structure**
behind those numbers — *how much of what is for sale is used*, *how many certified copies, by area* —
and today each such question means filtering the Copies list and reading its summary bar, one
combination at a time.

#397 decided the Overview is one screen of tiles, **an entry point and never a reports area**: no
`/reports` tree, no new sidebar section, and every tile a link into the list screen that holds its
rows. The reason was that a dashboard repeating the lists would become a second version of them,
drifting apart. A screen of breakdowns is exactly the thing that rule was written against, so this
record says why this one does not become that second version.

## Decision

### 1. A screen of its own, opened from the holdings tile

`/c/[slug]/inventory/structure`, reached from the holdings tile as the profit and loss screen is
reached from its tile (#1305). **No sidebar entry and no reports area**: the screen sits under the
Copies list whose copies it counts, and the tile's own figures keep linking to the Copies list.

This departs from #397's *one screen* and is recorded as such. What #397 protected is kept by §2.

*Rejected:* its own navigation entry, a tab of the Overview, and a mode of the Copies list's summary
bar.

### 2. It states counts and never lists a copy

**Every count is a link to the Copies list under exactly the filters that produce it**, and nothing
on the screen is a copy. Clicking a heading or a cell **narrows the screen** instead of opening
anything, so the two acts — *look closer* and *show me the copies* — are one click each and never
the same click.

That is the line between this screen and a second Copies list: the list is where copies are, this
screen only ever says how many and hands over to it. The agreement #397 asked of every tile holds by
construction rather than by care, because each count is taken from the list's own query (§4).

### 3. Nine dimensions, one or two at a time, with a drill-down

Disposition (the three marks with the intake stages beside them, as the holdings tile shows them),
condition, certificate, format, subtype, area, year of issue, tags and storage location. The rows
take one, the columns optionally another; each cell counts the copies in that pair.

A click narrows the whole screen to a row, a column or a cell, after which any dimension can be
picked again. **A drill-down step is simply a filter** — it writes the same parameter the filter bar
would — and the steps are recorded only so the breadcrumb can undo them, each with what it replaced.
Area and storage location drill into their own levels, and the year opens by decade, a decade into
its years.

Every dimension has a segment for copies without a value on it where one exists (*No certificate*,
*Single*, *No subtype*, *No area*, *No year*, *No tags*, *Not filed*). Segments follow the order
their dimension already has; the dictionaries always show every value, the open-ended dimensions
only what some copy reaches.

*Rejected:* checklist completeness as a dimension — it describes the catalogue, not the copies held.

### 4. The Copies list's own filter bar, and the list's own query

The screen carries **the same filter bar as the Copies list** — one component, drawn by both — and
keeps every filter, the dimensions and the steps **in its address, under the list's own parameter
names**. Nothing is remembered, so the screen opened from the tile shows what the tile counts.

The count is taken by the list's own `where`: the screen's address is translated as the list
translates its own (`copies-list-url.ts`) and read by the list routes' parser, and the copies are
scanned once and counted in memory against each segment. A segment only ever narrows what the screen
already shows — a dimension the screen is filtered on offers the values its filter admits, and a tree
offers the levels under the node in force — so a segment's count among the screen's copies is the
count of the list its link opens. The integration suite follows every count of every view it builds
to that list and counts it there.

Where the list could not express a segment, **the list gained the filter**: a decade (its own
parameter, beside the shared year), *No area* on the rail, *No tags* and *Not filed* on the bar.

### 5. Counting

The rules every other count uses: copies no longer held are not counted (#396), and a copy carrying
several stamps is one copy (#745). With no filter the total equals the holdings tile's.

**A copy is counted in every segment it belongs to, and a total counts it once.** The dispositions
overlap, a copy can carry several tags, and a stamp can be filed in several areas; for those three
dimensions the screen says its segments do not add up to the total, as the holdings tile does.

**A multi-stamp copy's area, year and subtype are read off its leading stamp**, as the Copies list's
filters read them — settled with the collector on 2026-09-27. #1399 had it spanning the areas, years
and subtypes of all its stamps, but the list files it under the leading stamp alone, and the screen's
one promise is that a count is the list it opens. Changing the list's reading instead would move
every reader of that filter — the Overview's value by area, the daily snapshots, the offer pickers —
and was not asked for.

## Consequences

- The Copies list gained three values and a parameter: `decade` (`1950s`, applied while the rail
  names no single year and not remembered), `areaId=none`, `tagIds=none` and `locationId=none` on the
  bar. `readYearFilter` is now the one parser of a list's year in every Copies route.
- The Copies list's filter controls live in `copies-filter-controls.tsx`; a control added there
  reaches both screens.
- The screen follows the collector's two subtree switches (#385) as the list does. With *this area
  only*, a tree offers the node itself rather than its children, since a child would select copies
  the narrowed screen does not show.
- #1402 adds the value measures to the same table.
