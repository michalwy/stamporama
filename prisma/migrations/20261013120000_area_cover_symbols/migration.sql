-- An area says whether its stamps may carry forbidden symbols (#1891; amends ADR-0066 §4–5). Only
-- the photos of copies in an area that may carry them are asked about before an offer on a covering
-- platform goes Ready.
--
-- Three states, as the offer's own override has: NULL follows the parent area, TRUE and FALSE are
-- set here and pass down to the sub-areas that say nothing. A top-level area that says nothing is
-- off. Nothing is filled in: every area starts off and the collector turns the flag on where it is
-- needed.

ALTER TABLE "collection_area" ADD COLUMN "coverSymbols" BOOLEAN;
