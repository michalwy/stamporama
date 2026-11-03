# ADR-0076: A Piece's Catalogue Value Is Computed by a Valuation Method

## Status

Accepted. Decided in #2359 on 2026-11-02 and built there; the design was settled with the collector in
the issue, and its *to be confirmed* points were implemented as written, with the few questions the
issue left open answered in §7. Amends [ADR-0044](0044-multi-stamp-copies.md) §6 (a carrier's value
was the figure recorded on it, #747) and completes [ADR-0020](0020-stamp-format-axis.md) §10 (the prices on
cover and on piece, #2356, which nothing read for a copy until now). Part of the cover valuation track
#2353 and #2356–#2359; #2353 shows how the value was reached. **Amended by
[ADR-0077](0077-valuation-method-roles.md) (#2375)**: every price a method reads comes from a condition
it maps to each of its roles, the reserved cover formats are gone, and Michel's rule is the Michel
method's — §4 and §7 say where.

## Context

A cover, a fragment or another piece carrying several stamps had no catalogue value: the collector
typed one in, helped by the sum of its stamps' loose prices (#747). Catalogues value such pieces by
rules of their own. Michel-Spezial prices a genuinely posted, correctly franked cover by its franking —
single (EF), multiple (MeF) or mixed (MiF) — and caps an overfranked or set cover at the most
expensive used stamp + 15 %. Fischer prices a cover from one ⊠ price per stamp by formula: 150 % for
two of the same stamp, 50 % of the most expensive in a mixed franking, the rest at used prices; for
some areas (the General Government) it prints the three franking prices separately. #2356 gave every
stamp room for those prices. What was missing was the rule that reads them.

## Decision

### 1. A piece is valued by a method

A **piece** is a copy carrying several stamps (ADR-0044), or one stamp once on a format of kind *On
cover* or *On piece* (§4). Its catalogue value is **computed** from its stamps' prices by one of four
methods (`piece-valuation.ts`):

- **Sum of used** — every stamp at its used price, in its own format, times its quantity (what #747
  suggested).
- **Michel** — on piece: Σ on-piece prices, whatever the franking. On cover, rate-correct: EF → the
  stamp's EF price; MeF → its MeF price; MiF → the highest MiF price among the stamps, the others adding
  nothing (a cover's ⊠ price is the cover's). Philatelic, posted: the most expensive stamp's used price
  + 15 %. Not posted: Σ used prices.
- **Fischer** — each stamp's ⊠ price is its MiF price (#2356). EF → ⊠; MeF → 150 % of ⊠ for the first
  two stamps, every further one at its used price; MiF → 50 % of the highest ⊠, every other stamp
  (further copies of that one included) at its used price.
- **Fischer FP/FW/FM** — EF → FP (EF), MeF → FW (MeF), MiF → the highest FM (MiF), no formula.

Under both Fischer methods a fragment and a cover not posted are valued as under Michel, and a
philatelic cover as a rate-correct one, since Fischer states no rule for it.

**EF, MeF or MiF counts stamps, not rows**: one stamp once is EF; one stamp several times — quantity
above 1, or an entry in a multiple format such as a block — is MeF; more than one stamp is MiF.

Every price is read as every price is (ADR-0007 §7): the area's primary catalogue at its latest
edition, explicit or derived by a format multiplier, the unknown-variant rollup, **at the copy's
condition and no certificate** (ADR-0044's component key), and compared in the collection currency.
The most expensive stamp is the one with the highest used price as a single.

### 2. Where the method comes from

A method is set on an **area** and inherited downwards unless an area below sets another; the
**collection** has a default, **Michel**. **The area of the piece's most expensive stamp decides**, and
a **copy can set its own**, which wins. `Collection.valuationMethod` (NOT NULL, default `michel`),
`CollectionArea.valuationMethod` and `Item.valuationMethod` (null follows) hold them, each with a CHECK.
They are set where format multipliers are: an area's ⋮ menu on the Areas screen (which names what *Same
as parent* resolves to and from where), Settings → Formats → *Valuation method* for the collection, and
the copy's Edit dialog — and, since #2369, beside the franking in the piece's Valuation window and the
identification step, whose *As inherited* names the method and where it comes from.

*Amended by #2385:* an area's method is a field of its **Edit** dialog on the Areas screen, not an
action of its ⋮ menu; *Same as parent* still names what it resolves to and from where, and choosing the
method the area would inherit anyway stores *same as parent*.

### 3. A piece has a franking

`Item.franking` — `rate_correct` (every row, new and old), `philatelic_posted`, `not_posted` — read only
for a piece on a cover. Set in the copy's Edit dialog and in the identification step, next to the stamps
on the piece.

### 4. A format has a kind

`StampFormat.pieceKind` — `on_cover`, `on_piece`, or null — set under Settings → Formats, never on the
four reserved price rows (a CHECK). It decides which rules apply: a piece whose format has no kind (an
FDC, until #2355 settles it) is valued by *Sum of used* whatever the method, and says so. A format with a
kind **has no prices of its own**: what was typed on its tab is the stamp's single-franking price, so
giving a format the kind moves its prices and multipliers to *Cover EF* (*On piece* for that kind); a
key the reserved row already fills keeps the reserved row's. A want, a lot line or a trade line in such
a format is priced at the reserved row for the same reason, and the price surfaces leave the format out.

*Since ADR-0077 (#2375)*: giving a format a kind moves nothing, there being no reserved row to move to;
the price surfaces still leave the format out, and a want, a lot line or a trade line in it is valued as
a piece of its one stamp, rate-correct, from the conditions its method maps.

One stamp once on a format of kind *On cover* is still a copy of that stamp and still counted (ADR-0044
§3 is unchanged); only its value is the method's — its EF price under Michel.

### 5. A missing price makes the value partial

A price the rule reads that is missing makes the value **partial**, and the valuation says which stamp
and which price (`CopyValuation.piece.missing`). For the highest of several prices a stamp without one
could have been the highest, so it makes the value partial too. The figure is what is priced, a lower
bound; with nothing priced the piece is unpriced, never zero.

### 6. The recorded value is retired

ADR-0044 §6 is replaced: a piece's catalogue value is the method's result. The value typed by hand
(#747) is moved, **once at boot** (`piece-value-conversion.ts`, the #1800/#2068 pattern, since the
method reads the catalogue in TypeScript), onto the copy's **amount modifier** (#2357): the amount is
whatever makes the modified value equal what the piece was worth, converted to the collection currency,
so no piece's value changes on the day. A piece the method prices nothing on, or whose recorded currency
has no rate, keeps its recorded figure in the row, is logged, and is moved on a later boot. Nothing else
reads `Item.explicitValue`; a later migration drops it with its currency.

So that the move measures against the rule the collector would have chosen, the migration gives the
formats the user guide suggests — named or abbreviated *Cover*, *Piece* or *Fragment*, case aside — their
kind, moving their prices as §4 does. The collector can change any of them afterwards.

### 7. Decided in building it

- **ADR-0020 gives a format no count of stamps**, so where Fischer's formulas count, an entry in a
  multiple format counts as **one** stamp of its quantity, at its own format's used price; and the two
  stamps priced at ⊠ are taken from the multiples first. A block alone on a cover is therefore 150 % of
  ⊠ — a lower bound, never a guess at how many stamps the block holds. Under Michel and FP/FW/FM nothing
  counts, and a block is simply MeF.
- **A still-valid stamp's cover prices come from Michel's rule** (#2358) for a piece too: where its
  EF, MeF or MiF price is read in the used condition, the rule replaces the multiplier, as on the price
  surfaces. *Since ADR-0077 §4 (#2375)*: the rule is the Michel method's alone, read from the conditions
  it maps as used and never hinged, and shown as derived in the piece's windows only.
- **A piece's value is in the collection currency**, where its prices were compared; its modifier's
  amount is in that currency too.
- **A trade's agreed valuation values a piece by its method in the agreed book**: the method is the
  catalogue's rule, and the partner's book has the prices to apply it. Until now a carrier had no agreed
  figure, because the recorded value was the collector's judgement.
- **The catalogue factor (#1828) leaves pieces out** of the ratio it learns — a lot or a price
  observation in a format of a kind — and the estimate (#602, #1829) is not applied to a piece: the ratio
  is learned from stamps, and a cover's value is not a stamp's.
- **The agent API** reports a piece's method, where it came from, its franking and kind, how it was
  franked and the prices it missed in `catalogValue.piece` (replacing `recorded`), and sets the franking
  and the copy's method with `set_copy_valuation`.

## Consequences

- Every reader of `valuateItemRows` gets the computed value with nothing of its own changed:
  `ValuationRow.copy` (renamed from `carrier`) is required and non-null for every copy, and whether the
  copy is a piece is decided inside `valuateItemRows`, which knows the format kinds.
- The Valuation window of a piece shows the computed value, the method and where it came from, the
  franking and what is missing, beside its stamps at their used prices; *Value of this piece* and *Use
  this sum* are gone. How each figure was reached, price by price, is #2353's.
- **Built in #2353**: the rule records the terms it adds (`PieceTerm`) and the valuation carries them
  with every stamp's prices, so the Valuation window and the identification step print the arithmetic
  from what the rule actually read; each stamp shows its used price and its price on the piece, the
  franking is changeable in both, and identification previews the value before the copy is written.
- A collection whose formats have other names starts with every piece on *Sum of used* until the
  collector gives the formats their kinds; values then follow the method, the moved modifiers unchanged.
