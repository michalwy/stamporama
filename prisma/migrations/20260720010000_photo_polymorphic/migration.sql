-- Make `photo` polymorphic (#137): a photo now belongs to *either* an inventory copy
-- (`itemId`, #112) *or* a catalog stamp (`stampId`). Exactly one owner is set, enforced by a
-- CHECK. Existing rows all have `itemId` set and satisfy the check unchanged.
--
-- Front/back stay singleton slots *per owner*. The old plain unique `(itemId, role)` cannot
-- carry over: with `itemId` now nullable, every stamp photo would share `itemId = NULL` and a
-- plain unique treats those as distinct only by role — so two stamp fronts would collide by
-- role while item/stamp fronts would clash on `(NULL, ...)`. Instead we use two *partial*
-- unique indexes, one per owner. NULL role (titled extras) remains unlimited (NULLs distinct).

-- Drop the old item-only unique; `itemId` becomes nullable; add `stampId`.
DROP INDEX "photo_itemId_role_key";

ALTER TABLE "photo" ALTER COLUMN "itemId" DROP NOT NULL;
ALTER TABLE "photo" ADD COLUMN "stampId" TEXT;

-- Exactly one owner (XOR).
ALTER TABLE "photo" ADD CONSTRAINT "photo_owner_xor"
    CHECK (("itemId" IS NOT NULL) <> ("stampId" IS NOT NULL));

-- Per-owner singleton front/back slots.
CREATE UNIQUE INDEX "photo_itemId_role_key" ON "photo"("itemId", "role")
    WHERE "itemId" IS NOT NULL;
CREATE UNIQUE INDEX "photo_stampId_role_key" ON "photo"("stampId", "role")
    WHERE "stampId" IS NOT NULL;

CREATE INDEX "photo_stampId_idx" ON "photo"("stampId");

-- Stamp owner FK (cascade: deleting a stamp drops its photo rows; the domain deletes bytes).
ALTER TABLE "photo" ADD CONSTRAINT "photo_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
