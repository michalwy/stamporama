-- Choosing by hand which variant an offer is listed under (extends #616).
--
-- The item-ID an unknown-variant umbrella is listed under is *derived* — the cheapest variant, from
-- the same rollup that values the copy — and nothing is stored. That stays the default. This table is
-- the override: one row wherever the collector has said which variant a particular offer sells a
-- particular stamp, in a particular condition, as.
--
-- Keyed on the On Colnect card's own row (`offer × stamp × condition`) rather than on the copy:
-- `offer_set_item` is N:M, so a per-copy choice would follow the copy into every other offer holding
-- it, and one offer's sets have to stay interchangeable (#405) — this key guarantees that instead of
-- merely permitting it. Per condition because that is what "cheapest" is resolved at.
--
-- `variantStampId` must be a descendant of `stampId`; a subtree is not expressible as a constraint,
-- so the writer validates it. Every reference cascades: the choice is meaningless without the offer,
-- the umbrella or the variant it names.
CREATE TABLE "offer_listed_variant" (
    "offerId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "variantStampId" TEXT NOT NULL,

    CONSTRAINT "offer_listed_variant_pkey" PRIMARY KEY ("offerId", "stampId", "conditionId")
);

CREATE INDEX "offer_listed_variant_offerId_idx" ON "offer_listed_variant"("offerId");
CREATE INDEX "offer_listed_variant_stampId_idx" ON "offer_listed_variant"("stampId");
CREATE INDEX "offer_listed_variant_conditionId_idx" ON "offer_listed_variant"("conditionId");
CREATE INDEX "offer_listed_variant_variantStampId_idx" ON "offer_listed_variant"("variantStampId");

ALTER TABLE "offer_listed_variant"
    ADD CONSTRAINT "offer_listed_variant_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offer_listed_variant"
    ADD CONSTRAINT "offer_listed_variant_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offer_listed_variant"
    ADD CONSTRAINT "offer_listed_variant_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offer_listed_variant"
    ADD CONSTRAINT "offer_listed_variant_variantStampId_fkey"
    FOREIGN KEY ("variantStampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
