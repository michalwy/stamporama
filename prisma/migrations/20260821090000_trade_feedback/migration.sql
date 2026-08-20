-- What the partner said back through the shared link (#641; ADR-0039 §10).
--
-- One row is one thing the partner has to say: a note on a line, a line struck out, or a note about
-- the whole exchange. Feedback **never edits the list** — it lands here and the collector accepts or
-- ignores it, because a list that rearranged itself under the person who agreed it would be worse
-- than no feedback at all.
--
-- **Unresolved is unread.** No separate read marker: an item is in the inbox until it is accepted or
-- dismissed, and an edit by the partner clears `resolvedAt` and puts it back. That is what the
-- derived *Partner has responded* badge is read off (ADR-0039 §6).
CREATE TABLE "trade_feedback" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    -- Null = about the whole trade.
    "lineId" TEXT,
    -- The partner's own words. Null when striking the line out is all they did.
    "note" TEXT,
    -- The partner does not want this line — worded per side on screen (*not wanted* of the
    -- collector's material, *cannot send* of the partner's own), one flag underneath.
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Bumped on every edit by the partner, which is also what puts a resolved item back in the inbox.
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- Null while it is still in the collector's inbox.
    "resolvedAt" TIMESTAMP(3),
    -- 'applied' | 'dismissed', null while unresolved.
    "resolution" TEXT,

    CONSTRAINT "trade_feedback_pkey" PRIMARY KEY ("id")
);

-- A row has to say something. A blank note with no mark is not feedback, it is the partner having
-- opened a box and closed it again — the writer deletes the row instead.
ALTER TABLE "trade_feedback" ADD CONSTRAINT "trade_feedback_says_something"
    CHECK ("rejected" = true OR ("note" IS NOT NULL AND btrim("note") <> ''));

-- There is no such thing as rejecting an entire exchange through a note box: the whole-trade row
-- carries words and nothing else.
ALTER TABLE "trade_feedback" ADD CONSTRAINT "trade_feedback_trade_note_not_rejected"
    CHECK ("lineId" IS NOT NULL OR "rejected" = false);

-- A resolution and the moment of it are written and cleared together — half of either is an inbox
-- item nobody can read the state of.
ALTER TABLE "trade_feedback" ADD CONSTRAINT "trade_feedback_resolution_whole"
    CHECK (("resolvedAt" IS NULL) = ("resolution" IS NULL));

-- One row per line: one trade, one partner, one link, so saying something again replaces what was
-- said. Nulls are distinct in Postgres, so this leaves the whole-trade row alone.
CREATE UNIQUE INDEX "trade_feedback_lineId_key" ON "trade_feedback"("lineId");

-- …and the whole-trade row is held to one by a partial index, which the schema language cannot
-- express. Without it, `lineId IS NULL` would be as many rows as the partner pressed save.
CREATE UNIQUE INDEX "trade_feedback_trade_note_key" ON "trade_feedback"("tradeId")
    WHERE "lineId" IS NULL;

-- Every read is "this trade's feedback", and the inbox narrows to the unresolved.
CREATE INDEX "trade_feedback_tradeId_resolvedAt_idx" ON "trade_feedback"("tradeId", "resolvedAt");

-- CASCADE: feedback is about one trade and says nothing once the trade is gone.
ALTER TABLE "trade_feedback" ADD CONSTRAINT "trade_feedback_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE: accepting a rejection deletes the line, and the request leaves with the thing it was
-- about. The inbox states what is outstanding; it is not an archive of a list that has moved on.
ALTER TABLE "trade_feedback" ADD CONSTRAINT "trade_feedback_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "trade_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
