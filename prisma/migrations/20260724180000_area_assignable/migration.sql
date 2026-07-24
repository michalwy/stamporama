-- Grouping-only collection areas (#263), mirroring `location.assignable` (#56). A
-- grouping-only area (e.g. "Europe") organizes its children but cannot itself receive
-- Issues/stamps. Defaults true, so every existing area stays directly assignable.
ALTER TABLE "collection_area" ADD COLUMN "assignable" BOOLEAN NOT NULL DEFAULT true;
