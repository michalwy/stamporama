-- Backfill the per-area title name (#210) from each area's own name, so every existing area shows
-- itself in listing titles by default. Roll-up is then opt-in per area: clearing an area's title
-- name makes the `{area}` token walk up to the nearest ancestor that still has one. Only fills rows
-- not already set (idempotent).
UPDATE "collection_area" SET "titleName" = "name" WHERE "titleName" IS NULL;
