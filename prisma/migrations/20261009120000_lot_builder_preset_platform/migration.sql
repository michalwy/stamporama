-- A Lot builder preset keeps the platform, with the listing type and the Facebook group that depend
-- on it (#1688, amending #773). The collector keeps presets per kind of lot, and a kind of lot is
-- listed on one platform, so loading a preset used to leave the platform to be chosen by hand each
-- time.
--
-- Nullable with no default and no backfill: a preset saved before this states no platform, and
-- loading it leaves the platform on screen as it is — which is what it always did.
--
-- **Plain ids, no foreign keys**, as `conditionIds` / `formatIds` already are. A preset naming a
-- platform deleted since, or a group archived or deleted since, has to *say so* when it is loaded;
-- an `ON DELETE SET NULL` would turn it silently into a preset that never had one, which is the one
-- reading the collector could not tell apart from an old preset. So the stale id is kept and judged
-- where the preset is read, exactly as a stale condition id is.

ALTER TABLE "lot_builder_preset" ADD COLUMN "platformId" TEXT;
ALTER TABLE "lot_builder_preset" ADD COLUMN "listingType" TEXT;
ALTER TABLE "lot_builder_preset" ADD COLUMN "facebookGroupId" TEXT;
