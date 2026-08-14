-- Identifying scan tiles into copies (#567, ADR-0033). The second half of the scan-first intake:
-- the tiles cut in #566 exist and carry images, and each one has to reach one of three ends —
-- a new copy, an existing copy on the lot, or a discard that leaves a trace.
--
-- The images themselves need no schema at all: a tile's crops are already `photo` rows under the
-- fourth owner, so "the tile's images move onto the copy" is `UPDATE photo SET "itemId" = …,
-- "tileId" = NULL` — one column, no byte copy, no second row. That is what decision 2 of the ADR
-- bought, and it is why this migration is two columns rather than a table.

-- ── What a consumed tile became ───────────────────────────────────────────────────────────────
--
-- A consumed tile has handed its images to a copy and has none of its own left, so without this
-- column its cell on the card would be a blank square with nothing to say about itself. With it,
-- the tile names the copy it turned into — which is also what makes "this stamp was on no line of
-- the auction description" a question the data can answer, by asking whether that copy's stamp
-- appears among the settled auction lot's lines.
--
-- `SET NULL`, not cascade: deleting a copy must not delete the record that a tile was worked
-- through. The tile stays `consumed` in that case, deliberately — its images left with the copy,
-- so there is nothing for it to go back to being.
ALTER TABLE "scan_tile" ADD COLUMN "itemId" TEXT;

CREATE INDEX "scan_tile_itemId_idx" ON "scan_tile"("itemId");

ALTER TABLE "scan_tile" ADD CONSTRAINT "scan_tile_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── When a batch was finished with ────────────────────────────────────────────────────────────
--
-- The moment the **last** tile of a batch leaves `unidentified`. From then on the batch can never
-- be re-cut — a consumed tile refuses it, because re-cutting would delete the `photo` rows a copy
-- now owns — so the retained original, the largest object the app stores, has no remaining
-- function.
--
-- Nothing in #567 reads this. What reads it is #578, the retention sweep: a TTL after a terminal
-- state, deleting the bytes and not the row, on the closed-offer photos' own pattern (#512), with
-- its period a collection setting (#577) rather than another environment variable. It is written
-- here because deriving the moment afterwards from the tiles is fragile — a tile's `state` says
-- what it is, never when it became that — and because adding the column later is a migration.
ALTER TABLE "scan_sheet" ADD COLUMN "batchDoneAt" TIMESTAMP(3);
