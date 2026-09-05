-- Saved bulk-lot builder criteria (#773).
--
-- The builder (#760) carries eleven controls, and stating them is most of the work of building a
-- lot: a collector who builds the same kind of lot repeatedly retypes all eleven and mistypes some.
-- A preset is that statement, named and kept — *how* a lot of this kind is picked, with nothing
-- about which lot.
--
-- The **platform and the area are deliberately not columns here**, nor is the area's subtree scope.
-- The area is exactly what varies between two lots of one kind — one recipe is meant to be run over
-- Germany and then over Poland — so carrying it would need one preset per area; the platform is a
-- select the collector must state anyway before the screen answers at all. The seed, the pins and
-- the rejections are not criteria but one lot's own closing-in, and a preset holding them would
-- propose the same hundred copies for ever.
--
-- `conditionIds` / `formatIds` are id **arrays**, not join tables. They restore a list of ids into a
-- query string, nothing in the builder joins on them, and an empty list means *every* condition —
-- which a join table would turn into a row count that cannot tell "no opinion" from "none allowed".
-- Ids of rows since deleted are dropped where the criteria are read, exactly as a stale link's are.
--
-- Unique on (collectionId, name): the select names a preset by its name, and two rows called
-- "Germany job lots" would make which one you applied depend on which row came back first.

CREATE TABLE "lot_builder_preset" (
  "id"              TEXT NOT NULL,
  "collectionId"    TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "yearFrom"        INTEGER,
  "yearTo"          INTEGER,
  "conditionIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "formatIds"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxCatalogValue" DECIMAL(12,2),
  "countMin"        INTEGER,
  "countMax"        INTEGER,
  "valueMin"        DECIMAL(12,2),
  "valueMax"        DECIMAL(12,2),
  "series"          TEXT NOT NULL DEFAULT 'neutral',
  "duplicates"      TEXT NOT NULL DEFAULT 'neutral',
  "maxPerStamp"     INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "lot_builder_preset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lot_builder_preset_collectionId_name_key"
  ON "lot_builder_preset"("collectionId", "name");
CREATE INDEX "lot_builder_preset_collectionId_idx"
  ON "lot_builder_preset"("collectionId");

ALTER TABLE "lot_builder_preset"
  ADD CONSTRAINT "lot_builder_preset_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
