-- Photos on a purchase (#2011, ADR-0072): pictures of what was bought as a whole — a stockbook, a
-- set, a box — taken on the phone when it is bought, so the desk can tell which purchase is which
-- parcel. Not of single copies: those keep their own photos from intake.
--
-- A fifth owner on `photo`, the road `itemId` → `stampId` → `offerId` → `tileId` has walked four
-- times. A purchase's photos have no role (no front, back or main): they are a plain list in
-- `sortOrder`, so no partial unique `(purchaseId, role)` index is needed beside the other owners'.
ALTER TABLE "photo" ADD COLUMN "purchaseId" TEXT;

ALTER TABLE "photo" DROP CONSTRAINT "photo_owner_xor";
ALTER TABLE "photo" ADD CONSTRAINT "photo_owner_xor"
    CHECK (num_nonnulls("itemId", "stampId", "offerId", "tileId", "purchaseId") = 1);

CREATE INDEX "photo_purchaseId_idx" ON "photo"("purchaseId");

-- The cascade drops the rows with the purchase; the bytes are deleted by `deletePurchase`.
ALTER TABLE "photo" ADD CONSTRAINT "photo_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
