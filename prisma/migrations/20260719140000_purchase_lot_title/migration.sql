-- Optional lot title (ADR-0009, #121). A free-text label so lots within a purchase can be
-- told apart (e.g. "Album Polska 1950s", "Box lot"). Nullable: when blank, the UI derives
-- a display label from the copies identified into the lot, falling back to "Lot N".

ALTER TABLE "purchase_lot" ADD COLUMN "title" TEXT;
