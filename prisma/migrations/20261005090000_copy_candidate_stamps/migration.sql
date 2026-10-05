-- A copy identified as **one of several candidate stamps** (#1651, ADR-0065).
--
-- A copy has pointed at exactly one node of a variant tree, and pointing at an umbrella has meant
-- "some variant of it, not known which" (ADR-0007 §2/§7, ADR-0010 §3). That cannot say *123aI or
-- 123bI*: the type is known and the colour is not, so the umbrella throws the type away and either
-- variant claims a colour nobody knows. Nor can it say *Mi 85 or Mi 101*, two German Reich stamps in
-- different issues told apart only by a watermark that cannot be read on a cover.
--
-- "item_candidate" holds the set. It is **"one of these"**, which is why it is not "item_stamp":
-- that table is "every one of these" (ADR-0044) and is summed into "item"."stampCount", read by the
-- `{catalog}` enumeration and by search as stamps the piece *carries*. An ordinary copy has no rows
-- here; a copy with a set has two or more, and keeps exactly one "item_stamp" entry — a set is
-- offered on a single-stamp copy only (decided with the collector, 2026-10-05).

CREATE TABLE "item_candidate" (
    "itemId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,

    CONSTRAINT "item_candidate_pkey" PRIMARY KEY ("itemId", "stampId")
);

-- Cascade from the copy: the set describes it and has no life without it.
--
-- Cascade from the stamp too, for the reason "item_stamp" gives in
-- 20260911120000_multi_stamp_copies: a RESTRICT is checked before the cascades queued beside it
-- have run and would make a collection undeletable. The rule that matters — a stamp still named as a
-- possible identity of some copy is not deleted out from under it — is enforced in `deleteStamp`.
ALTER TABLE "item_candidate" ADD CONSTRAINT "item_candidate_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_candidate" ADD CONSTRAINT "item_candidate_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- *Which copies might be Mi 85* — the read that shows a copy under each of its candidates.
CREATE INDEX "item_candidate_stampId_idx" ON "item_candidate"("stampId");

-- How many **variant trees** the set spans: 0 for an ordinary copy, 1 when every candidate climbs
-- variant edges (ADR-0010 §3) to one root, 2 or more when they do not. Materialised for the reason
-- "item"."stampCount" is (ADR-0044 §4): a copy whose candidates lie in several trees counts towards
-- no completeness, and that exclusion has to stay a flat `where` beside `disposedAt IS NULL` in
-- every read that counts held copies. Written only by `src/lib/item-candidates.ts`, at the write and
-- again whenever a stamp tree edit could change it.
ALTER TABLE "item" ADD COLUMN "candidateTrees" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "item" ADD CONSTRAINT "item_candidate_trees_range" CHECK ("candidateTrees" >= 0);
