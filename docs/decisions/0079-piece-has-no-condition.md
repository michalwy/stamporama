# ADR-0079: A Piece Has No Condition and Counts Towards No Stamp

## Status

Accepted. Decided in #2383 on 2026-11-03 with the collector — a piece has no condition, and a cover
carrying one stamp no longer counts towards that stamp's holdings — and built there, the issue's *to be
confirmed* points as written and the one question it left open answered in §6. **Amends
[ADR-0044](0044-multi-stamp-copies.md) §3** (a one-stamp cover was a counted copy of its stamp) **and
[ADR-0076](0076-piece-valuation-methods.md) §4** (the same, restated for a format with a kind). Part of
the cover valuation track, after #2375.

## Context

A piece — a copy carrying several stamps, or one stamp on a format of kind *On cover* or *On piece*
(ADR-0076, `isPiece`) — kept the condition a loose stamp has. It meant nothing: "MNH" on a posted cover
describes no paper the collector holds, and since #2375 no price is read from it — every price a
method reads comes from the condition it maps to the price's role. What it still did was harm: a cover
carrying one stamp was counted as a copy of that stamp **in that condition**, so *You hold*, the
checklists and the wants all said the collection held a Mi 200 it could not supply without destroying
a cover. ADR-0044 §3 had excused that case on the ground of *unambiguity* — one catalogue position on a
cover *is* that position "on cover". The collector decided that a cover is not a copy of its stamp
whatever it carries.

## Decision

### 1. A piece has no condition

`Item.conditionId` is nullable, and null **exactly** when the copy is a piece. Its state is its
franking and its faults. The Condition control is not shown for a piece — in identification, in the
copy's Edit dialog — and nothing shows a condition for it. The certificate stays: a cover can be
certified as a whole.

### 2. Becoming a piece clears it; ceasing to be one asks for it

`item-condition.ts` (`settleCopyConditionsTx`) runs after every write that can change either side — a
copy created (every creation path passes `createLeadingEntriesTx` or `setItemStampsTx`), its stamps
re-derived (`syncItemFromEntriesTx`), the copy edited (`updateItem`), a bulk change of its axes, a
format given or relieved of a kind (`updateStampFormat`). A piece keeps no condition it was given; a
loose stamp left without one is refused (`ConditionRequiredError`), and the refusal rolls back the
write that caused it. Picking a format with a kind or adding a second stamp therefore drops the
condition, and turning a piece back into a loose stamp needs one in the same save.

### 3. No piece counts towards a stamp's holdings

A cover carrying one stamp is counted exactly as one carrying several — towards none of them: copy
counts, *You hold*, checklists and completeness, wants and the want review, for-sale stock, the Colnect
list reads, the duplicate review, a stamp's purchase costs. Because §2 keeps the condition null exactly
for a piece, **the condition is the flat column the predicate reads**: `NOT_PIECE` (`multi-stamp.ts`,
`{ stampCount: 1, conditionId: { not: null } }`, and `NOT_PIECE_SQL` for the raw Colnect reads) is a
plain `where` beside `disposedAt: null`, as `stampCount` alone was, rather than a join on the format's
kind. `NOT_MULTI_STAMP` stays for what is about *several* stamps — the Copies list's *Several stamps*
filter.

The grouped Copies list follows: duplicate and issue groups are keyed on a stamp and leave every piece
out, and the bucket that collected the carriers of several stamps now collects every piece (*Covers and
pieces*). Its member reads narrow with a `piece` filter (`only` / `exclude`), never on the bar.

### 4. Filtering by condition never hides a piece for good

The Copies list's condition filter has a *No condition* value (`NO_CONDITION`, `"none"`, the
certificate axis's own spelling) matching the pieces and only them; the structure screen offers it as a
segment where there is a piece to put in it, and the new-offer panel's filter likewise.

### 5. What reads a condition says nothing for a piece

Generated texts name no condition for a piece, and a template asking for one gets nothing, no stand-in.
A piece has no catalogue cell of its own to quick-price, no market median by stamp × condition, no
platform grade — a platform that grades every listing (Colnect) refuses it with a blocker of its own
(`piece-without-condition`). The *last used* condition seeding in identification and the copy form does
not apply to a piece and is not overwritten by one.

### 6. Decided in building it

A format's kind cannot be taken away while one-stamp copies are in it: they would be loose stamps
without a condition. The refusal says to move them to another format first, where the copy's Edit
dialog asks for one. Giving a format a kind clears its copies' conditions at once.

### 7. The migration

`20261103230000_piece_no_condition` makes the column nullable and clears the condition of every
existing piece. Nothing is kept elsewhere: the value never read it.

### 8. The agent API

A copy's `condition` is absent for a piece in every read that states one (holdings, a copy's record,
search, unlisted copies, give lines), and `byCondition` counts no piece. The API has no write that
sets a copy's condition; the domain refusal above is what any future one meets.

## Consequences

- `Item.conditionId` is read as nullable everywhere; the surfaces about a stamp in a condition take a
  copy through `conditioned()` (`piece-condition.ts`), which is null for a piece.
- The browser extension's listing task and search copy carry `condition: null` for a piece.
- ADR-0044 §3's *unambiguity* reading is gone: the rule is now about what a piece is.
