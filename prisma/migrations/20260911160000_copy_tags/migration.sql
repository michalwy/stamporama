-- The third place a tag hangs (#1181): a **copy**.
--
-- #152 gave the collector the vocabulary and hung it on an issue and on a stamp — things the
-- catalogue names. A tag is worth most on the piece in hand: *to check*, *for expertising*,
-- *duplicate for the swap box*, *from the box grandfather left* are all statements about one copy,
-- not about a catalogue entry, and none of them is a fact the fixed schema has a column for.
--
-- The table is `issue_tag`'s and `stamp_tag`'s exactly, one level down, and for the same reasons:
--
--   * **Cascade on both ends.** Deleting a tag *is* the act of taking that label off everything
--     carrying it, so there is no in-use check and no refusal — the Settings confirmation states
--     the count and the collector's yes is the whole guard. This is where the tag tables part
--     company with every other dictionary reference on `item` (`conditionId`, `formatId` and
--     friends are `ON DELETE RESTRICT`, because a grade in use is a fact about the copy that a
--     delete would silently erase).
--   * **`tagId` indexed.** *What carries this tag* is the direction the delete confirmation's count
--     reads, and the one a tag filter over the Copies list (#1182) will.
--
-- **Nothing is inherited**, which is now a rule with a third direction to state: a tag on a stamp
-- is not on the copies of it, and a copy carrying several stamps (ADR-0044) takes tags of its own
-- rather than any of theirs. A copy is a physical thing and a stamp is a catalogue entry; the
-- collector's reason for labelling the piece on the desk is rarely the catalogue's.
CREATE TABLE "item_tag" (
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "item_tag_pkey" PRIMARY KEY ("itemId","tagId")
);

CREATE INDEX "item_tag_tagId_idx" ON "item_tag"("tagId");

ALTER TABLE "item_tag" ADD CONSTRAINT "item_tag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_tag" ADD CONSTRAINT "item_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
