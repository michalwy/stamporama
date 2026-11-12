# ADR-0081: Filter Presets Capture a List's Whole View, Wherever the List Keeps It

## Status

Accepted. Decided in #2487 on 2026-11-12 with the collector (presets on every list with filters, each
list its own; a preset holds the filters, area, years and search included, the sort and the grouping)
and built there, the issue's *to be confirmed* points as written. Refs #773 (the bulk-lot builder's
saved criteria, the first preset in the app) and ADR-0055 (the text-trim extension a `Json` column
must stay clear of).

## Context

The lists carry many filters — Copies alone has an area tree, years, a search with its fields and
around fifteen dropdowns — and the collector sets up the same combinations again and again. The
view of a list is not in one place: most filters ride in the URL, many of them **fall back to a value
remembered per collection** when the URL names none (#693, #325, #143), and some preferences live in
storage alone — the grouping and its axes, a search box's ticked fields, the sub-area switch. One
list (Wants) keeps its filters as screen state by design (#844). Fourteen lists, each spelling this
its own way.

## Decision

1. **One mechanism for every list**, `src/lib/list-views.ts` (pure) and `ListPresetsControl`
   (`shared/list-presets-control.tsx`). A list declares only what is *not* in its address, in
   `shared/list-view-specs.ts`: its remembered values (with the storage key and shape each hook
   uses), its stored preferences, the parameters that are not view state, and which parameters name
   collection records.
2. **The address is captured wholesale.** Every URL parameter a list does not exclude is part of the
   view, so a filter added to a list later is in its presets with no change to the spec. Rejected:
   enumerating each list's filters, which is the list a new filter would be forgotten from.
3. **A remembered value is captured as the value in force** — the URL's when it names one, the stored
   one otherwise — and **applying writes it to both**, so the list shows it now and opens on it next
   time, and a cleared value does not come back from memory.
4. **Applying replaces the view.** Every parameter the preset does not hold is cleared, every
   remembered value forgotten, every stored preference reset to its default. Nothing is merged.
5. **Kept on the server per collection and list** (`list_preset`: `view`, `refs`, `labels`), so a
   preset is the same on every device. The applied preset's id is remembered on the device per list;
   the control shows its name and **modified** once the view on screen differs from it.
6. **A record deleted since is dropped, and named.** The list declares which parameters reference
   which kind of record; the server stores the names those records had at each save, and when
   listing presets drops the ids that no longer exist (a switched-off platform for the filters that
   only take switched-on ones, an archived Facebook group) and returns a line per drop for the note.
7. **Stored preferences change as one event.** The persisted-value hooks also listen for, and raise,
   the shared stored-preference event (`lot-view-prefs.ts`), so a preset written to storage reaches
   every hook on the screen at once, and the control sees a change made by any of them.

## Consequences

- A new remembered filter or stored preference on a list must be added to that list's spec, or a
  preset will not carry it; a filter that only rides the URL needs nothing.
- The `view` column is a `Json` value of the app's own making and is left alone by the text-trim
  extension (ADR-0055 §2), so a search phrase is kept exactly as captured.
- Not covered: screens that are not lists of records (the completeness screen, the Colnect report,
  the lot builder, which keeps its own saved criteria from #773) and the phone screens, which have
  no filter bars of this kind.
