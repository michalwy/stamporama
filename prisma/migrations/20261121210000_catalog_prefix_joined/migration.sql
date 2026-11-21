-- #2657: a catalog prefix can join its number with no space between them — `DR D` + `12` reads
-- `DR D12`, `PL TP W` + `1` reads `PL TP W1`. Set by a checkbox beside each of the three places a
-- prefix is stated: the area's prefix for every catalog, the area's prefix for one catalog, and an
-- issue's override. False is the default, so every existing prefix keeps its space (`PL 123`).
ALTER TABLE "collection_area" ADD COLUMN "catalogPrefixJoined" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "collection_area_vendor" ADD COLUMN "prefixJoined" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "issue_catalog_prefix" ADD COLUMN "prefixJoined" BOOLEAN NOT NULL DEFAULT false;
