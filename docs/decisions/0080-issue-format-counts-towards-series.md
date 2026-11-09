# ADR-0080: Pieces a Catalogue Prices as a Whole Are Catalogue Entries, and an Issue Format Says Whether They Count Towards the Series

## Status

Accepted. Decided in #2355 on 2026-11-09 with the collector and built by #2470, the issue's *to be
confirmed* points as written. Builds on the issue format (#2439). Covers valued by per-stamp prices
through a valuation method are unaffected (ADR-0076, ADR-0077).

## Context

Catalogues price some pieces as a whole, not as the stamps on them: postal stationery, and covers of a
given make-up such as an FDC with a set. The catalogue held stamps only, so such a piece could be
recorded as a copy carrying several stamps (ADR-0044) with a value only typed in by hand. Valuation
methods (#2356, #2359) answer covers franked with ordinary stamps; they cannot answer a piece priced
as a whole.

## Decision

1. **Postal stationery is an ordinary catalogue entry** with the issue format *Postal stationery*: its
   own numbers, area, issue and catalogue prices, and the collector's piece is a copy of it. Rejected:
   a new kind of catalogue item, and a copy with the imprint described on it.
2. **A piece a catalogue lists with its own price**, such as an FDC with a set, is the same: an entry
   in the issue with the issue format *FDC*. Rejected: a catalogue price recorded on the copy. A piece
   no catalogue lists, such as one specific franking, stays a piece with a typed value.
3. **Value comes from the entry's own catalogue prices**, per condition and edition, like a stamp. No
   price means no value; nothing is derived from the sum of the issue's stamps.
4. **Each issue format has a switch, *Counts towards the series*** (`countsTowardsSeries`). FDC and
   Postal stationery are off; every other value is on, so nothing changes for souvenir sheets and the
   rest until the collector says so. **FDC** is seeded for new collections and added once to existing
   ones, in the neutral chip, the palette's ten hues being taken. An existing Postal stationery value
   is found by its seeded id or its seeded name; one that matches neither is left for the collector. A
   value the collector already called FDC is switched off rather than doubled.
5. **An entry that does not count can still be held, wanted individually, valued and offered**, and
   appears in its issue's list, marked by its issue format chip. A held one adds to collection value.
6. **The same condition dictionary as stamps**, with no per-format rules; the collector adds values
   such as *Unused* or *FDC* where needed.
7. **Intake and offers have no separate path**: identified like a stamp, narrowed with the issue
   format filter, named through the listing templates and `{issueFormat}`.
8. **The switch is read, never written through to the checklists.** A non-counting entry's
   `ChecklistStamp` row stays, and every read of a checklist **as a series** leaves it out, through one
   fragment (`COUNTING_CHECKLIST_MEMBER`, `issue-format-series.ts`): completeness and missing counts,
   the stamp tree's checklist marks, a checklist's price and value totals, a declared range, what
   makes a complete set (#1287, Series from singles, free extras #2422), a whole-set fan-out into a
   want, a lot, a trade or an auction line, a run of scan tiles, offer photos and album pages. The
   alternative was to take such entries off the checklists, which ADR-0031 would allow — an optional
   extra is a member on no checklist — and it would have served every reader for nothing. It was
   rejected because the switch would then destroy data: turning a value off and on again, or setting
   the wrong issue format on a stamp for a moment, would lose hand-built membership and order with no
   way back. **The membership stays what the editors read and write**, so `ChecklistData.stampIds` is
   the whole list and `countingStampIds` the series.
9. **A non-counting entry answers for nothing above it**: a variant filed under a counting stamp whose
   own issue format does not count satisfies no member, in the completeness rollup, the variant
   chains and a want run by variant depth.

## Consequences

A new reader of a checklist as a series has to spread the fragment; nothing forces it to, and the
failure is an FDC counted into a set. Reads that treat a checklist as a plain list of stamps — its
editor, the variant price grid and catalogue-number scope, size presets, the Copies filter by
checklist, the agent API's `list_checklist_stamps` — keep the whole membership on purpose.

Copies already recorded by hand as pieces carrying several stamps stay as they are (ADR-0044); moving
one to a catalogue entry is the collector's choice, per copy.
