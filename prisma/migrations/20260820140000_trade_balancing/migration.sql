-- The balancing engine's storage (#638; ADR-0039 §7): the two escape hatches on a line, the freeze
-- at `agreed`, and the rates a trade's figures are read through.
--
-- Nothing here computes anything. Own and agreed valuations are computed live from the catalogs
-- while a trade is being composed, exactly as every other valuation in the app is; these tables
-- exist for the three cases where a live read is the wrong answer:
--
--   1. material no catalog in the collection prices, which must not deadlock a trade;
--   2. one line the two sides agreed to look up in a different publisher's book;
--   3. the moment both sides commit, after which a new catalog edition loaded next week must not
--      silently rewrite a list the partner is holding a printout of.

-- ── 1. The line's two escape hatches ────────────────────────────────────────────────────────────
--
-- `manualValue` is in the collection's **base** currency and is the collector's own figure, marked
-- as such everywhere it is shown. Deliberately narrow: the default reflex stays "type the price on
-- the stamp", because a price is a property of the stamp and once entered it is there for good,
-- while a figure here describes one line of one trade. It is categorically different from the zero
-- the app refuses to assume.
--
-- `catalogVendorId` is the per-line rescue for the agreed catalog — "this one line we look up in
-- Fischer instead". A **vendor**, for the reason `trade.catalogVendorId` is one: which volume the
-- line is read in still follows from its stamp's area through `collection_area_catalog`.
ALTER TABLE "trade_line" ADD COLUMN "manualValue" DECIMAL(12,2);
ALTER TABLE "trade_line" ADD COLUMN "catalogVendorId" TEXT;

CREATE INDEX "trade_line_catalogVendorId_idx" ON "trade_line"("catalogVendorId");

-- RESTRICT, as every other named-catalog reference on a trade is: a vendor named on one line of an
-- agreement must not be deletable out from under it.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_catalogVendorId_fkey"
    FOREIGN KEY ("catalogVendorId") REFERENCES "catalog_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. The freeze ───────────────────────────────────────────────────────────────────────────────
--
-- One row per (line, valuation kind). `kind` is an axis rather than two sets of columns on the line,
-- for the reason `side` is one (ADR-0039 §1): the two valuations are the same shape asked of two
-- different books, and neither may acquire a field the other lacks.
--
-- The catalog's name and currency are **text**, not foreign keys. That is the entire point of a
-- snapshot: a catalog renamed, re-priced or deleted next week cannot restate what was agreed.
--
-- Rows exist only while a trade is frozen. The move to `agreed` writes them; going back to a status
-- whose list can be edited deletes them, because what is editable is not frozen and a snapshot
-- shadowing a live edit is the one way this table could lie.
CREATE TABLE "trade_line_valuation" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    -- own | agreed. The vocabulary lives in `trade-rules.ts`; nothing reads this spelling.
    "kind" TEXT NOT NULL,
    -- The picked catalog price in the currency that catalog prints, null when the line carries no
    -- catalog figure at all.
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    -- The book and the edition it was read at, as they read that day.
    "catalogName" TEXT,
    "editionYear" INTEGER,
    -- `currency` → `targetCurrency`. Null when the two agree, and null when no rate could be had —
    -- in which case `value` is null too: a converted figure nobody can reproduce is worse than none.
    "rate" DECIMAL(65,30),
    -- Base currency for `own`, the trade's currency for `agreed`. Stored rather than derived: the
    -- collection's base currency is a setting, and a trade agreed under the old one still means what
    -- it meant.
    "targetCurrency" TEXT NOT NULL,
    "value" DECIMAL(12,2),
    -- An unknown-variant rollup (#238). Still counts as a value for both gates — blocking on it
    -- would throw every umbrella stamp out of every trade, and a negotiating figure claims nothing
    -- of what a listing claims (#617).
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    -- The figure is `trade_line.manualValue`, never a catalog one. Carried into the freeze so a
    -- printed list cannot present a typed number as a published price.
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_line_valuation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_line_valuation_lineId_kind_key" ON "trade_line_valuation"("lineId", "kind");
CREATE INDEX "trade_line_valuation_lineId_idx" ON "trade_line_valuation"("lineId");

-- CASCADE: a snapshot is a fact about a line and has nothing to say once the line is gone.
ALTER TABLE "trade_line_valuation" ADD CONSTRAINT "trade_line_valuation_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "trade_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. The rates ────────────────────────────────────────────────────────────────────────────────
--
-- `exchange_rate`'s own shape with the collection swapped for a trade, because that is the
-- difference that matters: a collection's rate is today's, a trade's is the one both sides
-- negotiated under. Frozen at the first share, refreshable while `shared`, hard-frozen at `agreed`.
--
-- `toCurrency` is in the key because a trade converts toward **two** targets — the collector's own
-- valuation lands in the collection's base currency and the agreed one in the trade's — and one row
-- cannot mean both.
CREATE TABLE "trade_fx_rate" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    -- Printed beside the figures: a rate with no date is a number nobody can check.
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_fx_rate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_fx_rate_tradeId_fromCurrency_toCurrency_key" ON "trade_fx_rate"("tradeId", "fromCurrency", "toCurrency");
CREATE INDEX "trade_fx_rate_tradeId_idx" ON "trade_fx_rate"("tradeId");

ALTER TABLE "trade_fx_rate" ADD CONSTRAINT "trade_fx_rate_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
