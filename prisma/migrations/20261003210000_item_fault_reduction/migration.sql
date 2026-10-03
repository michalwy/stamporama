-- A copy's value lowered by a percentage typed on it, for its faults (#1560).
--
-- A faulty stamp is worth less than the catalogue says. The collector states by how much **on the
-- copy**, as a whole percentage, rather than on each fault in the dictionary (#1557): a percentage
-- per fault, multiplied or the largest taken, was considered and rejected with the collector. It can
-- be set on a copy with no listed faults, since a piece can be worth less for a reason the
-- dictionary does not name.
--
-- It lowers every value of that copy — its catalogue value (or the value recorded on a multi-stamp
-- copy, #747), its market value, and every total and suggestion built from them. What the stamp is
-- worth in the catalogue does not change; only this copy's figure does.
--
-- NULL is no reduction, and is what every existing row holds. A whole number from 1 to 100: zero is
-- written as NULL by the app, so "no reduction" has one spelling, and the CHECK keeps a hand-edited
-- row inside the range the arithmetic assumes. No index — the figure is read with the copy and is
-- never a search term.

ALTER TABLE "item"
  ADD COLUMN "faultReductionPercent" INTEGER,
  ADD CONSTRAINT "item_fault_reduction_percent_range"
    CHECK ("faultReductionPercent" IS NULL OR ("faultReductionPercent" BETWEEN 1 AND 100));
