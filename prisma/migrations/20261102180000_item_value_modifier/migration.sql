-- A copy's catalogue value adjusted on the copy (#2357): a percentage and an amount, with a note.
--
-- Catalogues carry exceptions a price grid cannot hold — a surcharge for a particular cancellation
-- (+200 %), a premium for a rare usage, a fixed addition for a feature. The collector states it on
-- the copy, and the copy is valued at
--
--   catalogue value × (1 + percent / 100) + amount, never below zero,
--
-- and only then lowered by the fault reduction (#1560), which stays its own column. The amount has no
-- currency of its own: it is in the currency of the figure it adjusts — the catalogue edition the copy
-- was valued from — and is converted with it, so "+200 € in Michel" stays what the catalogue said.
-- A copy with no catalogue figure gets no value from the modifier alone.
--
-- NULL is no modifier, and is what every existing row holds. Zero is written as NULL by the app so
-- "none" has one spelling, which the CHECKs keep for a hand-edited row too. The percentage is a whole
-- number from −100 up, with no upper limit; the amount may be negative. The note says why
-- ("Stempel Danzig +200 %") and exists only beside a percentage or an amount. No index — the figures
-- are read with the copy and are never a search term.

ALTER TABLE "item"
  ADD COLUMN "valueModifierPercent" INTEGER,
  ADD COLUMN "valueModifierAmount" DECIMAL(10,2),
  ADD COLUMN "valueModifierNote" TEXT,
  ADD CONSTRAINT "item_value_modifier_percent_range"
    CHECK ("valueModifierPercent" IS NULL OR ("valueModifierPercent" >= -100 AND "valueModifierPercent" <> 0)),
  ADD CONSTRAINT "item_value_modifier_amount_nonzero"
    CHECK ("valueModifierAmount" IS NULL OR "valueModifierAmount" <> 0),
  ADD CONSTRAINT "item_value_modifier_note_needs_modifier"
    CHECK ("valueModifierNote" IS NULL OR "valueModifierPercent" IS NOT NULL OR "valueModifierAmount" IS NOT NULL);
