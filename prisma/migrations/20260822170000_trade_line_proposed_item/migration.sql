-- **The partner's pick of which copy they receive** (#658; ADR-0039 §15).
--
-- A give line already names a copy, and #657 derived the set of copies that could take its place —
-- everything `listOfferableCopies` allows, matched on the full valuation key, minus what the
-- collector held back. This adds the partner's answer to that set.
--
-- **A second copy reference on the line, and the distinction is who put it there.** `itemId` is the
-- **effective** copy, the collector's, and stays the only one every other reader knows about: the
-- reservation gate (#639), the balance figures (#638), the packing list (#643) and the exit record
-- at closing (#644) all read it and nothing else. `proposedItemId` is the partner's **suggestion**,
-- with the moment it arrived beside it, and it moves nothing on its own — accepting writes it into
-- `itemId` and clears it, dismissing clears it alone.
--
-- That keeps **one** rule rather than a rule and an exception: everything arriving through the
-- shared link is advisory and the collector settles it (ADR-0039 §10). The copies in the pool were
-- declared interchangeable in advance, but *interchangeable* is a judgement about a set, and a
-- collector may have a reason about one particular piece that the pool never encoded — a thin spot
-- noticed on the second look, a copy promised out loud to somebody else. A proposal costs one click
-- and keeps that reason expressible. It also puts the eligibility re-check at **acceptance**, on the
-- collector's screen, where a refusal is actionable, rather than in the partner's hands in a browser
-- with no session and nothing to do about it.
ALTER TABLE "trade_line" ADD COLUMN "proposedItemId" TEXT;
ALTER TABLE "trade_line" ADD COLUMN "proposedAt" TIMESTAMP(3);

-- **SET NULL**, which is the whole difference from `itemId`'s RESTRICT. A give line guards its copy
-- because it is a promise about it; a suggestion records nothing that happened and guards nothing,
-- so a copy deleted takes the suggestions of it away and leaves every line naming what it named.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_proposedItemId_fkey"
    FOREIGN KEY ("proposedItemId") REFERENCES "item"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "trade_line_proposedItemId_idx" ON "trade_line"("proposedItemId");

-- **One proposal per copy per trade.** Two lines of one trade sharing a key ("two of these") must
-- not both end up proposed the same piece, and saying so here rather than in every writer is the
-- same move `trade_line_tradeId_itemId_key` makes for the effective side.
--
-- **Partial**, like the realisation index and for the same reason: on nearly every trade nobody has
-- proposed anything, so only the rows that say something belong in the index.
CREATE UNIQUE INDEX "trade_line_tradeId_proposedItemId_key"
    ON "trade_line"("tradeId", "proposedItemId")
    WHERE "proposedItemId" IS NOT NULL;

-- The shape, stated by the database rather than trusted to every future writer — `trade_line`'s own
-- rule for the two sides. Two things at once: the copy and the moment it was suggested are **one
-- fact** written and cleared as a unit, and a suggestion is a give-side thing, the receive side
-- naming material that is in nobody's inventory and so has no copies to choose between.
ALTER TABLE "trade_line" ADD CONSTRAINT "trade_line_proposal_shape"
    CHECK (
        ("proposedItemId" IS NULL AND "proposedAt" IS NULL)
        OR ("proposedItemId" IS NOT NULL AND "proposedAt" IS NOT NULL AND "side" = 'give')
    );
