-- The fourth place a tag hangs (#1625): an **auction lot**.
--
-- Tags went on issues and stamps (#152) and on copies (#1181), never on a lot being bid on. The
-- collector, and the assistant that finds listings for them, want to label lots in their own words —
-- *for the Danzig album*, *agent-found*, *ask about the gum* — and filter the watchlist by them.
--
-- `item_tag`'s table exactly, for its reasons: **cascade on both ends** (deleting a tag takes the
-- label off everything carrying it; deleting a lot takes its labels with it), and **`tagId`
-- indexed** for the tag filter and the Settings delete count.
--
-- **Nothing is inherited and nothing travels.** A lot's tags are not its sale's, and settling a won
-- lot into a purchase (#28) does not copy them onto the copies it becomes.
CREATE TABLE "auction_lot_tag" (
    "auctionLotId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "auction_lot_tag_pkey" PRIMARY KEY ("auctionLotId","tagId")
);

CREATE INDEX "auction_lot_tag_tagId_idx" ON "auction_lot_tag"("tagId");

ALTER TABLE "auction_lot_tag" ADD CONSTRAINT "auction_lot_tag_auctionLotId_fkey" FOREIGN KEY ("auctionLotId") REFERENCES "auction_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auction_lot_tag" ADD CONSTRAINT "auction_lot_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
