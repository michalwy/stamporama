-- A contact's own free-extras terms (#2416): a regular customer can be treated more generously than
-- a platform's terms (#2409) treat every buyer on it. The same three optional fields as a platform's;
-- on a sale to the contact each is combined with the platform's by taking the one better for the
-- buyer — the lower minimum order, the higher percentage, the higher maximum. A field left empty here
-- uses the platform's. The two amounts are in the collection's base currency, converted into the
-- sale's where they differ.
ALTER TABLE "contact" ADD COLUMN "freeExtrasMinimumOrder" DECIMAL(10,2);
ALTER TABLE "contact" ADD COLUMN "freeExtrasBudgetPercent" DECIMAL(5,2);
ALTER TABLE "contact" ADD COLUMN "freeExtrasMaximumBudget" DECIMAL(10,2);

-- Each is a positive figure when set: a zero would read as a setting while meaning none.
ALTER TABLE "contact" ADD CONSTRAINT "contact_free_extras_positive"
  CHECK (
    ("freeExtrasMinimumOrder" IS NULL OR "freeExtrasMinimumOrder" > 0)
    AND ("freeExtrasBudgetPercent" IS NULL OR "freeExtrasBudgetPercent" > 0)
    AND ("freeExtrasMaximumBudget" IS NULL OR "freeExtrasMaximumBudget" > 0)
  );
