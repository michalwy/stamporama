-- A block that starts its own band rather than sitting beside the block before it (#1421).
--
-- Presence-only, and on the block — an entry or a note — for ADR-0045 §3's reason, which every
-- correction on this track shares: a live page has no row and its identity moves with its contents,
-- so the setting stays with the series it was set on when the album re-flows. `false` is what every
-- block already is: an existing album keeps its pages exactly.
ALTER TABLE "album_entry" ADD COLUMN "bandBreakBefore" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "album_text_block" ADD COLUMN "bandBreakBefore" BOOLEAN NOT NULL DEFAULT false;
