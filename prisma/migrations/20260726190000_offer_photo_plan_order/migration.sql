-- A manual plan order over an offer's photos (#313).
--
-- The generated collages had no order of their own: their sequence came from the set order (#306)
-- and the grouping algorithm. The collector can now drag the **whole** plan — collages and manual
-- attachments alike — into an order that is theirs, kept here as an ordered array of stable tokens,
-- one per planned image:
--
--   c:<side>:<sortedItemIds>   a generated collage side (front/back distinguished by <side>)
--   a:<attachmentId>           a manual attachment
--
-- It is an **override**, not a replacement. The engine still groups and truncates the plan the same
-- way (so a front/back pair still drops together and attachments stay protected); this list only
-- reorders the images that survive. Tokens the offer no longer contains are ignored, and images
-- added since the last reorder fall in after their natural predecessor. An empty array — the
-- default, and the value every existing offer backfills to — means the derived order, unchanged.

ALTER TABLE "offer"
    ADD COLUMN "photoPlanOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
