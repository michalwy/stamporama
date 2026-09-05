-- Album bands replace album columns, and the running head becomes a choice (#767).
--
-- A **new migration rather than an edit** to `20260905220000_album_template` and `20260906090000_album`,
-- per the standing rule: a migration that has been written is corrected with another one, even one
-- written an hour ago and not yet released.
--
-- ## Why `columns` goes
--
-- `AlbumTemplate.columns` / `columnGapMm` (#766) modelled a page divided into fixed columns, with
-- content flowing down one and into the next. That is not what the collector's albums do, and the
-- source material is unambiguous about it: his files hold **35** active `PAGE_COLUMN_START` regions,
-- every single one closed by exactly one `PAGE_COLUMN_NEXT` and one `PAGE_COLUMN_STOP` — always a
-- pair, never more — and `PL-1933.txt` opens six of them on a **single page**. It is not a page mode.
-- It is two short checklists put side by side, several times per page, with everything else full
-- width.
--
-- So the setting becomes what it actually describes: the most blocks that may **share one horizontal
-- band**, and the gap between two that do. A ceiling, not a frame. Nothing overflows sideways, and
-- there is no notion of a block continuing into the next column.
--
-- Renaming in place rather than dropping and adding: the two columns answer the same question
-- ("how wide may the content be split, and by how much"), and no album has been created yet in any
-- case. Defaults are reset to the pair the sources show.
--
-- ## Why `printTitle` arrives
--
-- The album title's face and size were already on the template (#766), but nothing said whether the
-- title is printed at all. PL, DE-BM, DE-BY and DR carry the album's name as a running head on every
-- page; **DA does not** — footer only, and its content starts at 30 mm instead of PL's 20 because it
-- is not spending those millimetres on a head. Always-on would make DA unbuildable.

ALTER TABLE "album_template" RENAME COLUMN "columns" TO "blocksPerBand";
ALTER TABLE "album_template" RENAME COLUMN "columnGapMm" TO "blockGapMm";
ALTER TABLE "album_template" ADD COLUMN "printTitle" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "album" RENAME COLUMN "columns" TO "blocksPerBand";
ALTER TABLE "album" RENAME COLUMN "columnGapMm" TO "blockGapMm";
ALTER TABLE "album" ADD COLUMN "printTitle" BOOLEAN NOT NULL DEFAULT true;

-- A template written under the old meaning holds a column count, which reads as a band ceiling of
-- the same number — one column is one block per band, which is exactly right, and two columns
-- becomes "up to two blocks per band", which is what the collector's pages do anyway. Nothing has to
-- be rewritten; the default for anything new is the pair his own sources use.
ALTER TABLE "album_template" ALTER COLUMN "blocksPerBand" SET DEFAULT 1;
ALTER TABLE "album" ALTER COLUMN "blocksPerBand" SET DEFAULT 1;
