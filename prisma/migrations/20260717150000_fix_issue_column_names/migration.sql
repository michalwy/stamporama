-- Fix column naming in the issue table applied to an already-running e2e DB.
-- The previous migration (140000) was initially written with snake_case and
-- has since been corrected to camelCase. On fresh databases the rename below
-- is a no-op because the correct camelCase column already exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issue' AND column_name = 'collection_area_id'
  ) THEN
    ALTER TABLE "issue" RENAME COLUMN "collection_area_id" TO "collectionAreaId";
  END IF;
END $$;

ALTER TABLE "issue" DROP COLUMN IF EXISTS "catalogNameId";
