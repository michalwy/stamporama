-- A note's anchor gets a **side** (#769), and the column is renamed to say what it now is.
--
-- ## Why "after entry X" was not enough
--
-- `20260906170000_album_corrections` anchored a note to an entry so it would travel with the series
-- it is about — which is the design's own idiom, since every correction on this track is relative
-- and never a position. But *after X* and *before Y* are not the same statement under a re-flow, and
-- the case that separates them is an ordinary one: **a note that opens a chapter.**
--
-- Expressed as *after the last entry of the previous chapter*, that note is correct only until the
-- collector drags a newly gathered checklist into that previous chapter — at which point the note is
-- sitting in the middle of 1949 rather than opening 1950, having moved without anybody moving it.
-- That is exactly the failure anchoring was chosen to avoid, so the anchor has to be able to say
-- which side of its entry it is on.
--
-- Anchoring to **nothing** now says something on each side too, and both are stronger than anchoring
-- to a particular entry would be: null + `before` is the head of the album and null + `after` is the
-- end of it, neither of which moves when the first or last checklist changes.
--
-- ## Renamed rather than reinterpreted
--
-- `afterAlbumEntryId` with a `side` column beside it would be a name that lies half the time, on a
-- table nobody has looked at yet. This is a new migration rather than an edit to the one above it —
-- that one has been applied, and a migration that has been written is corrected with another one,
-- never rewritten (`docs/agents/platform.md`).

ALTER TABLE "album_text_block" RENAME COLUMN "afterAlbumEntryId" TO "anchorAlbumEntryId";
ALTER INDEX "album_text_block_afterAlbumEntryId_sortOrder_idx"
    RENAME TO "album_text_block_anchorAlbumEntryId_sortOrder_idx";
ALTER TABLE "album_text_block"
    RENAME CONSTRAINT "album_text_block_afterAlbumEntryId_fkey"
    TO "album_text_block_anchorAlbumEntryId_fkey";

-- `before` | `after`. Defaulted to `after` because that is what every row written under the previous
-- migration meant, and there is exactly one shape of row it could have been.
ALTER TABLE "album_text_block" ADD COLUMN "side" TEXT NOT NULL DEFAULT 'after';
