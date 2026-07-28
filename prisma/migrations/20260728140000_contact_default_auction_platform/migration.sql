-- The platform a seller was last tracked on for auctions (#351/#352). A self-reference on
-- `contact`: the seller points at the contact carrying the `platform` role.
--
-- Nullable and remembered rather than configured — nothing in the contact form writes it, the
-- domain layer does, whenever a lot or an auction sale is created. `ON DELETE SET NULL` because
-- deleting a platform must forget the memory, never block the delete: this is a convenience, not a
-- reference anything depends on.
ALTER TABLE "contact" ADD COLUMN "defaultAuctionPlatformId" TEXT;

ALTER TABLE "contact"
  ADD CONSTRAINT "contact_defaultAuctionPlatformId_fkey"
  FOREIGN KEY ("defaultAuctionPlatformId") REFERENCES "contact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contact_defaultAuctionPlatformId_idx" ON "contact"("defaultAuctionPlatformId");
