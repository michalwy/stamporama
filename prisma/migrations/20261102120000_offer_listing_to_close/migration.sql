-- #2343: a set sold into a sale on another platform leaves its offer sold here while its listing is
-- still up on its own platform. Stamped when the offer is sold out that way; cleared when the
-- collector says the listing is closed, or when the offer leaves `sold`.
ALTER TABLE "offer" ADD COLUMN "listingToCloseAt" TIMESTAMP(3);
