-- Per-platform fallback asking price for a new offer (#362), in the platform's own currency (#196).
-- Nullable: no default price is the normal case, and it is the lowest-priority suggestion — a lot's
-- suggested price (#190) and the catalog value (#230) both win over it.
ALTER TABLE "contact" ADD COLUMN "defaultOfferPrice" DECIMAL(10,2);
