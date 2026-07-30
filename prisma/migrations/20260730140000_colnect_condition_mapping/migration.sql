-- Colnect condition mapping (#404, part of #155) — replaces the per-platform table of
-- `20260730130000_platform_condition_mapping`.
--
-- Colnect's condition vocabulary is **fixed and global** (#402): the identical five options render
-- under every item of a multi-item sale form. So the mapping is one row per collection condition,
-- carrying only Colnect's option value — the label comes from the built-in list and is never
-- stored. That puts it beside `colnect_catalog_mapping` (#248), which translates catalog
-- abbreviations the same way, in the same Settings tab, rather than on each platform `Contact`.
--
-- The dropped table was never used by application code; a database that applied the previous
-- migration simply loses an empty table.
DROP TABLE IF EXISTS "platform_condition_mapping";

CREATE TABLE "colnect_condition_mapping" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "stampConditionId" TEXT NOT NULL,
    -- Colnect's own option value (`1`–`5`). Stored verbatim; the label it renders as lives in code.
    "colnectValue" TEXT NOT NULL,

    CONSTRAINT "colnect_condition_mapping_pkey" PRIMARY KEY ("id")
);

-- One mapping per condition: a copy has one condition and a listing takes one grade.
CREATE UNIQUE INDEX "colnect_condition_mapping_stampConditionId_key"
    ON "colnect_condition_mapping"("stampConditionId");

CREATE INDEX "colnect_condition_mapping_collectionId_idx"
    ON "colnect_condition_mapping"("collectionId");

ALTER TABLE "colnect_condition_mapping"
    ADD CONSTRAINT "colnect_condition_mapping_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "colnect_condition_mapping"
    ADD CONSTRAINT "colnect_condition_mapping_stampConditionId_fkey"
    FOREIGN KEY ("stampConditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
