-- A tile's quarter-turn, per side (#1006, ADR-0049 §6).
--
-- A card scan made sideways — by accident or on purpose — is put the right way up **per tile**,
-- never per card: the pieces on one card lie every way round. The turn cannot be a rewrite of the
-- sheet's bytes, because a tile's box addresses the **sheet** and `regionOnSheet` plus every
-- measurement stand on that correspondence. So it is a stored property of the tile, applied when the
-- tile's crop is cut and when the tile is drawn.
--
-- **Per side**, because the back of a piece is not its front turned the same way: each stamp is
-- turned over in place (ADR-0033 §5), and turning a sideways stamp over reverses the direction it
-- lies in. One number for both sides would put one of them upside down exactly when the other was
-- right.
--
-- Degrees clockwise, one of 0 / 90 / 180 / 270. Unconstrained integer, like `scan_sheet.kind` is
-- unconstrained text: this project keeps small closed vocabularies in the application
-- (`QuarterTurn` in `src/lib/tile-turn.ts`) rather than in a CHECK.
--
-- `0` for every existing row, which is what every tile cut before this migration is: nothing could
-- turn one. A widening with no data question in it.
--
-- No index: the turn is read with the tile it belongs to and is never a search term.

ALTER TABLE "scan_tile"
  ADD COLUMN "frontTurn" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "backTurn" INTEGER NOT NULL DEFAULT 0;
