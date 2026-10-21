-- The Copy number width setting goes (#2096).
--
-- A copy's internal number was the one internal number the app padded with zeros, to a width set per
-- collection (#268); offers, sales, posts, stamps and lots never were. It now reads plain everywhere,
-- so the width has nothing left to say. A template that wants a padded number asks for it with `:N`
-- (#2097), per placeholder.
--
-- Display only, as it always was: the stored `item."itemNo"` is the bare integer, so dropping the
-- width renumbers nothing, and a search still reads leading zeros as insignificant — a label written
-- while numbers were padded keeps finding its copy.

ALTER TABLE "collection" DROP COLUMN "itemNoPad";
