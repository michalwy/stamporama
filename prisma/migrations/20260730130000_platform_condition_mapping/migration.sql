-- Per-platform stamp-condition vocabulary (#404, part of #155).
--
-- Superseded by `20260730140000_colnect_condition_mapping`, which drops this table again: the
-- mapping was moved from the platform `Contact` to the collection, beside the Colnect catalog
-- mapping it is the counterpart of (#248). Kept in the history rather than deleted, so a database
-- that already applied it is migrated forward instead of diverging.
--
-- `value` is what gets posted; `label` is only what the collector reads back when checking the
-- mapping and is never sent anywhere. A condition with no row is unmapped, which is a listing
-- precondition failure (#406), never a silent default.
CREATE TABLE "platform_condition_mapping" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stampConditionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "platform_condition_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_condition_mapping_contactId_stampConditionId_key"
    ON "platform_condition_mapping"("contactId", "stampConditionId");

CREATE INDEX "platform_condition_mapping_contactId_idx"
    ON "platform_condition_mapping"("contactId");

CREATE INDEX "platform_condition_mapping_stampConditionId_idx"
    ON "platform_condition_mapping"("stampConditionId");

ALTER TABLE "platform_condition_mapping"
    ADD CONSTRAINT "platform_condition_mapping_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_condition_mapping"
    ADD CONSTRAINT "platform_condition_mapping_stampConditionId_fkey"
    FOREIGN KEY ("stampConditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
