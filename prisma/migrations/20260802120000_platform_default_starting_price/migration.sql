-- The platform's default price becomes an auction's default **starting price** (#449, narrowing
-- #362).
--
-- `defaultOfferPrice` was a flat asking price for a platform that lists everything at one figure.
-- With the listing type now on the offer, the useful half of that is the auction one: an auction
-- house one always opens at the same figure should not have it retyped per listing, while a quick
-- buy's price follows from the goods — which the lot's suggested price (#190) and the copies'
-- catalog value (#230) already answer, and a flat default could only override with a number nobody
-- had looked at the stamps to arrive at.
--
-- So it is renamed rather than duplicated: one column, one meaning. `RENAME COLUMN` keeps the
-- figures of platforms that carry one, and the write path clears it whenever the platform is not an
-- auction platform.
ALTER TABLE "contact" RENAME COLUMN "defaultOfferPrice" TO "defaultStartingPrice";

-- Every existing platform predates `defaultListingType` and so states no preference, which reads as
-- a quick buy — where this figure now means nothing. Clearing it is the point of the narrowing
-- rather than a casualty of it: a value left behind on a fixed platform would be a stored fact that
-- nothing reads, and the first surface to grow an auction default would inherit somebody else's
-- flat price. A platform that really does open at one figure states it again, on the tab that now
-- shows the field.
UPDATE "contact" SET "defaultStartingPrice" = NULL WHERE "defaultListingType" IS DISTINCT FROM 'auction';
