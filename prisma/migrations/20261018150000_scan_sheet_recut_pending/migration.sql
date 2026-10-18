-- A card can be re-cut after some of its tiles became copies (#2055).
--
-- Until now a sheet counted as cut once any tile named it, and a re-cut deleted every tile, so the
-- two could not disagree. A re-cut now keeps the tiles that became copies, and their boxes stay on
-- the sheet: the sheet still has tiles naming it, yet the rest of it is waiting to be cut again. This
-- flag says so. Set by the re-cut on the batch's sheets, cleared by that sheet's next commit, and
-- false on every existing row, none of which was re-cut around a copy.

ALTER TABLE "scan_sheet" ADD COLUMN "recutPending" BOOLEAN NOT NULL DEFAULT false;
