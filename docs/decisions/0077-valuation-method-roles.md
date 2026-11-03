# ADR-0077: Each Valuation Method Maps Its Roles to the Collection's Conditions

## Status

Accepted. Decided in #2375 on 2026-11-03 with the collector, its *to be confirmed* points built as
written, and two questions the issue left open answered with the collector while building it (§6).
**Reverses [ADR-0020](0020-stamp-format-axis.md) §10** (prices on cover and on piece as four reserved
formats, #2356) and **§11** in its price-grid half (Michel's rule as a derivation of the grid, #2358);
**amends [ADR-0076](0076-piece-valuation-methods.md)** §4 (a format of a kind) and §7 (Michel's rule for
a piece). Builds on #2374, a condition that is a price column only. Part of the cover valuation track.

## Context

#2356 stored a stamp's cover prices — Michel's ⊠ EF, MeF, MiF and *Bfst*, Fischer's ⊠ — as four reserved
rows of the format dictionary, so every price path carried them as formats. The collector could not
name, abbreviate or translate them, and they sat in the format axis although a catalogue prints them as
**columns**, the way it prints ** and ⊙. Fischer prints its own columns — ⊠, or FP / FW / FM for some
areas — which the reserved rows could hold only by convention (⊠ in *Cover MiF*, FP/FW/FM in EF/MeF/MiF).
#2374 let a condition be a price column only. What was left was to tell each method which column is
which.

## Decision

### 1. A method maps each role it reads to one of the collection's conditions

`ValuationMethodRole` — collection × method × role → condition, one row per role at most:

| Method | Roles |
| --- | --- |
| *Michel* | used, cover EF, cover MeF, cover MiF, on piece, never hinged |
| *Fischer* | used, cover ⊠, on piece |
| *Fischer FP/FW/FM* | used, FP, FW, FM, on piece |
| *Sum of used* | used |

A CHECK lists the pairs; `valuation-method-roles.ts` holds the same lists and `roleOfPrice`, which says
which role stands behind each of the five prices `valuePiece`'s rules name (Fischer's ⊠ behind its MiF
rule, FP/FW/FM behind EF/MeF/MiF). **Any condition can be mapped**, a price column only or not — *used*
is normally an ordinary condition such as *U* — and one condition may play roles in several methods.
Deleting the condition deletes the row, and the role is unmapped. The page is **Settings → Valuation
methods**: the collection's default method (moved from Settings → Formats) and one card per method, a
condition picker per role.

### 2. Every price a piece's value reads comes from the mapped condition

The used price too: the copy's own condition steers nothing. Each price is read at the single, no
certificate, the latest edition of the stamp's main catalogue — the used price at the entry's own
format, since a block's used price is a block's. The fields that type a piece's prices in place (#2368)
follow the mapping: each column is headed by the mapped condition's abbreviation, and a typed figure is
saved in that condition. The arithmetic (#2353) names a price by the condition's symbol where it has one
(⊠, ⊙), else its abbreviation.

### 3. An unmapped role makes the value partial, and is never filled from another

A price whose role is not set up is noted as **unmapped** rather than missing — there is nothing to type
it into — and the valuation names the method and the role (`PieceValuation.unmapped`), with a link to the
page. No role is read in place of another, and **nothing derives live**: a missing price in a mapped
condition is missing. *Fill from another condition* on the variant price grid is how a column is filled
from a ratio, once.

### 4. Michel's rule is the Michel method's

Where a stamp still valid for postage has no price in the condition Michel maps as cover EF, MeF or MiF,
the method works one out by the rule from the conditions it maps as *used* and *never hinged* (the same
edition's singles; `pickStillValidPrice`). With either of those unmapped it gives nothing and names the
role. The figure is the method's working: shown as derived (`~`) in the piece's windows only, never
written to the stamp's prices and never shown on a price grid or a list — so ADR-0020 §11's derivation on
the grids, the lists' *as* column and the agent's price reads goes, with `FormatDerivation`'s second case
and `StampCondition.priceRole`. Which stamps are still valid stays a mark on an area or an issue.

### 5. The reserved formats go, and nothing takes their place

The four rows, their prices and their multipliers are deleted, and `StampFormat.coverKind` with them,
`COPY_FORMAT_WHERE` and the price surfaces' `withCoverPrices` too; the agent API's catalogue price tools
no longer accept them. **The migration creates nothing** — no conditions, no mappings, no prices moved —
so a collection values pieces again once the collector has set the roles up. The format kind (*On cover*,
*On piece*) stays as ADR-0076 §4 built it, without the move of a format's prices into *Cover EF* on giving
it a kind: a format of a kind is still left off the price surfaces (`getStampFormats(…, { forPrices })`).

### 6. Decided in building it

- **Which stamp is the most expensive**, and so whose area decides the method, is read by the used price
  in the condition the **collection's default method** maps as used — the method cannot be known before
  it is chosen (the collector's call). With that role unmapped the collector's order decides.
- **A want, a lot line or a trade line in a format of a kind** is valued as a piece of its one stamp —
  one stamp once, rate-correct, by its area's method or the collection's (the collector's call). It had
  been priced at the reserved row.
- **The agent API** reads and sets the mappings (`get_valuation_methods`, `set_valuation_method_role`),
  and a piece's value names its roles not set up (`notSetUp`) and the condition of each missing price.

## Consequences

- After the migration every piece is unpriced and says which role of which method is not set up, until
  the collector maps them; the prices typed into the reserved formats are gone, as the issue settled.
- A cover price is an ordinary catalogue price in a condition: the price grid's condition columns, the
  lists' *Price for* switcher, filling one condition from another and the agent's price tools all reach
  it with nothing learned.
- A collector who prints Fischer's FP/FW/FM beside Michel's EF/MeF/MiF can keep both — two sets of
  conditions, each method mapped to its own.
