-- A hawid strip is identified by its packet number **and its label**, not by the packet number
-- alone (#796).
--
-- Before #793 a strip was one number, so one row per height was one row per product. #793 split it
-- into the packet number (the tallest stamp the strip takes) and the strip's own outer height, and
-- the border between them differs by product line: two mounts a collector really owns can both be
-- marked 26 mm and be 30 mm and 31 mm tall. The old key turned the second one away.
--
-- The label is the new second half, rather than the outer height, because it is the only thing the
-- collector reads when two such strips meet: the cutting list, the editor and a box's description all
-- name a strip as `26 mm (Hawid 264)`. Two rows that differ only by a tenth of a millimetre of border
-- would be a typo let in as a second product, and would print as the same line.
--
-- `label` is nullable and a missing label is a *value* of the key here — a second unlabelled 26 mm
-- strip is exactly the indistinguishable pair this refuses — so the index is `NULLS NOT DISTINCT`,
-- written by hand (ADR-0006; PostgreSQL 15+). Prisma cannot express it, so the schema carries no
-- `@@unique` for it.
--
-- Nothing is backfilled: every existing row was unique on the packet number, so it is unique on the
-- wider key too.

DROP INDEX "hawid_strip_collectionId_heightMm_key";

CREATE UNIQUE INDEX "hawid_strip_collectionId_heightMm_label_key"
    ON "hawid_strip"("collectionId", "heightMm", "label")
    NULLS NOT DISTINCT;
