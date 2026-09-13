-- The value of a multi-stamp copy (#747, ADR-0044 §6).
--
-- A carrier bearing more than one stamp is a copy of none of them (#745), so the catalogue grid —
-- keyed `stamp × condition × certificate × format` — has nothing to resolve for it, and the piece
-- would sit unpriced for ever. Covers are usually the interesting part of a collection, so the value
-- is recorded **on the copy**, by the collector: an amount and the currency it was stated in.
--
-- **Explicit, never derived.** The sum of the components is offered as a suggestion in the Valuation
-- dialog and is never written here on its own: the worth of a cover is a question of usage and
-- franking rather than the arithmetic of its stamps, and a figure that entered the collection's
-- totals without anybody judging it would be a claim the app invented. So these two columns hold
-- only what the collector accepted.
--
-- **Read only while the copy is a carrier** (`"stampCount" > 1`). An ordinary copy keeps resolving
-- from the catalogue, unchanged, and a carrier edited back down to one stamp does too — the figure
-- stays in the row rather than being erased as a side effect of an edit to the stamp list, so taking
-- a stamp off by mistake and putting it back loses nothing.
--
-- NULL on both for every existing row: nothing could record one before this migration, and "no
-- value" is what a carrier without one is — **unpriced, not zero**. The CHECK keeps the pair honest,
-- since an amount with no currency is not a figure anything can convert.
--
-- `DECIMAL(10, 2)` like `"costBasis"`, the other money this row carries. No index: the value is read
-- with the copy and is never a search term — the "missing catalog value" filter is a valuation pass,
-- not a `where`.

ALTER TABLE "item"
  ADD COLUMN "explicitValue" DECIMAL(10, 2),
  ADD COLUMN "explicitValueCurrency" TEXT,
  ADD CONSTRAINT "item_explicit_value_pair"
    CHECK (("explicitValue" IS NULL) = ("explicitValueCurrency" IS NULL));
