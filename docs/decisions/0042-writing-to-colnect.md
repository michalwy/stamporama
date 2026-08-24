# ADR-0042: Writing to a Colnect account from the Assistant

- Status: Accepted
- Date: 2026-08-24
- Issue: #689 (part of the Colnect list-sync track, #684–#690)
- Related: ADR-0015 (browser extension), #686 (the discrepancy report), #684 (list mappings)

## Context

Until now Stamporama has only ever **read** Colnect. The extension extracts catalogue pages
(#249/#251), the matcher links items to stamps (#250), the listing module fills Colnect's own sale
form and stops before Save (#409) — a form the collector then submits themselves. Nothing in the
repo has changed anything in a Colnect account without a human pressing Colnect's own button.

The list-sync track ends where that stops being enough. #686 produces a report that says exactly
which items belong on a Colnect list and which do not. Carrying that out by hand is one page load
and one click per item, and the first pass over Swap alone is in the thousands. The report knows the
answer; the collector is reduced to a mouse.

This ADR records the decision to close that loop, because it is a step change and should not be a
side effect of an implementation.

## Decision

**The Assistant applies list membership on Colnect, on the collector's behalf, in their own browser,
against endpoints Colnect does not document.**

### What is written

One endpoint, one act:

```
POST /item/col
act=check & id=<colnect item id> & cat=20 & lt=<list id> & val=+|-
```

This is precisely what clicking the list checkbox on an item row does. `cat=20` is Colnect's stamps
category, the same constant the sale form already uses (`platform/colnect/listing.ts`). `lt` is the
list — 2 Collection, 3 Swap, 4 Wish, 5 Sell, or a custom list's own number.

**Membership only.** The same endpoint accepts `act=x_cond_qty` for quantity and grade, and
`act=public` / `act=private` for the two note fields. None of them is written. A bulk run that
silently re-graded three thousand entries from a CSV is a far larger claim about the collection than
*this is on the list or it is not*, and the report does not hold enough to make it: a stamp with
three copies of two grades has no single Colnect grade (#686), which is exactly why that comparison
stays silent in the first place.

### On whose authority

**The collector's own session cookie, in their own browser, on a colnect.com page.** The write is a
same-origin `fetch` from the content script that is already permitted on `*://*.colnect.com/*`. The
app holds no Colnect credential, is given none, and could not perform this itself.

The gesture is deliberate and per run: the report hands the extension a worklist only after a dialog
that states the counts in both directions. A bulk removal from a public list is visible to every
partner reading it, and is not something to start by accident.

### The endpoints are internal and unsupported

`POST /item/col` is not a documented or supported Colnect API. It was established by reading
`https://colnect.com/s/m.115.js` on 2026-08-22 (`Inventory.col_update` / `col_update_do`). It may
change or disappear without notice, and Colnect is under no obligation to keep it working.

Two consequences are designed in rather than hoped for:

- **A run stops and says so.** An unexpected response is not retried blind and does not fail
  silently: the item is reported and the run halts on anything it cannot classify. A `410` — which
  Colnect's own handler answers by reloading the page — is reported as *the catalogue item changed*,
  for that one item, and the run carries on.
- **Nothing depends on it.** Every list difference remains fixable by hand from the same report row,
  exactly as it was before #689. If the endpoint dies, the loop reverts to what #686 already
  supported: the report tells you what to click, and you click it.

### Rate

Measured on the same site during a bulk close of 3,070 offers (`reference_colnect_bulk_close`):
**~4 req/s trips HTTP 429; ~0.6 req/s ran 3,070 operations with zero 429.** The run is paced at one
write every 1.6 seconds, backs off on 429, and gives up after repeated 429s at the longest back-off
rather than hammering.

A first Swap pass is therefore about an hour and a half of wall clock. That is the cost of being a
polite guest on somebody else's site, and it is why the run is **resumable**: the worklist and a
cursor are written down, an interrupted run continues from where it stopped, and every applied item
is marked done on the report as it lands, so the two screens never disagree about what was carried
out.

### Removals are guarded by the snapshot's age

Additions and removals are not symmetrical acts. An addition is taken on the strength of the
**local** side, read this second: the collection holds it, so the list should name it. A removal is
taken on the strength of the **file**: the report says Colnect has an item the predicate does not
hold for here, and if the export is three weeks old the collector may have added it there since, on
purpose.

So a run refuses its removals against a snapshot older than seven days
(`COLNECT_APPLY_MAX_SNAPSHOT_AGE_DAYS`), keeps its additions, and names the import as the way
through. This is #689's own rule — *removals only from what the report actually saw*.

## Alternatives considered

- **Keep proposing only.** What #686 does. Rejected for the reason #689 exists: the report is
  correct and unusable at Swap's scale, and a tool that knows the answer and makes you click it
  three thousand times is not finished.
- **Write from the server.** Impossible without holding the collector's Colnect credentials, which
  this app will not do, and would put a self-hosted server's IP behind the requests rather than the
  browser already signed in.
- **Drive the page's own checkboxes.** Clicking `span.cb` in a real DOM would be "more official" and
  is strictly worse: it needs the item's page loaded for every item — a page load per write on top
  of the write — and it breaks on any markup change just as surely.
- **Write quantity and grade too.** Rejected above: the local side often has no single honest answer
  to give, and inventing one at three thousand rows is how a shop's listings become wrong quietly.

## Consequences

- The repo now contains code that changes state in a third-party account. `docs/user-guide/` says so
  plainly, and the run's confirmation states the counts before anything is sent.
- `extension/src/platform/colnect/list-write.ts` is the only place that builds this request, and it
  is pure and unit-tested, so what is sent can be asserted without a browser.
- A Colnect change breaks the run and nothing else. The report, the import and every by-hand fix
  keep working.
