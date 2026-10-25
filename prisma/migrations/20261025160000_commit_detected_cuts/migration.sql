-- Commit detected cuts (#2164): a quick mode in which every card scan added is cut from its detected
-- boxes as soon as it is ready, with no cut editor, and the card is marked to be reviewed later.
--
-- The switch is remembered per collection. Each upload takes the switch as it stood when the scan was
-- added, so turning it off mid-sitting does not change the scans already on their way. A sheet cut
-- that way carries `cutUnreviewed` until its cut is committed by hand, re-cut, or said to be fine.

ALTER TABLE "collection" ADD COLUMN "commitDetectedCuts" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "scan_upload" ADD COLUMN "commitDetectedCut" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "scan_sheet" ADD COLUMN "cutUnreviewed" BOOLEAN NOT NULL DEFAULT false;
