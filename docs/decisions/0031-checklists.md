# ADR-0031: Checklists — a Completeness Target as a Thing of Its Own

## Status

Accepted (#531). Supersedes the `IssueMember.requiredForCompleteness` flag, which is dropped.

## Context

A **completeness target** — a named list of stamps that counts as one complete unit — used to be
welded to an issue. `IssueMember.requiredForCompleteness` was one boolean on one membership, so an
issue had exactly one complete set.

That is right most of the time. An issue is a publication event, a target is a collecting goal, and
they are usually 1:1. They are not always, and the cases are ordinary rather than exotic:

- **Basic vs specialized.** The same series is collected at two depths: the basic set a catalog
  summarises, and the specialized one that adds varieties, tabs, perforation types. Same
  publication, same stamps, two goals — and "complete basic, gaps in specialized" is the everyday
  question.
- **Perforated and imperforate.** Polish `73-84` exists in both; Fischer prints them as two series
  in one block, two columns. Each needs its own completeness, and sale sets are almost never mixed.
- **Tabs.** A series where the tabbed stamps (`485Pw1..10`) are the goal and the plain ones are
  background — or where both are, separately.

The workaround was to split the publication into two issues. It works, and it is what a collection
should do until this lands, but it costs: the issue stops matching what the catalog prints, names
grow qualifier suffixes, and the issue-level catalog-price total becomes ambiguous — it summed
required members, and with two goals in one publication there was no longer a single answer to
"which".

## Decisions

### 1. A checklist is its own row, and an issue may carry several

`Checklist` is collection-scoped, with a `name`, a `sortOrder`, and an **optional** `issueId`.
`ChecklistStamp` joins it to `Stamp`, many-to-many both ways — a stamp belongs to as many checklists
as apply, exactly as `IssueMember` already lets it belong to several issues.

The name is `Checklist` because it is the natural philatelic word and short enough to live in a
badge label and a menu entry. `Set` was unavailable (`OfferSet` is offer composition);
`CompletenessTarget` is accurate and too long for every place it would appear.

### 2. `issueId` is nullable, and null means the checklist spans issues

The same nullable-anchor idiom `StampFormatFactor` uses (ADR-0020 §5). A row naming an issue is that
issue's goal; null is a thematic set — "all Grosik 1928-1932" — that no single publication owns.

One kind of checklist with an optional anchor, rather than two kinds. The column is nullable from
the first migration so the later cross-issue editor needs no schema change; **only the issue-scoped
editor is built here**, because a cross-issue checklist has no home on any existing screen and
inventing one was not this issue's question.

### 3. Membership *is* required-ness

There is no per-membership "required" flag on a checklist. A stamp that is an optional extra — a
block, a variety nobody counts — is an `IssueMember` on no checklist, which is exactly what
`requiredForCompleteness = false` said. Adding a second flag would mean explaining two ways to say
the same thing.

### 4. The old flag is migrated and dropped, not kept as "the default target"

Every issue with at least one required member became one checklist carrying those members, named
after the issue (`Complete set` for an unnamed one). Lossless: the collection reads afterwards
exactly as it did before.

Keeping the flag as an implicit default target would have left two mechanisms doing one job, and
every consumer would have had to union them forever.

### 5. A checklist is edited from the issue's own row

ADR-0020 §7's scope rule, unchanged: the screen the editor is opened from already answers "which
issue", and asking again in a flat collection-wide list is how a goal ends up filed under the wrong
publication. `useChecklistsAction` is the row-menu entry, beside *Format multipliers…*.

Order is the collector's and it is **load-bearing**, not cosmetic: the first checklist is the one a
single-checklist row shows its badge and total for, and the one a new stamp joins when the stamp
form's box is ticked. So the editor is drag-reorderable through the shared kit.

### 6. Each derived fact gets an explicit subject

`requiredForCompleteness` was doing more than completeness, and with several checklists each
consumer needs to say which one it means:

| Consumer | Subject |
| --- | --- |
| Completeness grid (#519) | **per checklist** — one card each on the issue detail page |
| Catalog-price total | **per checklist** — summing a union would count a stamp two sets share once, for a total answering neither |
| Declared-range suggestions (#333) | **union** — an issue publishes one range of numbers however many goals sit inside it |
| Issue-level photo gallery (#137) | **union**, deduped |
| Intake fan-out (#121), auction lot composition (#353), the picker's *whole issue* button | **one checklist**, named by the button |
| Stamp-tree bolding, the stamp list's "required" styling | **on at least one checklist** |

### 7. The issue list collapses several checklists to a count

With one checklist a row is byte-for-byte what it was before: `12/14`, and the total beside it. With
several, the badge reads `3 checklists` and its tooltip lists each name, size and total — the rule
`MultiSelectFilter` (#425) already follows, for the same reason: a row that grows a line per goal
stops scanning evenly, and three names never fit where one number does.

The headline price chip is dropped in that case rather than repeated three times; the totals are in
the tooltip. The issue's own detail page is where several checklists get room — one completeness
card and one catalog-value card each.

### 8. The badge counts; the tree filters

The `3 checklists` badge on a collapsed row is an **indicator** and stays one. Narrowing happens
where the stamps actually are: a `MultiSelectFilter` (#425) above the row's **expanded** stamp tree,
and in the header of the **Stamps** card on the issue's detail page. Both keep the selection in
local state — the list shows many issues at once, so there is no single URL parameter a per-issue
filter could occupy, and the detail page follows the list's rule rather than inventing a second one.

The control was not put in the collapsed row's chip line, though its resting label (`2 checklists`)
is exactly the badge's text. `MultiSelectFilter` is toolbar-sized, and one such button per row would
outweigh the dense chip line it landed in — a row is scanned, and only an expanded row is read.

An issue with one checklist gets no filter at all: a multi-select over a single option is a control
with nothing to choose.

### 9. A filtered tree keeps the ancestors of its matches

`filterStampTreeByChecklists` (`src/lib/stamp-tree-filter.ts`, pure) drops stamps that are on none
of the picked checklists — **except** a node with a surviving descendant, which is kept and returned
in `contextIds` for the renderers to dim.

Hiding it would shorten the list and make the remainder unreadable: a variant tree is read through
its ancestors, and `309AP` without the `309` it hangs under is a number nobody can place. Dimming
says the same thing the filter does — this is not part of the set — without taking away what the
match is attached to.

An empty selection is the **absence of a filter**, not an empty set, matching what
`MultiSelectFilter` means by an empty selection everywhere else.

### 10. A name is a label, not an identifier

`Checklist.name` carries **no uniqueness constraint** — not per collection, not per issue — and
nothing anywhere resolves a checklist by it; every consumer holds the cuid. Two issues may both
have an *Imperforate*, and they never meet: `getChecklistsForIssue` and `listChecklistsForIssues`
are both scoped by `issueId`, so no surface lists checklists from more than one issue at a time.

Within **one** issue a repeated name is still allowed, but the editor shows the advisory ⚠ that
#178 uses for a duplicate issue name in an area. The check is client-side, since the dialog has
already loaded the issue's checklists. Blocking was rejected for #178's own reason: the collector
may mean it, and the list behind the field already says what is there.

The visible cost of a duplicate is real but local — the badge tooltip, the tree filter, the stamp
form's boxes and the price-details entries would each show two indistinguishable rows — which is
what the warning names.

## Schema

```prisma
model Checklist {
  id           String   @id @default(cuid())
  collectionId String
  issueId      String?  // null = spans issues
  name         String
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())

  collection Collection       @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  issue      Issue?           @relation(fields: [issueId], references: [id], onDelete: Cascade)
  stamps     ChecklistStamp[]

  @@index([collectionId])
  @@index([issueId, sortOrder])
}

model ChecklistStamp {
  checklistId String
  stampId     String

  checklist Checklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)
  stamp     Stamp     @relation(fields: [stampId], references: [id], onDelete: Cascade)

  @@id([checklistId, stampId])
  @@index([stampId])
}
```

`IssueMember` keeps `(issueId, stampId)` and loses its boolean.

## Consequences

- `src/lib/checklists.ts` owns storage and reads; `src/lib/checklist-completeness*.ts` owns the
  grid, renamed from `issue-completeness*` because the subject changed.
- `getIssuePriceDetails` became `getChecklistPriceDetails`, keyed on a checklist. The row menu
  offers one *Show catalog prices* entry per checklist that has a total.
- `intakeStamps` and `resolveAuctionLineStamps` take a `checklistId` where they took an `issueId`.
  The picker draws one *+ whole set* button per checklist instead of one *+ Whole issue*, which
  removes the chooser a multi-goal issue would otherwise have needed.
- The stamp form's *Required for completeness* checkbox became a **Counts towards** list, one box
  per checklist. An issue with none yet keeps a single box carrying the `default` sentinel
  (`src/lib/checklist-vocabulary.ts`), which creates the issue's first checklist on save — the
  dialog is often the very thing starting an issue, and at that moment there is nothing to name.
- #133 (completeness breakdown by disposition × condition × format) is now per checklist by
  construction, which is why this landed first.
- Offer composition (#31, #199) gains a natural source for "build me this set", and the want list
  (#532) gains a gap **generator** — an action that materialises editable rows once, never a live
  feed, since a want carries acceptance criteria and a maximum price a checklist knows nothing of.

## Still open

- **Cross-issue checklists have no editor.** The schema allows `issueId: null`; nothing creates one.
  A home for them — a Catalog tab, a nav entry — is its own decision.
- **A checklist is not yet a filter.** "Show me what is missing from Basic" reads off the detail
  page's grid, not off the Copies or Issues list.
