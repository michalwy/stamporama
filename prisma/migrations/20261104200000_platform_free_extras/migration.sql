-- When a platform's sales are due free extras, and how generous they are (#2409): the free-extras
-- action on a sale (#2408) opens from these rather than from empty fields. All three optional; a
-- platform with none behaves as before. The two amounts are in the platform's own currency, or in
-- the collection's where the platform has none, and are converted into the sale's where they differ.
--
-- * the minimum order value, below which no free extra is due — a hint, never a block;
-- * the default budget, as a percentage of the order's value;
-- * the maximum budget, an amount capping what the percentage gives.
ALTER TABLE "platform" ADD COLUMN "freeExtrasMinimumOrder" DECIMAL(10,2);
ALTER TABLE "platform" ADD COLUMN "freeExtrasBudgetPercent" DECIMAL(5,2);
ALTER TABLE "platform" ADD COLUMN "freeExtrasMaximumBudget" DECIMAL(10,2);

-- Each is a positive figure when set: a zero would read as a setting while meaning none.
ALTER TABLE "platform" ADD CONSTRAINT "platform_free_extras_positive"
  CHECK (
    ("freeExtrasMinimumOrder" IS NULL OR "freeExtrasMinimumOrder" > 0)
    AND ("freeExtrasBudgetPercent" IS NULL OR "freeExtrasBudgetPercent" > 0)
    AND ("freeExtrasMaximumBudget" IS NULL OR "freeExtrasMaximumBudget" > 0)
  );
