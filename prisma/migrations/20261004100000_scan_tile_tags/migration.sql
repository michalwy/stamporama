-- A tile's tags, marked before it is identified (#1599).
--
-- A tag is often known with the card in hand — *to check*, *for expertising*, *from the box
-- grandfather left* — so a tile can be marked with tags from the collection's dictionary (#152)
-- beside its condition, certificate (#1550) and faults (#1558), and the identification dialogs open
-- with them. A mark only seeds those dialogs; the copy takes what the dialog confirms.
CREATE TABLE "scan_tile_tag" (
    "tileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "scan_tile_tag_pkey" PRIMARY KEY ("tileId", "tagId")
);

CREATE INDEX "scan_tile_tag_tagId_idx" ON "scan_tile_tag"("tagId");

-- CASCADE at both ends, as scan_tile_fault: a tile deleted takes its marks with it, and a tag
-- deleted from the dictionary takes its marks and nothing else — the tile is still to be identified.
ALTER TABLE "scan_tile_tag" ADD CONSTRAINT "scan_tile_tag_tileId_fkey"
    FOREIGN KEY ("tileId") REFERENCES "scan_tile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_tile_tag" ADD CONSTRAINT "scan_tile_tag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
