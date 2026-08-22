-- A linked Colnect list belongs to the **section** it was imported into (#680).
--
-- `trade_colnect_list` was keyed on the trade (#645) and drawn in a card of its own above the
-- sections. The import, though, targets one `(section, side)`: mint goes into the mint section, used
-- into the used one, and a trade routinely carries several. Filed at the trade level, four links sat
-- in one box with nothing saying which part of the trade each of them produced.
--
-- So `sectionId` replaces `tradeId` as the owner. `side` stays — a section has two of them, and
-- *what I am asking you for* and *what you are asking me for* are still two lists.
--
-- **The uniqueness rule moves with the parent**, from `(tradeId, url)` to `(sectionId, url)`. The
-- same list in two sections is not a mistake: one export routinely carries mint and used together
-- and gets split across the sections it belongs to. The same list twice in one section still is.
--
-- **CASCADE off the section**, as it cascaded off the trade before: a link records nothing that
-- happened, so it follows out the part of the trade it was about. The section's own delete guards
-- (not empty, not the last one) already say when a section may go.

-- Nullable first, so the existing rows can be given an owner before the column is required.
ALTER TABLE "trade_colnect_list" ADD COLUMN "sectionId" TEXT;

-- Existing rows attach to their trade's **first** section, by the order both screens read sections
-- in (`position`, then `name`, with the id as a last deterministic tiebreak). There is no production
-- data to lose and no guessing to do; what matters is that the answer is the same every time this
-- runs.
UPDATE "trade_colnect_list" AS l
SET "sectionId" = (
    SELECT s."id"
    FROM "trade_section" s
    WHERE s."tradeId" = l."tradeId"
    ORDER BY s."position" ASC, s."name" ASC, s."id" ASC
    LIMIT 1
);

-- Every trade has at least one section, created with it, so this deletes nothing in practice — it is
-- here because `SET NOT NULL` below would otherwise fail on a row nothing could own.
DELETE FROM "trade_colnect_list" WHERE "sectionId" IS NULL;

ALTER TABLE "trade_colnect_list" ALTER COLUMN "sectionId" SET NOT NULL;

-- The old parent goes, indexes first: collapsing every link of a trade onto its first section keeps
-- `(sectionId, url)` unique — `(tradeId, url)` already forbade the same address twice on one trade.
DROP INDEX "trade_colnect_list_tradeId_url_key";
DROP INDEX "trade_colnect_list_tradeId_idx";
ALTER TABLE "trade_colnect_list" DROP CONSTRAINT "trade_colnect_list_tradeId_fkey";
ALTER TABLE "trade_colnect_list" DROP COLUMN "tradeId";

CREATE UNIQUE INDEX "trade_colnect_list_sectionId_url_key" ON "trade_colnect_list"("sectionId", "url");
CREATE INDEX "trade_colnect_list_sectionId_idx" ON "trade_colnect_list"("sectionId");

ALTER TABLE "trade_colnect_list" ADD CONSTRAINT "trade_colnect_list_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "trade_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
