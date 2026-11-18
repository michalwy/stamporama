-- #2574: the phone opens the collection last used on it instead of asking for one at every start.
--
-- One nullable column on the account, set only by a phone screen. Deleting the collection clears it,
-- so the next start shows the phone's Collections list.

ALTER TABLE "user" ADD COLUMN "phoneCollectionId" TEXT;

ALTER TABLE "user" ADD CONSTRAINT "user_phoneCollectionId_fkey"
    FOREIGN KEY ("phoneCollectionId") REFERENCES "collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
