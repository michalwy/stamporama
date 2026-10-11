-- A specification link lives as long as the specification it was made from (#1760): the page
-- compares today's contents with these and, once they differ or the offer has closed, says the offer
-- has changed instead of showing it.
--
-- A link minted before this column has no record of what it showed, so there is nothing to compare
-- it with; it is withdrawn rather than given a value that would make it read as changed or, worse,
-- as current.
DELETE FROM "offer_specification_share_token";

-- SHA-256 hex of `specificationContentsKey` at the moment the link was made.
ALTER TABLE "offer_specification_share_token" ADD COLUMN "contentsHash" TEXT NOT NULL;
