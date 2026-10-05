# ADR-0065: A Copy Identified as One of Several Candidate Stamps

## Status

Accepted. Written by #1651. **Extends ADR-0007** §2/§6/§7 (a copy points at one node of a variant
tree; an umbrella means *some variant of it*), as revised by **ADR-0010** §3 (what a variant edge is),
and sits beside **ADR-0044** (a copy carrying several stamps). #1651 is delivered in three pull
requests: the model, the valuation, the counts, the wants and trades, the listing and the agent API
first; the screens second; *possibly this copy* under each candidate on the issue-grouped lists and
the copy-count chips third. §8 below is what the third will build on.

## Context

A copy points at exactly one stamp, and pointing at an umbrella means *some variant of it, not known
which*, valued at the cheapest (#101, #238). That cannot express partial knowledge. With a tree

```
123
├─ 123a   (colour a)       ├─ 123aI   (type I)
│                          └─ 123aII  (type II)
└─ 123b   (colour b)       ├─ 123bI
                           └─ 123bII
```

where the colours are hard to tell apart and the types easy, a copy known to be type I but of
unknown colour is *123aI or 123bI*: pointing at 123 throws the type away, and pointing at 123a or
123aI claims a colour that is not known.

German Reich stamps raise the same question one level up: the watermark decides between two
catalogue numbers in **different issues**, and it often cannot be read, above all on a piece or a
cover. The uncertainty is about the issue as well as the variant.

Decided with the collector on 2026-10-04 and 2026-10-05: a copy can point at a **set** of candidate
stamps; the candidates may come from different trees and issues; a copy whose candidates lie in
several trees is shown under each as *possibly this copy*, counts towards no completeness, and is
counted once in totals at its cheapest candidate. Rejected: describing variants as independent axes
(colour × type) and identifying a copy per axis — too large a change to the catalogue, its prices and
its checklists.

## Decisions

### 1. `ItemCandidate` holds the set, apart from `ItemStamp`

A copy's candidate set is a table of its own, `ItemCandidate(itemId, stampId)`. It is **"one of
these"**, and `ItemStamp` (ADR-0044) is **"every one of these"**: that table is summed into
`stampCount`, enumerated by `{catalog}` and searched as stamps the piece carries. Putting candidates
there would make every one of those readers assert the copy carries stamps it does not.

An ordinary copy has no rows. A set has two or more.

### 2. Sets only on a copy of one stamp

A set is offered on a single-stamp copy only (the collector, 2026-10-05). A cover or a piece bearing
**one** German Reich stamp is such a copy — its format says what the carrier is (ADR-0044 §5) — so
the watermark case is covered. A carrier of several stamps is a copy of none of them and has a value
of its own (ADR-0044 §3/§6); a set on one of its components would change only its name, so the
uncertainty goes in the copy's notes. Giving a copy a second stamp drops its set (`syncItemFromEntriesTx`).

### 3. The set is canonical

What was ticked is put in canonical form before it is stored (`canonicalCandidateSet`):

- a candidate under another candidate, along variant edges, goes — *123a or 123aI* is *123a*;
- **every variant of one umbrella is the umbrella**, applied until nothing changes — ticking 123aI,
  123aII, 123bI and 123bII is 123a and 123b, which is 123, an ordinary umbrella copy;
- one stamp left is an ordinary copy of it.

### 4. A tree is a variant tree, and the pointer follows from it

A **tree** is what a stamp climbs to along *variant* edges (ADR-0010 §3). A distinct entry — an error,
an overprint — is its own catalogue position, so *2 or 2 B1* spans two trees exactly as *Mi 85 or
Mi 101* does.

`Item.stampId` stays non-null and stays a pointer (171 readers, ADR-0044 §2's reason):

- **one tree**: the candidates' **nearest common variant ancestor**. The copy is then an umbrella
  copy of it for every count — the copy counts, the checklist rollup, duplicates — and those needed
  no change. Because every candidate reaches that ancestor along variant edges, *counts towards a
  checklist only when every candidate is on it* holds by the existing chain rule: the ancestor's
  chain is the only one the copy climbs.
- **several trees**: no shared stamp exists; the pointer is the first candidate in catalogue order
  and is never read as the copy's identity.

`Item.candidateTrees` materialises the number of trees (0 without a set), for `stampCount`'s reason:
the exclusion `NOT_ACROSS_TREES` is a flat `where`, spread beside `NOT_MULTI_STAMP` in every read that
counts held copies of a catalogue position. Both derived values depend on the catalogue as well as on
the set, so the four edits that can change a variant tree — a stamp moved under another parent, a
stamp's subtype or override changed, a subtype's flag flipped, a stamp deleted with its children
re-parented — call `refreshCandidateCopiesTx`. It keeps the set as ticked and writes no history.

### 5. Valued over the candidates only

A set is valued as an umbrella is, over its candidates only (`valuateCandidateCopy`): each candidate
valued as a copy of it would be — its own area's catalogue, its own issue's format factor, its own
variants when it is an umbrella — and the **lowest** taken in base currency, flagged uncertain, with
`sourceStampId` naming the cheapest candidate or the variant of it the figure came from. Ties go to
catalogue order. `unpricedVariantIds` carries every identified candidate with nothing entered, which
is what a listing must not stand on (#617).

**Market value** is the lowest of the candidates' medians, **and none while any candidate has no
evidence** (the collector, 2026-10-05): a candidate with no results could be the cheaper one.

`ValuationRow.candidateStampIds` is **required**, as `carrier` is, so no copy reader can value a set
at its pointer by omission; a row that is not a copy passes null.

### 6. Listed under its cheapest candidate

A set is listed for sale as an umbrella copy is (#616), under its cheapest candidate, through the same
`resolveListingCatalogItemIds`. Its pointer's own item-ID and an offer's hand-picked variant for the
pointer are not read. The listing text says what it may be: `{#unknownVariant}` renders and
`{variants}` names the candidates; across trees `{catalog}` names each candidate, as it names each
stamp of a carrier, since there is no shared stamp to name.

### 7. Wants and trades: only if every candidate would

A want names one stamp and is matched exactly (ADR-0032 §7), so a set of two or more different stamps
satisfies none: `NO_CANDIDATES` takes sets out of the want tallies and the intake review, and the
trade requirement resolution and like-for-like alternatives leave them out (`excludeCandidateSets`).
A set may still be **promised** on a trade, which names a copy rather than a stamp.

### 8. Across trees: possibly this copy

A copy whose candidates span several trees counts towards no completeness and no copy count until it
is settled. Showing it under each candidate as *possibly this copy*, counted apart, is the third pull
request of #1651; `item_candidate_stampId_idx` is the read it will need. Collection totals count it
once, at its cheapest candidate, which §5 already does.

### 9. Settling and narrowing

A set is narrowed by writing a smaller one and settled by writing one stamp — `setCopyStamp`, the one
write behind identification, settling and the agent API's `set_copy_stamp`. *Identify variant* on a
set accepts a candidate or a variant of one. Re-pointing the copy writes a refinement-history row
(ADR-0007 §6); narrowing without moving the pointer writes none. An edit re-identifying the copy as
one stamp drops the set. A stamp still named as a candidate is not deleted (`deleteStamp` refuses,
as it refuses one a piece still carries).

## Consequences

- The agent API covers sets fully: every copy read reports `candidates` and `variantToSettle`,
  `set_copy_stamp` writes, `list_holdings` filters by `variant_to_settle`, and the OpenAPI description
  tells an agent to report *123aI or 123bI* rather than either (`docs/agents/agent-api.md`).
- `ItemListItem` carries the set labelled, for the screens.
- Area slicing of the value snapshots follows the pointer: across trees, the first candidate's area.
  The German Reich case keeps both candidates in one area; a set spanning areas is filed under the
  first.
- Duplicate groups and issue groups still key on the pointer; the third pull request settles where a
  set across trees is listed.
