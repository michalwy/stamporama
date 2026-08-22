-- **The two columns the Colnect list import ships with** (#645; ADR-0039 §11's rule holding — what
-- a change reads, it brings).
--
-- ── A section's default condition ────────────────────────────────────────────────────────────────
--
-- A Colnect list export states a grade against an item only where the collector bothered to; in a
-- real eight-row export, five rows say nothing. A condition is required on both sides of a trade
-- (the `trade_line_side_shape` CHECK on the receive side, `GiveRequirement` on the give side), so
-- silence in the file has to become something, and the three candidates are all worse than this one:
-- guessing MNH would promise a partner a grade nobody stated; asking per row would be five dialogs
-- for one file; and dropping the rows would import a list that quietly says less than the partner
-- sent.
--
-- So the **section** says it. A trade section is already the unit a collector groups a list into
-- ("Poland, used" / "Austria, mint"), which means the grade the list is in is a property of the
-- section far more often than of the row — and stating it once, where it is visible and editable,
-- is the difference between a default and a guess. Null is the ordinary case and means the section
-- states none, in which case a row with no grade of its own is a **gap**, listed and settled by hand
-- rather than assumed.
--
-- `RESTRICT`, like every other condition FK: a grade a live trade is written in must not vanish from
-- under it.
ALTER TABLE "trade_section" ADD COLUMN "defaultConditionId" TEXT;

CREATE INDEX "trade_section_defaultConditionId_idx" ON "trade_section"("defaultConditionId");

ALTER TABLE "trade_section" ADD CONSTRAINT "trade_section_defaultConditionId_fkey"
    FOREIGN KEY ("defaultConditionId") REFERENCES "stamp_condition"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The Colnect lists a trade is about ───────────────────────────────────────────────────────────
--
-- A Colnect exchange *is* two lists — the partner's and the collector's — and both go on living on
-- Colnect while the trade is negotiated here. The link is therefore part of the agreement rather
-- than a note about it: it is what either side opens to check a row, and the partner's own page
-- (#640) is exactly where it is most needed, because the partner is reading a list of stamps they
-- wrote and has no other way back to their own copy of it.
--
-- **A table rather than two columns on `trade`**, because the count is genuinely open: a partner
-- routinely sends two or three custom lists, and the second one would otherwise have nowhere to go.
-- Each row carries the **side** it belongs to, for the same reason a line does — *what I am asking
-- you for* and *what you are asking me for* are two different lists, and one heading would be wrong
-- for one of them.
--
-- `position` is hand-ordered like every other dictionary here; gaplessness is not promised.
-- `UNIQUE (tradeId, url)` because the same list twice is a mistake, not a second list. **CASCADE**:
-- a link records nothing that happened, so it follows the trade out.
CREATE TABLE "trade_colnect_list" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    -- What to call it on both screens. The import proposes the list's own name off the file; blank
    -- is allowed and renders as the bare link.
    "label" TEXT NOT NULL DEFAULT '',
    -- give | receive, the vocabulary of `trade-rules.ts` and never read from this column's spelling.
    "side" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_colnect_list_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_colnect_list_tradeId_url_key" ON "trade_colnect_list"("tradeId", "url");
CREATE INDEX "trade_colnect_list_tradeId_idx" ON "trade_colnect_list"("tradeId");

-- The side is a closed vocabulary, so the database states it — `trade_line`'s rule, and for the same
-- reason: a row on a third side would render nowhere and be found by nobody.
ALTER TABLE "trade_colnect_list" ADD CONSTRAINT "trade_colnect_list_side"
    CHECK ("side" IN ('give', 'receive'));

ALTER TABLE "trade_colnect_list" ADD CONSTRAINT "trade_colnect_list_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
