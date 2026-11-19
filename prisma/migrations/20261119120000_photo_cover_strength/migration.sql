-- A pixelation or a blur has a strength of its own (#2587; ADR-0066, amended).
--
-- Every pixelation and blur had one fixed strength. Each now carries a step on a short scale, 1 to 6,
-- which the editor sets with a slider; what each step means in blocks or blur is the code's. Step 3
-- is the strength every cover had, so every existing pixelation and blur is given 3 and its offer
-- images stay exactly as they were — the photo fingerprint names a strength only when it is not 3.
-- A bar has no strength.

ALTER TABLE "photo_cover" ADD COLUMN "strength" INTEGER;

UPDATE "photo_cover" SET "strength" = 3 WHERE "style" <> 'bar';

ALTER TABLE "photo_cover" ADD CONSTRAINT "photo_cover_strength_check"
    CHECK (("style" = 'bar') = ("strength" IS NULL) AND ("strength" IS NULL OR "strength" BETWEEN 1 AND 6));
