-- Where a copy has been (#2277, ADR-0074): one entry per change of a copy's location or ref,
-- including being taken off a location with no new one, shown on the copy and on the location.
--
-- The entries are written by the database, not by the app: a trigger on `item` adds one on every
-- insert and on every update that changes `locationId` or `locationRef`, so no way of moving a copy
-- — the copy form, Bulk edit, Store on a purchase, a scan sheet, a replacement, anything added
-- later — can move one without it being recorded. What the app adds is *what did it*: the
-- transaction-local settings `stamporama.move_source` and `stamporama.move_source_id`, written by
-- `setMoveSourceTx` (`src/lib/location-moves.ts`) inside the transaction that moves the copy. A
-- write that sets none is recorded as `created` (an insert) or `other` (an update), never refused.

CREATE TYPE "ItemLocationMoveSource" AS ENUM (
    'start',
    'created',
    'copy_form',
    'bulk_edit',
    'purchase',
    'scan',
    'replacement',
    'other'
);

CREATE TABLE "item_location_move" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "collectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromLocationId" TEXT,
    "fromLocationName" TEXT,
    "fromRef" TEXT,
    "toLocationId" TEXT,
    "toLocationName" TEXT,
    "toRef" TEXT,
    "source" "ItemLocationMoveSource" NOT NULL,
    "sourceId" TEXT,

    CONSTRAINT "item_location_move_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "item_location_move_itemId_movedAt_idx" ON "item_location_move"("itemId", "movedAt");
CREATE INDEX "item_location_move_fromLocationId_movedAt_idx" ON "item_location_move"("fromLocationId", "movedAt");
CREATE INDEX "item_location_move_toLocationId_movedAt_idx" ON "item_location_move"("toLocationId", "movedAt");
CREATE INDEX "item_location_move_collectionId_idx" ON "item_location_move"("collectionId");

ALTER TABLE "item_location_move" ADD CONSTRAINT "item_location_move_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_location_move" ADD CONSTRAINT "item_location_move_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_location_move" ADD CONSTRAINT "item_location_move_fromLocationId_fkey"
    FOREIGN KEY ("fromLocationId") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "item_location_move" ADD CONSTRAINT "item_location_move_toLocationId_fkey"
    FOREIGN KEY ("toLocationId") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The history starts today: every copy's location now is its first entry, marked as the starting
-- point, so every copy — filed or not, held or not — has an entry to start from. Written before the
-- trigger exists, which is what keeps it from being recorded twice.
INSERT INTO "item_location_move"
    ("collectionId", "itemId", "movedAt", "toLocationId", "toLocationName", "toRef", "source")
SELECT i."collectionId", i."id", (now() AT TIME ZONE 'UTC'), i."locationId", l."name", i."locationRef", 'start'
  FROM "item" i
  LEFT JOIN "location" l ON l."id" = i."locationId";

-- `clock_timestamp()` rather than `now()`, which is the transaction's start: one transaction moving
-- a copy twice (a copy created and then filed) has to leave two entries in the order they happened.
-- In UTC, as every timestamp Prisma writes is.
CREATE FUNCTION "item_record_location_move"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    src TEXT := NULLIF(current_setting('stamporama.move_source', true), '');
    src_id TEXT := NULLIF(current_setting('stamporama.move_source_id', true), '');
    from_id TEXT := NULL;
    from_ref TEXT := NULL;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        from_id := OLD."locationId";
        from_ref := OLD."locationRef";
    END IF;
    INSERT INTO "item_location_move"
        ("collectionId", "itemId", "movedAt",
         "fromLocationId", "fromLocationName", "fromRef",
         "toLocationId", "toLocationName", "toRef",
         "source", "sourceId")
    VALUES
        (NEW."collectionId", NEW."id", (clock_timestamp() AT TIME ZONE 'UTC'),
         from_id, (SELECT "name" FROM "location" WHERE "id" = from_id), from_ref,
         NEW."locationId", (SELECT "name" FROM "location" WHERE "id" = NEW."locationId"), NEW."locationRef",
         COALESCE(src, CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'other' END)::"ItemLocationMoveSource",
         src_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER "item_record_location_move_insert"
    AFTER INSERT ON "item"
    FOR EACH ROW EXECUTE FUNCTION "item_record_location_move"();

-- The ref is part of the place: card 12 to card 13 of the same box is a move too.
CREATE TRIGGER "item_record_location_move_update"
    AFTER UPDATE OF "locationId", "locationRef" ON "item"
    FOR EACH ROW
    WHEN (OLD."locationId" IS DISTINCT FROM NEW."locationId"
          OR OLD."locationRef" IS DISTINCT FROM NEW."locationRef")
    EXECUTE FUNCTION "item_record_location_move"();
