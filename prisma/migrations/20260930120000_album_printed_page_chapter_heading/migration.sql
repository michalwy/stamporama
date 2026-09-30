-- Which chapter's heading a printed card carries (#1498), beside the snapshot it is read from.
--
-- A chapter printed its year again unless its **first block** was on paper (#778). That was the wrong
-- question whenever the year stood alone on its sheet ahead of that block (#768's shape): marking the
-- series printed dropped the year's sheet from the plan, and the year reached no card at all. The
-- question is now *does a printed card carry this chapter's heading* — and a card that carries the
-- heading and nothing else has to be filed at the head of its chapter, which needs the same fact.
--
-- An index, like `album_printed_page_stamp`: derived from the snapshot and written with it in the same
-- transaction, never authored. The snapshot stays a result nothing filters on; this column is what the
-- planner asks on every read, so it does not have to open a card's geometry to learn it.
--
-- Null for a card that prints no chapter heading. A **free page** (#1429) that prints its chapter's
-- heading is null too: it never carries the year instead of the chapter's first stamp sheet
-- (ADR-0058), so it must not answer the question.
ALTER TABLE "album_printed_page" ADD COLUMN "chapterHeadingKey" TEXT;
UPDATE "album_printed_page"
  SET "chapterHeadingKey" = "snapshot"->>'chapterKey'
  WHERE jsonb_typeof("snapshot"->'page'->'chapter') = 'object'
    AND jsonb_typeof("snapshot"->'page'->'free') IS DISTINCT FROM 'object';
