# ADR-0078: A Piece Is Never Valued Below the Sum of Its Stamps' Used Prices

## Status

Accepted. Decided with the collector in #2397 on 2026-11-03 and built there; the issue's *to be
confirmed* points were implemented as written. **Amends [ADR-0076](0076-piece-valuation-methods.md)**
§1 (what a method gives is no longer the value on its own) and §5 (a missing used price makes every
piece's value partial). [ADR-0077](0077-valuation-method-roles.md) §1 needs no new role: every method
already maps *used*, and every method now reads it.

## Context

Michel caps a philatelic, posted cover at the most expensive used stamp + 15 % (*Überfrankaturen,
Satzbriefe und dergleichen werten, wenn echt gelaufen, höchstens 15 % mehr als die teuerste ⊙-Marke*).
Read as the catalogue states it, a cover carrying six stamps at ⊙ 0.30 EUR (1.33 PLN) each comes to
1.53 PLN, while the six stamps soaked off are worth 7.98 PLN. A value that makes destroying the cover
the better deal is not one the collector will use. The same can happen under any method: a rate-correct
mixed franking whose MiF price is below its stamps' used prices, or Fischer's 50 % of the highest ⊠.

## Decision

### 1. The value is the greater of the rule's figure and the sum of used prices

Whatever the method (Michel, Fischer, Fischer FP/FW/FM), the franking or the format's kind, a piece's
computed value is the **greater** of what the method's rule gives (ADR-0076 §1) and the **sum of its
stamps' used prices** — each stamp at its used price in its own format, times its quantity, read from
the method's mapped *used* condition: exactly what *Sum of used* computes. *Sum of used* — the method,
a cover not posted, a piece whose format has no kind — is its own floor and is not compared.

Michel's wording is kept as the Michel method's rule: the floor is a second figure beside it, not a
reading of the catalogue. Michel's *very rare stamps excepted* is not modelled; the value modifier
covers it by hand.

### 2. The arithmetic shows both

The valuation carries the floor beside the rule's terms (`PieceValuation.floor`: the sum, the rule's
own figure, and whether the floor is the value). The arithmetic prints the rule's sum, then the sum of
used prices and which is the value — *Philatelic: 115 % × Mi 7 ⊙ 1.33 = 1.53 · Sum of used 7.98 is
higher → 7.98* — and names the sum when the rule's figure stands too, so the comparison is visible.

### 3. A missing used price makes the value partial under every method

The floor could have been higher, so a missing used price is a missing price under every method
(ADR-0076 §5), named on its stamp; an unmapped *used* role is noted as unmapped (ADR-0077 §3). The
fields that type a piece's prices in place ask every stamp's used price under every rule.

### 4. The modifier and the fault reduction apply to the floored value

In the order they apply today (#2357, #1560): the floor is part of the computed value.

## Consequences

- Every reader of `valuateItemRows` gets the floored figure with nothing of its own changed: the floor
  is inside `valuePiece`.
- Pieces whose used prices outweigh their rule's figure rise in value the day this ships; the moved
  recorded values (ADR-0076 §6) are modifiers on top and move with them.
- The agent API's `catalogValue.piece` says when the floor is the value (`raisedToSumOfUsed`).
