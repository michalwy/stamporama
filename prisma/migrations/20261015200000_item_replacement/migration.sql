-- Replacement pairs (#1936, ADR-0070): a new copy that replaces an old one in the collection,
-- recorded once and settled later on the Replacements screen.
--
-- ## The pair
--
-- `item_replacement` names the two copies and where the pair stands: `open`, `done` (the old copy
-- went onto a sale card, out of the collection and for sale), `cancelled`, or `moot` (a copy left the
-- collector's hands first). `closedAt` is set exactly when the pair is no longer open.
--
-- ## One open pair on each side
--
-- A copy is the old copy of at most one open pair and the new copy of at most one open pair. Partial
-- unique indexes, because a closed pair is history and a copy collects any number of those.
--
-- ## Deleting a copy
--
-- Both copy references are `SET NULL`: deleting a copy must not take the other copy's history with
-- it, and a pair left open with a missing copy is closed as moot by the app. The copy numbers are
-- written on the pair so that history still names the deleted copy. The collection cascades, so a
-- whole collection still deletes in one statement.

CREATE TABLE "item_replacement" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "newItemId" TEXT,
    "oldItemId" TEXT,
    "newItemNo" INTEGER NOT NULL,
    "oldItemNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mootReason" TEXT,
    "mootSide" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "item_replacement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_replacement_status_valid"
        CHECK ("status" IN ('open', 'done', 'cancelled', 'moot')),
    CONSTRAINT "item_replacement_closed_when_not_open"
        CHECK (("status" = 'open') = ("closedAt" IS NULL)),
    CONSTRAINT "item_replacement_moot_reason"
        CHECK (
            ("status" = 'moot') = ("mootReason" IS NOT NULL)
            AND ("mootReason" IS NULL OR "mootReason" IN ('sold', 'traded', 'disposed', 'deleted'))
            AND ("mootReason" IS NULL) = ("mootSide" IS NULL)
            AND ("mootSide" IS NULL OR "mootSide" IN ('new', 'old'))
        ),
    CONSTRAINT "item_replacement_two_copies" CHECK ("newItemNo" <> "oldItemNo")
);

CREATE INDEX "item_replacement_collectionId_status_idx" ON "item_replacement"("collectionId", "status");
CREATE INDEX "item_replacement_newItemId_idx" ON "item_replacement"("newItemId");
CREATE INDEX "item_replacement_oldItemId_idx" ON "item_replacement"("oldItemId");

CREATE UNIQUE INDEX "item_replacement_open_new_key" ON "item_replacement"("newItemId")
    WHERE "status" = 'open';
CREATE UNIQUE INDEX "item_replacement_open_old_key" ON "item_replacement"("oldItemId")
    WHERE "status" = 'open';

ALTER TABLE "item_replacement" ADD CONSTRAINT "item_replacement_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_replacement" ADD CONSTRAINT "item_replacement_newItemId_fkey"
    FOREIGN KEY ("newItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "item_replacement" ADD CONSTRAINT "item_replacement_oldItemId_fkey"
    FOREIGN KEY ("oldItemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
