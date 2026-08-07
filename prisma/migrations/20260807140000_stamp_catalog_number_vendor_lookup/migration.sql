-- Reverse lookup for the Colnect matcher's recall net.
--
-- The table's primary key is ("stampId", "catalogVendorId") — it answers "what is this stamp's
-- number in that catalog". The matcher asks the opposite, a batch at a time: which stamps hold this
-- catalog's number. The recall predicate is a substring match, so this index cannot be used to
-- satisfy it directly; what it buys is a planner that knows the shape of the table from the vendor
-- side, and so keeps costing that scan sanely as the collection grows.
CREATE INDEX "stamp_catalog_number_catalogVendorId_number_idx"
    ON "stamp_catalog_number"("catalogVendorId", "number");
