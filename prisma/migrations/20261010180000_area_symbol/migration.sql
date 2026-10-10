-- An area has a symbol (#1740): usually its country's flag as an emoji (🇳🇱), which listings often
-- print beside or instead of the country's name.
--
-- Optional and empty until the collector sets it: nothing is filled in for existing areas, and a
-- sub-area never takes its parent's symbol (#1692). It is the same in every language, so it gets no
-- column on `collection_area_translation`.

ALTER TABLE "collection_area" ADD COLUMN "symbol" TEXT;
